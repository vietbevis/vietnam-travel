const crypto=require('node:crypto');
const mongoose=require('mongoose');
const jwt=require('jsonwebtoken');
const adminToken=require('../../helpers/admin-token.helper');
const cardAuth=require('../../helpers/card-auth.helper');
const Card=require('../../models/card.model');
const Customer=require('../../models/customer.model');
const Account=require('../../models/account-admin.model');
const Role=require('../../models/role.model');
const Op=require('../../models/card-operation.model');
const Order=require('../../models/order.model');
const Tx=require('../../models/card-transaction.model');
const Log=require('../../models/card-log.model');
const Request=require('../../models/card-issuance-request.model');
const E=require('../../helpers/card-op.helper');
const C=require('../../helpers/card-crypto.helper');
const A=require('../../helpers/card-apdu.helper');
const S=require('../../public/assets/js/card/card-shared');
const cloud=require('../../helpers/cloudinary.helper');
const mail=require('../../helpers/mail.helper');
const V=require('../../validates/admin/card.validate');
const api=require('../client/card-api.controller');
const cardLog=require('../../helpers/card-log.helper');
const walletRules=require('../../helpers/wallet-rule.helper');
const objectId=value=>typeof value==='string'&&/^[a-fA-F0-9]{24}$/.test(value);
function fail(code,status=409,message='Yêu cầu phát hành thẻ không hợp lệ hoặc đã kết thúc.'){const error=new Error(message);Object.assign(error,{code,status});throw error;}
function problem(res,error){if(error.code==='STEP_UP_REQUIRED')return res.status(403).json({code:'step-up-required',message:'Hãy xác thực lại thẻ nhân viên trước khi cấp lại thẻ.'});return res.status(error.status||500).json({code:'error',errorCode:error.code||'INTERNAL',message:error.status?error.message:'Không thể xử lý yêu cầu thẻ.'});}
module.exports.authenticate=async(req,res,next)=>{
  res.set('Cache-Control','no-store');
  try{
    if(req.method!=='GET'&&!req.is('application/json'))fail('INVALID_INPUT',415);
    if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin).origin;}catch{fail('OP_FORBIDDEN',403);}if(origin!==req.protocol+'://'+req.get('host'))fail('OP_FORBIDDEN',403);}
    if(!req.cookies?.token)fail('AUTH_REQUIRED',401);
    let decoded;try{decoded=jwt.verify(req.cookies.token,process.env.JWT_SECRET,{algorithms:['HS256']});}catch{fail('AUTH_REQUIRED',401);}
    if(decoded.stage!==undefined||!objectId(decoded.id)||typeof decoded.email!=='string')fail('AUTH_REQUIRED',401);
    const ctx=await adminToken.resolve(decoded);
    if(!ctx)fail('OP_FORBIDDEN',403);
    adminToken.attach(req,ctx);
    const account=ctx.account,role=ctx.role;
    req.cardActor={id:decoded.id,permissions:role.permissions||[]};next();
  }catch(error){problem(res,error);}
};
function endpoint(schema,fn){return async(req,res)=>{try{if(!req.cardActor?.permissions.includes('card-issue'))fail('OP_FORBIDDEN',403);const {error,value}=V.schemas[schema].validate(req.body,{convert:false});if(error)fail('INVALID_INPUT',400);await fn(req,res,value);}catch(error){if(error.code===11000)return problem(res,{status:409,code:'CURRENT_CARD',message:'Người này đã có thẻ đang hoạt động'});problem(res,error);}};}
async function transaction(fn){const session=await mongoose.startSession();let result;try{await session.withTransaction(async()=>{result=await fn(session);});return result;}finally{await session.endSession();}}
function pinKey(cardId){return crypto.createHmac('sha256',C.deriveEscrowKey(cardId)).update('travel-card-issuance-v1').digest();}
function encryptPin(cardId,pin){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',pinKey(cardId),iv);cipher.setAAD(Buffer.from(cardId));const encrypted=Buffer.concat([cipher.update(pin,'ascii'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('hex');}
function decryptPin(cardId,encrypted){const b=Buffer.from(encrypted,'hex'),cipher=crypto.createDecipheriv('aes-256-gcm',pinKey(cardId),b.subarray(0,12));cipher.setAAD(Buffer.from(cardId));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('ascii');}
async function cleanup(cardId,actorId,session){
  const card=await Card.findOne({cardId,status:'issuing',issuedBy:actorId}).select('+issuance').session(session).lean();
  const update=await Card.updateOne({cardId,status:'issuing',issuedBy:actorId},{$set:{status:'failed',isCurrent:false},$unset:{issuance:1}},{session});
  if(update.modifiedCount&&card?.issuance?.requestId)await Request.updateOne({requestId:card.issuance.requestId,actorId,state:{$in:['preparing','ready']}},{$set:{state:'cancelled'}},{session});
  if(update.modifiedCount){await Op.updateMany({cardId,actorType:'admin',actorId,status:{$in:['draft','prepared']}},{$set:{status:'failed'},$unset:{'params.encryptedPin':1,'params.newPin':1}},{session});await Log.create([{action:'issue-cancel',cardId,actorType:'admin',actorId,result:'success'}],{session});}
}
async function load(cardId,actorId,session,allowExpired=false){
  const card=await Card.findOne({cardId:cardId.toUpperCase()}).select('+issuance').session(session);
  if(!card)fail('CARD_NOT_FOUND',404);
  if(card.issuedBy!==actorId)fail('OP_FORBIDDEN',403);
  if(card.status!=='issuing'||!card.isCurrent)fail('CARD_STATE');
  if(!card.issuance||!allowExpired&&card.issuance.expireAt<=new Date())fail('ISSUE_EXPIRED');
  return card;
}
async function expire(cardId,actorId){const card=await Card.findOne({cardId:cardId.toUpperCase(),issuedBy:actorId,status:'issuing'}).select('+issuance').lean();if(card&&(!card.issuance||card.issuance.expireAt<=new Date())){await transaction(session=>cleanup(card.cardId,actorId,session));fail('ISSUE_EXPIRED');}}
function profile(owner){const data={};for(const key of ['fullName','dob','gender','phone','idNumber','emergencyName','emergencyPhone','bloodType','allergies'])if(owner[key])data[key]=key==='dob'?new Date(owner[key]).toISOString().slice(0,10).replace(/-/g,''):owner[key];return Buffer.from(S.encodeProfile(data)).toString('hex').toUpperCase();}
function replacementPermission(req){
  requirePermission(req,'card-issue');requirePermission(req,'card-revoke');
  if(!adminToken.stepUp.isFresh(req))fail('STEP_UP_REQUIRED',403);
}
// Nghĩa vụ còn cản thu hồi/cấp lại: chờ cổng, đã gửi, debit chờ thẻ, hoặc mọi giao dịch đã ký chưa done.
// Credit pending-card chưa ký thì không cản: cấp lại chuyển sang thẻ mới, thu hồi hoàn tiền cùng số dư (Ruling 13).
const liabilityFilter=cardId=>({cardId,status:{$ne:'done'},$or:[{status:{$in:['awaiting-payment','sent']}},{status:'pending-card',type:'debit'},{signedOpId:{$exists:true}}]});
const unsignedCreditFilter=cardId=>({cardId,type:'credit',status:'pending-card',signedOpId:{$exists:false}});
// Debit chưa ký chắc chắn chưa tới chip: huỷ trong cùng transaction kiểm nghĩa vụ; đã ký/đã gửi luôn giữ để khôi phục biên nhận.
async function voidUnsigned(cardId,session,req,actorId){
  const voided=await E.voidUnsignedDebits({cardId},session);
  if(voided.length)await cardLog.write({action:'card-debit-void',cardId,actorType:'admin',actorId,result:'success',detail:{reason:'card-close',txRefs:voided.map(tx=>tx.txRef),orderIds:voided.map(tx=>tx.orderId)},req},{session});
}
async function obligations(cardId,session,req,actorId){
  await E.expireStaleTopups(cardId,session);
  await voidUnsigned(cardId,session,req,actorId);
  const liability=await Tx.exists(liabilityFilter(cardId)).session(session);
  const prepared=await Op.exists({cardId,status:'prepared',type:{$ne:'set-state'}}).session(session);
  if(liability||prepared)fail('RECONCILIATION_REQUIRED',409,'Thẻ còn giao dịch hoặc lệnh đã ký cần đối soát. Không được cấp lại khi chưa xác nhận kết quả.');
}
async function replacement(body,ownerId,session,actorId){
  const stale=await Card.find({ownerId,cardType:body.ownerType,status:'issuing',isCurrent:true}).select('+issuance').session(session).lean();
  for(const card of stale)if(!card.issuance||!(card.issuance.expireAt>new Date()))await cleanup(card.cardId,card.issuedBy,session);
  if(await Card.exists({ownerId,cardType:body.ownerType,isCurrent:true}).session(session))fail('CURRENT_CARD',409,'Người này đã có thẻ đang hoạt động');
  const previous=await Card.find({ownerId,cardType:body.ownerType,status:'revoked',isCurrent:false}).session(session).lean();
  if(body.replaceOf){
    const source=previous.find(card=>card.cardId===body.replaceOf.toUpperCase());
    if(!source?.replacement||source.revokedReason!=='replaced'||source.replacement.completedAt)fail('INVALID_REPLACEMENT');
    if(source.replacement.actorId!==actorId)fail('OP_FORBIDDEN',403);
    if(source.replacement.targetCardId){
      const target=await Card.findOne({cardId:source.replacement.targetCardId}).session(session).lean();
      if(target&&target.status!=='failed')fail('CURRENT_CARD');
    }
    await obligations(source.cardId,session,null,actorId);
    return source;
  }
  if(previous.some(card=>card.replacement&&!card.replacement.completedAt)||previous.length&&(previous.some(card=>card.balance>0)||await Tx.exists({cardId:{$in:previous.map(card=>card.cardId)},status:{$ne:'done'},$nor:[{status:'failed',signedOpId:{$exists:false}}]}).session(session)||body.ownerType==='customer'&&await Order.exists({customerId:ownerId,deleted:false,items:{$elemMatch:{ticketStatus:{$in:['pending','written','used','pending-delete']}}}}).session(session)))fail('REPLACEMENT_DEFERRED',409,'Thẻ cũ còn tài sản hoặc yêu cầu cấp lại; hãy dùng Cấp lại từ thẻ nguồn.');
}
async function replacementSource(card,actorId,session){
  const source=await Card.findOne({cardId:card.replaceOf,ownerId:card.ownerId,cardType:card.cardType,status:'revoked',isCurrent:false,revokedReason:'replaced','replacement.actorId':actorId,'replacement.targetCardId':card.cardId,'replacement.completedAt':{$exists:false}}).session(session).lean();
  if(!source)fail('INVALID_REPLACEMENT');
  return source;
}
async function transferReplacement(card,actorId,session,req){
  const moved=[];
  const source=await replacementSource(card,actorId,session);
  await obligations(source.cardId,session,req,actorId);
  const won=await Card.updateOne({_id:source._id,__v:source.__v,balance:source.balance,'replacement.targetCardId':card.cardId,'replacement.completedAt':{$exists:false}},{$set:{balance:0,'replacement.completedAt':new Date()},$inc:{__v:1}},{session});
  if(won.modifiedCount!==1)fail('INVALID_REPLACEMENT');
  if(card.cardType==='customer'){
    if(source.balance>0)await Tx.create([{cardId:source.cardId,txRef:C.randomHex(8),type:'debit',source:'transfer',amount:source.balance,status:'done',balanceAfter:0,createdBy:actorId},{cardId:card.cardId,txRef:C.randomHex(8),type:'credit',source:'transfer',amount:source.balance,status:'pending-card',createdBy:actorId}],{session,ordered:true});
    // Credit chưa ký (chưa từng tới chip cũ) chuyển nguyên số tiền/nguồn sang thẻ mới; không mang createdBy/cashRequestId
    // để không tính lại vào hạn mức tiền mặt trong ngày, movedFrom giữ liên kết đối soát.
    for(const credit of await Tx.find(unsignedCreditFilter(source.cardId)).session(session).lean()){
      const closed=await Tx.updateOne({_id:credit._id,status:'pending-card',signedOpId:{$exists:false}},{$set:{status:'failed',failReason:'moved'}},{session});
      if(closed.modifiedCount!==1)fail('RECONCILIATION_REQUIRED',409,'Thẻ còn giao dịch hoặc lệnh đã ký cần đối soát. Không được cấp lại khi chưa xác nhận kết quả.');
      const [next]=await Tx.create([{cardId:card.cardId,txRef:C.randomHex(8),type:'credit',source:credit.source,amount:credit.amount,status:'pending-card',movedFrom:credit.txRef}],{session});
      moved.push({from:credit.txRef,to:next.txRef,amount:credit.amount,source:credit.source});
    }
    const orders=await Order.find({customerId:card.ownerId,deleted:false,paymentStatus:'paid',status:{$nin:['cancel','cancelled']},'items.ticketStatus':'written'}).session(session).lean();
    const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
    const tickets=require('../../helpers/ticket.helper');
    for(const order of orders){const changes={};for(let i=0;i<order.items.length;i++){
      const item=order.items[i];if(item.ticketStatus!=='written'||item.checkedInAt||item.checkedInBy||item.used===true||item.cancelled===true||['cancel','cancelled','used'].includes(item.status))continue;
      try{const data=tickets.ticketData(order,i);A.encodeTicket(data);if(new Date(new Date(data.departureDate).getTime()+7*3600000).toISOString().slice(0,10)<today)continue;}catch{continue;}
      changes['items.'+i+'.ticketStatus']='pending';
    }if(Object.keys(changes).length)await Order.updateOne({_id:order._id},{$set:changes},{session});}
  }
  await cardLog.write({action:'replace-finish',cardId:card.cardId,actorType:'admin',actorId,result:'success',detail:{replaceOf:source.cardId,amount:card.cardType==='customer'?source.balance:0,...(moved.length?{moved}:{})},req},{session});
}
function requestDigest(body,bytes){
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const {requestId,photoBase64,...input}=body;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(input))).update(bytes).digest('hex');
}
async function requestCustomer(request,session){return request.ownerType==='customer'&&request.ownerId&&await Customer.exists({_id:request.ownerId,deleted:false}).session(session)?request.ownerId:undefined;}
async function recoverPrepare(request,actorId,digest){
  if(request.actorId!==actorId)fail('OP_FORBIDDEN',403);
  if(['cancelled','finished'].includes(request.state))fail('ISSUE_CLOSED');
  if(request.digest!==digest)fail('REQUEST_MISMATCH');
  if(!(request.expireAt>new Date())){await cancelRequest(request.requestId,actorId);fail('ISSUE_EXPIRED');}
  if(request.state!=='ready')fail('ISSUE_PREPARING',409,'Yêu cầu đang chuẩn bị; hãy hủy yêu cầu trước khi thử lại.');
  const card=await Card.findOne({cardId:request.cardId,issuedBy:actorId,status:'issuing',isCurrent:true}).select('+issuance').lean();
  if(!card||card.publicKeyModulus||!card.issuance||!(card.issuance.expireAt>new Date()))fail('ISSUE_STARTED');
  if(card.replaceOf)await replacementSource(card,actorId,null);
  const profileOp=await Op.findOne({_id:card.issuance.profileOpId,cardId:card.cardId,status:'draft',actorType:'admin',actorId,type:'commit-write','params.target':1}).lean();
  const photoOp=await Op.findOne({_id:card.issuance.photoOpId,cardId:card.cardId,status:'draft',actorType:'admin',actorId,type:'commit-write','params.target':2}).lean();
  if(!profileOp||!photoOp)fail('ISSUE_INCOMPLETE');
  const initialPin=decryptPin(card.cardId,card.issuance.pinCipher);
  const initApdu=S.apdu(S.INS.INIT,0,0,A.buildInitData({cardIdHex:card.cardId,cardType:card.cardType==='customer'?1:2,pin:initialPin,kEscrow:C.deriveEscrowKey(card.cardId)}));
  return {code:'success',cardId:card.cardId,initApdu,initialPin,profileOpId:String(profileOp._id),profileHex:profileOp.params.dataHex,photoOpId:String(photoOp._id)};
}
async function cancelRequest(requestId,actorId){
  requestId=requestId.toUpperCase();
  // Upsert tạo tombstone kể cả khi prepare chưa kịp ghi claim.
  await Request.updateOne({requestId},{$setOnInsert:{actorId,state:'cancelled',expireAt:new Date(Date.now()+300000)}},{upsert:true});
  return transaction(async session=>{
    const request=await Request.findOne({requestId}).session(session).lean();
    if(request.actorId!==actorId)fail('OP_FORBIDDEN',403);
    if(request.state==='finished')fail('CARD_STATE');
    if(request.cardId){const card=await Card.findOne({cardId:request.cardId}).session(session).lean();if(card?.status==='active')fail('CARD_STATE');if(card?.status==='issuing')await cleanup(card.cardId,actorId,session);}
    await Request.updateOne({_id:request._id,state:{$ne:'finished'}},{$set:{state:'cancelled'},$inc:{__v:1}},{session});
    return {customerId:await requestCustomer(request,session)};
  });
}
module.exports.issue=async(req,res)=>{
  try{
    requirePermission(req,'card-issue');
    let replaceSource,sourceOwner;
    if(req.query.replaceOf!==undefined){
      replacementPermission(req);
      if(typeof req.query.replaceOf!=='string'||! /^[a-fA-F0-9]{32}$/.test(req.query.replaceOf))fail('INVALID_INPUT',400);
      replaceSource=await Card.findOne({cardId:req.query.replaceOf.toUpperCase(),status:'revoked',revokedReason:'replaced','replacement.actorId':req.cardActor.id,'replacement.completedAt':{$exists:false}}).lean();
      if(!replaceSource)fail('INVALID_REPLACEMENT');
      sourceOwner=await (replaceSource.cardType==='customer'?Customer:Account).findOne({_id:replaceSource.ownerId,deleted:false,status:'active'}).select('_id fullName email phone').lean();
      if(!sourceOwner)fail('OWNER_STATE');
    }
    const [customers,accounts]=await Promise.all([Customer.find({deleted:false,status:'active'}).select('_id fullName email phone').sort({fullName:1}).limit(500).lean(),Account.find({deleted:false,status:'active'}).select('_id fullName email').sort({fullName:1}).limit(500).lean()]);
    if(sourceOwner){const list=replaceSource.cardType==='customer'?customers:accounts;if(!list.some(owner=>String(owner._id)===replaceSource.ownerId))list.push(sourceOwner);}
    res.render('admin/pages/card-issue',{pageTitle:'Phát hành thẻ',customers,accounts,replaceSource});
  }catch(error){pageProblem(res,error,'Phát hành thẻ');}
};
module.exports.issuePrepare=endpoint('prepare',async(req,res,body)=>{
  if(body.replaceOf)replacementPermission(req);
  let bytes;try{bytes=V.decodePhoto(body.photoBase64);}catch{fail('INVALID_PHOTO',400,'Ảnh phải là JPEG hợp lệ và không quá 10 080 byte.');}
  const actorId=req.cardActor.id;
  const requestId=(body.requestId||C.randomHex(16)).toUpperCase(),digest=requestDigest(body,bytes);
  let request=await Request.findOne({requestId}).lean();
  if(request)return res.json(await recoverPrepare(request,actorId,digest));
  let owner;
  if(body.ownerType==='staff')owner=await Account.findOne({_id:body.accountId,status:'active',deleted:false}).select('_id fullName email phone dob gender idNumber emergencyName emergencyPhone bloodType allergies avatar').lean();
  else if(body.customerId)owner=await Customer.findOne({_id:body.customerId,status:'active',deleted:false}).lean();
  else owner={...body.customer,_id:new mongoose.Types.ObjectId()};
  if(!owner||!owner.email)fail('OWNER_STATE');
  const ownerId=String(owner._id);
  await replacement(body,ownerId,null,actorId);
  let profileHex;try{profileHex=profile(owner);}catch{fail('INVALID_PROFILE',400);}
  const cardId=C.randomHex(16),initialPin=C.generatePin(owner.dob),pinCipher=encryptPin(cardId,initialPin);
  const initApdu=S.apdu(S.INS.INIT,0,0,A.buildInitData({cardIdHex:cardId,cardType:body.ownerType==='customer'?1:2,pin:initialPin,kEscrow:C.deriveEscrowKey(cardId)}));
  try{request=await Request.create({requestId,actorId,digest,ownerId,ownerType:body.ownerType,state:'preparing',expireAt:new Date(Date.now()+300000)});}
  catch(error){if(error.code!==11000)throw error;return res.json(await recoverPrepare(await Request.findOne({requestId}).lean(),actorId,digest));}
  try{
    const upload=await cloud.uploadPhoto(bytes);
    if(!upload?.secure_url||!/^https:\/\//.test(upload.secure_url))fail('PHOTO_UPLOAD',502,'Không thể lưu ảnh; chưa phát hành thẻ.');
    await transaction(async session=>{
      const claim=await Request.findOne({requestId,actorId,state:'preparing',expireAt:{$gt:new Date()}}).session(session).lean();
      if(!claim)fail('ISSUE_CLOSED');
      if(body.customerId&&!await Customer.exists({_id:ownerId,status:'active',deleted:false}).session(session)||body.ownerType==='staff'&&!await Account.exists({_id:ownerId,status:'active',deleted:false}).session(session))fail('OWNER_STATE');
      const source=await replacement(body,ownerId,session,actorId);
      if(source){const claimed=await Card.updateOne({_id:source._id,__v:source.__v,'replacement.completedAt':{$exists:false}},{$set:{'replacement.targetCardId':cardId},$inc:{__v:1}},{session});if(claimed.modifiedCount!==1)fail('INVALID_REPLACEMENT');}
      if(body.ownerType==='customer'){
        if(!body.customerId)await Customer.create([{...body.customer,_id:owner._id,avatar:upload.secure_url,createdBy:actorId}],{session});
        else if(!body.replaceOf)await Customer.updateOne({_id:ownerId},{$set:{avatar:upload.secure_url,updatedBy:actorId}},{session});
      }
      await Card.create([{cardId,cardType:body.ownerType,ownerId,issuedBy:actorId,status:'issuing',isCurrent:true,replaceOf:body.replaceOf,issuance:{pinCipher,expireAt:claim.expireAt,requestId}}],{session});
      const updated=await Request.updateOne({_id:claim._id,state:'preparing',expireAt:{$gt:new Date()}},{$set:{cardId},$inc:{__v:1}},{session});if(updated.modifiedCount!==1)fail('ISSUE_CLOSED');
    });
    const profileOp=await E.createOp({cardId,type:'commit-write',params:{target:1,dataHex:profileHex},actorType:'admin',actorId});
    const photoOp=await E.createOp({cardId,type:'commit-write',params:{target:2,dataHex:bytes.toString('hex').toUpperCase(),...(body.replaceOf&&body.ownerType==='customer'?{customerUpdate:{avatar:upload.secure_url}}:{})},actorType:'admin',actorId});
    await transaction(async session=>{
      const update=await Card.updateOne({cardId,status:'issuing',issuedBy:actorId,'issuance.expireAt':{$gt:new Date()}},{$set:{'issuance.profileOpId':profileOp.id,'issuance.photoOpId':photoOp.id}},{session});
      if(update.modifiedCount!==1)fail('CARD_STATE');
      const claimed=await Request.updateOne({requestId,actorId,cardId,state:'preparing',expireAt:{$gt:new Date()}},{$set:{state:'ready'},$inc:{__v:1}},{session});if(claimed.modifiedCount!==1)fail('ISSUE_CLOSED');
    });
    res.json({code:'success',cardId,initApdu,initialPin,profileOpId:profileOp.id,profileHex,photoOpId:photoOp.id});
  }catch(error){await cancelRequest(requestId,actorId);throw error;}
});
module.exports.issueInitConfirm=endpoint('init',async(req,res,body)=>{
  await expire(body.cardId,req.cardActor.id);
  const modulus=Buffer.from(body.response,'hex');
  if(body.sw.toUpperCase()!=='9000'||!(modulus[0]&128)||!(modulus[127]&1))fail('INVALID_INIT');
  await transaction(async session=>{const card=await load(body.cardId,req.cardActor.id,session);if(!card.issuance.profileOpId||!card.issuance.photoOpId)fail('CARD_STATE');if(card.publicKeyModulus&&card.publicKeyModulus!==body.response.toUpperCase())fail('INVALID_INIT');card.publicKeyModulus=body.response;await card.save({session});});
  res.json({code:'success'});
});
module.exports.issueFinish=endpoint('card',async(req,res,body)=>{
  await expire(body.cardId,req.cardActor.id);
  let notification;
  const result=await transaction(async session=>{
    notification=undefined;
    const existing=await Card.findOne({cardId:body.cardId.toUpperCase()}).session(session).lean();
    if(existing?.issuedBy!==req.cardActor.id)fail('OP_FORBIDDEN',403);
    if(existing?.replaceOf)replacementPermission(req);
    if(existing.status==='active')return {alreadyFinished:true,emailStatus:'already-claimed'};
    const card=await load(body.cardId,req.cardActor.id,session);
    if(!/^[A-F0-9]{256}$/.test(card.publicKeyModulus||''))fail('INVALID_INIT');
    const meta=card.issuance;
    if(!objectId(meta.profileOpId)||!objectId(meta.photoOpId)||meta.profileOpId===meta.photoOpId)fail('ISSUE_INCOMPLETE');
    for(const [id,target]of [[meta.profileOpId,1],[meta.photoOpId,2]])if(!await Op.exists({_id:id,cardId:card.cardId,type:'commit-write',actorType:'admin',actorId:req.cardActor.id,status:'done','params.target':target}).session(session))fail('ISSUE_INCOMPLETE');
    const Owner=card.cardType==='customer'?Customer:Account;
    const owner=await Owner.findOne({_id:card.ownerId,status:'active',deleted:false}).session(session).lean();if(!owner?.email)fail('OWNER_STATE');
    if(card.replaceOf)await transferReplacement(card,req.cardActor.id,session,req);
    notification={email:owner.email,pin:decryptPin(card.cardId,meta.pinCipher)};
    const updated=await Card.updateOne({_id:card._id,status:'issuing',isCurrent:true,'issuance.expireAt':{$gt:new Date()}},{$set:{status:'active',issuedAt:new Date(),activatedAt:new Date()},$unset:{issuance:1}},{session});if(updated.modifiedCount!==1)fail('CARD_STATE');
    if(meta.requestId){const claimed=await Request.updateOne({requestId:meta.requestId,actorId:req.cardActor.id,cardId:card.cardId,state:'ready'},{$set:{state:'finished'},$inc:{__v:1}},{session});if(claimed.modifiedCount!==1)fail('CARD_STATE');}
    if(card.cardType==='staff'){const staff=await Account.updateOne({_id:owner._id,status:'active',deleted:false},{$set:{cardRequired:true}},{session});if(staff.matchedCount!==1)fail('OWNER_STATE');}
    await Log.create([{action:'issue',cardId:card.cardId,actorType:'admin',actorId:req.cardActor.id,result:'success'}],{session});
    return {alreadyFinished:false};
  });
  if(notification){try{const outcome=await mail.sendMail(notification.email,'Thẻ thành viên của bạn',`PIN ban đầu: <strong>${notification.pin}</strong>. Hãy đổi PIN ngay khi đăng nhập lần đầu và không chia sẻ mã PIN.`);result.emailStatus=outcome?.sent===false?'failed':'sent';}catch{result.emailStatus='failed';}finally{notification.pin='';}}
  res.json({code:'success',...result});
});
module.exports.issueCancel=endpoint('cancel',async(req,res,body)=>{
  if(body.requestId)return res.json({code:'success',...await cancelRequest(body.requestId,req.cardActor.id)});
  await transaction(async session=>{const card=await Card.findOne({cardId:body.cardId.toUpperCase()}).session(session).lean();if(!card)fail('CARD_NOT_FOUND',404);if(card.issuedBy!==req.cardActor.id)fail('OP_FORBIDDEN',403);if(card.status==='failed')return;if(card.status!=='issuing')fail('CARD_STATE');await cleanup(card.cardId,req.cardActor.id,session);});
  res.json({code:'success'});
});
async function forward(handler,req,res){
  try{
    const opId=req.body?.opId;
    if(objectId(opId)){
      const op=await Op.findById(opId).lean();
      if(op){const card=await Card.findOne({cardId:op.cardId}).select('+issuance').lean();if(card?.status==='issuing'){
        if(card.issuedBy!==req.cardActor.id||op.actorId!==req.cardActor.id||op.actorType!=='admin'||op.type!=='commit-write'||![card.issuance?.profileOpId,card.issuance?.photoOpId].includes(opId))fail('OP_FORBIDDEN',403);
        await expire(card.cardId,req.cardActor.id);
      }}
    }
    return handler(req,res);
  }catch(error){return problem(res,error);}
}
module.exports.opSign=(req,res)=>forward(api.sign,req,res);
module.exports.opConfirm=(req,res)=>forward(api.confirm,req,res);

module.exports.stepUpChallenge=async(req,res)=>{
  try{const ctx=adminToken.context(req);if(!ctx)fail('AUTH_REQUIRED',401);if(!await Card.exists({ownerId:ctx.account.id,cardType:'staff',status:'active',isCurrent:true,...(ctx.decoded.cardId?{cardId:ctx.decoded.cardId}:{})}))fail('OP_FORBIDDEN',403);res.json({code:'success',nonce:await cardAuth.issueNonce({purpose:'step-up',accountId:ctx.account.id})});}catch(error){problem(res,error);}
};
module.exports.stepUpVerify=async(req,res)=>{
  try{
    const ctx=adminToken.context(req);if(!ctx||!Number.isFinite(ctx.decoded.exp))fail('AUTH_REQUIRED',401);
    if(ctx.decoded.cardId&&ctx.decoded.cardId!==req.body.cardId.toUpperCase())fail('OP_FORBIDDEN',403);
    const result=await cardAuth.verify({...req.body,purpose:'step-up',accountId:ctx.account.id});
    if(result.error)fail('OP_FORBIDDEN',403);
    const current=await adminToken.resolve({...ctx.decoded,cardId:result.card.cardId});if(!current)fail('OP_FORBIDDEN',403);
    adminToken.issue(res,{account:current.account,cardId:result.card.cardId,stepUpAt:Date.now(),expiresAt:ctx.decoded.exp});res.json({code:'success'});
  }catch(error){problem(res,error);}
};

const NOT_ALLOWED='Bạn không có quyền sử dụng tính năng này!';
function requirePermission(req,permission){
  if(!req.cardActor?.permissions.includes(permission)){const error=new Error(NOT_ALLOWED);Object.assign(error,{code:'OP_FORBIDDEN',status:403,permissionDenied:true});throw error;}
}
// Trang GET thiếu quyền: vẫn hiển thị trong layout quản trị (như các trang quản trị khác ẩn nội dung), không trả JSON thô.
function pageProblem(res,error,pageTitle){
  if(error.permissionDenied)return res.status(403).render('admin/pages/no-permission',{pageTitle,message:NOT_ALLOWED});
  problem(res,error);
}
async function requireStepUp(req,res,action){
  if(adminToken.stepUp.isFresh(req))return true;
  await auditTask11Failure(action,req,{code:'STEP_UP_REQUIRED'});
  res.status(403).json({code:'step-up-required',message:'Hãy xác thực lại thẻ nhân viên trước khi thực hiện thao tác.'});return false;
}
// Ghi CardLog thất bại cho mọi yêu cầu thẻ bị từ chối (quyền, dữ liệu, Step-up, trạng thái, hạn mức).
async function auditTask11Failure(action,req,error){
  // Không lưu body, dữ liệu hồ sơ, ảnh hoặc lý do từ request bị từ chối.
  const rawId=req.body?.cardId;
  const cardId=typeof rawId==='string'&&/^[a-fA-F0-9]{32}$/.test(rawId)?rawId.toUpperCase():undefined;
  const errorCode=typeof error.code==='string'&&/^[A-Z_]{1,64}$/.test(error.code)?error.code:'INTERNAL';
  await cardLog.write({action,cardId,actorType:'admin',actorId:req.cardActor?.id,result:'fail',detail:{errorCode},req});
}
module.exports.profileBuildPost=async(req,res)=>{
  try{
    requirePermission(req,'card-edit');
    const {error,value:body}=V.schemas.profile.validate(req.body,{convert:false});if(error)fail('INVALID_INPUT',400,'Thông tin hồ sơ không hợp lệ.');
    const card=await Card.findOne({cardId:body.cardId.toUpperCase(),cardType:'customer',status:'active',isCurrent:true}).lean();
    if(!card)fail('CARD_STATE',409,'Chỉ sửa hồ sơ thẻ khách đang hoạt động.');
    const customer=await Customer.findOne({_id:card.ownerId,status:'active',deleted:false}).lean();if(!customer)fail('OWNER_STATE');
    const fields={...body.fields};
    if(fields.dob){const value=fields.dob,day=value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6);const date=new Date(day+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)fail('INVALID_INPUT',400);fields.dob=date;}
    let profileHex,bytes;
    try{if(body.fields)profileHex=profile({...customer,...fields});}catch{fail('INVALID_PROFILE',400,'Hồ sơ vượt giới hạn 448 byte hoặc chứa trường không hợp lệ.');}
    try{if(body.photoBase64)bytes=V.decodePhoto(body.photoBase64);}catch{fail('INVALID_PHOTO',400,'Ảnh phải là JPEG hợp lệ và không quá 10 080 byte.');}
    let avatar;if(bytes){const uploaded=await cloud.uploadPhoto(bytes);if(!uploaded?.secure_url||!/^https:\/\/[^\s]+$/.test(uploaded.secure_url))fail('PHOTO_UPLOAD',502);avatar=uploaded.secure_url;}
    const result={code:'success',message:'Đã chuẩn bị lệnh ghi; hồ sơ và ảnh chỉ cập nhật sau khi từng lệnh được xác nhận.'};
    if(body.fields){const op=await E.createOp({cardId:card.cardId,type:'commit-write',params:{target:1,dataHex:profileHex,customerUpdate:fields},actorType:'admin',actorId:req.cardActor.id});Object.assign(result,{profileOpId:op.id,profileHex});}
    if(bytes){const op=await E.createOp({cardId:card.cardId,type:'commit-write',params:{target:2,dataHex:bytes.toString('hex').toUpperCase(),customerUpdate:{avatar}},actorType:'admin',actorId:req.cardActor.id});result.photoOpId=op.id;}
    await cardLog.write({action:'profile-build',cardId:card.cardId,actorType:'admin',actorId:req.cardActor.id,result:'success',detail:{...(result.profileOpId?{profileOpId:result.profileOpId}:{}),...(result.photoOpId?{photoOpId:result.photoOpId}:{}),targets:[...(result.profileOpId?[1]:[]),...(result.photoOpId?[2]:[])]},req});
    res.json(result);
  }catch(error){await auditTask11Failure('profile-build',req,error);problem(res,error);}
};
module.exports.replacePost=async(req,res)=>{
  try{
    replacementPermission(req);
    const {error,value:body}=V.schemas.replace.validate(req.body,{convert:false});if(error)fail('INVALID_INPUT',400,'Cấp lại thẻ cần mã thẻ và lý do.');
    const result=await transaction(async session=>{
      const card=await Card.findOne({cardId:body.cardId.toUpperCase()}).session(session).lean();if(!card)fail('CARD_NOT_FOUND',404);
      if(card.replacement){if(card.replacement.actorId!==req.cardActor.id)fail('OP_FORBIDDEN',403);if(card.replacement.reason!==body.reason||card.replacement.completedAt)fail('INVALID_REPLACEMENT');return {cardId:card.cardId};}
      if(!['active','locked'].includes(card.status)||!card.isCurrent)fail('CARD_STATE');
      const owner=await (card.cardType==='customer'?Customer:Account).exists({_id:card.ownerId,status:'active',deleted:false}).session(session);if(!owner)fail('OWNER_STATE');
      const changed=await Card.updateOne({_id:card._id,status:card.status,__v:card.__v},{$set:{status:'revoked',isCurrent:false,revokedReason:'replaced',revokedBy:req.cardActor.id,revokedAt:new Date(),replacement:{actorId:req.cardActor.id,reason:body.reason}},$inc:{__v:1}},{session});if(changed.modifiedCount!==1)fail('CARD_STATE');
      await obligations(card.cardId,session,req,req.cardActor.id);
      await cardLog.write({action:'replace',cardId:card.cardId,actorType:'admin',actorId:req.cardActor.id,result:'success',detail:{reason:body.reason,balanceHeld:card.balance},req},{session});
      return {cardId:card.cardId};
    });
    res.json({code:'success',redirect:'/admin/card/issue?replaceOf='+result.cardId,message:'Thẻ cũ đã thu hồi; số dư được giữ đến khi phát hành thẻ mới hoàn tất.'});
  }catch(error){await auditTask11Failure('replace',req,error);problem(res,error);}
};
module.exports.resetPinPost=async(req,res)=>{
  try{
    requirePermission(req,'card-reset-pin');
    const {error,value:body}=V.schemas.card.validate(req.body,{convert:false});if(error)fail('INVALID_INPUT',400,'Mã thẻ không hợp lệ.');
    if(!await requireStepUp(req,res,'reset-pin'))return;
    const card=await Card.findOne({cardId:body.cardId.toUpperCase(),status:'active',isCurrent:true}).lean();
    if(!card)fail('CARD_STATE',409,'Chỉ reset PIN thẻ đang hoạt động.');
    const owner=await (card.cardType==='customer'?Customer:Account).findOne({_id:card.ownerId,deleted:false}).lean();
    if(!owner)fail('CARD_STATE',409,'Không tìm thấy chủ thẻ hiện tại.');
    // generatePin tự chuẩn hoá Date/ISO thành YYYYMMDD (giờ Việt Nam và UTC) để loại PIN trùng DDMMYY ngày sinh.
    const op=await E.createOp({cardId:card.cardId,type:'reset-pin',params:{newPin:C.generatePin(owner.dob)},actorType:'admin',actorId:req.cardActor.id});
    res.json({code:'success',opId:op.id,message:'Đã chuẩn bị reset PIN; giữ đúng thẻ trong đầu đọc.'});
  }catch(error){await auditTask11Failure('reset-pin',req,error);problem(res,error);}
};
function cashReplay(tx,body,actorId){
  if(tx.createdBy!==actorId||tx.cardId!==body.cardId.toUpperCase()||tx.amount!==body.amount||tx.type!=='credit'||tx.source!=='cash')fail('REQUEST_MISMATCH',409,'Mã yêu cầu đã được dùng cho một khoản thu khác.');
  return {txRef:tx.txRef,status:tx.status};
}
module.exports.topupCashPost=async(req,res)=>{
  try{
    requirePermission(req,'card-topup');
    const {error,value:body}=V.schemas.cash.validate(req.body,{convert:false});
    const rawKey=req.get('Idempotency-Key');if(error||typeof rawKey!=='string'||!/^[a-fA-F0-9]{32}$/.test(rawKey))fail('INVALID_INPUT',400,'Số tiền hoặc mã yêu cầu nạp không hợp lệ.');
    if(!await requireStepUp(req,res,'topup-cash'))return;
    const cashRequestId=rawKey.toUpperCase(),actorId=req.cardActor.id;
    let result;
    try{result=await transaction(async session=>{
      // Một khóa chung theo nhân viên bảo vệ hạn mức qua nhiều thẻ; khóa Card bảo vệ ví.
      const staff=await Account.updateOne({_id:actorId,status:'active',deleted:false},{$inc:{__v:1}},{session});
      if(staff.modifiedCount!==1)fail('OP_FORBIDDEN',403);
      const previous=await Tx.findOne({cashRequestId}).session(session).lean();
      if(previous)return cashReplay(previous,body,actorId);
      const card=await Card.findOne({cardId:body.cardId.toUpperCase(),cardType:'customer',status:'active',isCurrent:true}).session(session).lean();
      if(!card)fail('CARD_STATE',409,'Chỉ nạp tiền cho thẻ khách đang hoạt động.');
      await Card.updateOne({_id:card._id},{$inc:{__v:1}},{session});
      const now=Date.now(),from=new Date(Math.floor((now+7*3600000)/86400000)*86400000-7*3600000),to=new Date(from.getTime()+86400000);
      const daily=await Tx.aggregate([{$match:{type:'credit',source:'cash',createdBy:actorId,createdAt:{$gte:from,$lt:to}}},{$group:{_id:null,total:{$sum:'$amount'}}}]).session(session);
      const pending=await Tx.aggregate([{$match:{cardId:card.cardId,type:'credit',$or:[{status:{$in:['pending-card','sent']}},{status:'failed',signedOpId:{$exists:true}}]}},{$group:{_id:null,total:{$sum:'$amount'}}}]).session(session);
      const denied=walletRules.checkCashTopup({amount:body.amount,staffTodaySum:daily[0]?.total||0})||walletRules.checkOnlineTopup({balance:card.balance,pendingSum:pending[0]?.total||0,amount:body.amount});
      if(denied)fail('TOPUP_LIMIT',409,denied);
      const [tx]=await Tx.create([{cashRequestId,cardId:card.cardId,txRef:C.randomHex(8),type:'credit',source:'cash',amount:body.amount,status:'pending-card',createdBy:actorId}],{session});
      await cardLog.write({action:'topup-cash',cardId:card.cardId,actorType:'admin',actorId,result:'success',detail:{txRef:tx.txRef,amount:body.amount},req},{session});
      return {txRef:tx.txRef,status:tx.status};
    });}catch(error){
      // Hai nhân viên dùng trùng khóa có thể đụng unique index, vẫn đối chiếu binding.
      if(error.code!==11000)throw error;
      const previous=await Tx.findOne({cashRequestId}).lean();if(!previous)throw error;result=cashReplay(previous,body,actorId);
    }
    res.json({code:'success',...result,message:result.status==='done'?'Giao dịch đã hoàn tất.':'Đã ghi nhận tiền mặt. Cắm đúng thẻ để đồng bộ; không thu tiền lần nữa.'});
  }catch(error){await auditTask11Failure('topup-cash',req,error);problem(res,error);}
};
module.exports.statusPost=async(req,res)=>{
  // Nhật ký thất bại ghi đúng thao tác được yêu cầu; body hỏng thì ghi chung là 'status'.
  const requested=['lock','unlock','revoke'].includes(req.body?.action)?req.body.action:'status';
  try{
    const {error,value:body}=V.schemas.status.validate(req.body,{convert:false});
    if(error)fail('INVALID_INPUT',400,'Thông tin trạng thái thẻ không hợp lệ; thu hồi cần có lý do.');
    requirePermission(req,body.action==='revoke'?'card-revoke':'card-lock');
    if(body.action==='revoke'&&!adminToken.stepUp.isFresh(req)){
      await auditTask11Failure(requested,req,{code:'STEP_UP_REQUIRED'});
      return res.status(403).json({code:'step-up-required',message:'Hãy xác thực lại thẻ nhân viên trước khi thu hồi.'});
    }
    const result=await transaction(async session=>{
      const card=await Card.findOne({cardId:body.cardId.toUpperCase()}).select('+issuance').session(session);
      if(!card)fail('CARD_NOT_FOUND',404,'Không tìm thấy thẻ.');
      const status=E.cardStatus.nextStatus(card.status,body.action);
      const previousStatus=card.status,previousBalance=card.balance;
      let refundedCredits=[];
      if(!status)fail('CARD_STATE',409,card.status==='revoked'?'Thẻ đã bị thu hồi.':'Không thể chuyển trạng thái thẻ này.');
      // Cùng ghi Card với sign/confirm để snapshot cũ không lọt qua kiểm tra nghĩa vụ.
      const lock=await Card.updateOne({_id:card._id,status:card.status,__v:card.__v},{$inc:{__v:1}},{session});
      if(lock.modifiedCount!==1)fail('CARD_STATE',409,'Trạng thái thẻ đã thay đổi; hãy tải lại trang.');
      if(body.action==='revoke'){
        await E.expireStaleTopups(card.cardId,session);
        await voidUnsigned(card.cardId,session,req,req.cardActor.id);
        const liability=await Tx.exists(liabilityFilter(card.cardId)).session(session);
        // Sync công khai có thể tạo set-state; lệnh này không được dùng để cản thu hồi.
        const prepared=await Op.exists({cardId:card.cardId,status:'prepared',type:{$ne:'set-state'}}).session(session);
        if(liability||prepared)fail('RECONCILIATION_REQUIRED',409,'Thẻ còn giao dịch hoặc lệnh đã ký cần đối soát. Hãy đồng bộ và xác nhận kết quả trước khi thu hồi; có thể khóa thẻ ngay.');
        // Credit chờ ghi chưa ký là tiền khách đã nộp nhưng chưa tới chip: hoàn cùng số dư khi "đã hoàn tiền mặt".
        const credits=await Tx.find(unsignedCreditFilter(card.cardId)).session(session).lean();
        if((card.balance>0||credits.length)&&body.refunded!==true)fail('REFUND_REQUIRED',409,'Thẻ còn số dư, hãy xác nhận đã hoàn tiền hoặc dùng Cấp lại thẻ');
        if(card.balance>0)await Tx.create([{cardId:card.cardId,txRef:C.randomHex(8),type:'debit',source:'refund',amount:card.balance,status:'done',balanceAfter:0,createdBy:req.cardActor.id}],{session});
        for(const credit of credits){
          const closed=await Tx.updateOne({_id:credit._id,status:'pending-card',signedOpId:{$exists:false}},{$set:{status:'failed',failReason:'refunded'}},{session});
          if(closed.modifiedCount!==1)fail('RECONCILIATION_REQUIRED',409,'Thẻ còn giao dịch hoặc lệnh đã ký cần đối soát. Hãy đồng bộ và xác nhận kết quả trước khi thu hồi; có thể khóa thẻ ngay.');
          // Mỗi credit một bút toán hoàn riêng (luôn trong giới hạn số tiền một giao dịch), chỉ ở server.
          await Tx.create([{cardId:card.cardId,txRef:C.randomHex(8),type:'debit',source:'refund',amount:credit.amount,status:'done',createdBy:req.cardActor.id,movedFrom:credit.txRef}],{session});
        }
        refundedCredits=credits.map(credit=>credit.txRef);
        if(card.issuance?.requestId){
          await Request.updateOne({requestId:card.issuance.requestId,cardId:card.cardId,state:{$in:['preparing','ready']}},{$set:{state:'cancelled'},$inc:{__v:1}},{session});
        }
        // Chỉ đóng bản nháp chưa ký; giao dịch tiền và lệnh đã gửi luôn được giữ để đối soát.
        await Op.updateMany({cardId:card.cardId,status:'draft'},{$set:{status:'failed'},$unset:{'params.encryptedPin':1,'params.newPin':1}},{session});
      }
      const reason=(body.reason||'').trim();
      const update={status,isCurrent:status!=='revoked'};
      if(body.action==='lock')update.lockedReason=reason;
      if(body.action==='unlock')update.lockedReason='';
      if(body.action==='revoke')Object.assign(update,{balance:0,revokedBy:req.cardActor.id,revokedAt:new Date(),revokedReason:reason});
      card.set(update);
      if(body.action==='revoke')card.set('issuance',undefined);
      // Validator isCurrent cần document có status, không dùng query validator thiếu ngữ cảnh.
      await card.save({session});
      await cardLog.write({action:body.action,cardId:card.cardId,actorType:'admin',actorId:req.cardActor.id,result:'success',detail:{reason,from:previousStatus,to:status,refunded:body.action==='revoke'&&(previousBalance>0||refundedCredits.length>0),...(refundedCredits.length?{refundedCredits}:{})},req},{session});
      return {cardId:card.cardId,status};
    });
    res.json({code:'success',...result,message:'Đã cập nhật trạng thái trên server. Cắm thẻ để đồng bộ.'});
  }catch(error){await auditTask11Failure(requested,req,error);problem(res,error);}
};

const statusNames={issuing:'Đang phát hành',active:'Đang hoạt động',locked:'Đã khóa',revoked:'Đã thu hồi',failed:'Phát hành thất bại'};
function queryText(query,key,max=120){
  if(query[key]===undefined)return '';
  if(typeof query[key]!=='string'||query[key].length>max)fail('INVALID_INPUT',400,'Bộ lọc không hợp lệ.');
  return query[key].trim();
}
function pageNumber(query){
  const value=queryText(query,'page',7);
  if(value&&!/^[1-9]\d{0,5}$/.test(value))fail('INVALID_INPUT',400,'Trang không hợp lệ.');
  return value?Number(value):1;
}
const escapedRegex=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function owners(cards){
  const ids=cards.map(card=>card.ownerId).filter(objectId);
  const [customers,accounts]=await Promise.all([Customer.find({_id:{$in:ids},deleted:false}).select('_id fullName email phone dob gender idNumber emergencyName emergencyPhone bloodType allergies avatar').lean(),Account.find({_id:{$in:ids},deleted:false}).select('_id fullName email phone dob gender idNumber emergencyName emergencyPhone bloodType allergies avatar').lean()]);
  const map=new Map([...customers.map(owner=>['customer:'+owner._id,owner]),...accounts.map(owner=>['staff:'+owner._id,owner])]);
  return cards.map(card=>({...card,owner:map.get(card.cardType+':'+card.ownerId)}));
}
function pagination(req,page,total){
  const pages=Math.max(1,Math.ceil(total/20)),url=new URLSearchParams();
  for(const [key,value]of Object.entries(req.query))if(key!=='page'&&typeof value==='string')url.set(key,value);
  const link=number=>{url.set('page',number);return '?'+url.toString();};
  return {page,pages,total,previous:page>1?link(page-1):null,next:page<pages?link(page+1):null};
}
module.exports.list=async(req,res)=>{
  try{
    requirePermission(req,'card-view');
    const page=pageNumber(req.query),status=queryText(req.query,'status'),cardType=queryText(req.query,'cardType'),keyword=queryText(req.query,'keyword');
    if(status&&!Object.hasOwn(statusNames,status)||cardType&&!['customer','staff'].includes(cardType))fail('INVALID_INPUT',400,'Bộ lọc không hợp lệ.');
    const query={...(status?{status}:{}),...(cardType?{cardType}:{})};
    if(keyword){
      const regex={$regex:escapedRegex(keyword),$options:'i'};
      const [customers,accounts]=await Promise.all([Customer.find({fullName:regex,deleted:false}).select('_id').lean(),Account.find({fullName:regex,deleted:false}).select('_id').lean()]);
      query.$or=[{cardId:regex},{cardType:'customer',ownerId:{$in:customers.map(owner=>String(owner._id))}},{cardType:'staff',ownerId:{$in:accounts.map(owner=>String(owner._id))}}];
    }
    const [cards,total]=await Promise.all([Card.find(query).select('cardId cardType ownerId status balance createdAt').sort({createdAt:-1,_id:-1}).skip((page-1)*20).limit(20).lean(),Card.countDocuments(query)]);
    res.render('admin/pages/card-list',{pageTitle:'Quản lý thẻ',cards:await owners(cards),statusNames,filters:{status,cardType,keyword},pagination:pagination(req,page,total)});
  }catch(error){pageProblem(res,error,'Quản lý thẻ');}
};
module.exports.detail=async(req,res)=>{
  try{
    requirePermission(req,'card-view');
    if(!/^[a-fA-F0-9]{32}$/.test(req.params.cardId))fail('INVALID_INPUT',400,'Mã thẻ không hợp lệ.');
    const card=await Card.findOne({cardId:req.params.cardId.toUpperCase()}).select('-publicKeyModulus').lean();
    if(!card)fail('CARD_NOT_FOUND',404,'Không tìm thấy thẻ.');
    const [transactions,pendingCredits,orders,logs]=await Promise.all([
      Tx.find({cardId:card.cardId}).select('txRef type source amount status balanceAfter createdAt').sort({createdAt:-1,_id:-1}).limit(100).lean(),
      Tx.find({cardId:card.cardId,type:'credit',$or:[{status:{$in:['awaiting-payment','pending-card','sent']}},{status:'failed',signedOpId:{$exists:true}}]}).select('txRef amount status').lean(),
      card.cardType==='customer'?Order.find({customerId:card.ownerId,deleted:false,'items.ticketStatus':{$in:['pending','written','used','pending-delete','deleted']}}).select('orderCode items createdAt').sort({createdAt:-1,_id:-1}).lean():[],
      // Quyền xem chi tiết bao gồm 50 mục lịch sử của chính thẻ; trang toàn cục cần card-log-view.
      Log.find({cardId:card.cardId}).select('action actorType actorId result detail ip createdAt').sort({createdAt:-1,_id:-1}).limit(50).lean()
    ]);
    res.render('admin/pages/card-detail',{pageTitle:'Chi tiết thẻ',card:(await owners([card]))[0],statusNames,transactions,pendingCredits,orders,logs});
  }catch(error){pageProblem(res,error,'Chi tiết thẻ');}
};
function dateFilter(query,key,end=false){
  const value=queryText(query,key,10);
  if(!value)return undefined;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('INVALID_INPUT',400,'Ngày lọc không hợp lệ.');
  const day=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value)fail('INVALID_INPUT',400,'Ngày lọc không hợp lệ.');
  // Ngày giao diện theo Việt Nam; cận cuối là đầu ngày tiếp theo, không mất mili giây.
  return new Date(day.getTime()-7*3600000+(end?86400000:0));
}
module.exports.log=async(req,res)=>{
  try{
    requirePermission(req,'card-log-view');
    const page=pageNumber(req.query),cardId=queryText(req.query,'cardId',32).toUpperCase(),action=queryText(req.query,'action',80),from=dateFilter(req.query,'from'),to=dateFilter(req.query,'to',true);
    if(cardId&&!/^[A-F0-9]{32}$/.test(cardId)||from&&to&&from>=to)fail('INVALID_INPUT',400,'Bộ lọc không hợp lệ.');
    const query={...(cardId?{cardId}:{}),...(action?{action}:{}),...(from||to?{createdAt:{...(from?{$gte:from}:{}),...(to?{$lt:to}:{})}}:{})};
    const [logs,total]=await Promise.all([Log.find(query).sort({createdAt:-1,_id:-1}).skip((page-1)*20).limit(20).lean(),Log.countDocuments(query)]);
    res.render('admin/pages/card-log',{pageTitle:'Nhật ký thẻ',logs,filters:{cardId,action,from:req.query.from||'',to:req.query.to||''},pagination:pagination(req,page,total)});
  }catch(error){pageProblem(res,error,'Nhật ký thẻ');}
};
