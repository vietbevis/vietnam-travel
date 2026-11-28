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
const E=require('../../helpers/card-op.helper');
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
const key=crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const modulus=Buffer.from(key.publicKey.export({format:'jwk'}).n,'base64url').toString('hex').toUpperCase();
const cardId='A1'.repeat(16),newCardId='C1'.repeat(16),challenge='CD'.repeat(16);
const ADMIN_ID='0123456789abcdef0123abcd';
let server,base,A,cardA,tokenA,tour,permissions;
before(async()=> {
  process.env.JWT_SECRET='refund-fixture-secret';
  process.env.CARD_SERVER_KEY_PATH=path.resolve('smartcard/test-vectors/server-test-key.pem');
  process.env.CARD_ESCROW_MASTER='11'.repeat(32);
  if(db.enabled) {
    await db.connect();
    await Promise.all([Card,Customer,Order,Tour,Tx,Op,CardLog,Nonce].map(m=>m.init()));
  }
  const app=express();
  app.set('trust proxy',true);
  app.use(express.json());
  app.use(cookies());
  app.use('/card-api',require('../../routes/client/card-api.route'));
  // Sửa đơn quản trị (editPatch) không qua middleware flash/permission của trang admin.
  app.patch('/order-edit/:id',(req,res)=>{req.flash=()=>{};req.account={id:ADMIN_ID};req.permissions=permissions;require('../../controllers/admin/order.controller').editPatch(req,res);});
  server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  base='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=> {
  if(!db.enabled)
    return;
  await db.reset();
  permissions=['order-edit'];
  A=await Customer.create({fullName:'Khách A',email:'a@example.com',phone:'0901111111',totalSpent:30000000});
  cardA=await Card.create({cardId,cardType:'customer',ownerId:A.id,status:'active',publicKeyModulus:modulus,balance:2000000});
  tokenA=jwt.sign({customerId:A.id,cardId},process.env.JWT_SECRET,{expiresIn:'1d'});
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
    method:'POST',
    headers:{'content-type':'application/json',...(token?{cookie:'customerToken='+token}:{})},
    body:JSON.stringify(body)
  });
  const text=await r.text();
  let json={};
  try {
    json=JSON.parse(text);
  }
  catch {
  }
  return{status:r.status,text,...json};
}
async function patchOrder(id,body) {
  const r=await fetch(base+'/order-edit/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  return{status:r.status,...await r.json()};
}
function receipt({txRef,balance,amount,counter,type='debit',id=cardId}) {
  const m=Buffer.alloc(38);
  m[0]=0x52;
  Buffer.from(id,'hex').copy(m,1);
  m[17]=type==='credit'?1:2;
  Buffer.from(txRef,'hex').copy(m,18);
  m.writeUInt32BE(amount,26);
  m.writeUInt32BE(balance,30);
  m.writeUInt32BE(counter,34);
  return Buffer.concat([m,crypto.sign('sha256',m,key.privateKey)]).toString('hex');
}
const makeOrder=(extra={})=>Order.create({
  orderCode:'OD'+crypto.randomBytes(3).toString('hex').toUpperCase(),
  fullName:A.fullName,
  phone:A.phone,
  customerId:A.id,
  subTotal:1500000,
  discount:0,
  total:1500000,
  paymentMethod:'card',
  paymentStatus:'unpaid',
  status:'initial',
  items:[{tourId:tour.id,quantityAdult:1,quantityChildren:1,quantityBaby:0,ticketStatus:'none'}],
  ...extra
});
// Thanh toán ví thật: prepare -> sign -> confirm với biên nhận chữ ký thẻ (balance 2 000 000 -> 500 000).
async function paidByCard(extra={}) {
  const order=await makeOrder(extra);
  const prepared=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal(prepared.code,'success',prepared.text);
  const signed=await request('/card-api/op/sign',{opId:prepared.opId,challenge});
  assert.equal(signed.code,'success',signed.text);
  const debit=await Tx.findOne({orderId:order.id,type:'debit'}).lean();
  const confirmed=await request('/card-api/op/confirm',{opId:prepared.opId,response:receipt({txRef:debit.txRef,balance:500000,amount:1500000,counter:1}),sw:'9000'});
  assert.equal(confirmed.code,'success',confirmed.text);
  const paid=await Order.findById(order.id).lean();
  assert.equal(paid.paymentStatus,'paid');
  assert.equal((await Customer.findById(A.id)).totalSpent,31500000);
  return{order:paid,debit};
}
async function unchanged(order,{totalSpent=31500000}={}) {
  const kept=await Order.findById(order._id).lean();
  assert.deepEqual([kept.status,kept.paymentStatus,kept.refundTxRef,kept.stockRestoredAt],[order.status,'paid',undefined,undefined]);
  assert.equal(await Tx.countDocuments({source:'refund'}),0);
  assert.equal((await Customer.findById(A.id)).totalSpent,totalSpent);
  const stock=await Tour.findById(tour.id).lean();
  assert.deepEqual([stock.stockAdult,stock.stockChildren],[10,10]);
  assert.equal(await CardLog.countDocuments({action:'card-refund'}),0);
}

it('cancelling a wallet-paid order refunds the wallet once, restores stock and spend, and moves tickets',async()=> {
  const {order,debit}=await paidByCard();
  // Một vé đã ghi lên thẻ, một vé còn chờ ghi.
  await Order.updateOne({_id:order._id},{$set:{'items.0.ticketStatus':'written'}});
  await Order.updateOne({_id:order._id},{$push:{items:{tourId:tour.id,quantityAdult:2,quantityChildren:0,quantityBaby:0,ticketStatus:'pending'}}});
  const r=await patchOrder(order._id,{status:'cancel',fullName:order.fullName,phone:order.phone,note:'',paymentMethod:'card',paymentStatus:'paid'});
  assert.equal(r.code,'success',JSON.stringify(r));
  assert.equal(r.message,'Đã huỷ đơn và hoàn 1.500.000 đ vào ví thẻ. Tiền sẽ được ghi lên thẻ ở lần cắm thẻ tiếp theo.');
  assert.equal(r.refund.amount,1500000);
  assert.equal(r.refund.overCap,false);
  const cancelled=await Order.findById(order._id).lean();
  assert.equal(cancelled.status,'cancel');
  assert.equal(cancelled.paymentStatus,'paid');
  assert.ok(cancelled.stockRestoredAt);
  assert.deepEqual(cancelled.items.map(i=>i.ticketStatus),['pending-delete','none']);
  const refund=await Tx.findOne({source:'refund'}).lean();
  assert.deepEqual([refund.type,refund.status,refund.amount,refund.cardId,refund.orderId,refund.createdBy],['credit','pending-card',1500000,cardId,String(order._id),ADMIN_ID]);
  assert.equal(cancelled.refundTxRef,refund.txRef);
  assert.equal(r.refund.txRef,refund.txRef);
  // Debit gốc giữ nguyên làm chứng cứ thanh toán.
  assert.equal((await Tx.findById(debit._id)).status,'done');
  const stock=await Tour.findById(tour.id).lean();
  assert.deepEqual([stock.stockAdult,stock.stockChildren,stock.stockBaby],[13,11,10]);
  assert.equal((await Customer.findById(A.id)).totalSpent,30000000);
  const log=await CardLog.findOne({action:'card-refund'}).lean();
  assert.equal(log.cardId,cardId);
  assert.equal(log.actorType,'admin');
  assert.equal(log.actorId,ADMIN_ID);
  assert.equal(log.result,'success');
  assert.equal(log.detail.orderId,String(order._id));
  assert.equal(log.detail.txRef,refund.txRef);
  assert.equal(log.detail.amount,1500000);
  assert.equal(log.detail.debitTxRef,debit.txRef);
  assert.deepEqual([log.detail.totalSpentBefore,log.detail.totalSpentAfter],[31500000,30000000]);
  assert.equal(await CardLog.countDocuments({action:'ticket-order-cancel'}),1);
  // Lưu lại form / bấm lại huỷ: không hoàn lần hai, không hoàn kho lần hai.
  const again=await patchOrder(order._id,{status:'cancel'});
  assert.equal(again.refund,undefined);
  assert.equal(await Tx.countDocuments({source:'refund'}),1);
  assert.equal((await Tour.findById(tour.id)).stockAdult,13);
  assert.equal((await Customer.findById(A.id)).totalSpent,30000000);
  // Đơn đã huỷ không quay về chưa thanh toán (không mở đường trừ ví lần hai).
  const unpaid=await patchOrder(order._id,{paymentStatus:'unpaid'});
  assert.equal(unpaid.code,'error');
  assert.equal((await Order.findById(order._id)).paymentStatus,'paid');
});

it('concurrent double cancel creates exactly one refund and restores stock once',async()=> {
  const {order}=await paidByCard();
  const results=await Promise.all([patchOrder(order._id,{status:'cancel'}),patchOrder(order._id,{status:'cancel'}),patchOrder(order._id,{status:'cancel'})]);
  assert.equal(results.filter(r=>r.refund).length,1,JSON.stringify(results));
  assert.equal(await Tx.countDocuments({source:'refund'}),1);
  assert.equal(await CardLog.countDocuments({action:'card-refund'}),1);
  const stock=await Tour.findById(tour.id).lean();
  assert.deepEqual([stock.stockAdult,stock.stockChildren],[11,11]);
  assert.equal((await Customer.findById(A.id)).totalSpent,30000000);
});

it('the unique refund index refuses a second refund credit for the same order',async()=> {
  const {order}=await paidByCard();
  await Tx.create({txRef:'11'.repeat(8),cardId,type:'credit',source:'refund',amount:1500000,orderId:String(order._id),status:'pending-card'});
  await assert.rejects(Tx.create({txRef:'22'.repeat(8),cardId,type:'credit',source:'refund',amount:1500000,orderId:String(order._id),status:'pending-card'}),{code:11000});
  // Credit nguồn khác cùng orderId không bị index chặn.
  await Tx.create({txRef:'33'.repeat(8),cardId,type:'credit',source:'cash',amount:10000,orderId:String(order._id),status:'pending-card'});
  // Đơn đã có khoản hoàn: huỷ đơn bị từ chối, không đổi gì.
  const r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.code,'error');
  assert.match(r.message,/đã được hoàn tiền/);
  assert.equal((await Order.findById(order._id)).status,'initial');
});

it('the next card sync writes the refund credit to the chip with a verified receipt',async()=> {
  const {order}=await paidByCard();
  const r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.code,'success',JSON.stringify(r));
  const refund=await Tx.findOne({source:'refund'}).lean();
  const next=await request('/card-api/sync/next',{cardId,cardState:2,challenge});
  assert.equal(next.code,'success',next.text);
  assert.equal(next.step.kind,'op',next.text);
  const op=await Op.findById(next.step.opId).lean();
  assert.deepEqual([op.type,op.params.txRef],['credit',refund.txRef]);
  assert.equal((await Tx.findById(refund._id)).status,'sent');
  const confirmed=await request('/card-api/sync/confirm',{opId:next.step.opId,response:receipt({type:'credit',txRef:refund.txRef,balance:2000000,amount:1500000,counter:2}),sw:'9000'});
  assert.equal(confirmed.code,'success',confirmed.text);
  const done=await Tx.findById(refund._id).lean();
  assert.deepEqual([done.status,done.balanceAfter,done.txCounter],['done',2000000,2]);
  assert.ok(done.completedAt instanceof Date && done.completedAt >= refund.createdAt);
  const card=await Card.findOne({cardId}).lean();
  assert.deepEqual([card.balance,card.txCounter],[2000000,2]);
});

it('a refund credit not linked to a cancelled order cannot be signed onto the chip',async()=> {
  const {order}=await paidByCard();
  // Không gắn đơn, gắn đơn chưa huỷ, hoặc đơn trỏ sang txRef khác: đều bị policy từ chối.
  const cases=[{txRef:'44'.repeat(8)},{txRef:'55'.repeat(8),orderId:String(order._id)}];
  for(const row of cases) {
    await Tx.create({cardId,type:'credit',source:'refund',amount:10000,status:'pending-card',...row});
    await assert.rejects(E.createOp({cardId,type:'credit',params:{txRef:row.txRef},actorType:'system',actorId:'customer:'+A.id}),{code:'OP_STATE'});
    await Tx.deleteOne({txRef:row.txRef});
  }
  await Order.updateOne({_id:order._id},{$set:{status:'cancel',refundTxRef:'66'.repeat(8)}});
  await Tx.create({cardId,type:'credit',source:'refund',amount:10000,status:'pending-card',txRef:'77'.repeat(8),orderId:String(order._id)});
  await assert.rejects(E.createOp({cardId,type:'credit',params:{txRef:'77'.repeat(8)},actorType:'system',actorId:'customer:'+A.id}),{code:'OP_STATE'});
  // Bản chuyển sang thẻ mới khi cấp lại (movedFrom, không orderId) vẫn ghi được như credit chuyển số dư.
  await Tx.create({cardId,type:'credit',source:'refund',amount:10000,status:'pending-card',txRef:'88'.repeat(8),movedFrom:'77'.repeat(8)});
  const op=await E.createOp({cardId,type:'credit',params:{txRef:'88'.repeat(8)},actorType:'system',actorId:'customer:'+A.id});
  assert.ok(op);
});

it('a refund that would exceed the 50 000 000 wallet cap is recorded and held by sync for reconciliation',async()=> {
  const {order}=await paidByCard();
  await Card.updateOne({cardId},{$set:{balance:49000000}});
  const r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.code,'success',JSON.stringify(r));
  assert.equal(r.refund.overCap,true);
  assert.match(r.message,/vượt hạn mức 50\.000\.000 đ/);
  const refund=await Tx.findOne({source:'refund'}).lean();
  assert.equal(refund.status,'pending-card');
  assert.equal((await CardLog.findOne({action:'card-refund'})).detail.overCap,true);
  // Đồng bộ không ký credit vượt trần (applet sẽ từ chối), giữ lại và ghi nhật ký đúng một lần.
  const next=await request('/card-api/sync/next',{cardId,cardState:2,challenge});
  assert.equal(next.code,'success',next.text);
  assert.equal(next.step,null);
  const held=await Tx.findById(refund._id).lean();
  assert.ok(held.capHeldAt);
  assert.equal(held.status,'pending-card');
  assert.equal(await CardLog.countDocuments({action:'card-sync-credit-held',cardId}),1);
});

it('refund goes to the customer current card after the paying card was replaced',async()=> {
  const {order,debit}=await paidByCard();
  await Card.updateOne({cardId},{$set:{status:'revoked',isCurrent:false,revokedReason:'replaced',balance:0}});
  await Card.create({cardId:newCardId,cardType:'customer',ownerId:A.id,status:'active',publicKeyModulus:modulus,balance:500000,replaceOf:cardId});
  const r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.code,'success',JSON.stringify(r));
  assert.match(r.message,/thẻ hiện tại của khách/);
  const refund=await Tx.findOne({source:'refund'}).lean();
  assert.equal(refund.cardId,newCardId);
  assert.equal(r.refund.cardId,newCardId);
  const log=await CardLog.findOne({action:'card-refund'}).lean();
  assert.deepEqual([log.cardId,log.detail.paidCardId],[newCardId,debit.cardId]);
});

it('refund is refused with a clear message when the customer has no active card',async()=> {
  const {order}=await paidByCard();
  await Card.updateOne({cardId},{$set:{status:'locked'}});
  let r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.code,'error');
  assert.match(r.message,/đang bị khoá/);
  await unchanged(order);
  await Card.updateOne({cardId},{$set:{status:'revoked',isCurrent:false}});
  r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.code,'error');
  assert.match(r.message,/không còn thẻ đang hoạt động/);
  await unchanged(order);
});

it('a paid card order without a done debit receipt is refused for manual reconciliation',async()=> {
  const order=await makeOrder({paymentStatus:'paid',cardTxRef:'99'.repeat(8)});
  const r=await patchOrder(order.id,{status:'cancel'});
  assert.equal(r.code,'error');
  assert.match(r.message,/Không tìm thấy giao dịch trừ ví thẻ đã hoàn tất/);
  await unchanged(order.toObject(),{totalSpent:30000000});
});

it('paid orders of other payment methods still require manual refund reconciliation',async()=> {
  for(const paymentMethod of ['money','bank','zalopay','vnpay']) {
    await Order.deleteMany({});
    const order=await makeOrder({paymentMethod,paymentStatus:'paid'});
    const r=await patchOrder(order.id,{status:'cancel'});
    assert.equal(r.code,'error');
    assert.equal(r.message,'Đơn đã thanh toán cần xử lý hoàn tiền và đối soát riêng.');
    await unchanged(order.toObject(),{totalSpent:30000000});
  }
});

it('an unpaid card order with a signed debit awaiting its receipt asks to sync the card first',async()=> {
  const order=await makeOrder();
  const prepared=await request('/card-api/pay/prepare',{orderId:order.id});
  assert.equal((await request('/card-api/op/sign',{opId:prepared.opId,challenge})).code,'success');
  const r=await patchOrder(order.id,{status:'cancel'});
  assert.equal(r.code,'error');
  assert.equal(r.message,'Đơn đang có giao dịch ví thẻ chưa đối soát; hãy để khách cắm thẻ đồng bộ trước');
  assert.equal((await Order.findById(order.id)).status,'initial');
  assert.equal(await Tx.countDocuments({source:'refund'}),0);
});

it('an already cancelled order keeps the existing message and never refunds',async()=> {
  const {order}=await paidByCard();
  assert.equal((await patchOrder(order._id,{status:'cancel'})).code,'success');
  const r=await patchOrder(order._id,{status:'initial'});
  assert.equal(r.code,'error');
  assert.equal(r.message,'Đơn hàng đã huỷ, không thể đổi sang trạng thái khác!');
  assert.equal(await Tx.countDocuments({source:'refund'}),1);
});

it('cancel requires the order-edit permission',async()=> {
  const {order}=await paidByCard();
  permissions=[];
  const r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.status,403);
  await unchanged(order);
});

it('an audit failure rolls back the refund, stock, spend, tickets and order together',async t=> {
  const {order}=await paidByCard();
  await Order.updateOne({_id:order._id},{$set:{'items.0.ticketStatus':'written'}});
  const create=CardLog.create.bind(CardLog);
  t.mock.method(CardLog,'create',async(docs,options)=> {
    if(Array.isArray(docs)&&docs[0]?.action==='card-refund')
      throw new Error('audit down');
    return create(docs,options);
  });
  const r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.code,'error');
  t.mock.restoreAll();
  await unchanged(order);
  assert.deepEqual((await Order.findById(order._id).lean()).items.map(i=>i.ticketStatus),['written']);
  assert.equal((await Card.findOne({cardId})).balance,500000);
});

const USED_MESSAGE='Đơn có vé đã check-in, không thể huỷ và hoàn tiền tự động. Vui lòng xử lý thủ công.';
it('a wallet-paid order whose ticket was checked in is refused and nothing changes',async()=> {
  const {order}=await paidByCard();
  await Order.updateOne({_id:order._id},{$set:{'items.0.ticketStatus':'used','items.0.checkedInAt':new Date(),'items.0.checkedInBy':ADMIN_ID}});
  const r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.code,'error');
  assert.equal(r.message,USED_MESSAGE);
  await unchanged(order);
  assert.deepEqual((await Order.findById(order._id).lean()).items.map(i=>i.ticketStatus),['used']);
  assert.equal((await Card.findOne({cardId})).balance,500000);
});

it('mixed items with one checked-in ticket block the whole cancel and refund',async()=> {
  const {order}=await paidByCard();
  await Order.updateOne({_id:order._id},{$set:{'items.0.ticketStatus':'written'}});
  await Order.updateOne({_id:order._id},{$push:{items:{$each:[
    {tourId:tour.id,quantityAdult:1,quantityChildren:0,quantityBaby:0,ticketStatus:'used',checkedInAt:new Date()},
    {tourId:tour.id,quantityAdult:1,quantityChildren:0,quantityBaby:0,ticketStatus:'pending'}
  ]}}});
  const r=await patchOrder(order._id,{status:'cancel'});
  assert.equal(r.code,'error');
  assert.equal(r.message,USED_MESSAGE);
  await unchanged(order);
  assert.deepEqual((await Order.findById(order._id).lean()).items.map(i=>i.ticketStatus),['written','used','pending']);
  assert.equal(await CardLog.countDocuments({action:'ticket-order-cancel'}),0);
});

it('a legacy unpaid order with a checked-in ticket is refused by the same rule',async()=> {
  const order=await makeOrder({paymentMethod:'money',items:[{tourId:tour.id,quantityAdult:1,quantityChildren:1,quantityBaby:0,ticketStatus:'used'}]});
  const r=await patchOrder(order.id,{status:'cancel'});
  assert.equal(r.code,'error');
  assert.equal(r.message,USED_MESSAGE);
  const kept=await Order.findById(order.id).lean();
  assert.deepEqual([kept.status,kept.stockRestoredAt],['initial',undefined]);
  assert.equal((await Tour.findById(tour.id)).stockAdult,10);
});
