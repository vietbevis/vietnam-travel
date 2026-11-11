const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mongoose=require('mongoose');
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
const E=require('../../helpers/card-op.helper');
const C=require('../../helpers/card-crypto.helper');
const S=require('../../public/assets/js/card/card-shared');
const mail=require('../../helpers/mail.helper');
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
const permissions=['card-view','card-topup','card-reset-pin'];
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const modulus=Buffer.from(keys.publicKey.export({format:'jwk'}).n,'base64url').toString('hex').toUpperCase();
let server,base,admin,staff,owner,token;
before(async()=>{
  process.env.JWT_SECRET='task10-isolated-secret';process.env.CARD_SERVER_KEY_PATH=path.resolve('smartcard/test-vectors/server-test-key.pem');process.env.CARD_ESCROW_MASTER='11'.repeat(32);
  if(db.enabled){assert.equal(process.env.TEST_DATABASE,'mongodb://127.0.0.1:27018/vietnam-travel-smartcard-test');await db.connect();await Promise.all([Card,Customer,Account,Role,Tx,Op,Log].map(model=>model.init()));}
  const app=express();app.set('view engine','pug');app.set('views',path.resolve('views'));app.locals.pathAdmin='admin';app.locals.messages={};app.use(express.json());app.use(cookies());app.use('/admin',require('../../routes/admin/index.route'));app.use('/card-api',require('../../routes/client/card-api.route'));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=>{
  if(!db.enabled)return;await db.reset();
  const role=await Role.create({name:'Task10',permissions});admin=await Account.create({fullName:'Nhân viên quầy',email:'staff@example.invalid',role:role.id,status:'active'});
  staff=await Card.create({cardId:'FA'.repeat(16),cardType:'staff',ownerId:admin.id,status:'active',publicKeyModulus:modulus});token=makeToken();
  owner=await Customer.create({fullName:'Khách hàng',email:'owner@example.invalid',dob:new Date('1998-03-14')});
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(db.enabled)await db.close();});
function makeToken(extra={},account=admin,card=staff){return jwt.sign({id:account.id,email:account.email,cardId:card.cardId,stepUpAt:Date.now(),...extra},process.env.JWT_SECRET,{expiresIn:3600});}
const key=()=>crypto.randomBytes(16).toString('hex');
async function card(extra={}){return Card.create({cardId:key(),cardType:'customer',ownerId:owner.id,status:'active',publicKeyModulus:modulus,...extra});}
async function post(endpoint,body,{cookie=token,requestId=key(),headers={}}={}){const response=await fetch(base+endpoint,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie:'token='+cookie}:{}),...(requestId?{'Idempotency-Key':requestId}:{}),...headers},body:JSON.stringify(body)});let json={};try{json=await response.json();}catch{}return {http:response.status,...json};}
const reset=(body,options)=>post('/admin/card/reset-pin',body,options);
const cash=(body,options)=>post('/admin/card/topup-cash',body,options);
async function prepared(c){const r=await reset({cardId:c.cardId});assert.equal(r.code,'success',JSON.stringify(r));assert.equal((await post('/admin/card/op/sign',{opId:r.opId,challenge:'AB'.repeat(16)})).code,'success');return r.opId;}
async function row(c,amount,extra={}){return Tx.create({cardId:c.cardId,txRef:crypto.randomBytes(8).toString('hex'),type:'credit',source:'cash',amount,status:'done',createdBy:admin.id,...extra});}
it('late callback and cash topup share the wallet lock and cannot overbook capacity',async()=>{
  const c=await card({balance:49000000});
  const late=await row(c,1000000,{source:'zalopay',status:'failed',failReason:'expired'});
  const [received,cashResult]=await Promise.all([E.markTopupPaid(late.id,'zalopay'),cash({cardId:c.cardId,amount:1000000})]);
  assert.equal(received,true);
  const stored=await Tx.findById(late.id);
  assert.ok(['pending-card','reconciliation'].includes(stored.status));
  const pending=await Tx.find({cardId:c.cardId,type:'credit',status:{$in:['pending-card','sent']}}).lean();
  assert.equal(49000000+pending.reduce((sum,tx)=>sum+tx.amount,0),50000000);
  assert.equal(cashResult.http,stored.status==='pending-card'?409:200);
});

// Bắt thiếu route, quyền hiện tại hoặc tin freshness do trình duyệt tự gửi.
it('reset and cash enforce current admin permission fresh staff step-up and strict input',async()=>{
  const c=await card();for(const action of [reset,cash]){
    const body={cardId:c.cardId,...(action===cash?{amount:10000}:{})};
    assert.equal((await action(body,{cookie:null})).http,401);
    await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});assert.equal((await action(body)).http,403);
    await Role.updateOne({_id:admin.role},{$set:{permissions}});
    for(const stepUpAt of [undefined,Date.now()-300001,Date.now()+10000])assert.equal((await action(body,{cookie:makeToken({stepUpAt})})).code,'step-up-required');
    assert.equal((await action({...body,stepUpAt:Date.now()})).http,400);
    assert.equal((await action(body,{headers:{origin:'https://attacker.invalid'}})).http,403);
  }
  assert.equal(await Op.countDocuments(),0);assert.equal(await Tx.countDocuments(),0);
});
it('reset active customer or staff uses encrypted strong DOB-aware PIN and returns it only once',async t=>{
  const messages=[];t.mock.method(mail,'sendMail',async(email,subject,body)=>{messages.push({email,body});return {sent:true};});
  for(const c of [await card(),staff]){
    const opId=await prepared(c),before=await Op.findById(opId).lean();assert.equal(before.params.newPin,undefined);assert.match(before.params.encryptedPin,/^[a-f0-9]{32}$/i);
    const results=await Promise.all([1,2].map(()=>post('/admin/card/op/confirm',{opId,response:'',sw:'9000'})));
    const winner=results.find(r=>r.ok);assert.ok(winner);assert.match(winner.result.newPin,/^\d{6}$/);assert.equal(S.isWeakPin(winner.result.newPin,c.cardType==='customer'?'19980314':undefined),false);assert.equal(winner.result.emailStatus,'sent');
    assert.equal(results.filter(r=>r.result?.newPin).length,1);assert.equal(messages.length,c.cardType==='customer'?1:2);
    const stored=await Op.findById(opId).lean();assert.equal(stored.status,'done');assert.equal(stored.params.newPin,undefined);assert.equal(stored.params.encryptedPin,undefined);assert.equal(stored.emailStatus,'sent');
    const replay=await post('/card-api/op/confirm',{opId,response:'',sw:'9000'});assert.equal(replay.result,null);assert.equal(JSON.stringify(await Log.find()).includes(winner.result.newPin),false);
  }
});
it('reset mail rejection or synchronous failure is explicit and never replays mail',async t=>{
  const c=await card();for(const behavior of [()=>{throw new Error('SMTP private');},async()=>{throw new Error('SMTP private');},async()=>({sent:false})]){
    let sends=0;const mock=t.mock.method(mail,'sendMail',(...args)=>{sends++;return behavior(...args);});
    const opId=await prepared(c),r=await post('/admin/card/op/confirm',{opId,response:'',sw:'9000'});assert.equal(r.ok,true);assert.match(r.result.newPin,/^\d{6}$/);assert.equal(r.result.emailStatus,'failed');
    assert.equal((await Op.findById(opId)).emailStatus,'failed');await post('/admin/card/op/confirm',{opId,response:'',sw:'9000'});assert.equal(sends,1);mock.mock.restore();
  }
});
it('reset without recipient still returns first PIN and safely reports not-applicable',async()=>{
  await Account.updateOne({_id:admin.id},{$unset:{email:1}});
  const op=await E.createOp({cardId:staff.cardId,type:'reset-pin',params:{newPin:'827491'},actorType:'admin',actorId:admin.id});await E.signOp({opId:op.id,challengeHex:'AB'.repeat(16),actorType:'admin',actorId:admin.id});
  const r=await E.confirmOp({opId:op.id,sw:'9000',actorType:'admin',actorId:admin.id});assert.equal(r.result.newPin,'827491');assert.equal(r.result.emailStatus,'not-applicable');
});
it('locked revoked non-current target and staff cash are rejected without ledger mutation',async()=>{
  for(const extra of [{status:'locked'},{status:'revoked',isCurrent:false},{status:'failed',isCurrent:false}]){const c=await card(extra);assert.equal((await reset({cardId:c.cardId})).http,409);assert.equal((await cash({cardId:c.cardId,amount:10000})).http,409);await Card.deleteOne({_id:c._id});}
  assert.equal((await cash({cardId:staff.cardId,amount:10000})).http,409);assert.equal(await Tx.countDocuments(),0);
});
it('reset sign and confirm recheck target state permissions actor and freshness including old API',async()=>{
  const c=await card(),r=await reset({cardId:c.cardId});assert.equal(r.code,'success');
  for(const endpoint of ['/admin/card/op/sign','/card-api/op/sign'])assert.equal((await post(endpoint,{opId:r.opId,challenge:'AB'.repeat(16)},{cookie:makeToken({stepUpAt:Date.now()-301000})})).http,403);
  await Card.updateOne({_id:c.id},{$set:{status:'locked'}});assert.equal((await post('/admin/card/op/sign',{opId:r.opId,challenge:'AB'.repeat(16)})).http,409);
  await Card.updateOne({_id:c.id},{$set:{status:'active'}});assert.equal((await post('/admin/card/op/sign',{opId:r.opId,challenge:'AB'.repeat(16)})).code,'success');
  assert.equal((await post('/card-api/sync/confirm',{opId:r.opId,response:'',sw:'9000'})).http,403);
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});assert.equal((await post('/admin/card/op/confirm',{opId:r.opId,response:'',sw:'9000'})).http,403);
  await Role.updateOne({_id:admin.role},{$set:{permissions}});await Card.updateOne({_id:c.id},{$set:{status:'locked'}});assert.equal((await post('/admin/card/op/confirm',{opId:r.opId,response:'',sw:'9000'})).http,409);
});
it('cash validates minimum integer amount and durable 32hex request identity',async()=>{
  const c=await card();for(const amount of [0,9999,10000.5,'10000',-10000,50000001])assert.equal((await cash({cardId:c.cardId,amount})).http,400);
  for(const requestId of [null,'short','x'.repeat(32)])assert.equal((await cash({cardId:c.cardId,amount:10000},{requestId})).http,400);
  const r=await cash({cardId:c.cardId,amount:10000});assert.equal(r.code,'success');assert.equal(r.status,'pending-card');assert.equal((await Card.findById(c.id)).balance,0);assert.equal(await Tx.countDocuments(),1);
});
it('cash daily cap counts all accepted cash statuses for actor across cards with staff independence',async()=>{
  const c=await card();await row(c,9000000);await row(c,9000000,{status:'failed'});
  assert.equal((await cash({cardId:c.cardId,amount:2500000})).http,409);assert.equal((await cash({cardId:c.cardId,amount:2000000})).code,'success');assert.equal((await cash({cardId:c.cardId,amount:10000})).http,409);
  const other=await Account.create({email:'other@example.invalid',role:admin.role,status:'active'}),otherStaff=await Card.create({cardId:'FB'.repeat(16),cardType:'staff',ownerId:other.id,status:'active',publicKeyModulus:modulus});
  assert.equal((await cash({cardId:c.cardId,amount:2500000},{cookie:makeToken({},other,otherStaff)})).code,'success');
});
it('cash day boundary is Vietnam midnight and excludes next day rows',async()=>{
  const c=await card(),now=new Date(),day=Math.floor((now.getTime()+7*3600000)/86400000)*86400000-7*3600000;
  for(const [createdAt,amount]of [[new Date(day-1),20000000],[new Date(day),18000000],[new Date(day+86400000),20000000]])await row(c,amount,{createdAt});
  assert.equal((await cash({cardId:c.cardId,amount:2000000})).code,'success');assert.equal((await cash({cardId:c.cardId,amount:10000})).http,409);
});
it('cash wallet cap includes pending sent and failed signed liabilities exactly once',async()=>{
  const c=await card({balance:45000000});await row(c,1000000,{source:'vnpay',status:'pending-card'});await row(c,1000000,{status:'sent',signedOpId:'11'.repeat(12)});await row(c,1000000,{status:'failed',signedOpId:'22'.repeat(12)});await row(c,20000000,{source:'vnpay',status:'failed'});
  assert.equal((await cash({cardId:c.cardId,amount:2000001})).http,409);assert.equal((await cash({cardId:c.cardId,amount:2000000})).code,'success');assert.equal((await Card.findById(c.id)).balance,45000000);
});
it('cash same key concurrent replay returns same row after done and denies card amount actor mismatch',async()=>{
  const c=await card(),requestId=key(),body={cardId:c.cardId,amount:500000};const results=await Promise.all([1,2,3].map(()=>cash(body,{requestId})));assert.ok(results.every(r=>r.code==='success'),JSON.stringify(results));assert.equal(new Set(results.map(r=>r.txRef)).size,1);assert.equal(await Tx.countDocuments(),1);
  await Tx.updateOne({txRef:results[0].txRef},{$set:{status:'done'}});const replay=await cash(body,{requestId});assert.equal(replay.txRef,results[0].txRef);assert.equal(replay.status,'done');
  assert.equal((await cash({...body,amount:600000},{requestId})).http,409);const c2=await card({ownerId:'11'.repeat(12)});assert.equal((await cash({...body,cardId:c2.cardId},{requestId})).http,409);
  const other=await Account.create({email:'other@example.invalid',role:admin.role,status:'active'}),otherStaff=await Card.create({cardId:'FB'.repeat(16),cardType:'staff',ownerId:other.id,status:'active',publicKeyModulus:modulus});assert.equal((await cash(body,{requestId,cookie:makeToken({},other,otherStaff)})).http,409);
});
it('cash concurrent distinct keys across cards share staff cap and one card shares wallet cap across staff',async()=>{
  const c=await card(),c2=await card({ownerId:'11'.repeat(12)});await row(c,18000000);
  const results=await Promise.all([c,c2].map(c=>cash({cardId:c.cardId,amount:1500000})));assert.equal(results.filter(r=>r.code==='success').length,1);assert.equal(await Tx.countDocuments(),2);
  await Tx.deleteMany({});await Card.updateOne({_id:c.id},{$set:{balance:49000000}});
  const other=await Account.create({email:'other@example.invalid',role:admin.role,status:'active'}),otherStaff=await Card.create({cardId:'FB'.repeat(16),cardType:'staff',ownerId:other.id,status:'active',publicKeyModulus:modulus});
  const outcomes=await Promise.all([cash({cardId:c.cardId,amount:700000}),cash({cardId:c.cardId,amount:700000},{cookie:makeToken({},other,otherStaff)})]);assert.equal(outcomes.filter(r=>r.code==='success').length,1);assert.equal(await Tx.countDocuments(),1);
});
it('cash receipt recovery verifies amount card counter balance and applies one credit after lost confirm',async()=>{
  const c=await card(),r=await cash({cardId:c.cardId,amount:500000});assert.equal(r.code,'success');
  const next=await post('/card-api/sync/next',{cardId:c.cardId,cardState:2,challenge:'AB'.repeat(16)});assert.equal(next.step.kind,'op');
  const message=Buffer.alloc(38);message[0]=0x52;Buffer.from(c.cardId,'hex').copy(message,1);message[17]=1;Buffer.from(r.txRef,'hex').copy(message,18);message.writeUInt32BE(500000,26);message.writeUInt32BE(500000,30);message.writeUInt32BE(1,34);
  const receipt=bytes=>Buffer.concat([bytes,crypto.sign('RSA-SHA256',bytes,keys.privateKey)]).toString('hex');
  for(const offset of [1,26,30,34]){const wrong=Buffer.from(message);wrong[offset]^=1;assert.equal((await post('/card-api/sync/receipt',{cardId:c.cardId,txRef:r.txRef,response:receipt(wrong),sw:'9000'},{cookie:null})).ok,false);}
  const good=receipt(message),recovery=await post('/card-api/sync/receipt',{cardId:c.cardId,txRef:r.txRef,response:good,sw:'9000'},{cookie:null});assert.equal(recovery.ok,true);assert.equal((await Card.findById(c.id)).balance,500000);assert.equal((await Card.findById(c.id)).txCounter,1);assert.equal((await Tx.findOne({txRef:r.txRef})).status,'done');assert.equal((await post('/card-api/sync/receipt',{cardId:c.cardId,txRef:r.txRef,response:good,sw:'9000'},{cookie:null})).ok,false);
});
it('reset transaction rollback then lost race never leaks earlier callback PIN or sends a second email',async t=>{
  const c=await card(),opId=await prepared(c),start=mongoose.startSession.bind(mongoose);let entered=false,winner,sends=0;
  t.mock.method(mail,'sendMail',async()=>{sends++;return {sent:true};});
  t.mock.method(mongoose,'startSession',async()=>{
    const session=await start();if(entered)return session;entered=true;
    const withTransaction=session.withTransaction.bind(session),rollback=new Error('Chủ động hủy snapshot kiểm thử');
    session.withTransaction=async callback=>{
      await assert.rejects(withTransaction(async()=>{await callback();throw rollback;}),error=>error===rollback);
      winner=await E.confirmOp({opId,sw:'9000',actorType:'admin',actorId:admin.id});
      return withTransaction(callback);
    };return session;
  });
  const loser=await E.confirmOp({opId,sw:'9000',actorType:'admin',actorId:admin.id});assert.equal(winner.ok,true);assert.match(winner.result.newPin,/^\d{6}$/);assert.equal(loser.ok,false);assert.equal(loser.result,null);assert.equal(sends,1);assert.equal((await Op.findById(opId)).params.encryptedPin,undefined);
});
it('reset generation rejects owner birthday repeated digits and sequential PIN before encrypting',async t=>{
  const c=await card(),values=[140398,111111,123456,827491];let calls=0;t.mock.method(crypto,'randomInt',()=>{calls++;return values.shift();});t.mock.method(mail,'sendMail',async()=>({sent:true}));
  const opId=await prepared(c),r=await post('/admin/card/op/confirm',{opId,response:'',sw:'9000'});assert.equal(r.result.newPin,'827491');assert.equal(calls,4);assert.equal((await Op.findById(opId)).params.newPin,undefined);
});
it('reset failed SW and expiry scrub ciphertext and never return PIN or send mail',async t=>{
  const c=await card();let sends=0;t.mock.method(mail,'sendMail',async()=>{sends++;return {sent:true};});
  const opId=await prepared(c),r=await post('/admin/card/op/confirm',{opId,response:'',sw:'6982'});assert.equal(r.ok,false);assert.equal(r.result,null);assert.equal((await Op.findById(opId)).params.encryptedPin,undefined);
  const expired=await reset({cardId:c.cardId});await Op.updateOne({_id:expired.opId},{$set:{expireAt:new Date(Date.now()-1000)}});assert.equal((await post('/admin/card/op/sign',{opId:expired.opId,challenge:'AB'.repeat(16)})).http,409);assert.equal((await Op.findById(expired.opId)).params.encryptedPin,undefined);assert.equal(sends,0);
});
it('reset first confirm is denied to another admin or stale stepup through both operation APIs',async t=>{
  const c=await card(),opId=await prepared(c);t.mock.method(mail,'sendMail',async()=>({sent:true}));
  const other=await Account.create({email:'other@example.invalid',role:admin.role,status:'active'}),otherStaff=await Card.create({cardId:'FB'.repeat(16),cardType:'staff',ownerId:other.id,status:'active',publicKeyModulus:modulus});
  for(const endpoint of ['/admin/card/op/confirm','/card-api/op/confirm'])for(const cookie of [makeToken({stepUpAt:Date.now()-301000}),makeToken({},other,otherStaff)])assert.equal((await post(endpoint,{opId,response:'',sw:'9000'},{cookie})).http,403);
  assert.equal((await Op.findById(opId)).status,'prepared');assert.equal((await post('/admin/card/op/confirm',{opId,response:'',sw:'9000'})).ok,true);
});
it('cash bound sync sign and confirm require fresh staff permission before financial mutation',async()=>{
  const c=await card(),r=await cash({cardId:c.cardId,amount:500000});assert.equal(r.code,'success');
  const body={cardId:c.cardId,cardState:2,challenge:'AB'.repeat(16)};const stale=await post('/card-api/sync/next',body,{cookie:makeToken({stepUpAt:Date.now()-301000})});assert.equal(stale.http,200);assert.equal(stale.step,null);assert.equal(stale.requiresAuth,true);assert.equal(await Op.countDocuments(),0);
  const next=await post('/card-api/sync/next',body);assert.equal(next.step.kind,'op');
  for(const endpoint of ['/admin/card/op/confirm','/card-api/op/confirm','/card-api/sync/confirm'])assert.equal((await post(endpoint,{opId:next.step.opId,response:'',sw:'9000'},{cookie:makeToken({stepUpAt:Date.now()-301000})})).http,403);
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});assert.equal((await post('/card-api/sync/confirm',{opId:next.step.opId,response:'',sw:'9000'})).http,403);assert.equal((await Card.findById(c.id)).balance,0);assert.equal((await Tx.findOne({txRef:r.txRef})).status,'sent');
});
it('detail gates reset and customer cash controls by permission and active state',async()=>{
  const c=await card();async function html(id){const response=await fetch(base+'/admin/card/detail/'+id,{headers:{cookie:'token='+token}});assert.equal(response.status,200);return response.text();}
  let output=await html(c.cardId);for(const selector of ['data-card-reset-pin-form','data-card-topup-cash-form','data-card-new-pin-dialog','data-card-cash-recover'])assert.ok(output.includes(selector));
  output=await html(staff.cardId);assert.ok(output.includes('data-card-reset-pin-form'));assert.ok(!output.includes('data-card-topup-cash-form'));
  await Card.updateOne({_id:c.id},{$set:{status:'locked'}});output=await html(c.cardId);assert.ok(!output.includes('data-card-reset-pin-form'));assert.ok(!output.includes('data-card-topup-cash-form'));
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});output=await html(staff.cardId);assert.ok(!output.includes('data-card-reset-pin-form'));assert.ok(!output.includes('data-card-new-pin-dialog'));
});
// L3: yêu cầu reset PIN / nạp tiền mặt bị từ chối (quyền, dữ liệu, Step-up, hạn mức, trạng thái) đều có CardLog thất bại, không chứa PIN.
it('rejected reset-pin and cash requests are audit-logged with an error code and no PIN',async()=>{
  const c=await card();
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});
  assert.equal((await reset({cardId:c.cardId})).http,403);assert.equal((await cash({cardId:c.cardId,amount:10000})).http,403);
  await Role.updateOne({_id:admin.role},{$set:{permissions}});
  assert.equal((await reset({cardId:'zz'})).http,400);
  assert.equal((await cash({cardId:c.cardId,amount:10000},{cookie:makeToken({stepUpAt:Date.now()-300001})})).code,'step-up-required');
  assert.equal((await cash({cardId:c.cardId,amount:5000})).http,400);
  await row(c,20000000);assert.equal((await cash({cardId:c.cardId,amount:10000})).http,409);
  const locked=await card({status:'revoked',isCurrent:false});assert.equal((await reset({cardId:locked.cardId})).http,409);
  const logs=await Log.find({result:'fail',action:{$in:['reset-pin','topup-cash']}}).sort({_id:1}).lean();
  assert.deepEqual(logs.map(log=>[log.action,log.detail.errorCode,log.cardId||null]),[
    ['reset-pin','OP_FORBIDDEN',c.cardId.toUpperCase()],['topup-cash','OP_FORBIDDEN',c.cardId.toUpperCase()],
    ['reset-pin','INVALID_INPUT',null],['topup-cash','STEP_UP_REQUIRED',c.cardId.toUpperCase()],
    ['topup-cash','INVALID_INPUT',c.cardId.toUpperCase()],['topup-cash','TOPUP_LIMIT',c.cardId.toUpperCase()],
    ['reset-pin','CARD_STATE',locked.cardId.toUpperCase()]
  ]);
  for(const log of logs){assert.equal(log.actorId,admin.id);assert.ok(!/\b\d{6}\b/.test(JSON.stringify(log.detail)));}
});
