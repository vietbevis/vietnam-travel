const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const express=require('express'),cookies=require('cookie-parser'),jwt=require('jsonwebtoken');
const db=require('../helpers/db');
const Card=require('../../models/card.model'),Customer=require('../../models/customer.model'),Nonce=require('../../models/card-nonce.model'),Forgot=require('../../models/forgot-password.model'),Tx=require('../../models/card-transaction.model'),Log=require('../../models/card-log.model'),Op=require('../../models/card-operation.model');
const mail=require('../../helpers/mail.helper'),A=require('../../helpers/card-apdu.helper'),E=require('../../helpers/card-op.helper');
const Account=require('../../models/account-admin.model');
const mongoose=require('mongoose');
const key=crypto.generateKeyPairSync('rsa',{modulusLength:1024}),modulus=Buffer.from(key.publicKey.export({format:'jwk'}).n,'base64url').toString('hex').toUpperCase();
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
let server,base,customer,card,token,messages=[];
before(async()=>{process.env.JWT_SECRET='task12-fixture-secret';process.env.CARD_SERVER_KEY_PATH=path.resolve('smartcard/test-vectors/server-test-key.pem');if(db.enabled){await db.connect();await Promise.all([Card,Customer,Nonce,Forgot,Tx,Log,Op,Account].map(m=>m.init()));}mail.sendMail=async(email,subject,content)=>{messages.push({email,subject,content});return{sent:true};};const app=express();app.set('trust proxy',true);app.set('view engine','pug');app.set('views',path.resolve('views'));app.locals.messages={};app.locals.settingWebsiteInfo={};app.locals.categoryList=[];app.locals.cardAgentUrl='';app.use(express.json());app.use(cookies());app.use('/card-api',require('../../routes/client/card-api.route'));app.use('/admin/account',require('../../routes/admin/account.route'));app.use('/account',(req,res,next)=>{try{return require('../../middlewares/client/customer-auth.middleware').optional(req,res,next);}catch{return res.status(404).end();}},(req,res,next)=>{try{return require('../../routes/client/account.route')(req,res,next);}catch{return res.status(404).end();}});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
beforeEach(async()=>{if(!db.enabled)return;await db.reset();messages=[];customer=await Customer.create({fullName:'Khách kiểm thử',email:'customer@example.com',phone:'0901111111',dob:new Date('1990-01-02'),totalSpent:35000000});card=await Card.create({cardId:'A0'.repeat(16),cardType:'customer',ownerId:customer.id,status:'active',publicKeyModulus:modulus,balance:700000});token=jwt.sign({customerId:customer.id,cardId:card.cardId},process.env.JWT_SECRET,{expiresIn:'1d'});});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(db.enabled)await db.close();});
async function request(url,body,cookie=token,extra={}){const r=await fetch(base+url,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie:'customerToken='+cookie}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();let json={};try{json=JSON.parse(text);}catch{}return{status:r.status,headers:r.headers,text,...json};}
async function proof(changes={},nonce){nonce=nonce||(await request('/card-api/login/challenge',{},'')).nonce;const body={cardId:card.cardId,nonce,counter:0,...changes};body.signature=crypto.sign('sha256',A.buildAuthMessage({nonceHex:body.nonce,cardIdHex:body.cardId,counter:body.counter}),key.privateKey).toString('hex');return body;}
async function otp(){const r=await request('/account/card-lock/otp',{email:customer.email},'');assert.equal(r.status,200);await new Promise(r=>setTimeout(r,20));return /\b\d{6}\b/.exec(messages[0]?.content||'')?.[0];}
// Catches missing nonce purpose/CAS, accepting forged proof, and wrong token/cookie lifetime.
it('customer login consumes RSA nonce once activates first login and sets protected one-day JWT',async()=>{const body=await proof();const r=await request('/card-api/login/verify',body,'');assert.equal(r.status,200,r.text);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Max-Age=86400/);const decoded=jwt.verify(decodeURIComponent(cookie.match(/customerToken=([^;]+)/)[1]),process.env.JWT_SECRET,{algorithms:['HS256']});assert.equal(decoded.exp-decoded.iat,86400);assert.equal(decoded.customerId,customer.id);assert.equal(decoded.cardId,card.cardId);assert.ok((await Card.findById(card.id)).activatedAt);assert.equal((await request('/card-api/login/verify',body,'')).status,401);});
it('login rejects foreign purpose expiry signature staff locked revoked and deleted owner without money changes',async()=>{for(const mode of ['purpose','expiry','signature','staff','locked','revoked','deleted']){await Nonce.deleteMany({});await Card.updateOne({_id:card.id},{$set:{cardType:'customer',status:'active',isCurrent:true}});await Customer.updateOne({_id:customer.id},{$set:{deleted:false}});const body=await proof();if(mode==='purpose')await Nonce.updateOne({nonce:body.nonce},{$set:{purpose:'step-up'}});if(mode==='expiry')await Nonce.updateOne({nonce:body.nonce},{$set:{expireAt:new Date(0)}});if(mode==='signature')body.signature='00'.repeat(128);if(mode==='staff')await Card.updateOne({_id:card.id},{$set:{cardType:'staff'}});if(['locked','revoked'].includes(mode))await Card.updateOne({_id:card.id},{$set:{status:mode,isCurrent:mode==='locked'}});if(mode==='deleted')await Customer.updateOne({_id:customer.id},{$set:{deleted:true}});assert.equal((await request('/card-api/login/verify',body,'')).status,401,mode);}assert.equal((await Card.findById(card.id)).balance,700000);assert.equal((await Card.findById(card.id)).txCounter,0);});
it('nonce concurrency issues a single session and cross-origin strict input cannot login or logout',async()=>{const body=await proof();const results=await Promise.all([request('/card-api/login/verify',body,''),request('/card-api/login/verify',body,'')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);for(const url of ['/card-api/login/challenge','/card-api/logout'])assert.equal((await request(url,{},token,{origin:'https://other.example'})).status,403);assert.equal((await request('/card-api/login/challenge',{purpose:'login-staff'},'')).status,400);assert.equal((await request('/card-api/logout',{})).headers.get('set-cookie').includes('customerToken=;'),true);});
it('middleware rejects forged expired foreign owner and next request after lock or revoke',async()=>{for(const bad of [token+'x',jwt.sign({customerId:customer.id,cardId:card.cardId},process.env.JWT_SECRET,{expiresIn:-1}),jwt.sign({customerId:'11'.repeat(12),cardId:card.cardId},process.env.JWT_SECRET)]){const r=await request('/account/card',undefined,bad);assert.equal(r.status,302);assert.match(r.headers.get('set-cookie'),/customerToken=;/);}for(const status of ['locked','revoked']){await Card.updateOne({_id:card.id},{$set:{status,isCurrent:status==='locked'}});assert.equal((await request('/account/card')).status,302);assert.equal((await request('/card-api/profile/build',{phone:'0902222222',emergencyName:'Mẹ',emergencyPhone:'0903333333'})).status,401);}});
it('account renders persisted tier spend pending balance and transaction history without exposing proof',async()=>{await Tx.create({cardId:card.cardId,txRef:'11'.repeat(8),type:'credit',source:'cash',amount:10000,status:'pending-card'});const r=await request('/account/card');assert.equal(r.status,200,r.text);for(const text of ['Gold','35.000.000','700.000','10.000','1111111111111111'])assert.ok(r.text.includes(text),text);assert.ok(!r.text.includes(modulus));assert.equal(r.headers.get('cache-control'),'no-store');});
it('profile accepts exactly three fields canonical TLV and applies only after bound latest confirm',async()=>{const fields={phone:'0902222222',emergencyName:'Mẹ',emergencyPhone:'0903333333'};const r=await request('/card-api/profile/build',fields);assert.equal(r.status,200,r.text);assert.ok(r.profileHex.includes(Buffer.from('Khách kiểm thử').toString('hex').toUpperCase()));assert.equal((await Customer.findById(customer.id)).phone,'0901111111');const op=await Op.findById(r.opId);assert.equal(op.actorType,'customer');assert.equal(op.actorId,customer.id);await E.signOp({opId:r.opId,challengeHex:'AB'.repeat(16),actorType:'customer',actorId:customer.id});assert.equal((await request('/card-api/op/confirm',{opId:r.opId,response:'',sw:'9000'})).ok,true);assert.equal((await Customer.findById(customer.id)).phone,fields.phone);const a=await request('/card-api/profile/build',fields);await E.signOp({opId:a.opId,challengeHex:'AB'.repeat(16),actorType:'customer',actorId:customer.id});await request('/card-api/profile/build',{...fields,phone:'0904444444'});assert.equal((await request('/card-api/op/confirm',{opId:a.opId,response:'',sw:'9000'})).status,409);});
it('profile rejects immutable missing extra fields and failed confirm preserves Customer with sanitized audits',async()=>{for(const body of [{phone:'1'},{phone:'1',emergencyName:'Mẹ',emergencyPhone:'2',email:'evil@example.com'},{phone:123,emergencyName:'Mẹ',emergencyPhone:'2'}])assert.equal((await request('/card-api/profile/build',body)).status,400);const r=await request('/card-api/profile/build',{phone:'0902222222',emergencyName:'Mẹ',emergencyPhone:'0903333333'});await E.signOp({opId:r.opId,challengeHex:'AB'.repeat(16),actorType:'customer',actorId:customer.id});assert.equal((await request('/card-api/op/confirm',{opId:r.opId,response:'',sw:'6A80'})).ok,false);assert.equal((await Customer.findById(customer.id)).phone,'0901111111');const logs=await Log.find({action:'customer-profile-build'}).lean();assert.equal(logs.length,4);assert.ok(!JSON.stringify(logs).includes('0902222222'));});
it('OTP send is uniform for unknown deleted inactive-card and mail failure and stores only context HMAC',async()=>{const known=await request('/account/card-lock/otp',{email:customer.email},'');for(const email of ['unknown@example.com',customer.email]){mail.sendMail=async()=>{throw new Error('raw-secret');};const r=await request('/account/card-lock/otp',{email},'');assert.equal(r.status,known.status);assert.equal(r.message,known.message);}const row=await Forgot.findOne({purpose:'customer-card-lock'}).lean();assert.ok(row);assert.equal(row.otp,undefined);assert.match(row.otpHash,/^[a-f0-9]{64}$/);assert.equal(row.cardId,card.cardId);assert.ok(row.expireAt-Date.now()<=300000);mail.sendMail=async(email,subject,content)=>{messages.push({email,subject,content});return{sent:true};};});
it('valid OTP atomically locks once preserves wallet and pending and invalidates session',async()=>{const code=await otp();assert.match(code,/^\d{6}$/);await Tx.create({cardId:card.cardId,txRef:'22'.repeat(8),type:'credit',source:'cash',amount:10000,status:'sent'});const results=await Promise.all([request('/account/card-lock/confirm',{email:customer.email,otp:code},''),request('/account/card-lock/confirm',{email:customer.email,otp:code},'')]);assert.equal(results.filter(r=>r.code==='success').length,1);const locked=await Card.findById(card.id);assert.equal(locked.status,'locked');assert.equal(locked.lockedReason,'customer-reported-lost');assert.equal(locked.balance,700000);assert.equal(await Tx.countDocuments({status:'sent'}),1);assert.equal(await Log.countDocuments({action:'customer-card-lock',result:'success',actorId:customer.id}),1);assert.equal((await request('/account/card')).status,302);await Card.updateOne({_id:card.id},{$set:{status:'active'}});assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:code},'')).code,'error');assert.equal((await Card.findById(card.id)).status,'active');});
it('wrong expired five-attempt and replaced-card OTP cannot lock and reissue retains quotas',async()=>{let code=await otp();for(let i=0;i<5;i++)assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:code==='000000'?'000001':'000000'},'')).code,'error');assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:code},'')).code,'error');assert.equal((await Card.findById(card.id)).status,'active');await Forgot.deleteMany({});messages=[];code=await otp();await Forgot.updateOne({purpose:'customer-card-lock'},{$set:{expireAt:new Date(0)}});assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:code},'')).code,'error');await Forgot.deleteMany({});messages=[];code=await otp();await Card.updateOne({_id:card.id},{$set:{status:'revoked',isCurrent:false}});const next=await Card.create({cardId:'B0'.repeat(16),cardType:'customer',ownerId:customer.id,status:'active',publicKeyModulus:modulus});assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:code},'')).code,'error');assert.equal((await Card.findById(next.id)).status,'active');});
it('admin legacy OTP cannot verify customer lock and send cooldown survives identical requests',async()=>{await Forgot.create({email:customer.email,otp:'482057',expireAt:new Date(Date.now()+300000)});assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:'482057'},'')).code,'error');await otp();for(let i=0;i<6;i++)await request('/account/card-lock/otp',{email:customer.email},'');assert.equal(messages.filter(m=>m.subject.includes('OTP')).length,1);assert.equal(await Forgot.countDocuments({purpose:'customer-card-lock'}),1);assert.equal(await Forgot.countDocuments({otp:'482057'}),1);});
it('persistent email caps survive cooldown changes OTP reissue and module reload while IP caps span addresses',async()=>{
  for(let i=0;i<7;i++){await Forgot.updateMany({purpose:'customer-card-lock'},{$set:{nextSendAt:new Date(0)}});await request('/account/card-lock/otp',{email:customer.email},'',{'x-forwarded-for':'192.0.2.'+(i+1)});}
  assert.equal(messages.length,5);
  const rows=await Forgot.find({purpose:'customer-card-lock-limit'}).lean();assert.ok(rows.some(r=>r.count===5));
  for(let i=0;i<31;i++)await request('/account/card-lock/otp',{email:'unknown'+i+'@example.com'},'',{'x-forwarded-for':'192.0.2.100'});
  assert.ok((await Forgot.find({purpose:'customer-card-lock-limit'}).lean()).some(r=>r.count===30));
  delete require.cache[require.resolve('../../controllers/client/account.controller')];
  const sendAgain=require('../../controllers/client/account.controller').sendOtp;
  await Forgot.updateMany({purpose:'customer-card-lock'},{$set:{nextSendAt:new Date(0)}});
  let result;await sendAgain({body:{email:customer.email},headers:{},is:()=>true,ip:'192.0.2.200'}, {set(){},json(value){result=value;}});
  assert.equal(result.code,'success');assert.equal(messages.length,5);
});
it('concurrent sends emit one code and atomic wrong attempts cannot exceed five even with valid racing request',async()=>{
  await Promise.all(Array.from({length:8},()=>request('/account/card-lock/otp',{email:customer.email},'')));
  assert.equal(messages.length,1);
  const code=/\b\d{6}\b/.exec(messages[0].content)[0];
  await Promise.all(Array.from({length:8},()=>request('/account/card-lock/confirm',{email:customer.email,otp:code==='000000'?'000001':'000000'},'')));
  assert.equal((await Forgot.findOne({purpose:'customer-card-lock'})).attempts,5);
  assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:code},'')).code,'error');
});
it('verify email quota persists across new OTP and IP quota rejects across unknown emails',async()=>{
  let code=await otp();
  for(let i=0;i<20;i++)await request('/account/card-lock/confirm',{email:customer.email,otp:'wrong!'},'');
  // Đầu vào sai định dạng không tiêu quota; mã đúng định dạng thì có.
  for(let i=0;i<20;i++)await request('/account/card-lock/confirm',{email:customer.email,otp:code==='000000'?'000001':'000000'},'',{'x-forwarded-for':'192.0.2.'+(i+1)});
  await Forgot.updateOne({purpose:'customer-card-lock'},{$set:{nextSendAt:new Date(0)}});messages=[];code=await otp();
  assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:code},'',{'x-forwarded-for':'192.0.2.90'})).code,'error');
  for(let i=0;i<101;i++)await request('/account/card-lock/confirm',{email:'unknown'+i+'@example.com',otp:'482057'},'',{'x-forwarded-for':'192.0.2.200'});
  assert.ok((await Forgot.find({purpose:'customer-card-lock-limit'}).lean()).some(r=>r.count===100));
  assert.equal((await Card.findById(card.id)).status,'active');
});
it('admin request cooldown and verification never consume customer purpose including same email legacy admin records',async()=>{
  await Account.create({email:customer.email,status:'active'});
  const code=await otp();
  assert.equal((await request('/admin/account/otp-password',{email:customer.email,otp:code},'')).code,'error');
  assert.equal(await Forgot.countDocuments({purpose:'customer-card-lock'}),1);
  assert.equal((await request('/admin/account/forgot-password',{email:customer.email},'')).code,'success');
  const admin=await Forgot.findOne({purpose:'admin-reset'});assert.ok(admin);
  assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:admin.otp},'')).code,'error');
  assert.equal((await request('/admin/account/otp-password',{email:customer.email,otp:admin.otp},'')).code,'success');
  assert.equal(await Forgot.countDocuments({purpose:'customer-card-lock'}),1);
  await Forgot.create({email:customer.email,otp:'482057',expireAt:new Date(Date.now()+300000)});
  assert.equal((await request('/admin/account/otp-password',{email:customer.email,otp:'482057'},'')).code,'success');
});
it('deleted owner invalidates current token and all customer audits omit OTP JWT and submitted private values',async()=>{
  const code=await otp();await request('/account/card-lock/confirm',{email:customer.email,otp:'482057'},'');await Customer.updateOne({_id:customer.id},{$set:{deleted:true}});
  assert.equal((await request('/account/card')).status,302);
  const logs=JSON.stringify(await Log.find().lean());for(const value of [code,token,'482057',customer.email])assert.ok(!logs.includes(value));
});
it('rejected anonymous profile builds are audited without accepting submitted identity',async()=>{
  const r=await request('/card-api/profile/build',{phone:'0902222222',emergencyName:'Mẹ',emergencyPhone:'0903333333'},'');assert.equal(r.status,401);
  const entry=await Log.findOne({action:'customer-profile-build',result:'fail'}).lean();assert.ok(entry);assert.equal(entry.detail.errorCode,'AUTH_REQUIRED');assert.equal(entry.actorId,undefined);assert.ok(!JSON.stringify(entry).includes('0902222222'));
});
it('legacy mixed-case email works and ambiguous canonical email fails closed without choosing an owner',async()=>{
  await Customer.updateOne({_id:customer.id},{$set:{email:'Customer@Example.com'}});
  const code=await otp();assert.match(code,/^\d{6}$/);
  assert.equal((await request('/account/card-lock/confirm',{email:'CUSTOMER@example.com',otp:code},'')).code,'success');
  await Card.updateOne({_id:card.id},{$set:{status:'active'}});await Forgot.deleteMany({});messages=[];
  await Customer.create({email:'customer@example.COM',status:'active'});
  const r=await request('/account/card-lock/otp',{email:customer.email},'');assert.equal(r.code,'success');assert.equal(messages.length,0);assert.equal((await Card.findById(card.id)).status,'active');
});
it('OTP expiry is checked after delayed transaction starts rather than using request-time snapshot',async()=>{
  const code=await otp();await Forgot.updateOne({purpose:'customer-card-lock'},{$set:{expireAt:new Date(Date.now()+50)}});
  const original=mongoose.startSession;mongoose.startSession=async function(...args){const session=await original.apply(this,args),withTransaction=session.withTransaction.bind(session);session.withTransaction=async fn=>{await new Promise(r=>setTimeout(r,100));return withTransaction(fn);};return session;};
  try{assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:code},'')).code,'error');assert.equal((await Card.findById(card.id)).status,'active');}finally{mongoose.startSession=original;}
});
it('aborted OTP transaction never sends an unpersisted code after audit failure',async()=>{
  const cardLog=require('../../helpers/card-log.helper'),original=cardLog.write;
  cardLog.write=async function(entry,options){if(entry.action==='customer-card-lock-otp'&&options?.session)throw new Error('fixture-audit-unavailable');return original(entry,options);};
  try{const r=await request('/account/card-lock/otp',{email:customer.email},'');assert.equal(r.status,200);assert.equal(r.message,'Nếu email hợp lệ, mã OTP đã được gửi');await new Promise(r=>setTimeout(r,20));assert.equal(messages.length,0);assert.equal(await Forgot.countDocuments({purpose:'customer-card-lock'}),0);assert.equal(await Forgot.countDocuments({purpose:'customer-card-lock-limit'}),0);assert.equal((await Card.findById(card.id)).status,'active');}finally{cardLog.write=original;}
});
it('IP-denied send cannot exhaust a victim email quota or create counters for new email addresses',async()=>{
  const blocked='192.0.2.31';
  for(let i=0;i<30;i++)await request('/account/card-lock/otp',{email:'fill@example.com'},'',{'x-forwarded-for':blocked});
  const before=await Forgot.find({purpose:'customer-card-lock-limit'}).sort({key:1}).lean();
  for(let i=0;i<6;i++){const result=await request('/account/card-lock/otp',{email:customer.email},'',{'x-forwarded-for':blocked});assert.equal(result.code,'success');}
  for(let i=0;i<3;i++)await request('/account/card-lock/otp',{email:'new-denied'+i+'@example.com'},'',{'x-forwarded-for':blocked});
  const after=await Forgot.find({purpose:'customer-card-lock-limit'}).sort({key:1}).lean();
  assert.deepEqual(after.map(row=>[row.key,row.count,+row.windowStart]),before.map(row=>[row.key,row.count,+row.windowStart]));
  const result=await request('/account/card-lock/otp',{email:customer.email},'',{'x-forwarded-for':'192.0.2.32'});assert.equal(result.code,'success');assert.equal(messages.length,1);
});
it('IP-denied verification cannot exhaust a victim email quota and clean IP can still consume valid OTP',async()=>{
  const code=await otp(),blocked='192.0.2.41';
  for(let i=0;i<100;i++)await request('/account/card-lock/confirm',{email:'fill@example.com',otp:'482057'},'',{'x-forwarded-for':blocked});
  const before=await Forgot.find({purpose:'customer-card-lock-limit'}).sort({key:1}).lean();
  for(let i=0;i<21;i++)await request('/account/card-lock/confirm',{email:customer.email,otp:'482057'},'',{'x-forwarded-for':blocked});
  for(let i=0;i<3;i++)await request('/account/card-lock/confirm',{email:'new-denied'+i+'@example.com',otp:'482057'},'',{'x-forwarded-for':blocked});
  const after=await Forgot.find({purpose:'customer-card-lock-limit'}).sort({key:1}).lean();
  assert.deepEqual(after.map(row=>[row.key,row.count,+row.windowStart]),before.map(row=>[row.key,row.count,+row.windowStart]));
  assert.equal((await Forgot.findOne({purpose:'customer-card-lock'})).attempts,0);
  assert.equal((await request('/account/card-lock/confirm',{email:customer.email,otp:code},'',{'x-forwarded-for':'192.0.2.42'})).code,'success');
});
