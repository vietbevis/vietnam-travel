const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const express=require('express');
const cookies=require('cookie-parser');
const jwt=require('jsonwebtoken');
const axios=require('axios').default;
const db=require('../helpers/db');
const Card=require('../../models/card.model');
const Customer=require('../../models/customer.model');
const Order=require('../../models/order.model');
const Tx=require('../../models/card-transaction.model');
const CardLog=require('../../models/card-log.model');
const E=require('../../helpers/card-op.helper');
const sync=require('../../helpers/card-sync.helper');
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
const originalPost=axios.post;
const savedEnv={...process.env};
const cardId='A1'.repeat(16),otherCardId='B1'.repeat(16);
let server,base,A,B,cardA,tokenA,tokenB,zaloCalls;
before(async()=> {
  Object.assign(process.env,{JWT_SECRET:'task14-fixture-secret',ZALOPAY_APPID:'1234',ZALOPAY_KEY1:'fixture-request',ZALOPAY_KEY2:'fixture-callback',ZALOPAY_DOMAIN:'https://zalo.example.invalid',VNPAY_CODE:'FIXTURE01',VNPAY_SECRET:'fixture-vnp-secret',VNPAY_URL:'https://vnp.example.invalid/pay',DOMAIN_WEBSITE:'https://shop.example.invalid'});
  if(db.enabled)await db.connect();
  if(db.enabled)await Promise.all([Card,Customer,Order,Tx,CardLog].map(m=>m.init()));
  // Chỉ thay HTTP ra ngoài; controller, chữ ký, helper và Mongo đều thật.
  axios.post=async(url,body,options)=>{zaloCalls.push(options.params);return{data:{return_code:1,order_url:'https://zalo.example.invalid/checkout'}};};
  const app=express();
  app.set('trust proxy',true);
  app.use(express.json());
  app.use(cookies());
  app.use('/card-api',require('../../routes/client/card-api.route'));
  app.use('/order',require('../../middlewares/client/customer-auth.middleware').optional,require('../../routes/client/order.route'));
  server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  base='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=> {
  zaloCalls=[];
  if(!db.enabled)return;
  await db.reset();
  A=await Customer.create({fullName:'Khách A',email:'a@example.com',phone:'0901111111'});
  B=await Customer.create({fullName:'Khách B',email:'b@example.com',phone:'0902222222'});
  cardA=await Card.create({cardId,cardType:'customer',ownerId:A.id,status:'active',publicKeyModulus:'AB'.repeat(128),balance:1000000});
  await Card.create({cardId:otherCardId,cardType:'customer',ownerId:B.id,status:'active',publicKeyModulus:'AB'.repeat(128),balance:0});
  tokenA=jwt.sign({customerId:A.id,cardId},process.env.JWT_SECRET,{expiresIn:'1d'});
  tokenB=jwt.sign({customerId:B.id,cardId:otherCardId},process.env.JWT_SECRET,{expiresIn:'1d'});
});
after(async()=> {
  axios.post=originalPost;
  if(server)await new Promise(r=>server.close(r));
  if(db.enabled)await db.close();
  for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];
  Object.assign(process.env,savedEnv);
});
async function post(url,body,token=tokenA) {
  const r=await fetch(base+url,{method:'POST',redirect:'manual',headers:{'content-type':'application/json',...(token?{cookie:'customerToken='+token}:{})},body:JSON.stringify(body)});
  let json={};try{json=await r.json();}catch{}
  return{status:r.status,...json};
}
async function get(url) {
  const r=await fetch(base+url,{redirect:'manual'});
  return{status:r.status,location:r.headers.get('location')};
}
const txRef=()=>crypto.randomBytes(8).toString('hex').toUpperCase();
const makeTx=(extra={})=>Tx.create({txRef:txRef(),cardId,type:'credit',source:'zalopay',amount:100000,status:'awaiting-payment',createdBy:A.id,...extra});
function zaloBody(tx,extra={},appUser='topup-'+tx.id) {
  const data=JSON.stringify({app_id:1234,app_trans_id:'261110_123456',app_user:appUser,amount:tx.amount,...extra});
  return{type:1,data,mac:crypto.createHmac('sha256',process.env.ZALOPAY_KEY2).update(data).digest('hex')};
}
function vnpQuery(tx,extra={}) {
  const query={vnp_TmnCode:'FIXTURE01',vnp_TxnRef:tx.txRef,vnp_Amount:String(tx.amount*100),vnp_ResponseCode:'00',vnp_TransactionStatus:'00',...extra};
  const raw=Object.keys(query).sort().map(key=>`${encodeURIComponent(key)}=${encodeURIComponent(query[key]).replace(/%20/g,'+')}`).join('&');
  return new URLSearchParams({...query,vnp_SecureHash:crypto.createHmac('sha512',process.env.VNPAY_SECRET).update(raw).digest('hex')}).toString();
}
const status=async tx=>(await Tx.findById(tx.id).lean()).status;

it('paidTwiceCreditsOnce',async()=> {
  const tx=await makeTx();
  assert.equal(await E.markTopupPaid(tx.id,'zalopay'),true);
  assert.equal(await E.markTopupPaid(tx.id,'zalopay'),false);
  assert.equal(await Tx.countDocuments({status:'pending-card'}),1);
});
it('markTopupPaid rejects wrong source, debit, unknown or malformed id and concurrent calls win once',async()=> {
  const tx=await makeTx();
  assert.equal(await E.markTopupPaid(tx.id,'vnpay'),false);
  assert.equal(await E.markTopupPaid('xyz','zalopay'),false);
  assert.equal(await E.markTopupPaid(new (require('mongoose').Types.ObjectId)().toString(),'zalopay'),false);
  const debit=await makeTx({type:'debit',source:'order'});
  assert.equal(await E.markTopupPaid(debit.id,'order'),false);
  assert.equal(await status(tx),'awaiting-payment');
  const results=await Promise.all(Array.from({length:8},()=>E.markTopupPaid(tx.id,'zalopay')));
  assert.equal(results.filter(Boolean).length,1);
});
it('topup requires a logged-in customer with an active current card and valid input',async()=> {
  assert.equal((await post('/card-api/topup',{amount:100000,method:'zalopay'},null)).status,401);
  assert.equal((await post('/card-api/topup',{amount:100000,method:'zalopay'},'garbage')).status,401);
  await Card.updateOne({cardId},{$set:{status:'locked'}});
  assert.equal((await post('/card-api/topup',{amount:100000,method:'zalopay'})).status,401);
  await Card.updateOne({cardId},{$set:{status:'active'}});
  for(const body of [{amount:9999,method:'zalopay'},{amount:'100000',method:'zalopay'},{amount:100000.5,method:'vnpay'},{amount:100000,method:'cash'},{amount:100000},{amount:100000,method:'vnpay',cardId:otherCardId}]) {
    const r=await post('/card-api/topup',body);
    assert.equal(r.code,'error');assert.ok(r.status>=400&&r.status<500);
  }
  assert.equal(await Tx.countDocuments(),0);
});
it('topup zalopay creates awaiting-payment credit on the caller card with topup- appUser and distinct callback',async()=> {
  const r=await post('/card-api/topup',{amount:100000,method:'zalopay'});
  assert.equal(r.status,200);assert.equal(r.code,'success');assert.equal(r.redirectUrl,'https://zalo.example.invalid/checkout');
  const tx=await Tx.findOne().lean();
  assert.deepEqual([tx.cardId,tx.type,tx.source,tx.amount,tx.status,tx.createdBy],[cardId,'credit','zalopay',100000,'awaiting-payment',A.id]);
  assert.equal(zaloCalls[0].app_user,'topup-'+tx._id);
  assert.equal(zaloCalls[0].amount,100000);
  assert.equal(zaloCalls[0].callback_url,'https://shop.example.invalid/card-api/topup-zalopay-result');
  assert.equal(JSON.parse(zaloCalls[0].embed_data).redirecturl,'https://shop.example.invalid/account/card?topup=1');
  assert.ok(await CardLog.findOne({action:'card-topup-prepare',result:'success'}));
});
it('topup vnpay uses txRef as vnp_TxnRef and a separate return path',async()=> {
  const r=await post('/card-api/topup',{amount:150000,method:'vnpay'});
  assert.equal(r.status,200);
  const tx=await Tx.findOne().lean(),url=new URL(r.redirectUrl);
  assert.equal(tx.source,'vnpay');assert.equal(tx.status,'awaiting-payment');
  assert.equal(url.searchParams.get('vnp_TxnRef'),tx.txRef);
  assert.equal(url.searchParams.get('vnp_Amount'),'15000000');
  assert.equal(url.searchParams.get('vnp_ReturnUrl'),'https://shop.example.invalid/card-api/topup-vnpay-result');
});
it('topup cap counts pending',async()=> {
  await Card.updateOne({cardId},{$set:{balance:49000000}});
  await makeTx({amount:900000,status:'pending-card'});
  const r=await post('/card-api/topup',{amount:200000,method:'zalopay'});
  assert.equal(r.code,'error');assert.equal(r.status,400);
  assert.equal(await Tx.countDocuments({status:'awaiting-payment'}),0);
  assert.equal((await post('/card-api/topup',{amount:100000,method:'zalopay'})).status,200);
});
it('topup cap counts sent credits but not awaiting-payment or debits or other cards',async()=> {
  await Card.updateOne({cardId},{$set:{balance:49000000}});
  await makeTx({amount:900000,status:'sent'});
  await makeTx({amount:5000000,status:'awaiting-payment'});
  await makeTx({amount:5000000,status:'pending-card',type:'debit',source:'order'});
  await makeTx({amount:5000000,status:'pending-card',cardId:otherCardId});
  assert.equal((await post('/card-api/topup',{amount:100001,method:'vnpay'})).status,400);
  assert.equal((await post('/card-api/topup',{amount:100000,method:'vnpay'})).status,200);
});
it('gateway failure leaves no awaiting-payment transaction',async()=> {
  axios.post=async()=>({data:{return_code:2}});
  try {
    const r=await post('/card-api/topup',{amount:100000,method:'zalopay'});
    assert.equal(r.code,'error');
    assert.equal(await Tx.countDocuments(),0);
  } finally {
    axios.post=async(url,body,options)=>{zaloCalls.push(options.params);return{data:{return_code:1,order_url:'https://zalo.example.invalid/checkout'}};};
  }
});
it('zalopay callback credits once and retries are acknowledged without a second credit',async()=> {
  const tx=await makeTx();
  const body=zaloBody(tx);
  const first=await post('/card-api/topup-zalopay-result',body,null);
  assert.equal(first.return_code,1);assert.equal(await status(tx),'pending-card');
  const second=await post('/card-api/topup-zalopay-result',body,null);
  assert.equal(second.return_code,1);
  assert.equal(await Tx.countDocuments({status:'pending-card'}),1);
  assert.equal((await Card.findOne({cardId})).balance,1000000);
  // Sync lập kế hoạch đúng một lệnh CREDIT cho khoản này.
  const context=await sync.loadSyncContext(await Card.findOne({cardId}).lean());
  assert.equal(context.pendingCredit.txRef,tx.txRef);
});
it('zalopay callback rejects bad mac, wrong amount, unknown tx, wrong source and foreign app_user; tx unchanged',async()=> {
  const tx=await makeTx(),vn=await makeTx({source:'vnpay'}),debit=await makeTx({type:'debit',source:'order'});
  const bad=zaloBody(tx);bad.mac='0'.repeat(64);
  const ghost=zaloBody(tx,{},'topup-'+new (require('mongoose').Types.ObjectId)());
  for(const body of [bad,zaloBody(tx,{amount:tx.amount+1}),ghost,zaloBody(vn),zaloBody(debit),zaloBody(tx,{},'0901111111-'+tx.id),zaloBody(tx,{},'topup-nothex'),{}]) {
    const r=await post('/card-api/topup-zalopay-result',body,null);
    assert.notEqual(r.return_code,1);
  }
  for(const item of [tx,vn,debit])assert.equal(await status(item),'awaiting-payment');
});
it('order zalopay callback cannot settle a topup and topup tx is not an order',async()=> {
  const tx=await makeTx();
  const r=await post('/order/payment-zalopay-result',zaloBody(tx),null);
  assert.notEqual(r.return_code,1);
  assert.equal(await status(tx),'awaiting-payment');
});
it('vnpay return credits once; F5 redirects again without a second credit',async()=> {
  const tx=await makeTx({source:'vnpay'});
  const query=vnpQuery(tx);
  const first=await get('/card-api/topup-vnpay-result?'+query);
  assert.equal(first.status,302);assert.equal(first.location,'/account/card?topup=1');
  assert.equal(await status(tx),'pending-card');
  const second=await get('/card-api/topup-vnpay-result?'+query);
  assert.equal(second.location,'/account/card?topup=1');
  assert.equal(await Tx.countDocuments({status:'pending-card'}),1);
  assert.equal((await Tx.findById(tx.id)).signedOpId,undefined);
});
it('vnpay return rejects bad hash, failed payment, wrong amount, wrong merchant, wrong source and unknown tx',async()=> {
  const tx=await makeTx({source:'vnpay'}),zl=await makeTx({source:'zalopay'});
  const tampered=vnpQuery(tx).replace('vnp_Amount=','vnp_Amount=1');
  const unknown={...tx.toObject(),txRef:txRef()};
  const urls=[tampered,vnpQuery(tx,{vnp_ResponseCode:'24'}),vnpQuery(tx,{vnp_TransactionStatus:'02'}),vnpQuery(tx,{vnp_Amount:String((tx.amount+1)*100)}),vnpQuery(tx,{vnp_TmnCode:'OTHER'}),vnpQuery(tx,{vnp_Amount:'12345'}),vnpQuery(zl),vnpQuery(unknown),'vnp_TxnRef='+tx.txRef,''];
  for(const query of urls) {
    const r=await get('/card-api/topup-vnpay-result?'+query);
    assert.equal(r.status,302);assert.notEqual(r.location,'/account/card?topup=1');
  }
  // Return ký hợp lệ nhưng báo thất bại thì đóng khoản chờ; các lỗi còn lại không đổi gì.
  assert.equal(await status(tx),'failed');assert.equal(await status(zl),'awaiting-payment');
});
it('order vnpay return does not settle a topup reference',async()=> {
  const tx=await makeTx({source:'vnpay'});
  const r=await get('/order/payment-vnpay-result?'+vnpQuery(tx));
  assert.equal(r.status,302);assert.equal(await status(tx),'awaiting-payment');
});

// ---- Fix round 1: hạn cổng, thất bại đã xác minh, nhận tiền muộn, nhật ký ----
const backdate=(tx,minutes)=>Tx.collection.updateOne({_id:tx._id},{$set:{createdAt:new Date(Date.now()-minutes*60000)}});
const logs=(query={})=>CardLog.find({action:'card-topup-callback',result:'fail',...query}).lean();
it('gateway requests carry a 15 minute expiry for top-up only',async()=> {
  await post('/card-api/topup',{amount:100000,method:'zalopay'});
  assert.equal(zaloCalls[0].expire_duration_seconds,900);
  const r=await post('/card-api/topup',{amount:100000,method:'vnpay'});
  const url=new URL(r.redirectUrl),pad=n=>String(n).padStart(2,'0');
  const parse=v=>Date.UTC(+v.slice(0,4),+v.slice(4,6)-1,+v.slice(6,8),+v.slice(8,10),+v.slice(10,12),+v.slice(12,14));
  assert.equal(parse(url.searchParams.get('vnp_ExpireDate'))-parse(url.searchParams.get('vnp_CreateDate')),15*60000);
  // Luồng đơn hàng không đổi: không có tham số hạn.
  const vnp=require('../../helpers/vnpay.helper').buildPaymentUrl({txnRef:'X1',amount:10000,orderInfo:'x',returnPath:'/r',ipAddr:'1.1.1.1'});
  assert.ok(!vnp.includes('vnp_ExpireDate'));
  axios.post=async(u,b,o)=>{zaloCalls.push(o.params);return{data:{return_code:1,order_url:'https://z/x'}};};
  await require('../../helpers/zalopay.helper').createOrder({appUser:'0901111111-x',amount:10000,description:'d',redirectUrl:'https://s/r',callbackPath:'/order/payment-zalopay-result'});
  assert.ok(!('expire_duration_seconds' in zaloCalls.at(-1)));
});
it('verified VNPay failure closes the tx as failed and a later success never re-credits it',async()=> {
  const tx=await makeTx({source:'vnpay'});
  const r=await get('/card-api/topup-vnpay-result?'+vnpQuery(tx,{vnp_ResponseCode:'24'}));
  assert.equal(r.location,'/account/card?topup=fail');
  const stored=await Tx.findById(tx.id).lean();
  assert.deepEqual([stored.status,stored.failReason],['failed','gateway']);
  const later=await get('/card-api/topup-vnpay-result?'+vnpQuery(tx));
  assert.notEqual(later.location,'/account/card?topup=1');
  assert.equal(await status(tx),'failed');
});
it('stale awaiting-payment rows stop blocking replace and revoke checks, fresh ones still count',async()=> {
  const stale=await makeTx(),fresh=await makeTx();
  await backdate(stale,21);await backdate(fresh,19);
  assert.equal(await E.expireStaleTopups(cardId),1);
  const s=await Tx.findById(stale.id).lean();
  assert.deepEqual([s.status,s.failReason],['failed','expired']);
  assert.equal(await status(fresh),'awaiting-payment');
  assert.equal(await Tx.exists({cardId,status:{$ne:'done'},$or:[{status:{$in:['awaiting-payment','pending-card','sent']}},{signedOpId:{$exists:true}}]}).then(Boolean),true);
  await Tx.deleteOne({_id:fresh._id});
  assert.equal(await Tx.exists({cardId,status:{$ne:'done'},$or:[{status:{$in:['awaiting-payment','pending-card','sent']}},{signedOpId:{$exists:true}}]}),null);
});
it('late paid callback for an expired tx is honoured once when the card is active and current',async()=> {
  const tx=await makeTx();await backdate(tx,30);await E.expireStaleTopups(cardId);
  const body=zaloBody(tx);
  assert.equal((await post('/card-api/topup-zalopay-result',body,null)).return_code,1);
  const stored=await Tx.findById(tx.id).lean();
  assert.deepEqual([stored.status,stored.failReason],['pending-card',undefined]);
  assert.equal((await post('/card-api/topup-zalopay-result',body,null)).return_code,1);
  assert.equal(await Tx.countDocuments({status:'pending-card'}),1);
  const vn=await makeTx({source:'vnpay'});await backdate(vn,30);await E.expireStaleTopups(cardId);
  assert.equal((await get('/card-api/topup-vnpay-result?'+vnpQuery(vn))).location,'/account/card?topup=1');
  assert.equal(await status(vn),'pending-card');
});
it('late paid callback after card is no longer active or current needs manual reconciliation and leaves tx untouched',async()=> {
  for(const change of [{status:'locked'},{status:'revoked'},{isCurrent:false}]) {
    await Tx.deleteMany({});await CardLog.deleteMany({});
    await Card.updateOne({cardId},{$set:{status:'active',isCurrent:true}});
    const tx=await makeTx();await backdate(tx,30);await E.expireStaleTopups(cardId);
    await Card.updateOne({cardId},{$set:change});
    assert.notEqual((await post('/card-api/topup-zalopay-result',zaloBody(tx),null)).return_code,1);
    const stored=await Tx.findById(tx.id).lean();
    assert.deepEqual([stored.status,stored.failReason],['failed','expired']);
    const entry=await CardLog.findOne({result:'fail','detail.reason':/đối soát thủ công/});
    assert.ok(entry);assert.equal(entry.detail.txRef,tx.txRef);assert.equal(entry.detail.amount,tx.amount);
  }
});
it('failed for a real gateway failure is never re-credited by zalopay callback',async()=> {
  const tx=await makeTx({status:'failed',failReason:'gateway'});
  assert.notEqual((await post('/card-api/topup-zalopay-result',zaloBody(tx),null)).return_code,1);
  assert.equal(await status(tx),'failed');
});
it('every callback and return rejection writes a failure CardLog without secrets',async()=> {
  const tx=await makeTx(),vn=await makeTx({source:'vnpay'});
  const bad=zaloBody(tx);bad.mac='0'.repeat(64);
  await post('/card-api/topup-zalopay-result',bad,null);
  await post('/card-api/topup-zalopay-result',zaloBody(tx,{amount:tx.amount+1}),null);
  await post('/card-api/topup-zalopay-result',zaloBody(tx,{},'topup-'+new (require('mongoose').Types.ObjectId)()),null);
  await post('/card-api/topup-zalopay-result',zaloBody(tx,{},'0901111111-'+tx.id),null);
  await get('/card-api/topup-vnpay-result?'+vnpQuery(vn).replace('vnp_Amount=','vnp_Amount=1'));
  await get('/card-api/topup-vnpay-result?'+vnpQuery(vn,{vnp_TmnCode:'OTHER'}));
  await get('/card-api/topup-vnpay-result?'+vnpQuery({...vn.toObject(),txRef:txRef()}));
  await get('/card-api/topup-vnpay-result?'+vnpQuery(vn,{vnp_ResponseCode:'24'}));
  const entries=await logs();
  assert.equal(entries.length,8);
  assert.ok(entries.every(e=>e.detail.reason&&!JSON.stringify(e).includes('fixture-')&&!JSON.stringify(e).includes(bad.mac)));
  assert.ok(entries.some(e=>e.detail.txRef===vn.txRef&&e.detail.amount===vn.amount));
});

it('a repeated callback for a paid top-up later moved to a replacement card or refunded is acknowledged without crediting again',async()=> {
  for(const failReason of ['moved','refunded']) {
    await Tx.deleteMany({});
    const tx=await makeTx();
    assert.equal((await post('/card-api/topup-zalopay-result',zaloBody(tx),null)).return_code,1);
    await Tx.updateOne({_id:tx._id},{$set:{status:'failed',failReason}});
    assert.equal((await post('/card-api/topup-zalopay-result',zaloBody(tx),null)).return_code,1);
    const vn=await makeTx({source:'vnpay'});
    assert.equal((await get('/card-api/topup-vnpay-result?'+vnpQuery(vn))).location,'/account/card?topup=1');
    await Tx.updateOne({_id:vn._id},{$set:{status:'failed',failReason}});
    assert.equal((await get('/card-api/topup-vnpay-result?'+vnpQuery(vn))).location,'/account/card?topup=1');
    assert.equal(await Tx.countDocuments({status:{$ne:'failed'}}),0);
  }
});
