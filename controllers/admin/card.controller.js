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
const objectId=value=>typeof value==='string'&&/^[a-fA-F0-9]{24}$/.test(value);
function fail(code,status=409,message='Yêu cầu phát hành thẻ không hợp lệ hoặc đã kết thúc.'){const error=new Error(message);Object.assign(error,{code,status});throw error;}
function problem(res,error){return res.status(error.status||500).json({code:'error',errorCode:error.code||'INTERNAL',message:error.status?error.message:'Không thể xử lý yêu cầu thẻ.'});}
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
async function replacement(body,ownerId,session){
  const stale=await Card.find({ownerId,cardType:body.ownerType,status:'issuing',isCurrent:true}).select('+issuance').session(session).lean();
  for(const card of stale)if(!card.issuance||!(card.issuance.expireAt>new Date()))await cleanup(card.cardId,card.issuedBy,session);
  if(await Card.exists({ownerId,cardType:body.ownerType,isCurrent:true}).session(session))fail('CURRENT_CARD',409,'Người này đã có thẻ đang hoạt động');
  const previous=await Card.find({ownerId,cardType:body.ownerType,status:'revoked',isCurrent:false}).select('cardId balance').session(session).lean();
  if(body.replaceOf&&!previous.some(card=>card.cardId===body.replaceOf.toUpperCase()))fail('INVALID_REPLACEMENT');
  if(previous.length&&(previous.some(card=>card.balance>0)||await Tx.exists({cardId:{$in:previous.map(card=>card.cardId)},status:{$ne:'done'}}).session(session)||await Order.exists({customerId:ownerId,deleted:false,items:{$elemMatch:{ticketStatus:{$in:['pending','written','used','pending-delete']}}}}).session(session)))fail('REPLACEMENT_DEFERRED',409,'Thẻ cũ còn số dư hoặc vé cần chuyển; chức năng cấp lại chưa hỗ trợ trường hợp này.');
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
module.exports.issue=async(req,res)=>{try{if(!req.cardActor?.permissions.includes('card-issue'))fail('OP_FORBIDDEN',403);const [customers,accounts]=await Promise.all([Customer.find({deleted:false,status:'active'}).select('_id fullName email phone').sort({fullName:1}).limit(500).lean(),Account.find({deleted:false,status:'active'}).select('_id fullName email').sort({fullName:1}).limit(500).lean()]);res.render('admin/pages/card-issue',{pageTitle:'Phát hành thẻ',customers,accounts});}catch(error){problem(res,error);}};
module.exports.issuePrepare=endpoint('prepare',async(req,res,body)=>{
  let bytes;try{bytes=V.decodePhoto(body.photoBase64);}catch{fail('INVALID_PHOTO',400,'Ảnh phải là JPEG hợp lệ và không quá 10 080 byte.');}
  const actorId=req.cardActor.id;
  const requestId=(body.requestId||C.randomHex(16)).toUpperCase(),digest=requestDigest(body,bytes);
  let request=await Request.findOne({requestId}).lean();
  if(request)return res.json(await recoverPrepare(request,actorId,digest));
  let owner;
  if(body.ownerType==='staff')owner=await Account.findOne({_id:body.accountId,status:'active',deleted:false}).select('_id fullName email phone').lean();
  else if(body.customerId)owner=await Customer.findOne({_id:body.customerId,status:'active',deleted:false}).lean();
  else owner={...body.customer,_id:new mongoose.Types.ObjectId()};
  if(!owner||!owner.email)fail('OWNER_STATE');
  const ownerId=String(owner._id);
  await replacement(body,ownerId,null);
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
      await replacement(body,ownerId,session);
      if(body.ownerType==='customer'){
        if(!body.customerId)await Customer.create([{...body.customer,_id:owner._id,avatar:upload.secure_url,createdBy:actorId}],{session});
        else await Customer.updateOne({_id:ownerId},{$set:{avatar:upload.secure_url,updatedBy:actorId}},{session});
      }
      await Card.create([{cardId,cardType:body.ownerType,ownerId,issuedBy:actorId,status:'issuing',isCurrent:true,replaceOf:body.replaceOf,issuance:{pinCipher,expireAt:claim.expireAt,requestId}}],{session});
      const updated=await Request.updateOne({_id:claim._id,state:'preparing',expireAt:{$gt:new Date()}},{$set:{cardId},$inc:{__v:1}},{session});if(updated.modifiedCount!==1)fail('ISSUE_CLOSED');
    });
    const profileOp=await E.createOp({cardId,type:'commit-write',params:{target:1,dataHex:profileHex},actorType:'admin',actorId});
    const photoOp=await E.createOp({cardId,type:'commit-write',params:{target:2,dataHex:bytes.toString('hex').toUpperCase()},actorType:'admin',actorId});
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
    if(existing.status==='active')return {alreadyFinished:true,emailStatus:'already-claimed'};
    const card=await load(body.cardId,req.cardActor.id,session);
    if(!/^[A-F0-9]{256}$/.test(card.publicKeyModulus||''))fail('INVALID_INIT');
    const meta=card.issuance;
    if(!objectId(meta.profileOpId)||!objectId(meta.photoOpId)||meta.profileOpId===meta.photoOpId)fail('ISSUE_INCOMPLETE');
    for(const [id,target]of [[meta.profileOpId,1],[meta.photoOpId,2]])if(!await Op.exists({_id:id,cardId:card.cardId,type:'commit-write',actorType:'admin',actorId:req.cardActor.id,status:'done','params.target':target}).session(session))fail('ISSUE_INCOMPLETE');
    const Owner=card.cardType==='customer'?Customer:Account;
    const owner=await Owner.findOne({_id:card.ownerId,status:'active',deleted:false}).session(session).lean();if(!owner?.email)fail('OWNER_STATE');
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
