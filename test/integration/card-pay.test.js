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
const Order=require('../../models/order.model');
const Tour=require('../../models/tour.model');
const Tx=require('../../models/card-transaction.model');
const Op=require('../../models/card-operation.model');
const CardLog=require('../../models/card-log.model');
const Nonce=require('../../models/card-nonce.model');
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
const key=crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const modulus=Buffer.from(key.publicKey.export({format:'jwk'}).n,'base64url').toString('hex').toUpperCase();
const cardId='A1'.repeat(16),otherCardId='B1'.repeat(16),challenge='CD'.repeat(16);
let server,base,A,B,cardA,cardB,tokenA,tokenB,tour;
before(async()=> {
  process.env.JWT_SECRET='task13-fixture-secret';
  process.env.CARD_SERVER_KEY_PATH=path.resolve('smartcard/test-vectors/server-test-key.pem');
  process.env.CARD_ESCROW_MASTER='11'.repeat(32);
  if(db.enabled)
    await db.connect();
  if(db.enabled)
    await Promise.all([Card,Customer,Order,Tour,Tx,Op,CardLog,Nonce].map(m=>m.init()));
  const app=express();
  app.set('trust proxy',true);
  app.set('view engine','pug');
  app.set('views',path.resolve('views'));
  app.locals.messages={};
  app.locals.settingWebsiteInfo={};
  app.locals.categoryList=[];
  app.locals.cardAgentUrl='';
  app.use(express.json());
  app.use(cookies());
  app.use('/card-api',require('../../routes/client/card-api.route'));
  app.use('/order',require('../../middlewares/client/customer-auth.middleware').optional,require('../../routes/client/order.route'));
  server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  base='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=> {
  if(!db.enabled)
    return;
  await db.reset();
  A=await Customer.create({fullName:'Khách A',email:'a@example.com',phone:'0901111111',totalSpent:30000000});
  B=await Customer.create({fullName:'Khách B',email:'b@example.com',phone:'0902222222',totalSpent:0});
  cardA=await Card.create({cardId,cardType:'customer',ownerId:A.id,status:'active',publicKeyModulus:modulus,balance:2000000});
  cardB=await Card.create({cardId:otherCardId,cardType:'customer',ownerId:B.id,status:'active',publicKeyModulus:modulus,balance:2000000});
  tokenA=jwt.sign({customerId:A.id,cardId},process.env.JWT_SECRET,{expiresIn:'1d'});
  tokenB=jwt.sign({customerId:B.id,cardId:otherCardId},process.env.JWT_SECRET,{expiresIn:'1d'});
  tour=await Tour.create({name:'Tour thử',status:'active',deleted:false,priceNewAdult:1000000,priceNewChildren:500000,priceNewBaby:0,stockAdult:10,stockChildren:10,stockBaby:10,departureDate:new Date('2026-12-01')});
});
after(async()=> {
  if(server)
    await new Promise(r=>server.close(r));
  if(db.enabled)
    await db.close();
});
async function request(url,body,token=tokenA) {
  const r=await fetch(base+url,{
    method:body===undefined?'GET':'POST',
    redirect:'manual',
    headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{cookie:'customerToken='+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const text=await r.text();
  let json={};
  try {
    json=JSON.parse(text);
  }
  catch {
  }
  return{status:r.status,headers:r.headers,text,...json};
}
function receipt({txRef,balance,amount,counter=1,id=cardId}) {
  const m=Buffer.alloc(38);
  m[0]=0x52;
  Buffer.from(id,'hex').copy(m,1);
  m[17]=2;
  Buffer.from(txRef,'hex').copy(m,18);
  m.writeUInt32BE(amount,26);
  m.writeUInt32BE(balance,30);
  m.writeUInt32BE(counter,34);
  return Buffer.concat([m,crypto.sign('sha256',m,key.privateKey)]).toString('hex');
}
const makeOrder=(customer,extra={})=>Order.create({
  orderCode:'OD1',
  fullName:customer.fullName,
  phone:customer.phone,
  customerId:customer.id,
  subTotal:extra.total??1500000,
  discount:0,
  total:1500000,
  paymentMethod:'card',
  paymentStatus:'unpaid',
  status:'initial',
  items:[{tourId:tour.id,quantityAdult:1,quantityChildren:1,quantityBaby:0,ticketStatus:'none'}],
  ...extra
});
const orderBody=(extra={})=>({fullName:'Khách A',phone:'0901111111',note:'',paymentMethod:'card',items:[{tourId:tour.id,locationFrom:'x',quantityAdult:2,quantityChildren:0,quantityBaby:0}],...extra});

it('payOtherCustomersOrderRejected',async()=> {
  const order=await makeOrder(B);
  const r=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(r.code,'error');
  assert.equal(await Tx.countDocuments(),0);
  assert.equal(await Op.countDocuments(),0);
  assert.equal((await Order.findById(order.id)).cardTxRef,undefined);
});
it('pay prepare blocks while debit sent',async()=> {
  const order=await makeOrder(A,{cardTxRef:'AB'.repeat(8)});
  await Tx.create({cardId,txRef:'AB'.repeat(8),type:'debit',source:'order',amount:1500000,orderId:order.id,status:'sent',signedOpId:'0123456789abcdef01234567'});
  const r=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(r.code,'error');
  assert.equal(r.message,'Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ');
  assert.equal(await Tx.countDocuments(),1);
  assert.equal(await Op.countDocuments(),0);
});
it('pay prepare blocks while a signed pending-card debit awaits receipt recovery',async()=> {
  const order=await makeOrder(A,{cardTxRef:'AB'.repeat(8)});
  await Tx.create({cardId,txRef:'AB'.repeat(8),type:'debit',source:'order',amount:1500000,orderId:order.id,status:'pending-card',signedOpId:'0123456789abcdef01234567'});
  const r=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(r.code,'error');
  assert.equal(r.message,'Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ');
  assert.equal(await Op.countDocuments(),0);
});
it('createPost applies tier discount',async()=> {
  const r=await request('/order/create',orderBody({items:[{tourId:tour.id,locationFrom:'x',quantityAdult:2,quantityChildren:0,quantityBaby:0}]}));
  assert.equal(r.code,'success',r.text);
  const order=await Order.findById(r.orderId).lean();
  assert.equal(order.subTotal,2000000);
  assert.equal(order.discount,100000);
  assert.equal(order.total,1900000);
  assert.equal(order.customerId,A.id);
  assert.ok(order.items.every(i=>i.ticketStatus==='none'));
});
it('createPost ignores client supplied customerId and gives guests no discount',async()=> {
  const r=await request('/order/create',orderBody({paymentMethod:'money',customerId:B.id,cardTxRef:'AB'.repeat(8),discount:999999,total:1}),'');
  assert.equal(r.code,'success',r.text);
  const order=await Order.findById(r.orderId).lean();
  assert.equal(order.customerId,undefined);
  assert.equal(order.cardTxRef,undefined);
  assert.equal(order.discount,0);
  assert.equal(order.total,2000000);
});
it('createPost card payment without login is rejected before touching stock',async()=> {
  const r=await request('/order/create',orderBody(),'');
  assert.equal(r.code,'error');
  assert.equal(await Order.countDocuments(),0);
  assert.equal((await Tour.findById(tour.id)).stockAdult,10);
});
it('debit confirm marks paid and queues tickets',async()=> {
  const order=await makeOrder(A);
  const prepared=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(prepared.code,'success',prepared.text);
  assert.equal(prepared.amount,1500000);
  const tx=await Tx.findOne({orderId:order.id});
  assert.equal(tx.type,'debit');
  assert.equal(tx.source,'order');
  assert.equal(tx.status,'pending-card');
  assert.equal((await Order.findById(order.id)).cardTxRef,tx.txRef);
  const signed=await request('/card-api/op/sign',{opId:prepared.opId,challenge});
  assert.equal(signed.code,'success',signed.text);
  assert.equal(signed.apdu.slice(2,4),'52');
  const confirmed=await request('/card-api/op/confirm',{opId:prepared.opId,response:receipt({txRef:tx.txRef,balance:500000,amount:1500000}),sw:'9000'});
  assert.equal(confirmed.code,'success',confirmed.text);
  const paid=await Order.findById(order.id).lean();
  assert.equal(paid.paymentStatus,'paid');
  assert.deepEqual(paid.items.map(i=>i.ticketStatus),['pending']);
  assert.equal((await Customer.findById(A.id)).totalSpent,31500000);
  const stored=await Card.findOne({cardId});
  assert.equal(stored.balance,500000);
  assert.equal((await Tx.findById(tx.id)).status,'done');
  assert.ok(await CardLog.exists({cardId,result:'success',action:'card-pay-prepare'}));
  const again=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(again.code,'error');
});
it('insufficient balance is refused without tx or op',async()=> {
  const order=await makeOrder(A,{total:2500000});
  const r=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(r.code,'error');
  assert.equal(r.message,'Số dư ví không đủ');
  assert.equal(await Tx.countDocuments(),0);
  assert.equal(await Op.countDocuments(),0);
  assert.ok(await CardLog.exists({cardId,result:'fail',action:'card-pay-prepare'}));
});
it('lost confirm is recovered by receipt exactly once and prepare stays blocked until then',async()=> {
  const order=await makeOrder(A);
  const prepared=await request('/card-api/pay/prepare',{orderId:order.id});
  await request('/card-api/op/sign',{opId:prepared.opId,challenge});
  const tx=await Tx.findOne({orderId:order.id});
  assert.equal(tx.status,'sent');
  // Trình duyệt mất kết nối: không gọi op/confirm.
  const blocked=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(blocked.code,'error');
  assert.equal(blocked.message,'Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ');
  // Đồng bộ kế tiếp phải yêu cầu GET_RECEIPT cho đúng giao dịch.
  const next=await request('/card-api/sync/next',{cardId,cardState:2,challenge},'');
  assert.equal(next.step.kind,'receipt');
  assert.equal(next.step.txRef.toUpperCase(),tx.txRef);
  const body={cardId,txRef:tx.txRef,response:receipt({txRef:tx.txRef,balance:500000,amount:1500000}),sw:'9000'};
  const first=await request('/card-api/sync/receipt',body,'');
  assert.equal(first.ok,true,first.text);
  const second=await request('/card-api/sync/receipt',body,'');
  assert.equal(second.ok,false);
  assert.equal((await Order.findById(order.id)).paymentStatus,'paid');
  assert.equal((await Customer.findById(A.id)).totalSpent,31500000);
  assert.equal((await Card.findOne({cardId})).balance,500000);
});
it('unsigned abandoned prepare is reused instead of dead-locking the order',async()=> {
  const order=await makeOrder(A);
  const first=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(first.code,'success');
  await Op.deleteMany({});
  const second=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(second.code,'success',second.text);
  assert.equal(await Tx.countDocuments(),1);
  assert.notEqual(second.opId,first.opId);
});
it('prepare refuses unauthenticated, cancelled, paid, non-card orders and bad input',async()=> {
  const order=await makeOrder(A);
  assert.equal((await request('/card-api/pay/prepare',{orderId:order.id},'')).status,401);
  assert.equal((await request('/card-api/pay/prepare',{orderId:'zz'})).status,400);
  assert.equal((await request('/card-api/pay/prepare',{orderId:order.id,extra:1})).status,400);
  for(const extra of [{status:'cancel'},{paymentStatus:'paid'},{paymentMethod:'zalopay'},{deleted:true}]) {
    const o=await makeOrder(A,extra);
    assert.equal((await request('/card-api/pay/prepare',{orderId:o.id})).code,'error');
  }
  assert.equal(await Tx.countDocuments(),0);
});
it('payment page renders for owner only',async()=> {
  const order=await makeOrder(A);
  const mine=await request('/order/payment-card?orderId='+order.id);
  assert.equal(mine.status,200);
  assert.match(mine.text,/1\.500\.000/);
  assert.match(mine.text,/2\.000\.000/);
  const other=await request('/order/payment-card?orderId='+order.id,undefined,tokenB);
  assert.equal(other.status,302);
  const guest=await request('/order/payment-card?orderId='+order.id,undefined,'');
  assert.equal(guest.status,302);
});
