const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const express=require('express');
const cookies=require('cookie-parser');
const jwt=require('jsonwebtoken');
const db=require('../helpers/db');
const Card=require('../../models/card.model');
const Customer=require('../../models/customer.model');
const Account=require('../../models/account-admin.model');
const Role=require('../../models/role.model');
const Op=require('../../models/card-operation.model');
const Log=require('../../models/card-log.model');
const Order=require('../../models/order.model');
const E=require('../../helpers/card-op.helper');
const T=require('../../helpers/ticket.helper');
const Sync=require('../../helpers/card-sync.helper');
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
const permissions=['card-view','card-checkin','card-edit'];
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const modulus=Buffer.from(keys.publicKey.export({format:'jwk'}).n,'base64url').toString('hex').toUpperCase();
const tourId='0123456789abcdef01234567',otherTourId='76543210fedcba9876543210',challenge='AB'.repeat(16);
const NOT_ALLOWED='Bạn không có quyền sử dụng tính năng này!';
let server,base,admin,token,staffCard,owner,customerCard,seq=0;
before(async()=>{
  process.env.JWT_SECRET='task15-isolated-secret';process.env.CARD_SERVER_KEY_PATH=path.resolve('smartcard/test-vectors/server-test-key.pem');
  if(db.enabled){await db.connect();await Promise.all([Card,Customer,Account,Role,Op,Log,Order].map(model=>model.init()));}
  const app=express();app.set('view engine','pug');app.set('views',path.resolve('views'));app.locals.pathAdmin='admin';app.locals.messages={};app.use(express.json());app.use(cookies());
  // Kiểm cách order.controller huỷ đơn mà không cần toàn bộ middleware flash/permission của trang quản trị.
  app.patch('/order-edit/:id',(req,res)=>{req.flash=()=>{};req.account={id:String(admin.id)};require('../../controllers/admin/order.controller').editPatch(req,res);});
  app.use('/admin',require('../../routes/admin/index.route'));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=>{
  if(!db.enabled)return;await db.reset();seq=0;
  const role=await Role.create({name:'Task15',permissions});admin=await Account.create({fullName:'Nhân viên',email:'admin@example.invalid',role:role.id,status:'active'});
  staffCard=await Card.create({cardId:'FA'.repeat(16),cardType:'staff',ownerId:admin.id,status:'active',publicKeyModulus:modulus});
  token=jwt.sign({id:admin.id,email:admin.email,cardId:staffCard.cardId,stepUpAt:Date.now()},process.env.JWT_SECRET,{expiresIn:3600});
  owner=await Customer.create({fullName:'Trần Thị B',email:'owner@example.invalid',phone:'0900000001',bloodType:'O+',allergies:'Hải sản'});
  binding='customer:'+owner.id;sys={actorType:'customer',actorId:owner.id};
  customerCard=await Card.create({cardId:crypto.randomBytes(16).toString('hex').toUpperCase(),cardType:'customer',ownerId:owner.id,status:'active',isCurrent:true,publicKeyModulus:modulus});
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db.enabled)await db.close();});
const soon=()=>new Date(Date.now()+86400000*0.5);
async function order(extra={},itemExtra={}) {
  seq+=1;
  return Order.create({orderCode:'TASK15'+String(seq).padStart(6,'0'),customerId:owner.id,paymentStatus:'paid',status:'confirmed',fullName:'Trần Thị B',phone:'0900000001',items:[{tourId,departureDate:soon(),quantityAdult:2,quantityChildren:1,quantityBaby:0,ticketStatus:'written',...itemExtra}],...extra});
}
async function post(url,body,cookie=token) {
  const response=await fetch(base+'/admin/card/checkin/'+url,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie:'token='+cookie}:{})},body:JSON.stringify(body)});
  let json={};try{json=await response.json();}catch{}
  return{http:response.status,...json};
}
const lookup=(extra={})=>post('lookup',{cardId:customerCard.cardId,tourId,...extra});
const use=(o,itemIndex=0,extra={})=>post('use',{cardId:customerCard.cardId,orderId:String(o._id),itemIndex,...extra});
const actor={actorType:'admin'};
let binding,sys;
async function confirmUse(opId) {
  await E.signOp({opId,challengeHex:challenge,...actor,actorId:String(admin.id)});
  return E.confirmOp({opId,sw:'9000',...actor,actorId:String(admin.id)});
}
const status=async(o,i=0)=>(await Order.findById(o._id)).items[i].ticketStatus;

it('lookup and use require the card-checkin permission',async()=>{
  const o=await order();
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});
  for(const response of [await lookup(),await use(o)]){assert.equal(response.http,403);assert.equal(response.code,'error');assert.equal(response.message,NOT_ALLOWED);}
  assert.equal(await Op.countDocuments(),0);
});
it('lookup returns customer and only paid non-cancelled items of the requested tour',async()=>{
  const good=await order();
  await order({paymentStatus:'unpaid'});
  await order({status:'cancel'});
  await order({},{tourId:otherTourId});
  const r=await lookup();
  assert.equal(r.code,'success',JSON.stringify(r));
  assert.deepEqual(r.customer,{fullName:'Trần Thị B',phone:'0900000001',bloodType:'O+',allergies:'Hải sản'});
  assert.deepEqual(r.items,[{orderId:String(good._id),itemIndex:0,orderCode:good.orderCode,pax:3,ticketStatus:'written'}]);
  assert.ok(await Log.findOne({action:'checkin-lookup',result:'success',cardId:customerCard.cardId}));
});
it('lookup rejects outside the check-in window and inactive or non-customer cards',async()=>{
  await order({}, {departureDate:new Date(Date.now()+5*86400000)});
  assert.equal((await lookup()).message,'Chưa tới hoặc đã qua ngày check-in');
  await Order.deleteMany({});
  await order({},{departureDate:new Date(Date.now()-5*86400000)});
  assert.equal((await lookup()).message,'Chưa tới hoặc đã qua ngày check-in');
  await Card.updateOne({_id:customerCard._id},{$set:{status:'locked'}});
  assert.equal((await lookup()).http,409);
  assert.equal((await lookup({cardId:staffCard.cardId})).http,409);
  assert.equal((await lookup({tourId:'x'})).http,400);
  assert.ok(await Log.findOne({action:'checkin-lookup',result:'fail'}));
});
it('use refuses pending, outside window, cancelled, unpaid and foreign orders with the specified messages',async()=>{
  const pending=await order({},{ticketStatus:'pending'});
  assert.equal((await use(pending)).message,'Vé chưa được ghi lên thẻ, hãy đồng bộ trước');
  const early=await order({},{departureDate:new Date(Date.now()+5*86400000)});
  assert.equal((await use(early)).message,'Chưa tới hoặc đã qua ngày check-in');
  const cancelled=await order({status:'cancel'});assert.equal((await use(cancelled)).http,409);
  const unpaid=await order({paymentStatus:'unpaid'});assert.equal((await use(unpaid)).http,409);
  const stranger=await order({customerId:new (require('mongoose').Types.ObjectId)().toString()});assert.equal((await use(stranger)).http,409);
  assert.equal((await use(await order(),9)).http,404);
  assert.equal(await Op.countDocuments(),0);
  assert.equal(await Log.countDocuments({action:'checkin-use',result:'fail'}),6);
});
it('use-ticket confirm marks the item used with checkedInBy and a second check-in says already used',async()=>{
  const o=await order();
  const first=await use(o);
  assert.equal(first.code,'success',JSON.stringify(first));
  const confirmed=await confirmUse(first.opId);
  assert.equal(confirmed.ok,true);
  const item=(await Order.findById(o._id)).items[0];
  assert.equal(item.ticketStatus,'used');assert.equal(item.checkedInBy,String(admin.id));assert.ok(item.checkedInAt instanceof Date);
  const second=await use(o);
  assert.equal(second.http,409);assert.equal(second.message,'Vé đã sử dụng');
  const l=await lookup();assert.equal(l.items[0].ticketStatus,'used');
  assert.ok(await Log.findOne({action:'checkin-use',result:'success',cardId:customerCard.cardId}));
});
it('admin cancel maps written to pending-delete and pending to none, idempotently, and sync then plans DELETE',async()=>{
  const o=await order({},{ticketStatus:'written'});
  await Order.updateOne({_id:o._id},{$push:{items:[{tourId,departureDate:soon(),quantityAdult:1,ticketStatus:'pending'},{tourId,departureDate:soon(),quantityAdult:1,ticketStatus:'used'}]}});
  const response=await fetch(base+'/order-edit/'+o._id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:'cancel'})});
  assert.equal((await response.json()).code,'success');
  assert.deepEqual((await Order.findById(o._id)).items.map(i=>i.ticketStatus),['pending-delete','none','used']);
  const logs=await Log.find({action:'ticket-order-cancel'});assert.equal(logs.length,1);assert.equal(logs[0].cardId,customerCard.cardId);assert.equal(logs[0].actorId,String(admin.id));
  await T.onOrderCancelled(o);await T.onOrderCancelled(await Order.findById(o._id));
  assert.deepEqual((await Order.findById(o._id)).items.map(i=>i.ticketStatus),['pending-delete','none','used']);
  assert.equal(await Log.countDocuments({action:'ticket-order-cancel'}),1);
  const context=await Sync.loadSyncContext(await Card.findById(customerCard._id).lean());
  const step=Sync.planNextSync({card:(await Card.findById(customerCard._id).lean()),cardState:2,...context});
  assert.deepEqual(step,{kind:'op',type:'delete-ticket',params:{orderId:String(o._id),itemIndex:0}});
  const op=await E.createOp({cardId:customerCard.cardId,type:'delete-ticket',params:step.params,actorType:'system',actorId:binding});
  await E.signOp({opId:op.id,challengeHex:challenge,...sys});
  assert.equal((await E.confirmOp({opId:op.id,sw:'9000',...sys})).ok,true);
  assert.equal(await status(o),'deleted');
  assert.equal(Sync.planNextSync({card:customerCard.toObject(),cardState:2,...await Sync.loadSyncContext(customerCard.toObject())}),null);
});
it('cancel while a write-ticket op was already signed keeps the ticket tracked for deletion',async()=>{
  const o=await order({},{ticketStatus:'pending'});
  const op=await E.createOp({cardId:customerCard.cardId,type:'write-ticket',params:{orderId:String(o._id),itemIndex:0},actorType:'system',actorId:binding});
  await E.signOp({opId:op.id,challengeHex:challenge,...sys});
  assert.ok((await Order.findById(o._id)).items[0].get('writeSignedAt'));
  await Order.updateOne({_id:o._id},{$set:{status:'cancel'}});
  await T.onOrderCancelled(o);
  // Thẻ có thể đã nhận vé: không được về none mà phải chờ xoá.
  assert.equal(await status(o),'pending-delete');
  // Confirm ghi vé đến muộn bị từ chối, không hồi sinh item.
  await assert.rejects(E.confirmOp({opId:op.id,sw:'9000',...sys}),/OP_STATE/);
  assert.equal(await status(o),'pending-delete');
  const delOp=await E.createOp({cardId:customerCard.cardId,type:'delete-ticket',params:{orderId:String(o._id),itemIndex:0},actorType:'system',actorId:binding});
  await E.signOp({opId:delOp.id,challengeHex:challenge,...sys});
  // Thẻ chưa từng nhận vé (6A88) vẫn kết thúc vòng xoá.
  assert.equal((await E.confirmOp({opId:delOp.id,sw:'6A88',...sys})).ok,true);
  assert.equal(await status(o),'deleted');
});
it('cancel of a pending ticket that was never signed goes straight to none',async()=>{
  const o=await order({status:'cancel'},{ticketStatus:'pending'});
  await T.onOrderCancelled(o);
  assert.equal(await status(o),'none');
});
