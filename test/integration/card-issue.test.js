const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');
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
const Request=require('../../models/card-issuance-request.model');
const E=require('../../helpers/card-op.helper');
const cloud=require('../../helpers/cloudinary.helper');
const mail=require('../../helpers/mail.helper');
let routes;try{routes=require('../../routes/admin/card.route');}catch{}
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
const photoBase64=fs.readFileSync(path.resolve('public/admin/assets/images/avatar.jpg')).toString('base64');
const modulus=Buffer.from(crypto.generateKeyPairSync('rsa',{modulusLength:1024}).publicKey.export({format:'jwk'}).n,'base64url').toString('hex').toUpperCase();
let server,base,admin,token,otherToken,mails;
before(async()=>{
  process.env.JWT_SECRET='task7-isolated-test-secret';
  process.env.CARD_SERVER_KEY_PATH=path.resolve('smartcard/test-vectors/server-test-key.pem');
  process.env.CARD_ESCROW_MASTER='11'.repeat(32);
  if(db.enabled){await db.connect();await Promise.all([Card,Customer,Account,Role,Op,Log,Request].map(m=>m.init()));}
  cloud.uploadPhoto=async()=>({secure_url:'https://res.cloudinary.com/fixture/photo.jpg'});
  mail.sendMail=async(email,subject,html)=>{mails.push({email,subject,html});return {sent:true};};
  global.pathAdmin='admin';
  const app=express();app.set('view engine','pug');app.set('views',path.resolve('views'));app.locals.pathAdmin='admin';app.locals.messages={};app.use(express.json());app.use(cookies());if(routes)app.use('/admin',require('../../routes/admin/index.route'));app.use('/card-api',require('../../routes/client/card-api.route'));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
});
beforeEach(async()=>{if(!db.enabled)return;await db.reset();mails=[];const role=await Role.create({name:'Issuer',permissions:['card-issue','card-view']});admin=await Account.create({fullName:'Fixture Admin',email:'issuer@example.invalid',status:'active',deleted:false,role:role.id});token=jwt.sign({id:admin.id,email:admin.email},process.env.JWT_SECRET);const other=await Account.create({email:'other@example.invalid',status:'active',deleted:false,role:role.id});otherToken=jwt.sign({id:other.id,email:other.email},process.env.JWT_SECRET);});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(db.enabled)await db.close();});
async function post(endpoint,body,cookie=token,headers={}){const response=await fetch(base+'/admin/card/'+endpoint,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie:'token='+cookie}:{}),...headers},body:JSON.stringify(body)});let json;try{json=await response.json();}catch{json={};}return{status:response.status,...json};}
function body(extra={}){return {ownerType:'customer',customer:{fullName:'Nguyễn An',email:'new@example.invalid',phone:'0901234567'},photoBase64,...extra};}
async function prepare(extra={}){const r=await post('issue/prepare',body(extra));assert.equal(r.code,'success',JSON.stringify(r));return r;}
async function complete(r){assert.equal((await post('issue/init-confirm',{cardId:r.cardId,response:modulus,sw:'9000'})).code,'success');for(const opId of [r.profileOpId,r.photoOpId]){await E.signOp({opId,challengeHex:'AB'.repeat(16),actorType:'admin',actorId:admin.id});assert.equal((await E.confirmOp({opId,responseHex:'',sw:'9000',actorType:'admin',actorId:admin.id})).ok,true);}}

it('prepare new customer persists two real draft ops while keeping PIN metadata private',async()=>{const r=await prepare();assert.match(r.initialPin,/^\d{6}$/);assert.equal(await Customer.countDocuments(),1);assert.equal(await Op.countDocuments({cardId:r.cardId,status:'draft'}),2);const card=await Card.findOne({cardId:r.cardId}).lean();assert.equal(card.status,'issuing');assert.equal(card.issuance,undefined);const raw=await Card.collection.findOne({cardId:r.cardId});assert.ok(raw.issuance.pinCipher);assert.ok(!JSON.stringify(raw).includes(r.initialPin));await assert.rejects(E.signOp({opId:r.profileOpId,challengeHex:'AB'.repeat(16),actorType:'admin',actorId:admin.id}),{code:'CARD_STATE'});});
it('finish activates only after the exact two issuance ops are done and emails once',async()=>{const r=await prepare();assert.equal((await post('issue/finish',{cardId:r.cardId})).status,409);await complete(r);const results=await Promise.all([1,2].map(()=>post('issue/finish',{cardId:r.cardId})));assert.ok(results.every(x=>x.code==='success'));assert.equal((await Card.findOne({cardId:r.cardId})).status,'active');assert.equal(mails.length,1);assert.equal(mails[0].email,'new@example.invalid');assert.ok(mails[0].html.includes(r.initialPin));assert.ok(!JSON.stringify(results).includes(r.initialPin));assert.equal((await Card.collection.findOne({cardId:r.cardId})).issuance,undefined);assert.equal(await Log.countDocuments({action:'issue',cardId:r.cardId,result:'success'}),1);assert.equal((await post('issue/cancel',{cardId:r.cardId})).status,409);assert.equal((await Card.findOne({cardId:r.cardId})).status,'active');});
it('existing customer duplicate and concurrent prepare admit only one current card',async()=>{const c=await Customer.create({fullName:'Existing',email:'existing@example.invalid'});const attempts=await Promise.all([1,2].map(()=>post('issue/prepare',body({customer:undefined,customerId:c.id}))));assert.equal(attempts.filter(r=>r.code==='success').length,1);assert.equal(await Card.countDocuments({ownerId:c.id,isCurrent:true}),1);assert.equal(await Customer.countDocuments(),1);});
it('foreign issuer cannot INIT finish cancel or sign draft',async()=>{const r=await prepare();for(const endpoint of ['init-confirm','finish','cancel'])assert.equal((await post('issue/'+endpoint,{cardId:r.cardId,...(endpoint==='init-confirm'?{response:modulus,sw:'9000'}:{})},otherToken)).status,403);assert.equal((await post('op/sign',{opId:r.profileOpId,challenge:'AB'.repeat(16)},otherToken)).status,403);});
it('bad INIT SW length and invalid modulus never activate issuance',async()=>{const r=await prepare();for(const [response,sw]of [[modulus,'6F00'],['AA','9000'],['00'.repeat(128),'9000'],['AA'.repeat(128),'9000']])assert.notEqual((await post('issue/init-confirm',{cardId:r.cardId,response,sw})).code,'success');assert.equal((await Card.findOne({cardId:r.cardId})).publicKeyModulus,undefined);});
it('invalid or oversized JPEG and missing customer email are rejected before persistence',async()=>{for(const data of [body({photoBase64:Buffer.from('not jpeg').toString('base64')}),body({photoBase64:Buffer.alloc(10081,1).toString('base64')}),body({photoBase64:Buffer.from('FFD8FFD9','hex').toString('base64')}),body({customer:{fullName:'No email'}})])assert.equal((await post('issue/prepare',data)).status,400);assert.equal(await Card.countDocuments(),0);assert.equal(await Customer.countDocuments(),0);});
it('API rejects anonymous missing permission and cross origin requests',async()=>{assert.equal((await post('issue/prepare',body(),null)).status,401);await Role.updateOne({_id:admin.role},{$set:{permissions:[]}});assert.equal((await post('issue/prepare',body())).status,403);await Role.updateOne({_id:admin.role},{$set:{permissions:['card-issue']}});assert.equal((await post('issue/prepare',body(),token,{origin:'https://attacker.invalid'})).status,403);});
it('staff must be active and cardRequired changes atomically only on finish',async()=>{const staff=await Account.create({fullName:'Staff',email:'staff@example.invalid',status:'inactive'});assert.equal((await post('issue/prepare',{ownerType:'staff',accountId:staff.id,photoBase64})).status,409);await Account.updateOne({_id:staff.id},{$set:{status:'active'}});const r=await post('issue/prepare',{ownerType:'staff',accountId:staff.id,photoBase64});assert.equal(r.code,'success');assert.equal((await Account.findById(staff.id)).cardRequired,false);await complete(r);assert.equal((await post('issue/finish',{cardId:r.cardId})).code,'success');assert.equal((await Account.findById(staff.id)).cardRequired,true);});
it('cancel clears secrets fails pending ops and permits a new issuance',async()=>{const c=await Customer.create({fullName:'Cancel Fixture',email:'cancel@example.invalid'});const r=await prepare({customer:undefined,customerId:c.id});assert.equal((await post('issue/cancel',{cardId:r.cardId})).code,'success');assert.equal((await Card.findOne({cardId:r.cardId})).isCurrent,false);assert.equal((await Card.collection.findOne({cardId:r.cardId})).issuance,undefined);assert.equal(await Op.countDocuments({cardId:r.cardId,status:'failed'}),2);assert.equal((await post('issue/cancel',{cardId:r.cardId})).code,'success');await prepare({customer:undefined,customerId:c.id});});
it('expired issuance fails closed and removes durable PIN cipher',async()=>{const r=await prepare();await Card.updateOne({cardId:r.cardId},{$set:{'issuance.expireAt':new Date(0)}});assert.equal((await post('issue/init-confirm',{cardId:r.cardId,response:modulus,sw:'9000'})).status,409);assert.equal((await Card.findOne({cardId:r.cardId})).status,'failed');assert.equal((await Card.collection.findOne({cardId:r.cardId})).issuance,undefined);});
it('customer list searches persisted name email phone with escaped regex and current card status',async()=>{
  const a=await Customer.create({fullName:'Literal [A].*',email:'search@example.invalid',phone:'0909998888'});
  await Customer.create({fullName:'Other',email:'other@example.invalid'});
  await Customer.create({fullName:'Deleted',email:'gone@example.invalid',deleted:true});
  await Card.create({cardId:'12'.repeat(16),cardType:'customer',ownerId:a.id,status:'locked'});
  for(const keyword of ['[A].*','search@example.invalid','0909998888']){
    const response=await fetch(base+'/admin/user/list?keyword='+encodeURIComponent(keyword),{headers:{cookie:'token='+token}});
    assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes('search@example.invalid'));assert.ok(html.includes('Đã khóa'));assert.ok(!html.includes('other@example.invalid'));assert.ok(!html.includes('gone@example.invalid'));
  }
});
it('customer list permission and rendered card menus follow backend role permissions',async()=>{
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-view']}});
  let response=await fetch(base+'/admin/user/list',{headers:{cookie:'token='+token}}),html=await response.text();
  assert.equal(response.status,200);assert.ok(html.includes('/admin/card/list'));assert.ok(!html.includes('/admin/card/issue'));assert.ok(!html.includes('/admin/card/checkin'));assert.ok(!html.includes('/admin/card/log'));
  await Role.updateOne({_id:admin.role},{$set:{permissions:[]}});
  response=await fetch(base+'/admin/user/list',{headers:{cookie:'token='+token}});assert.equal(response.status,403);
  // M4: đúng thông báo chung và trang không có quyền trong layout admin.
  html=await response.text();assert.ok(html.includes('Bạn không có quyền sử dụng tính năng này!'));assert.ok(html.includes('data-no-permission'));
  await Role.updateOne({_id:admin.role},{$set:{permissions:['card-issue','card-checkin','card-log-view']}});
  response=await fetch(base+'/admin/card/issue',{headers:{cookie:'token='+token}});html=await response.text();assert.equal(response.status,200);assert.ok(html.includes('/admin/card/checkin'));assert.ok(html.includes('/admin/card/log'));assert.ok(html.includes('data-card-issue'));assert.ok(!html.includes('name="password"'));
});
it('expiry blocks Task5 signing policy through alternate routes too',async()=>{
  const r=await prepare();await post('issue/init-confirm',{cardId:r.cardId,response:modulus,sw:'9000'});
  await Card.updateOne({cardId:r.cardId},{$set:{'issuance.expireAt':new Date(0)}});
  await assert.rejects(E.signOp({opId:r.profileOpId,challengeHex:'AB'.repeat(16),actorType:'admin',actorId:admin.id}),{code:'CARD_STATE'});
});
it('alternate card API refuses missing issuance metadata and foreign draft ops',async()=>{
  const r=await prepare();await post('issue/init-confirm',{cardId:r.cardId,response:modulus,sw:'9000'});
  const foreign=await E.createOp({cardId:r.cardId,type:'commit-write',params:{target:1,dataHex:'010141'},actorType:'admin',actorId:admin.id});
  async function alternate(opId){const response=await fetch(base+'/card-api/op/sign',{method:'POST',headers:{'content-type':'application/json',cookie:'token='+token},body:JSON.stringify({opId,challenge:'AB'.repeat(16)})});return response.status;}
  assert.equal(await alternate(foreign.id),409);
  await Card.updateOne({cardId:r.cardId},{$unset:{issuance:1}});
  assert.equal(await alternate(r.profileOpId),409);
});
it('finish rejects two unrelated completed ops replacing the intended profile or photo',async()=>{
  const r=await prepare();await complete(r);
  const card=await Card.findOne({cardId:r.cardId}).select('+issuance').lean();
  await Op.updateOne({_id:card.issuance.photoOpId},{$set:{'params.target':1}});
  assert.equal((await post('issue/finish',{cardId:r.cardId})).status,409);
});
it('deleted admin role and staff-card session requirements block all issuance endpoints',async()=>{
  for(const [Model,id,change,restore]of [[Account,()=>admin.id,{deleted:true},{deleted:false}],[Role,()=>admin.role,{deleted:true},{deleted:false}],[Account,()=>admin.id,{cardRequired:true},{cardRequired:false}]]){
    await Model.updateOne({_id:id()},{$set:change});assert.equal((await post('issue/prepare',body())).status,403);await Model.updateOne({_id:id()},{$set:restore});
  }
});
it('email delivery failure keeps card active and does not resend PIN on finish retry',async()=>{
  const r=await prepare();await complete(r);const deliver=mail.sendMail;mail.sendMail=async()=>({sent:false});
  try{assert.equal((await post('issue/finish',{cardId:r.cardId})).emailStatus,'failed');assert.equal((await Card.findOne({cardId:r.cardId})).status,'active');assert.equal((await post('issue/finish',{cardId:r.cardId})).alreadyFinished,true);}finally{mail.sendMail=deliver;}
});
it('durable request replay preserves the same new customer card and drafts after committed response loss',async()=>{
  const requestId='A1'.repeat(16),payload=body({requestId});
  const dropped=await fetch(base+'/admin/card/issue/prepare',{method:'POST',headers:{'content-type':'application/json',cookie:'token='+token},body:JSON.stringify(payload)});
  assert.equal(dropped.status,200);await dropped.arrayBuffer();
  const recovered=await post('issue/prepare',payload);
  assert.equal(recovered.code,'success');assert.equal(await Customer.countDocuments(),1);assert.equal(await Card.countDocuments(),1);assert.equal(await Op.countDocuments(),2);
  assert.equal((await post('issue/prepare',payload,otherToken)).status,403);
  assert.equal((await post('issue/prepare',{...payload,customer:{...payload.customer,email:'changed@example.invalid'}})).status,409);
  await complete(recovered);await post('issue/finish',{cardId:recovered.cardId});
  const replay=await post('issue/prepare',payload);assert.equal(replay.status,409);assert.ok(!replay.initialPin);
});
it('request cancel tombstone prevents delayed prepare from committing customer or card',async()=>{
  const requestId='B2'.repeat(16);
  assert.equal((await post('issue/cancel',{requestId})).code,'success');
  assert.equal((await post('issue/cancel',{requestId},otherToken)).status,403);
  assert.equal((await post('issue/prepare',body({requestId}))).status,409);
  assert.equal(await Card.countDocuments(),0);assert.equal(await Customer.countDocuments(),0);
});
it('cancelling by request after response loss preserves the new customer for a safe retry',async()=>{
  const requestId='C3'.repeat(16),payload=body({requestId});
  assert.equal((await post('issue/prepare',payload)).code,'success');
  const cancelled=await post('issue/cancel',{requestId});assert.equal(cancelled.code,'success');assert.match(cancelled.customerId,/^[a-f0-9]{24}$/i);
  assert.equal(await Card.countDocuments({isCurrent:true}),0);
  const retry=await prepare({customer:undefined,customerId:cancelled.customerId,requestId:'D4'.repeat(16)});
  assert.equal(retry.code,'success');assert.equal(await Customer.countDocuments(),1);assert.equal(await Card.countDocuments({isCurrent:true}),1);
});
it('prepare releases expired owner issuance and concurrent identical requests share one persisted owner',async()=>{
  const requestId='E5'.repeat(16),payload=body({requestId});
  const first=await post('issue/prepare',payload);assert.equal(first.code,'success');
  const owner=await Customer.findOne();await Card.updateOne({cardId:first.cardId},{$set:{'issuance.expireAt':new Date(0)}});
  const retry=await prepare({customer:undefined,customerId:owner.id,requestId:'F6'.repeat(16)});
  assert.equal(retry.code,'success');assert.equal(await Card.countDocuments({isCurrent:true}),1);
  await post('issue/cancel',{cardId:retry.cardId});
  const identical=body({customer:undefined,customerId:owner.id,requestId:'A7'.repeat(16)});
  const results=await Promise.all([1,2].map(()=>post('issue/prepare',identical)));
  assert.ok(results.some(r=>r.code==='success'));assert.equal(await Customer.countDocuments(),1);assert.equal(await Card.countDocuments({isCurrent:true}),1);
});
it('owner asset boundary rejects omitted predecessor with balance pending funds or outstanding tickets',async()=>{
  const Tx=require('../../models/card-transaction.model'),Order=require('../../models/order.model');
  const customer=await Customer.create({fullName:'Revoked Owner',email:'revoked@example.invalid'});
  const old=await Card.create({cardId:'99'.repeat(16),ownerId:customer.id,cardType:'customer',status:'revoked',isCurrent:false,balance:50000});
  const payload=body({customer:undefined,customerId:customer.id});
  assert.equal((await post('issue/prepare',payload)).errorCode,'REPLACEMENT_DEFERRED');
  await Card.updateOne({_id:old.id},{$set:{balance:0}});
  await Tx.create({cardId:old.cardId,txRef:'88'.repeat(8),type:'credit',source:'cash',status:'pending-card',amount:10000});
  assert.equal((await post('issue/prepare',payload)).errorCode,'REPLACEMENT_DEFERRED');
  await Tx.deleteMany({});
  for(const ticketStatus of ['pending','written','used','pending-delete']){
    await Order.create({customerId:customer.id,items:[{ticketStatus}]});
    assert.equal((await post('issue/prepare',payload)).errorCode,'REPLACEMENT_DEFERRED');await Order.deleteMany({});
  }
  const allowed=await post('issue/prepare',payload);assert.equal(allowed.code,'success');
});
it('closed unsigned transactions on a revoked predecessor do not defer a new issuance but signed ones do',async()=>{
  const Tx=require('../../models/card-transaction.model');
  const customer=await Customer.create({fullName:'Closed Owner',email:'closed@example.invalid'});
  const old=await Card.create({cardId:'98'.repeat(16),ownerId:customer.id,cardType:'customer',status:'revoked',isCurrent:false,balance:0});
  const payload=body({customer:undefined,customerId:customer.id});
  let n=0;for(const failReason of ['voided','moved','refunded','expired','gateway'])await Tx.create({cardId:old.cardId,txRef:'7'+String(++n).padStart(15,'0'),type:failReason==='voided'?'debit':'credit',source:failReason==='voided'?'order':'zalopay',status:'failed',failReason,amount:10000});
  const signed=await Tx.create({cardId:old.cardId,txRef:'76'.repeat(8),type:'credit',source:'cash',status:'failed',signedOpId:'33'.repeat(12),amount:10000});
  assert.equal((await post('issue/prepare',payload)).errorCode,'REPLACEMENT_DEFERRED');
  await Tx.deleteOne({_id:signed._id});
  const allowed=await post('issue/prepare',payload);assert.equal(allowed.code,'success',JSON.stringify(allowed));
});
it('actual HTTP response lost after prepare commit is recovered before Agent work and cancels safely',async()=>{
  const browser=require('../../public/admin/assets/js/card-admin');let dropped=false,transmitted=false;
  const payload=body({requestId:'B8'.repeat(16)});delete payload.photoBase64;payload.photo=Buffer.from(photoBase64,'base64');
  const fetcher=async(url,options)=>{
    const response=await fetch(base+url,{...options,headers:{...options.headers,cookie:'token='+token}});
    if(url.endsWith('/prepare')&&!dropped){dropped=true;assert.equal(response.status,200);await response.arrayBuffer();throw new Error('response lost after actual server commit');}
    return response;
  };
  let failure;
  try{await browser.issueFlow(payload,{fetch:fetcher,client:{openSession:async()=>({state:0}),transmit:async()=>{transmitted=true;throw new Error('Agent intentionally unavailable');}}});}catch(error){failure=error;}
  assert.ok(dropped);assert.ok(transmitted);assert.match(failure.recoveryCustomerId,/^[a-f0-9]{24}$/i);
  assert.equal(await Customer.countDocuments(),1);assert.equal(await Card.countDocuments({isCurrent:true}),0);assert.equal(await Card.countDocuments({status:'failed'}),1);assert.equal(await Op.countDocuments({status:'failed'}),2);assert.equal(mails.length,0);
  await prepare({customer:undefined,customerId:failure.recoveryCustomerId});assert.equal(await Customer.countDocuments(),1);
});
it('cancel during external photo upload prevents a late prepare transaction from resurrecting the claim',async()=>{
  const original=cloud.uploadPhoto,requestId='C9'.repeat(16);let release,started;
  const entered=new Promise(resolve=>{started=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
  cloud.uploadPhoto=async()=>{started();await blocked;return {secure_url:'https://res.cloudinary.com/fixture/late.jpg'};};
  try{
    const preparing=post('issue/prepare',body({requestId}));await entered;
    assert.equal((await post('issue/cancel',{requestId})).code,'success');release();
    assert.equal((await preparing).status,409);assert.equal(await Card.countDocuments(),0);assert.equal(await Customer.countDocuments(),0);assert.equal((await Request.findOne({requestId})).state,'cancelled');
    assert.equal((await post('issue/prepare',body({requestId}))).status,409);
  }finally{release();cloud.uploadPhoto=original;}
});
it('expired request replay cancels its current card and returns its persisted customer for retry',async()=>{
  const requestId='DA'.repeat(16),payload=body({requestId});const first=await post('issue/prepare',payload);assert.equal(first.code,'success');
  await Request.updateOne({requestId},{$set:{expireAt:new Date(0)}});await Card.updateOne({cardId:first.cardId},{$set:{'issuance.expireAt':new Date(0)}});
  assert.equal((await post('issue/prepare',payload)).errorCode,'ISSUE_EXPIRED');assert.equal(await Card.countDocuments({isCurrent:true}),0);
  const cancelled=await post('issue/cancel',{requestId});await prepare({customer:undefined,customerId:cancelled.customerId});assert.equal(await Customer.countDocuments(),1);
});
