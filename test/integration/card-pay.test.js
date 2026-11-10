// Task 13: tạo đơn có giảm giá hạng, prepare debit ví thẻ và settlement qua receipt.
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const express=require('express');
const cookies=require('cookie-parser');
const jwt=require('jsonwebtoken');
const db=require('../helpers/db');
const Card=require('../../models/card.model');
const Tx=require('../../models/card-transaction.model');
const Op=require('../../models/card-operation.model');
const Order=require('../../models/order.model');
const Customer=require('../../models/customer.model');
const Tour=require('../../models/tour.model');
const key=crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const modulus=Buffer.from(key.publicKey.export({format:'jwk'}).n,'base64url').toString('hex').toUpperCase();
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
const cardIdA='A1'.repeat(16),cardIdB='B2'.repeat(16),challenge='CD'.repeat(16);
const config=require('../../config/variable');
let server,base,custA,custB,cardA,cardB,tour;
before(async()=> {
  process.env.JWT_SECRET='task13-fixture-secret';
  process.env.CARD_SERVER_KEY_PATH=path.resolve('smartcard/test-vectors/server-test-key.pem');
  process.env.CARD_ESCROW_MASTER='11'.repeat(32);
  if(db.enabled) {
    await db.connect();
    await Promise.all([Card,Tx,Op,Order,Customer,Tour].map(m=>m.init()));
  }
  const app=express();
  app.set('view engine','pug');
  app.set('views',path.resolve('views'));
  app.locals.messages={};
  app.locals.settingWebsiteInfo={};
  app.locals.categoryList=[];
  app.locals.cardAgentUrl='';
  app.use(express.json());
  app.use(cookies());
  app.use('/card-api',require('../../routes/client/card-api.route'));
  app.use(require('../../middlewares/client/customer-auth.middleware').optional);
  app.use('/order',require('../../routes/client/order.route'));
  app.use('/cart',require('../../routes/client/cart.route'));
  server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  base='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=> {
  if(!db.enabled)
    return;
  await db.reset();
  custA=await Customer.create({fullName:'Khách A Kiểm Thử',email:'a@example.com',phone:'0901111111',totalSpent:0});
  custB=await Customer.create({fullName:'Khách B Kiểm Thử',email:'b@example.com',phone:'0902222222',totalSpent:0});
  cardA=await Card.create({cardId:cardIdA,cardType:'customer',ownerId:custA.id,status:'active',publicKeyModulus:modulus,balance:2000000});
  cardB=await Card.create({cardId:cardIdB,cardType:'customer',ownerId:custB.id,status:'active',publicKeyModulus:modulus,balance:2000000});
  tour=await Tour.create({name:'Tour kiểm thử',status:'active',deleted:false,priceNewAdult:1000000,priceNewChildren:500000,priceNewBaby:0,stockAdult:10,stockChildren:10,stockBaby:10,departureDate:new Date('2027-01-01'),avatar:'https://example.invalid/a.jpg'});
});
after(async()=> {
  if(server)
    await new Promise(r=>server.close(r));
  if(db.enabled)
    await db.close();
});
const tokenOf=(customer,card)=>jwt.sign({customerId:customer.id,cardId:card.cardId},process.env.JWT_SECRET,{expiresIn:'1d'});
const cookieA=()=>tokenOf(custA,cardA),cookieB=()=>tokenOf(custB,cardB);
async function call(method,url,body,cookie,headers={}) {
  const res=await fetch(base+url,{method,redirect:'manual',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie:'customerToken='+cookie}:{}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
  const text=await res.text();
  let json;
  try {
    json=JSON.parse(text);
  }
  catch {
  }
  return{status:res.status,text,json,headers:res.headers};
}
const items=(extra={})=>[{tourId:tour.id,locationFrom:'123456789012345678901234',quantityAdult:2,quantityChildren:0,quantityBaby:0,...extra}];
const form=(extra={})=>({fullName:'Khách hàng thử',phone:'0901234567',note:'',paymentMethod:'card',items:items(),...extra});
async function create(cookie=cookieA(),body=form()) {
  return call('POST','/order/create',body,cookie);
}
async function cardOrder(cookie=cookieA()) {
  const r=await create(cookie);
  assert.equal(r.json?.code,'success',r.text);
  return Order.findById(r.json.orderId);
}
const prepare=(orderId,cookie=cookieA(),extra={})=>call('POST','/card-api/pay/prepare',{orderId,...extra},cookie);
function receipt({tx,counter=1,balance,amount,id=cardIdA,privateKey=key.privateKey,type='debit'}) {
  const m=Buffer.alloc(38);
  m[0]=0x52;
  Buffer.from(id,'hex').copy(m,1);
  m[17]=type==='credit'?1:2;
  Buffer.from(tx.txRef,'hex').copy(m,18);
  m.writeUInt32BE(amount??tx.amount,26);
  m.writeUInt32BE(balance??2000000-tx.amount,30);
  m.writeUInt32BE(counter,34);
  return Buffer.concat([m,crypto.sign('sha256',m,privateKey)]).toString('hex');
}
async function signed(order,cookie=cookieA()) {
  const p=await prepare(order.id,cookie);
  assert.equal(p.status,200,p.text);
  const s=await call('POST','/card-api/op/sign',{opId:p.json.opId,challenge},cookie);
  assert.equal(s.status,200,s.text);
  return{opId:p.json.opId,tx:await Tx.findOne({orderId:order.id})};
}
const confirm=(opId,response,cookie=cookieA(),sw='9000')=>call('POST','/card-api/op/confirm',{opId,response,sw},cookie);

// ---- Phần 1: tạo đơn và giảm giá ----
it('payment method card is configured',()=> {
  assert.deepEqual(config.paymentMethod.find(m=>m.value==='card'),{label:'Ví thẻ thành viên',value:'card'});
});
it('createPost applies backend tier discount at exact thresholds',async()=> {
  await Tour.updateOne({_id:tour.id},{$set:{stockAdult:100}});
  const rows=[[0,0],[9999999,0],[10000000,60000],[29999999,60000],[30000000,100000],[79999999,100000],[80000000,160000]];
  for(const [spent,discount] of rows) {
    await Customer.updateOne({_id:custA.id},{$set:{totalSpent:spent}});
    const order=await cardOrder();
    assert.equal(order.subTotal,2000000,String(spent));
    assert.equal(order.discount,discount,String(spent));
    assert.equal(order.total,2000000-discount);
  }
});
it('gold customer with 2.000.000 subTotal gets 100.000 off and total 1.900.000 with fixed linkage',async()=> {
  await Customer.updateOne({_id:custA.id},{$set:{totalSpent:30000000}});
  const order=await cardOrder();
  assert.equal(order.discount,100000);
  assert.equal(order.total,1900000);
  assert.equal(order.customerId,custA.id);
  assert.equal(order.paymentStatus,'unpaid');
  assert.equal(order.status,'initial');
  assert.ok(order.items.length>0&&order.items.every(i=>i.ticketStatus==='none'));
});
it('client supplied customerId discount totals prices status and tier are ignored',async()=> {
  const r=await create(cookieA(),form({customerId:custB.id,discount:1999999,total:1,subTotal:1,status:'done',paymentStatus:'paid',cardTxRef:'AB'.repeat(8),deleted:true,tier:'platinum',items:items({priceNewAdult:1,priceNewChildren:1,priceNewBaby:1,discount:5,ticketStatus:'pending',name:'giả'})}));
  assert.equal(r.json.code,'success',r.text);
  const order=await Order.findById(r.json.orderId).lean();
  assert.equal(order.customerId,custA.id);
  assert.equal(order.subTotal,2000000);
  assert.equal(order.discount,0);
  assert.equal(order.total,2000000);
  assert.equal(order.status,'initial');
  assert.equal(order.paymentStatus,'unpaid');
  assert.equal(order.deleted,false);
  assert.equal(order.cardTxRef,undefined);
  assert.equal(order.items[0].priceNewAdult,1000000);
  assert.equal(order.items[0].name,'Tour kiểm thử');
  assert.equal(order.items[0].ticketStatus,'none');
});
it('anonymous visitor cannot choose card and nothing is reserved',async()=> {
  const r=await create('',form());
  assert.equal(r.json.code,'error');
  assert.match(r.json.message,/đăng nhập/i);
  assert.equal(await Order.countDocuments(),0);
  assert.equal((await Tour.findById(tour.id)).stockAdult,10);
});
it('anonymous forged customerId on other methods is not linked and gets no discount',async()=> {
  const r=await create('',form({paymentMethod:'money',customerId:custB.id,discount:500}));
  assert.equal(r.json.code,'success',r.text);
  const order=await Order.findById(r.json.orderId).lean();
  assert.equal(order.customerId,undefined);
  assert.equal(order.discount,0);
  assert.equal(order.total,2000000);
});
it('invalid quantities unknown tours unknown methods and over-stock are rejected without stock change',async()=> {
  const bad=[items({quantityAdult:-1}),items({quantityAdult:1.5}),items({quantityAdult:'2'}),items({quantityAdult:0}),items({quantityAdult:11}),items({tourId:'123456789012345678901234'}),items({tourId:{$ne:null}}),[],'x'];
  for(const list of bad) {
    const r=await create(cookieA(),form({items:list}));
    assert.equal(r.json?.code,'error',JSON.stringify(list));
  }
  assert.equal((await create(cookieA(),form({paymentMethod:'bitcoin'}))).json.code,'error');
  assert.equal(await Order.countDocuments(),0);
  const t=await Tour.findById(tour.id);
  assert.deepEqual([t.stockAdult,t.stockChildren,t.stockBaby],[10,10,10]);
});
it('card total above the single wallet transaction cap is rejected at creation',async()=> {
  await Tour.updateOne({_id:tour.id},{$set:{priceNewAdult:30000000}});
  const r=await create(cookieA(),form());
  assert.equal(r.json.code,'error');
  assert.equal(await Order.countDocuments(),0);
});
it('stock is reserved atomically so concurrent orders cannot oversell',async()=> {
  await Tour.updateOne({_id:tour.id},{$set:{stockAdult:3}});
  const results=await Promise.all(Array.from({length:4},()=>create('',form({paymentMethod:'money'}))));
  assert.equal(results.filter(r=>r.json.code==='success').length,1);
  assert.equal((await Tour.findById(tour.id)).stockAdult,1);
});
it('zalopay and vnpay orders still create unpaid orders for logged-in and anonymous customers',async()=> {
  await Tour.updateOne({_id:tour.id},{$set:{stockAdult:100}});
  for(const method of ['zalopay','vnpay','bank','momo','money']) {
    for(const cookie of [cookieA(),'']) {
      const r=await create(cookie,form({paymentMethod:method}));
      assert.equal(r.json.code,'success',method+r.text);
      const order=await Order.findById(r.json.orderId);
      assert.equal(order.paymentMethod,method);
      assert.equal(order.paymentStatus,'unpaid');
    }
  }
});

// ---- Phần 2: prepare ----
it('prepare returns opId and server amount, creates one debit and does not touch balance',async()=> {
  const order=await cardOrder();
  const r=await prepare(order.id);
  assert.equal(r.status,200,r.text);
  assert.equal(r.json.amount,2000000);
  assert.match(r.json.opId,/^[a-f0-9]{24}$/);
  const tx=await Tx.findOne({orderId:order.id});
  assert.equal(await Tx.countDocuments(),1);
  assert.equal(tx.type,'debit');
  assert.equal(tx.source,'order');
  assert.equal(tx.amount,order.total);
  assert.equal(tx.cardId,cardIdA);
  assert.equal(tx.status,'pending-card');
  assert.equal((await Order.findById(order.id)).cardTxRef,tx.txRef);
  assert.equal((await Card.findOne({cardId:cardIdA})).balance,2000000);
  const op=await Op.findById(r.json.opId);
  assert.equal(op.type,'debit');
  assert.equal(op.params.txRef,tx.txRef);
  assert.equal(op.actorId,custA.id);
});
it('prepare requires session and strict body so amount card or customer cannot be forged',async()=> {
  const order=await cardOrder();
  assert.equal((await prepare(order.id,'')).status,401);
  for(const extra of [{amount:1},{cardId:cardIdB},{customerId:custB.id},{total:1}])
    assert.equal((await prepare(order.id,cookieA(),extra)).status,400);
  assert.equal((await call('POST','/card-api/pay/prepare',{orderId:{$ne:null}},cookieA())).status,400);
  assert.equal((await call('POST','/card-api/pay/prepare',{orderId:'zz'},cookieA())).status,400);
  assert.equal(await Tx.countDocuments(),0);
});
it('payOtherCustomersOrderRejected',async()=> {
  const orderB=await cardOrder(cookieB());
  const r=await prepare(orderB.id,cookieA());
  assert.equal(r.status,403);
  assert.equal(r.json.errorCode,'OP_FORBIDDEN');
  assert.equal(await Tx.countDocuments(),0);
  assert.equal((await Order.findById(orderB.id)).cardTxRef,undefined);
  // orderId không tồn tại cũng trả cùng kết quả, không lộ sự tồn tại.
  assert.equal((await prepare('123456789012345678901234')).status,403);
});
it('paid cancelled deleted and non-card orders cannot be prepared',async()=> {
  for(const patch of [{paymentStatus:'paid'},{status:'cancel'},{deleted:true},{paymentMethod:'zalopay'}]) {
    const order=await cardOrder();
    await Order.updateOne({_id:order.id},{$set:patch});
    const r=await prepare(order.id);
    assert.ok([403,409].includes(r.status),JSON.stringify(patch)+r.text);
  }
  assert.equal(await Tx.countDocuments(),0);
});
it('insufficient server balance is rejected with the exact message and no debit',async()=> {
  await Card.updateOne({cardId:cardIdA},{$set:{balance:1999999}});
  const order=await cardOrder();
  const r=await prepare(order.id);
  assert.equal(r.status,409);
  assert.equal(r.json.message,'Số dư ví không đủ');
  assert.equal(r.json.errorCode,'INSUFFICIENT_BALANCE');
  assert.equal(await Tx.countDocuments(),0);
  assert.equal(await Op.countDocuments(),0);
  assert.equal((await Order.findById(order.id)).cardTxRef,undefined);
});
it('existing sent or signed unresolved debit blocks prepare with sync instruction',async()=> {
  for(const patch of [{status:'sent',signedOpId:'1'.repeat(24)},{status:'failed',signedOpId:'2'.repeat(24)}]) {
    await Tx.deleteMany({});
    await Op.deleteMany({});
    const order=await cardOrder();
    await Tx.create({cardId:cardIdA,txRef:'AB'.repeat(8),type:'debit',source:'order',amount:order.total,orderId:order.id,...patch});
    await Order.updateOne({_id:order.id},{$set:{cardTxRef:'AB'.repeat(8)}});
    const r=await prepare(order.id);
    assert.equal(r.status,409);
    assert.equal(r.json.message,'Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ');
    assert.equal(await Tx.countDocuments(),1);
    assert.equal(await Op.countDocuments(),0);
  }
});
it('repeated and reloaded prepare reuses the unsigned debit instead of creating another',async()=> {
  const order=await cardOrder();
  const first=await prepare(order.id);
  const second=await prepare(order.id);
  assert.equal(first.status,200);
  assert.equal(second.status,200);
  assert.notEqual(first.json.opId,second.json.opId);
  assert.equal(await Tx.countDocuments(),1);
  // Hai op cùng giao dịch: chỉ op đầu tiên ký được.
  const a=await call('POST','/card-api/op/sign',{opId:first.json.opId,challenge},cookieA());
  const b=await call('POST','/card-api/op/sign',{opId:second.json.opId,challenge},cookieA());
  assert.equal(a.status,200);
  assert.notEqual(b.status,200);
  const third=await prepare(order.id);
  assert.equal(third.status,409);
  assert.equal(await Tx.countDocuments(),1);
});
it('concurrent prepare creates exactly one debit transaction for the order',async()=> {
  const order=await cardOrder();
  const results=await Promise.all(Array.from({length:6},()=>prepare(order.id)));
  assert.equal(await Tx.countDocuments({orderId:order.id}),1);
  const tx=await Tx.findOne({orderId:order.id});
  assert.ok(results.every(r=>r.status===200||r.status===409),results.map(r=>r.status).join());
  assert.ok(results.some(r=>r.status===200));
  assert.equal((await Order.findById(order.id)).cardTxRef,tx.txRef);
});
it('two different orders can each hold their own pending debit but only one can be signed at a time',async()=> {
  const o1=await cardOrder(),o2=await cardOrder();
  const p1=await prepare(o1.id),p2=await prepare(o2.id);
  assert.equal(p1.status,200);
  assert.equal(p2.status,200);
  assert.equal((await call('POST','/card-api/op/sign',{opId:p1.json.opId,challenge},cookieA())).status,200);
  assert.notEqual((await call('POST','/card-api/op/sign',{opId:p2.json.opId,challenge},cookieA())).status,200);
});
it('locked revoked or replaced card cannot prepare',async()=> {
  const order=await cardOrder();
  for(const patch of [{status:'locked'},{status:'revoked',isCurrent:false}]) {
    await Card.updateOne({cardId:cardIdA},{$set:patch});
    assert.equal((await prepare(order.id)).status,401);
    await Card.updateOne({cardId:cardIdA},{$set:{status:'active',isCurrent:true}});
  }
  assert.equal(await Tx.countDocuments(),0);
});

// ---- Settlement ----
it('debit confirm marks paid once, queues tickets and increases totalSpent exactly once',async()=> {
  const order=await cardOrder();
  const {opId,tx}=await signed(order);
  assert.equal((await Tx.findById(tx.id)).status,'sent');
  const good=receipt({tx});
  const results=await Promise.all([confirm(opId,good),confirm(opId,good)]);
  assert.equal(results.filter(r=>r.status===200&&r.json.ok).length,1);
  const paid=await Order.findById(order.id);
  assert.equal(paid.paymentStatus,'paid');
  assert.ok(paid.items.every(i=>i.ticketStatus==='pending'));
  assert.equal((await Customer.findById(custA.id)).totalSpent,2000000);
  assert.equal((await Card.findOne({cardId:cardIdA})).balance,0);
  assert.equal((await Tx.findById(tx.id)).status,'done');
  // Phát lại thất bại, không tăng chi tiêu/trừ lần hai.
  await confirm(opId,good);
  assert.equal((await Customer.findById(custA.id)).totalSpent,2000000);
  assert.equal((await prepare(order.id)).status,409);
  assert.equal(await Tx.countDocuments(),1);
});
it('receipts with wrong signature counter amount balance card or type are rejected and order stays unpaid',async()=> {
  const variants=[{privateKey:crypto.generateKeyPairSync('rsa',{modulusLength:1024}).privateKey},{counter:2},{amount:1999999},{balance:1},{type:'credit'}];
  for(const variant of variants) {
    await db.reset();
    custA=await Customer.create({fullName:'Khách A Kiểm Thử',email:'a@example.com',phone:'0901111111'});
    cardA=await Card.create({cardId:cardIdA,cardType:'customer',ownerId:custA.id,status:'active',publicKeyModulus:modulus,balance:2000000});
    tour=await Tour.create({name:'Tour kiểm thử',status:'active',deleted:false,priceNewAdult:1000000,priceNewChildren:500000,priceNewBaby:0,stockAdult:10,stockChildren:10,stockBaby:10,departureDate:new Date('2027-01-01')});
    const order=await cardOrder();
    const {opId,tx}=await signed(order);
    const r=await confirm(opId,receipt({tx,...variant}));
    assert.equal(r.json.ok,false,JSON.stringify(Object.keys(variant)));
    assert.equal((await Order.findById(order.id)).paymentStatus,'unpaid');
    assert.equal((await Customer.findById(custA.id)).totalSpent,0);
    assert.equal((await Card.findOne({cardId:cardIdA})).balance,2000000);
  }
});
it('receipt of another customers card cannot settle the order',async()=> {
  const order=await cardOrder();
  const {opId,tx}=await signed(order);
  const r=await confirm(opId,receipt({tx,id:cardIdB}),cookieB());
  assert.notEqual(r.json?.ok,true);
  assert.equal((await Order.findById(order.id)).paymentStatus,'unpaid');
});
it('lost confirm is recovered through GET_RECEIPT sync exactly once and blocks a second debit meanwhile',async()=> {
  const order=await cardOrder();
  const {tx}=await signed(order);
  assert.equal((await prepare(order.id)).status,409);
  const next=await call('POST','/card-api/sync/next',{cardId:cardIdA,cardState:2,challenge},cookieA());
  assert.equal(next.json.step.kind,'receipt');
  assert.equal(next.json.step.txRef,tx.txRef);
  const body={cardId:cardIdA,txRef:tx.txRef,response:receipt({tx}),sw:'9000'};
  const first=await call('POST','/card-api/sync/receipt',body);
  assert.equal(first.json.ok,true,first.text);
  const again=await call('POST','/card-api/sync/receipt',body);
  assert.equal(again.json.ok,false);
  assert.equal((await Order.findById(order.id)).paymentStatus,'paid');
  assert.equal((await Customer.findById(custA.id)).totalSpent,2000000);
  assert.equal((await Card.findOne({cardId:cardIdA})).balance,0);
  assert.equal(await Tx.countDocuments(),1);
});
it('forged receipt through public sync does not settle and later valid receipt still can',async()=> {
  const order=await cardOrder();
  const {tx}=await signed(order);
  const forged=await call('POST','/card-api/sync/receipt',{cardId:cardIdA,txRef:tx.txRef,response:receipt({tx,privateKey:crypto.generateKeyPairSync('rsa',{modulusLength:1024}).privateKey}),sw:'9000'});
  assert.equal(forged.json.ok,false);
  assert.equal((await Order.findById(order.id)).paymentStatus,'unpaid');
  const good=await call('POST','/card-api/sync/receipt',{cardId:cardIdA,txRef:tx.txRef,response:receipt({tx}),sw:'9000'});
  assert.equal(good.json.ok,true);
  assert.equal((await Order.findById(order.id)).paymentStatus,'paid');
});
it('cancelled order after signing is never settled by a late receipt',async()=> {
  const order=await cardOrder();
  const {tx}=await signed(order);
  await Order.updateOne({_id:order.id},{$set:{status:'cancel'}});
  const r=await call('POST','/card-api/sync/receipt',{cardId:cardIdA,txRef:tx.txRef,response:receipt({tx}),sw:'9000'});
  assert.equal(r.json.ok,false);
  assert.equal((await Customer.findById(custA.id)).totalSpent,0);
});

// ---- Phần 3: trang thanh toán và tự điền ----
it('payment page shows only the owners unpaid order with server totals and balance',async()=> {
  await Customer.updateOne({_id:custA.id},{$set:{totalSpent:30000000}});
  const order=await cardOrder();
  const page=await call('GET','/order/payment-card?orderId='+order.id,undefined,cookieA());
  assert.equal(page.status,200,page.text.slice(0,300));
  for(const text of [order.orderCode,'2.000.000','100.000','1.900.000','Thanh toán bằng thẻ',`data-order-id="${order.id}"`,'data-card-pay'])
    assert.ok(page.text.includes(text),text);
  assert.equal((await call('GET','/order/payment-card?orderId='+order.id)).status,302);
  assert.equal((await call('GET','/order/payment-card?orderId='+order.id,undefined,cookieB())).status,302);
  assert.equal((await call('GET','/order/payment-card?orderId=zz',undefined,cookieA())).status,302);
  await Order.updateOne({_id:order.id},{$set:{status:'cancel'}});
  assert.equal((await call('GET','/order/payment-card?orderId='+order.id,undefined,cookieA())).status,302);
});
it('payment page of a paid order redirects to the success page and non-card order is not shown',async()=> {
  const order=await cardOrder();
  await Order.updateOne({_id:order.id},{$set:{paymentStatus:'paid'}});
  const r=await call('GET','/order/payment-card?orderId='+order.id,undefined,cookieA());
  assert.equal(r.status,302);
  assert.ok(r.headers.get('location').startsWith('/order/success?orderId='+order.id));
  const other=await create(cookieA(),form({paymentMethod:'vnpay'}));
  assert.equal((await call('GET','/order/payment-card?orderId='+other.json.orderId,undefined,cookieA())).status,302);
});
it('cart prefills name and phone from the server customer shows tier discount and card method only when logged in',async()=> {
  await Customer.updateOne({_id:custA.id},{$set:{totalSpent:30000000}});
  const page=await call('GET','/cart',undefined,cookieA());
  assert.equal(page.status,200,page.text.slice(0,300));
  for(const text of ['data-discount-percent="5"','value="Khách A Kiểm Thử"','value="0901111111"','data-card-autofill','id="methodCard"','Giảm hạng Gold (5%)'])
    assert.ok(page.text.includes(text),text);
  assert.ok(!/id="methodCard"[^>]*disabled/.test(page.text));
  const anonymous=await call('GET','/cart');
  assert.ok(anonymous.text.includes('data-discount-percent="0"'));
  assert.ok(!anonymous.text.includes('data-card-autofill'));
  assert.ok(/id="methodCard"[^>]*disabled/.test(anonymous.text));
  assert.ok(!anonymous.text.includes('Khách A Kiểm Thử'));
});
// Admin không được sửa tiền/liên kết thẻ hoặc hủy đơn đang chờ biên nhận (tiền trên chip có thể đã bị trừ).
it('admin order edit ignores money fields and cannot cancel or re-mark a card order with unresolved debit',async()=> {
  const admin=require('../../controllers/admin/order.controller');
  const edit=async(id,body)=> {
    let out;
    await admin.editPatch({params:{id},body,flash(){}},{json(v){out=v;}});
    return out;
  };
  const order=await cardOrder();
  const {tx}=await signed(order);
  const forged=await edit(order.id,{total:1,subTotal:1,discount:5,cardTxRef:'AB'.repeat(8),customerId:custB.id,'$set':{total:2},note:'ghi chú'});
  assert.equal(forged.code,'success');
  const after=await Order.findById(order.id).lean();
  assert.deepEqual([after.total,after.subTotal,after.discount,after.cardTxRef,after.customerId,after.note],[2000000,2000000,0,tx.txRef,custA.id,'ghi chú']);
  assert.equal((await edit(order.id,{status:'cancel'})).code,'error');
  assert.equal((await edit(order.id,{paymentStatus:'paid'})).code,'error');
  assert.equal((await edit(order.id,{paymentMethod:'money'})).code,'error');
  assert.equal((await Order.findById(order.id)).status,'initial');
  // Sau khi receipt được áp dụng thì hủy lại được phép.
  const ok=await call('POST','/card-api/sync/receipt',{cardId:cardIdA,txRef:tx.txRef,response:receipt({tx}),sw:'9000'});
  assert.equal(ok.json.ok,true);
  assert.equal((await edit(order.id,{status:'cancel'})).code,'success');
});
it('a failed multi-tour order restores every reserved seat (stock shortage on a later tour and save failure)',async()=> {
  const two=[{tourId:tour.id,locationFrom:'123456789012345678901234',quantityAdult:2,quantityChildren:1,quantityBaby:0},{tourId:'',locationFrom:'123456789012345678901234',quantityAdult:1,quantityChildren:0,quantityBaby:0}];
  const second=await Tour.create({name:'Tour hết chỗ',status:'active',deleted:false,priceNewAdult:1000,priceNewChildren:0,priceNewBaby:0,stockAdult:0,stockChildren:0,stockBaby:0,departureDate:new Date('2027-01-02')});
  two[1].tourId=second.id;
  const r=await create(cookieA(),form({items:two}));
  assert.equal(r.json.code,'error');
  const t=await Tour.findById(tour.id);
  assert.deepEqual([t.stockAdult,t.stockChildren,t.stockBaby],[10,10,10]);
  assert.equal(await Order.countDocuments(),0);
  const original=Order.prototype.save;
  Order.prototype.save=async function() { throw new Error('save failed'); };
  try {
    const failed=await create(cookieA(),form());
    assert.equal(failed.json.code,'error');
  }
  finally {
    Order.prototype.save=original;
  }
  assert.equal((await Tour.findById(tour.id)).stockAdult,10);
  assert.equal(await Order.countDocuments(),0);
});
