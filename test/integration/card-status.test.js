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
const Tx=require('../../models/card-transaction.model');
const Op=require('../../models/card-operation.model');
const Log=require('../../models/card-log.model');
const Request=require('../../models/card-issuance-request.model');
const Order=require('../../models/order.model');
const E=require('../../helpers/card-op.helper');
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
const permissions=['card-view','card-log-view','card-lock','card-revoke','card-issue'];
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const modulus=Buffer.from(keys.publicKey.export({format:'jwk'}).n,'base64url').toString('hex').toUpperCase();
let server,base,admin,token,staffCard,owner;
before(async()=>{
  process.env.JWT_SECRET='task9-isolated-secret';process.env.CARD_SERVER_KEY_PATH=path.resolve('smartcard/test-vectors/server-test-key.pem');
  if(db.enabled){await db.connect();await Promise.all([Card,Customer,Account,Role,Tx,Op,Log,Request,Order].map(model=>model.init()));}
  const app=express();app.set('view engine','pug');app.set('views',path.resolve('views'));app.locals.pathAdmin='admin';app.locals.messages={};app.use(express.json());app.use(cookies());app.use('/admin',require('../../routes/admin/index.route'));app.use('/card-api',require('../../routes/client/card-api.route'));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=>{
  if(!db.enabled)return;await db.reset();
  const role=await Role.create({name:'Task9',permissions});admin=await Account.create({fullName:'Người quản trị',email:'admin@example.invalid',role:role.id,status:'active'});
  staffCard=await Card.create({cardId:'FA'.repeat(16),cardType:'staff',ownerId:admin.id,status:'active',publicKeyModulus:modulus});
  token=makeToken();owner=await Customer.create({fullName:'Nguyễn [An].*',email:'owner@example.invalid'});
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db.enabled)await db.close();});
function makeToken(extra={}){return jwt.sign({id:admin.id,email:admin.email,cardId:staffCard.cardId,stepUpAt:Date.now(),...extra},process.env.JWT_SECRET,{expiresIn:3600});}
async function card(extra={}){return Card.create({cardId:crypto.randomBytes(16).toString('hex').toUpperCase(),cardType:'customer',ownerId:owner.id,status:'active',publicKeyModulus:modulus,...extra});}
async function post(body,cookie=token,extra={}){const response=await fetch(base+'/admin/card/status',{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie:'token='+cookie}:{}),...extra},body:JSON.stringify(body)});let json={};try{json=await response.json();}catch{}return {http:response.status,...json};}
async function get(url,cookie=token){const response=await fetch(base+'/admin/card/'+url,{headers:{cookie:'token='+cookie}});return {status:response.status,html:await response.text()};}

// Nếu thiếu route/gate/transaction hoặc đổi cạnh sai thì dữ liệu và HTTP cùng phát hiện.
it('lock unlock and revoke persist current-state consistency and actor reason IP audit',async()=>{
  const c=await card();for(const [action,want]of [['lock','locked'],['unlock','active'],['revoke','revoked']]){
    const r=await post({cardId:c.cardId,action,reason:'Mất thẻ'});assert.equal(r.code,'success',JSON.stringify(r));assert.match(r.message,/Cắm thẻ để đồng bộ/);
    const stored=await Card.findById(c.id);assert.equal(stored.status,want);assert.equal(stored.isCurrent,want!=='revoked');
    const audit=await Log.findOne({cardId:c.cardId,action});assert.equal(audit.actorId,admin.id);assert.equal(audit.actorType,'admin');assert.equal(audit.detail.reason,'Mất thẻ');assert.ok(audit.ip);assert.ok(!JSON.stringify(audit).includes('582046'));
  }
  assert.equal((await post({cardId:c.cardId,action:'unlock'})).http,409);
});
it('status permissions same-origin strict input and canonical fresh step-up fail closed',async()=>{
  const c=await card();assert.equal((await post({cardId:c.cardId,action:'lock'},null)).http,401);
  for(const action of ['lock','unlock','revoke']){await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});assert.equal((await post({cardId:c.cardId,action,reason:'Mất'})).http,403);}
  await Role.updateOne({_id:admin.role},{$set:{permissions}});
  assert.equal((await post({cardId:c.cardId,action:'lock'},token,{origin:'https://attacker.invalid'})).http,403);
  for(const extra of [{refunded:'true'},{cardId:{$ne:null}},{action:'bad'},{extra:1},{reason:['bad']}])assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Mất',...extra})).http,400);
  assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Mất'},makeToken({stepUpAt:Date.now()-300001}))).code,'step-up-required');
  assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Mất'},makeToken({stepUpAt:Date.now()+10000}))).code,'step-up-required');
  assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'   '})).http,400);assert.equal((await Card.findById(c.id)).status,'active');
});
it('positive balance requires explicit refund and concurrent retries create one debit and one revoke audit',async()=>{
  const c=await card({balance:45000});assert.match((await post({cardId:c.cardId,action:'revoke',reason:'Mất'})).message,/Thẻ còn số dư, hãy xác nhận đã hoàn tiền hoặc dùng Cấp lại thẻ/);
  const body={cardId:c.cardId,action:'revoke',reason:'Mất',refunded:true};const results=await Promise.all([post(body),post(body)]);assert.equal(results.filter(r=>r.code==='success').length,1);
  assert.equal((await post(body)).http,409);const refund=await Tx.find({cardId:c.cardId});assert.equal(refund.length,1);assert.equal(refund[0].type,'debit');assert.equal(refund[0].source,'refund');assert.equal(refund[0].status,'done');assert.equal(refund[0].amount,45000);assert.equal(refund[0].balanceAfter,0);assert.equal((await Card.findById(c.id)).balance,0);assert.equal(await Log.countDocuments({cardId:c.cardId,action:'revoke',result:'success'}),1);
});
it('zero balance revoke never creates a zero amount refund',async()=>{const c=await card();assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Mất',refunded:true})).code,'success');assert.equal(await Tx.countDocuments({cardId:c.cardId}),0);});
it('anonymous prepared state sync cannot veto privileged revoke or later unlock the revoked card',async()=>{
  const c=await card({balance:45000});
  async function anonymous(endpoint,body){const response=await fetch(base+'/card-api/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {http:response.status,...await response.json()};}
  const sync=await anonymous('sync/next',{cardId:c.cardId,cardState:3,challenge:'AB'.repeat(16)});
  assert.equal(sync.http,200);assert.equal(sync.step.kind,'op');assert.match(sync.step.apdu,/^[A-F0-9]+$/i);
  const prepared=await Op.findById(sync.step.opId);assert.equal(prepared.type,'set-state');assert.equal(prepared.params.state,2);assert.equal(prepared.status,'prepared');
  const draft=await E.createOp({cardId:c.cardId,type:'set-state',params:{state:2},actorType:'system'});
  const revoked=await post({cardId:c.cardId,action:'revoke',reason:'Mất thẻ',refunded:true});assert.equal(revoked.code,'success',JSON.stringify(revoked));assert.equal(await Tx.countDocuments({cardId:c.cardId,source:'refund',amount:45000,status:'done'}),1);
  const confirmed=await anonymous('sync/confirm',{opId:sync.step.opId,response:'',sw:'9000'});assert.equal(confirmed.http,409);assert.equal(confirmed.errorCode,'CARD_STATE');
  await assert.rejects(E.signOp({opId:draft.id,challengeHex:'CD'.repeat(16),actorType:'system'}),{code:'OP_STATE'});
  await assert.rejects(E.createOp({cardId:c.cardId,type:'set-state',params:{state:2},actorType:'system'}),{code:'CARD_STATE'});
  const stored=await Card.findById(c.id);assert.equal(stored.status,'revoked');assert.equal(stored.isCurrent,false);assert.equal(stored.balance,0);assert.equal((await Op.findById(sync.step.opId)).status,'prepared');
});
it('transactional audit failure rolls back refund and revoke while successful reasons redact secrets',async()=>{
  const c=await card({balance:5000}),original=Log.create;Log.create=async()=>{throw new Error('audit unavailable');};
  try{assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Mất',refunded:true})).http,500);assert.equal((await Card.findById(c.id)).status,'active');assert.equal((await Card.findById(c.id)).balance,5000);assert.equal(await Tx.countDocuments({cardId:c.cardId}),0);}finally{Log.create=original;}
  assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'PIN=582046 token=abc',refunded:true})).code,'success');const audit=await Log.findOne({cardId:c.cardId,action:'revoke',result:'success'});assert.ok(!JSON.stringify(audit).includes('582046'));assert.ok(!JSON.stringify(audit.detail).includes('token=abc'));
});
it('unreconciled pending payment credit and signed liabilities block revoke without destroying recovery rows but allow lock and unlock',async()=>{
  // Credit pending-card chưa ký không còn cản thu hồi: nó được hoàn tiền cùng số dư (Ruling 13, test bên dưới).
  for(const [type,status,signed]of [['credit','awaiting-payment',false],['credit','sent',true],['credit','failed',true],['credit','pending-card',true],['debit','sent',true],['debit','failed',true],['debit','pending-card',true]]){
    const c=await card({ownerId:crypto.randomBytes(12).toString('hex')});const tx=await Tx.create({cardId:c.cardId,txRef:crypto.randomBytes(8).toString('hex'),type,source:type==='credit'?'cash':'order',amount:5000,status,...(signed?{signedOpId:crypto.randomBytes(12).toString('hex'),signedAt:new Date()}: {})});
    const r=await post({cardId:c.cardId,action:'revoke',reason:'Mất',refunded:true});assert.equal(r.http,409);assert.equal(r.errorCode,'RECONCILIATION_REQUIRED');assert.equal((await Tx.findById(tx.id)).status,status);assert.equal((await Card.findById(c.id)).status,'active');assert.equal((await post({cardId:c.cardId,action:'lock'})).code,'success');assert.equal((await post({cardId:c.cardId,action:'unlock'})).code,'success');assert.equal((await Tx.findById(tx.id)).status,status);assert.equal((await Tx.findById(tx.id)).signedOpId,tx.signedOpId);
  }
});
it('concurrent valid debit receipt and revoke preserve settlement and refund only the final server balance once',async()=>{
  const c=await card({balance:50000}),txRef='BD'.repeat(8);
  const order=await Order.create({orderCode:'OD1234567890',customerId:owner.id,total:20000,paymentMethod:'card',paymentStatus:'unpaid',status:'initial',cardTxRef:txRef,items:[]});
  await Tx.create({cardId:c.cardId,txRef,type:'debit',source:'order',amount:20000,orderId:order.id,status:'pending-card'});
  const op=await E.createOp({cardId:c.cardId,type:'debit',params:{txRef},actorType:'customer',actorId:owner.id});
  await E.signOp({opId:op.id,challengeHex:'AB'.repeat(16),actorType:'customer',actorId:owner.id});
  const message=Buffer.alloc(38);message[0]=0x52;Buffer.from(c.cardId,'hex').copy(message,1);message[17]=2;Buffer.from(txRef,'hex').copy(message,18);message.writeUInt32BE(20000,26);message.writeUInt32BE(30000,30);message.writeUInt32BE(1,34);
  const responseHex=Buffer.concat([message,crypto.sign('sha256',message,keys.privateKey)]).toString('hex');
  const body={cardId:c.cardId,action:'revoke',reason:'Mất thẻ',refunded:true};
  const [confirm,revoke]=await Promise.all([E.confirmOp({opId:op.id,responseHex,sw:'9000',actorType:'customer',actorId:owner.id}),post(body)]);
  assert.equal(confirm.ok,true);if(revoke.code!=='success'){assert.equal(revoke.errorCode,'RECONCILIATION_REQUIRED');assert.equal((await post(body)).code,'success');}
  const refunds=await Tx.find({cardId:c.cardId,source:'refund'});assert.equal(refunds.length,1);assert.equal(refunds[0].amount,30000);assert.equal((await Tx.findOne({txRef})).status,'done');assert.equal((await Tx.findOne({txRef})).receiptHex,responseHex.toUpperCase());assert.equal((await Order.findById(order.id)).paymentStatus,'paid');assert.equal((await Card.findById(c.id)).balance,0);assert.equal((await Card.findById(c.id)).txCounter,1);assert.equal((await Card.findById(c.id)).status,'revoked');assert.equal((await post(body)).http,409);
});
it('issuing revoke closes claim clears secrets and blocks finish without pretending chip reset',async()=>{
  const requestId='CD'.repeat(16);const c=await card({status:'issuing',issuedBy:admin.id,issuance:{pinCipher:'secret-cipher',requestId,expireAt:new Date(Date.now()+300000)}});
  await Request.create({requestId,actorId:admin.id,state:'ready',cardId:c.cardId,expireAt:new Date(Date.now()+300000)});
  await Op.create({cardId:c.cardId,type:'commit-write',actorType:'admin',actorId:admin.id,params:{target:1,dataHex:'010141'},status:'draft'});
  assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Hủy phát hành'})).code,'success');assert.equal((await Card.collection.findOne({_id:c._id})).issuance,undefined);assert.equal((await Request.findOne({requestId})).state,'cancelled');assert.equal(await Op.countDocuments({cardId:c.cardId,status:'draft'}),0);
  const response=await fetch(base+'/admin/card/issue/finish',{method:'POST',headers:{'content-type':'application/json',cookie:'token='+token},body:JSON.stringify({cardId:c.cardId})});assert.equal(response.status,409);
});
it('revoking another staff card invalidates its old bound JWT at next request',async()=>{
  const target=await Account.create({email:'staff@example.invalid',fullName:'Nhân viên',role:admin.role,status:'active',cardRequired:true});const c=await card({cardType:'staff',ownerId:target.id});const old=jwt.sign({id:target.id,email:target.email,cardId:c.cardId},process.env.JWT_SECRET);
  assert.equal((await get('list',old)).status,200);assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Nghỉ việc'})).code,'success');assert.equal((await get('list',old)).status,403);
});
it('card pages paginate 20 and escape literal owner/card search with status and type filters',async()=>{
  const c=await card({status:'locked'});await Card.insertMany(Array.from({length:21},()=>({cardId:crypto.randomBytes(16).toString('hex'),ownerId:crypto.randomBytes(12).toString('hex'),cardType:'customer',status:'active'})));
  const result=await get('list');assert.equal(result.status,200);assert.equal((result.html.match(/data-card-row/g)||[]).length,20);const page2=await get('list?page=2');assert.equal((page2.html.match(/data-card-row/g)||[]).length,3);
  for(const keyword of ['[An].*',c.cardId]){const r=await get('list?status=locked&cardType=customer&keyword='+encodeURIComponent(keyword));assert.equal(r.status,200);assert.ok(r.html.includes(c.cardId));assert.equal((r.html.match(/data-card-row/g)||[]).length,1);}
  assert.equal((await get('list?page=-1')).status,400);assert.equal((await get('list?status=unknown')).status,400);
});
it('detail shows owner server funds pending credits ticket items recent transactions and latest 50 logs only',async()=>{
  const c=await card({balance:25000});await Tx.create({cardId:c.cardId,txRef:'AA'.repeat(8),type:'credit',source:'cash',amount:17000,status:'pending-card'});
  await Order.create({customerId:owner.id,orderCode:'TOUR-OWNER',items:[{ticketStatus:'written',title:'Vé Hạ Long'}]});
  await Log.insertMany(Array.from({length:51},(_,i)=>({cardId:c.cardId,action:i===0?'HIDDEN-OLDEST':'audit-'+i,actorType:'admin',actorId:admin.id,result:'success',createdAt:new Date(1000+i)})));
  const r=await get('detail/'+c.cardId);assert.equal(r.status,200);for(const value of ['Nguyễn [An].*','25.000','17.000','AAAAAAAAAAAAAAAA','Vé Hạ Long','card-actions'])assert.ok(r.html.includes(value),value);assert.ok(!r.html.includes('HIDDEN-OLDEST'));assert.equal((r.html.match(/data-card-log-row/g)||[]).length,50);
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});const limited=await get('detail/'+c.cardId);assert.ok(!limited.html.includes('value="revoke"'));assert.ok(!limited.html.includes('value="lock"'));assert.ok(!limited.html.includes('data-card-sync'));
});
it('pending credit section excludes unsigned failed credits but retains failed signed liability',async()=>{
  const c=await card();
  await Tx.create([{cardId:c.cardId,txRef:'AB'.repeat(8),type:'credit',source:'cash',amount:11000,status:'failed'},{cardId:c.cardId,txRef:'CD'.repeat(8),type:'credit',source:'cash',amount:12000,status:'failed',signedOpId:'11'.repeat(12)}]);
  const r=await get('detail/'+c.cardId);assert.equal(r.status,200);const pending=r.html.slice(r.html.indexOf('Credit đang chờ'),r.html.indexOf('Giao dịch (100'));assert.ok(!pending.includes('ABABABABABABABAB'));assert.ok(pending.includes('CDCDCDCDCDCDCDCD'));
});
it('readonly log requires own permission and filters card action inclusive dates with no delete route',async()=>{
  const c=await card();await Log.create([{cardId:c.cardId,action:'lock',actorType:'admin',result:'success',createdAt:new Date('2026-01-10T12:00:00Z')},{cardId:c.cardId,action:'unlock',actorType:'admin',result:'success',createdAt:new Date('2026-01-11T12:00:00Z')}]);
  const r=await get('log?cardId='+c.cardId+'&action=lock&from=2026-01-10&to=2026-01-10');assert.equal(r.status,200);assert.equal((r.html.match(/data-card-log-row/g)||[]).length,1);assert.ok(!r.html.includes('data-delete'));assert.equal((await get('log?from=invalid')).status,400);
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});assert.equal((await get('log')).status,403);await Role.updateOne({_id:admin.role},{$set:{permissions:['card-log-view']}});assert.equal((await get('list')).status,403);assert.equal((await get('detail/'+c.cardId)).status,403);
});
it('a signed non-wallet operation blocks revoke until receipt confirmation and concurrent sign cannot escape revocation',async()=>{
  const c=await card();const op=await E.createOp({cardId:c.cardId,type:'commit-write',params:{target:2,dataHex:'010141'},actorType:'admin',actorId:admin.id});
  const outcomes=await Promise.allSettled([E.signOp({opId:op.id,challengeHex:'AB'.repeat(16),actorType:'admin',actorId:admin.id}),post({cardId:c.cardId,action:'revoke',reason:'Mất'})]);
  const stored=await Card.findById(c.id),operation=await Op.findById(op.id);
  if(stored.status==='revoked'){assert.equal(outcomes[0].status,'rejected');assert.notEqual(operation.status,'prepared');}
  else {assert.equal(stored.status,'active');assert.equal(operation.status,'prepared');assert.equal(outcomes[1].value.errorCode,'RECONCILIATION_REQUIRED');assert.equal((await E.confirmOp({opId:op.id,responseHex:'',sw:'9000',actorType:'admin',actorId:admin.id})).ok,true);assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Mất'})).code,'success');}
});

it('revoke voids unsigned debits and refunds unsigned pending credits together with the balance',async()=>{
  const c=await card({balance:30000});
  const order=await Order.create({orderCode:'OD1234567891',customerId:owner.id,total:20000,paymentMethod:'card',paymentStatus:'unpaid',status:'initial',cardTxRef:'D1'.repeat(8),items:[]});
  const debit=await Tx.create({cardId:c.cardId,txRef:'D1'.repeat(8),type:'debit',source:'order',amount:20000,orderId:order.id,status:'pending-card'});
  const cash=await Tx.create({cardId:c.cardId,txRef:'C1'.repeat(8),type:'credit',source:'cash',amount:17000,status:'pending-card'});
  const online=await Tx.create({cardId:c.cardId,txRef:'C2'.repeat(8),type:'credit',source:'zalopay',amount:5000,status:'pending-card'});
  const body={cardId:c.cardId,action:'revoke',reason:'Mất thẻ'};
  const refused=await post(body);assert.equal(refused.errorCode,'REFUND_REQUIRED');
  // Từ chối thì transaction rollback: không huỷ hay hoàn gì.
  for(const tx of [debit,cash,online])assert.equal((await Tx.findById(tx.id)).status,'pending-card');
  const r=await post({...body,refunded:true});assert.equal(r.code,'success',JSON.stringify(r));
  const d=await Tx.findById(debit.id);assert.deepEqual([d.status,d.failReason],['failed','voided']);
  for(const tx of [cash,online]){const t=await Tx.findById(tx.id);assert.deepEqual([t.status,t.failReason],['failed','refunded']);}
  const refunds=await Tx.find({cardId:c.cardId,source:'refund'}).lean();
  assert.equal(refunds.reduce((sum,tx)=>sum+tx.amount,0),52000);assert.ok(refunds.every(tx=>tx.type==='debit'&&tx.status==='done'));
  const stored=await Card.findById(c.id);assert.equal(stored.status,'revoked');assert.equal(stored.balance,0);
  const audit=await Log.findOne({cardId:c.cardId,action:'revoke',result:'success'}).lean();assert.equal(audit.detail.refunded,true);
  // Thẻ số dư 0 nhưng còn credit chờ ghi vẫn phải xác nhận hoàn tiền.
  const z=await card();await Tx.create({cardId:z.cardId,txRef:'C3'.repeat(8),type:'credit',source:'cash',amount:10000,status:'pending-card'});
  assert.equal((await post({cardId:z.cardId,action:'revoke',reason:'Mất'})).errorCode,'REFUND_REQUIRED');
  assert.equal((await post({cardId:z.cardId,action:'revoke',reason:'Mất',refunded:true})).code,'success');
  assert.equal(await Tx.countDocuments({cardId:z.cardId,source:'refund',amount:10000,status:'done'}),1);
});
it('revoke never voids or refunds signed transactions',async()=>{
  const c=await card({balance:30000});
  const signed=await Tx.create({cardId:c.cardId,txRef:'E1'.repeat(8),type:'debit',source:'order',amount:20000,orderId:'0123456789abcdef01234567',status:'pending-card',signedOpId:'11'.repeat(12)});
  const unsigned=await Tx.create({cardId:c.cardId,txRef:'E2'.repeat(8),type:'credit',source:'cash',amount:17000,status:'pending-card'});
  const r=await post({cardId:c.cardId,action:'revoke',reason:'Mất',refunded:true});assert.equal(r.errorCode,'RECONCILIATION_REQUIRED');
  assert.equal((await Tx.findById(signed.id)).status,'pending-card');assert.equal((await Tx.findById(unsigned.id)).status,'pending-card');
  assert.equal(await Tx.countDocuments({source:'refund'}),0);
});
// L4: thông báo thiếu quyền đúng nguyên văn; trang GET thiếu quyền render trang quản trị (layout) thay vì JSON thô.
it('missing permission uses the exact message and GET pages render an admin page instead of raw JSON',async()=>{
  const NOT_ALLOWED='Bạn không có quyền sử dụng tính năng này!';
  const c=await card();
  await Role.updateOne({_id:admin.role},{$set:{permissions:[]}});
  const denied=await post({cardId:c.cardId,action:'lock',reason:'x'});assert.equal(denied.http,403);assert.equal(denied.code,'error');assert.equal(denied.message,NOT_ALLOWED);
  for(const url of ['list','log','detail/'+c.cardId,'issue','checkin']){
    const response=await fetch(base+'/admin/card/'+url,{headers:{cookie:'token='+token}});const html=await response.text();
    assert.equal(response.status,403,url);assert.match(response.headers.get('content-type'),/text\/html/,url);
    assert.ok(html.includes(NOT_ALLOWED),url);assert.ok(html.includes('<html'),url);assert.ok(!html.trim().startsWith('{'),url);
  }
});
// L3: yêu cầu đổi trạng thái bị từ chối cũng phải có CardLog thất bại.
it('rejected status requests are audit-logged with the requested action and error code',async()=>{
  const c=await card({balance:5000});
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});
  assert.equal((await post({cardId:c.cardId,action:'lock',reason:'x'})).http,403);
  await Role.updateOne({_id:admin.role},{$set:{permissions}});
  assert.equal((await post({cardId:c.cardId,action:'revoke'})).http,400);
  assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Mất'},makeToken({stepUpAt:Date.now()-300001}))).code,'step-up-required');
  assert.equal((await post({cardId:c.cardId,action:'revoke',reason:'Mất'})).http,409);
  assert.equal((await post({cardId:c.cardId,action:'unlock'})).http,409);
  assert.equal((await post({cardId:'zz',action:'explode'})).http,400);
  const logs=await Log.find({result:'fail'}).sort({_id:1}).lean();
  assert.deepEqual(logs.map(log=>[log.action,log.detail.errorCode,log.cardId||null]),[
    ['lock','OP_FORBIDDEN',c.cardId],['revoke','INVALID_INPUT',c.cardId],['revoke','STEP_UP_REQUIRED',c.cardId],
    ['revoke','REFUND_REQUIRED',c.cardId],['unlock','CARD_STATE',c.cardId],['status','INVALID_INPUT',null]
  ]);
  for(const log of logs)assert.equal(log.actorId,admin.id);
  assert.equal((await Card.findById(c.id)).status,'active');
});
