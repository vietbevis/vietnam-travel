const Joi=require('joi');
const mongoose=require('mongoose');
const jwt=require('jsonwebtoken');
const crypto=require('node:crypto');
const adminTokenHelper=require('../../helpers/admin-token.helper');
const Card=require('../../models/card.model');
const Tx=require('../../models/card-transaction.model');
const Op=require('../../models/card-operation.model');
const Customer=require('../../models/customer.model');
const Order=require('../../models/order.model');
const Account=require('../../models/account-admin.model');
const Role=require('../../models/role.model');
const E=require('../../helpers/card-op.helper');
const P=require('../../helpers/card-sync.helper');
const S=require('../../public/assets/js/card/card-shared');
const customerAuth=require('../../middlewares/client/customer-auth.middleware');
const cardAuth=require('../../helpers/card-auth.helper');
const cardLog=require('../../helpers/card-log.helper');
const zalopayHelper=require('../../helpers/zalopay.helper');
const vnpayHelper=require('../../helpers/vnpay.helper');
const {checkOnlineTopup}=require('../../helpers/wallet-rule.helper');
const customerValidation=require('../../validates/client/card.validate');
const hex=n=>Joi.string().pattern(new RegExp(`^[a-fA-F0-9]{${n}}$`)).required();
const response=Joi.string().allow('').pattern(/^([a-fA-F0-9]{2})*$/).max(332).required();
const schemas={
  next:Joi.object({cardId:hex(32),cardState:Joi.number().integer().valid(0,2,3,127).required(),challenge:hex(32)}).required().unknown(false),
  sign:Joi.object({opId:hex(24),challenge:hex(32)}).required().unknown(false),
  confirm:Joi.object({opId:hex(24),response,sw:hex(4)}).required().unknown(false),
  receipt:Joi.object({
    cardId:hex(32),
    txRef:hex(16),
    // Challenge thẻ vừa phát trong cùng batch, ngay trước GET_RECEIPT (client cũ không gửi).
    challenge:Joi.string().pattern(/^[a-fA-F0-9]{32}$/),
    // Lần ký mà client quan sát được trong bước receipt (/sync/next): mở lại chỉ khi vẫn đúng lần ký hiện tại.
    signedOpId:Joi.string().pattern(/^[a-fA-F0-9]{24}$/),
    response,
    sw:hex(4)
  }).required().unknown(false)
};
const HANDLER_ACTIONS={next:'card-sync-op',sign:'card-op-sign',confirm:'card-op-confirm',receipt:'card-receipt-recovery'};
const problem=(res,status,errorCode,message='Yêu cầu thẻ không hợp lệ hoặc không được phép.')=>res.status(status).json({code:'error',errorCode,message});
function handler(schema,fn) {
  return async(req,res)=> {
    if(!req.is('application/json'))
      return problem(res,415,'INVALID_INPUT');
    if(req.headers.origin) {
      try {
        const origin=new URL(req.headers.origin);
        if(origin.origin!==req.protocol+'://'+req.get('host'))
          return problem(res,403,'OP_FORBIDDEN');
      }
      catch {
        return problem(res,403,'OP_FORBIDDEN');
      }
    }
    const {error,value}=schemas[schema].validate(req.body,{convert:false});
    if(error)
      return problem(res,400,'INVALID_INPUT');
    try {
      await fn(req,res,value);
    }
    catch(error) {
      const code=error instanceof E.CardOpError?error.code:'INTERNAL';
      const status=code==='OP_NOT_FOUND'?404:code==='OP_FORBIDDEN'?403:code==='INTERNAL'?500:409;
      // Từ chối trước khi engine chạy (xác thực, quyền...) vẫn phải có nhật ký; engine đã ghi thì không ghi trùng.
      if(!error?.logged)
        await cardLog.write({
          action:HANDLER_ACTIONS[schema],
          cardId:value.cardId?.toUpperCase(),
          actorType:req.cookies?.customerToken?'customer':req.cookies?.token?'admin':'system',
          result:'fail',
          detail:{...(value.opId?{opId:value.opId}:{}),...(value.txRef?{txRef:value.txRef.toUpperCase()}:{}),errorCode:code},
          req
        });
      problem(res,status,code);
    }
  };
}
const deny=(missingPermission=false)=> {
  const error=new E.CardOpError('OP_FORBIDDEN');
  // Phân biệt thiếu quyền vai trò (đồng bộ dừng êm) với lỗi xác thực/Step-up (vẫn từ chối cứng).
  error.missingPermission=missingPermission;
  throw error;
};
const permissions={
  'set-state':'card-lock',
  'reset-pin':'card-reset-pin',
  credit:'card-topup',
  'write-ticket':'card-edit',
  'delete-ticket':'card-edit',
  'use-ticket':'card-checkin',
  'commit-write':'card-edit'
};
async function actor(req,op) {
  const token=req.cookies?.customerToken,adminToken=req.cookies?.token;
  if(!token&&!adminToken)
    return null;
  let decoded;
  try {
    decoded=jwt.verify(op.actorType==='admin'?adminToken:token,process.env.JWT_SECRET,{algorithms:['HS256']});
  }
  catch {
    deny();
  }
  if(op.actorType==='customer') {
    const context=await customerAuth.resolve(token);
    if(!context||String(context.customer._id)!==op.actorId||context.card.cardId!==op.cardId)
      deny();
    return{actorType:'customer',actorId:decoded.customerId};
  }
  if(decoded.stage!==undefined)deny();
  if(op.actorType!=='admin')
    deny();
  if(typeof decoded.id!=='string'||!/^[a-fA-F0-9]{24}$/.test(decoded.id)||(op.actorId!==undefined&&decoded.id!==op.actorId))
    deny();
  const verified=await adminTokenHelper.resolve(decoded);
  if(!verified)deny();
  adminTokenHelper.attach(req,verified);
  const {account,role}=verified;
  let permission=op.type==='set-state'&&op.params.state===127?'card-revoke':permissions[op.type];
  if(op.type==='commit-write') {
    const card=await Card.findOne({cardId:op.cardId}).lean();
    if(card?.status==='issuing') {
      if(card.issuedBy!==decoded.id||!card.isCurrent)
        deny();
      permission='card-issue';
    }
  }
  // Người có card-checkin chỉ được ký write-ticket (nội dung vé do server dẫn xuất, loadItem vẫn kiểm đơn đã thanh toán, chưa huỷ);
  // mọi loại thao tác khác giữ nguyên quyền cũ.
  const accepted=op.type==='write-ticket'?['card-edit','card-checkin']:[permission];
  if(!permission||!accepted.some(name=>role?.permissions?.includes(name)))
    deny(true);
  if(account.cardRequired) {
    if(typeof decoded.cardId!=='string'||!await Card.exists({
      cardId:decoded.cardId,
      cardType:'staff',
      ownerId:account._id.toString(),
      status:'active',
      isCurrent:true
    }))
      deny();
  }
  const cash=op.type==='credit'&&await Tx.exists({txRef:op.params.txRef,source:'cash'});
  if(op.type==='reset-pin'||permission==='card-revoke'||cash) {
    if(!adminTokenHelper.stepUp.isFresh(req))deny();
  }
  return{actorType:'admin',actorId:account._id.toString()};
}
async function owned(req,res,id,publicSync) {
  if(!publicSync&&!req.cookies?.customerToken&&!req.cookies?.token) {
    problem(res,401,'AUTH_REQUIRED');
    return null;
  }
  const op=await Op.findById(id).lean();
  if(!op) {
    problem(res,404,'OP_NOT_FOUND');
    return null;
  }
  if(publicSync) {
    if(op.actorType!=='system'||!['set-state','credit','delete-ticket','write-ticket'].includes(op.type))
      deny();
    if(op.type==='set-state')
      return{op,actor:{actorType:'system'}};
  }
  let actorOp=op;
  if(op.actorType==='system') {
    const binding=/^(customer|admin):([a-fA-F0-9]{24})$/.exec(op.actorId||'');
    if(!binding)
      deny();
    actorOp={...op,actorType:binding[1],actorId:binding[2]};
  }
  const resolved=await actor(req,actorOp);
  if(!resolved) {
    problem(res,401,'AUTH_REQUIRED');
    return null;
  }
  return{op,actor:resolved};
}
// Bộ đếm trong bộ nhớ theo (thẻ, IP): chặn gọi /sync/next dồn dập. Mỗi phiên hợp lệ tối đa 10 vòng đồng bộ.
// Lưu ý: req.ip chỉ là IP thật của khách khi Express bật 'trust proxy' đúng với reverse proxy phía trước;
// nếu không, mọi khách sau proxy dùng chung một IP (bộ đếm thành theo thẻ). Ở đây không tự bật 'trust proxy'.
// Map có giới hạn số khoá: xoá khoá hết hạn trước, còn đầy thì bỏ khoá cũ nhất (Map giữ thứ tự chèn).
const syncThrottle={limit:60,windowMs:60_000,maxKeys:10_000,hits:new Map()};
function syncAllowed(cardId,ip) {
  const now=Date.now(),key=cardId+'|'+(ip||'');
  let entry=syncThrottle.hits.get(key);
  if(!entry||now-entry.start>=syncThrottle.windowMs) {
    syncThrottle.hits.delete(key);
    if(syncThrottle.hits.size>=syncThrottle.maxKeys)
      for(const [stale,old] of syncThrottle.hits)
        if(now-old.start>=syncThrottle.windowMs)
          syncThrottle.hits.delete(stale);
    while(syncThrottle.hits.size>=syncThrottle.maxKeys)
      syncThrottle.hits.delete(syncThrottle.hits.keys().next().value);
    entry={start:now,count:0};
    syncThrottle.hits.set(key,entry);
  }
  entry.count++;
  return{allowed:entry.count<=syncThrottle.limit,first:entry.count===syncThrottle.limit+1};
}
module.exports.syncThrottle=syncThrottle;
module.exports.next=handler('next',async(req,res,body)=> {
  const throttle=syncAllowed(body.cardId.toUpperCase(),req.ip);
  if(!throttle.allowed) {
    // Chỉ ghi nhật ký lần đầu bị chặn trong mỗi cửa sổ để bản thân nhật ký không bị spam.
    if(throttle.first)
      await cardLog.write({action:'card-sync-op',cardId:body.cardId.toUpperCase(),actorType:'system',result:'fail',detail:{errorCode:'RATE_LIMITED'},req});
    return problem(res,429,'RATE_LIMITED','Thao tác đồng bộ thẻ quá nhanh, vui lòng thử lại sau.');
  }
  const card=await Card.findOne({cardId:body.cardId.toUpperCase()}).lean();
  if(!card||!['active','locked','revoked'].includes(card.status))
    return res.json({code:'success',message:'Không có bước đồng bộ.',step:null});
  const context=await P.loadSyncContext(card);
  const step=P.planNextSync({card,cardState:body.cardState,...context});
  if(!step)
    return res.json({code:'success',message:'Không có bước đồng bộ.',step:null});
  if(step.kind==='receipt')
    return res.json({code:'success',message:'Cần khôi phục biên nhận.',step:{...step,...(context.sentTx?.signedOpId?{signedOpId:context.sentTx.signedOpId}:{}),apdu:S.apdu(S.INS.GET_RECEIPT,0,0,Buffer.from(step.txRef,'hex'))}});
  let binding;
  if(step.type!=='set-state') {
    let resolved;
    try {
      resolved=await actor(req,{
        cardId:card.cardId,
        type:step.type,
        params:step.params,
        actorType:req.cookies?.customerToken?'customer':'admin',
        actorId:req.cookies?.customerToken?card.ownerId:undefined
      });
    }
    catch(error) {
      // Mọi từ chối xác thực/quyền (thiếu quyền vai trò, cookie khách khác, JWT hết hạn, Step-up quá hạn cho tiền mặt):
      // dừng đồng bộ êm như chưa đăng nhập, không tạo op. Lỗi khác vẫn ném ra.
      if(error.code!=='OP_FORBIDDEN')
        throw error;
      if(error.missingPermission!==true)
        await cardLog.write({action:'card-sync-op',cardId:card.cardId,actorType:req.cookies?.customerToken?'customer':'admin',result:'fail',detail:{type:step.type,errorCode:'OP_FORBIDDEN',requiresAuth:true},req});
      resolved=null;
    }
    if(!resolved)
      return res.json({
        code:'success',
        message:'Đăng nhập để đồng bộ dữ liệu thẻ.',
        step:null,
        requiresAuth:true
      });
    binding=resolved;
  }
  const reused=await E.reuseSyncOp({cardId:card.cardId,type:step.type,params:step.params,binding,challengeHex:body.challenge,req});
  if(reused)
    return res.json({code:'success',message:'Đã chuẩn bị bước đồng bộ.',step:{kind:'op',opId:reused.opId,apdu:reused.apdu}});
  const op=await E.createOp({
    cardId:card.cardId,
    type:step.type,
    params:step.params,
    actorType:'system',
    actorId:binding?`${binding.actorType}:${binding.actorId}`:undefined
  });
  // Op đồng bộ hết hạn sau 5 phút: nhật ký giữ lại loại bước và tham số an toàn (vé nào, trạng thái nào, giao dịch nào).
  await cardLog.write({action:'card-sync-op',cardId:card.cardId,actorType:binding?.actorType||'system',actorId:binding?.actorId,result:'success',detail:{opId:op.id,...E.opLogDetail(op)},req});
  const {apdu}=await E.signOp({opId:op.id,challengeHex:body.challenge,...(binding||{actorType:'system'}),req});
  res.json({code:'success',message:'Đã chuẩn bị bước đồng bộ.',step:{kind:'op',opId:op.id,apdu}});
});
module.exports.sign=handler('sign',async(req,res,body)=> {
  const ctx=await owned(req,res,body.opId,false);
  if(ctx)
    res.json({code:'success',message:'Đã ký thao tác thẻ.',...await E.signOp({opId:body.opId,challengeHex:body.challenge,...ctx.actor,req})});
});
function confirm(publicSync) {
  return handler('confirm',async(req,res,body)=> {
    const ctx=await owned(req,res,body.opId,publicSync);
    if(ctx) {
      const result=await E.confirmOp({
        opId:body.opId,
        responseHex:body.response,
        sw:body.sw,
        ...ctx.actor,
        req
      });
      res.json({code:result.ok?'success':'error',...result});
    }
  });
}
module.exports.confirm=confirm(false);
module.exports.syncConfirm=confirm(true);
// Chủ thể được phép mở lại giao dịch sau 6A88: khách sở hữu đúng thẻ (phiên/JWT của thẻ này),
// hoặc admin có quyền ví (card-topup), thẻ nhân viên hợp lệ và Step-up còn hạn. Người lạ/ẩn danh: null.
async function releasePrincipal(req,card,tx) {
  if(card.cardType!=='customer')
    return null;
  try {
    if(req.cookies?.customerToken)
      return await actor(req,{cardId:card.cardId,type:tx.type,params:{txRef:tx.txRef},actorType:'customer',actorId:card.ownerId});
    if(req.cookies?.token) {
      const resolved=await actor(req,{cardId:card.cardId,type:'credit',params:{txRef:tx.txRef},actorType:'admin'});
      if(resolved&&adminTokenHelper.stepUp.isFresh(req))
        return resolved;
    }
  }
  catch(error) {
    if(error?.code!=='OP_FORBIDDEN')
      throw error;
  }
  return null;
}
module.exports.receipt=handler('receipt',async(req,res,body)=> {
  const card=await Card.findOne({cardId:body.cardId.toUpperCase()}).lean();
  const tx=await Tx.findOne({cardId:body.cardId.toUpperCase(),txRef:body.txRef.toUpperCase()}).lean();
  if(!card||!tx||!tx.signedOpId) {
    // Biên nhận thẻ ký hợp lệ cho giao dịch đã được mở lại: chỉ ghi nhật ký đối soát, không ghi sổ.
    if(card&&tx&&!tx.signedOpId&&body.sw.toUpperCase()==='9000')
      await E.recordLateReceipt({cardId:card.cardId,txRef:tx.txRef,responseHex:body.response,req});
    return problem(res,404,'OP_NOT_FOUND');
  }
  let ok=false;
  if(body.sw.toUpperCase()==='9000')
    ok=await E.applyReceipt({
      card,
      tx,
      responseHex:body.response,
      req
    });
  else
  if(body.sw.toUpperCase()==='6A88') {
    // Có challenge mới (đã đổi cùng batch): lệnh cũ chắc chắn chưa chạy và không còn chạy được, mở lại giao dịch.
    // Chỉ người được phép đồng bộ thẻ này (Ruling 19) và đúng lần ký client đã quan sát; còn lại giữ hành vi cũ, không mở lại.
    const principal=body.challenge&&body.signedOpId===tx.signedOpId?await releasePrincipal(req,card,tx):null;
    const released=principal?await E.releaseUnappliedTx({cardId:card.cardId,txRef:tx.txRef,challengeHex:body.challenge,signedOpId:body.signedOpId,actor:principal,req}):null;
    if(released)
      return res.json({
        code:'success',
        ok:false,
        released:true,
        message:released.type==='credit'?'Thẻ chưa nhận khoản nạp; sẽ ghi lại ở lần đồng bộ tiếp theo.':'Thẻ chưa bị trừ tiền; giao dịch thanh toán đã được huỷ.',
        result:null
      });
    await Tx.updateOne({_id:tx._id,status:{$ne:'done'},signedOpId:tx.signedOpId},{$set:{status:'failed'}});
    await cardLog.write({action:'card-receipt-recovery',cardId:card.cardId,actorType:'system',result:'fail',detail:{txRef:tx.txRef,sw:'6A88',applied:false},req});
  }
  res.json({
    code:ok?'success':'error',
    ok,
    message:ok?'Đã xác minh biên nhận.':'Chưa có biên nhận hợp lệ; không tự ký lại giao dịch.',
    result:null
  });
});
function customerHandler(schema,action,fn,required=false){
  return async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      if(required&&(!req.customer||!req.card))throw new E.CardOpError('AUTH_REQUIRED');
      if(!req.is('application/json')){const error=new E.CardOpError('INVALID_INPUT');error.httpStatus=415;throw error;}
      if(req.headers.origin&&req.headers.origin!==req.protocol+'://'+req.get('host'))throw new E.CardOpError('OP_FORBIDDEN');
      const {error,value}=schema.validate(req.body,{convert:false});
      if(error){const invalid=new E.CardOpError('INVALID_INPUT');invalid.httpStatus=400;throw invalid;}
      await fn(req,res,value);
    }catch(error){
      const errorCode=error instanceof E.CardOpError?error.code:'INTERNAL';
      await cardLog.write({action,cardId:req.card?.cardId,actorType:'customer',actorId:req.customer?String(req.customer._id):undefined,result:'fail',detail:{errorCode},req});
      problem(res,error.httpStatus||(['CARD_AUTH_INVALID','AUTH_REQUIRED'].includes(errorCode)?401:errorCode==='OP_FORBIDDEN'?403:errorCode==='INVALID_PROFILE'?400:errorCode==='INTERNAL'?500:409),errorCode,error.userMessage);
    }
  };
}
module.exports.loginChallenge=customerHandler(customerValidation.empty,'customer-login',async(req,res)=>{
  const nonce=await cardAuth.issueNonce({purpose:'login-customer'});
  await cardLog.write({action:'customer-login-challenge',actorType:'customer',result:'success',detail:{},req});
  res.json({code:'success',message:'Đã tạo yêu cầu xác thực thẻ.',nonce});
});
module.exports.loginVerify=customerHandler(customerValidation.login,'customer-login',async(req,res,body)=>{
  const result=await cardAuth.verify({purpose:'login-customer',...body});
  if(!result.card)throw new E.CardOpError('CARD_AUTH_INVALID');
  const customer=await Customer.findOne({_id:result.card.ownerId,status:'active',deleted:false}).lean();
  if(!customer)throw new E.CardOpError('CARD_AUTH_INVALID');
  const current=await Card.findOneAndUpdate({_id:result.card._id,ownerId:String(customer._id),cardType:'customer',status:'active',isCurrent:true},[{$set:{activatedAt:{$ifNull:['$activatedAt','$$NOW']}}}],{new:true});
  if(!current)throw new E.CardOpError('CARD_AUTH_INVALID');
  res.cookie('customerToken',jwt.sign({customerId:String(customer._id),cardId:current.cardId},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'1d'}),{...customerAuth.flags(),maxAge:86400000});
  await cardLog.write({action:'customer-login',cardId:current.cardId,actorType:'customer',actorId:String(customer._id),result:'success',detail:{},req});
  res.json({code:'success',message:'Đăng nhập thành công.'});
});
module.exports.logout=customerHandler(customerValidation.empty,'customer-logout',async(req,res)=>{
  customerAuth.clear(res);
  await cardLog.write({action:'customer-logout',cardId:req.card?.cardId,actorType:'customer',actorId:req.customer?String(req.customer._id):undefined,result:'success',detail:{},req});
  res.json({code:'success',message:'Đã đăng xuất.'});
});
module.exports.profileBuild=customerHandler(customerValidation.profile,'customer-profile-build',async(req,res,body)=>{
  const profile={...req.customer,...body};
  if(profile.dob instanceof Date)profile.dob=profile.dob.toISOString().slice(0,10).replace(/-/g,'');
  let profileHex;try{profileHex=Buffer.from(S.encodeProfile(profile)).toString('hex').toUpperCase();}catch{throw new E.CardOpError('INVALID_PROFILE');}
  const op=await E.createOp({cardId:req.card.cardId,type:'commit-write',params:{target:1,dataHex:profileHex,customerUpdate:body},actorType:'customer',actorId:String(req.customer._id)});
  await cardLog.write({action:'customer-profile-build',cardId:req.card.cardId,actorType:'customer',actorId:String(req.customer._id),result:'success',detail:{opId:op.id},req});
  res.json({code:'success',message:'Đã chuẩn bị hồ sơ; dữ liệu chỉ đổi sau khi xác nhận ghi thẻ.',opId:op.id,profileHex});
},true);
const PAY_SYNC_MESSAGE='Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ';
const refused=(code,message)=>{const error=new E.CardOpError(code);error.userMessage=message;return error;};
// U5: chuẩn bị trừ ví cho một đơn. Không bao giờ ký lại tiền khi giao dịch cũ chưa đối soát xong.
module.exports.payPrepare=customerHandler(customerValidation.payPrepare,'card-pay-prepare',async(req,res,body)=>{
  const customerId=String(req.customer._id);
  const order=await Order.findOne({_id:body.orderId,customerId,deleted:false,paymentMethod:'card',paymentStatus:'unpaid',status:{$ne:'cancel'}}).lean();
  if(!order||!Number.isSafeInteger(order.total)||order.total<1)throw refused('OP_STATE','Đơn hàng không hợp lệ hoặc đã được thanh toán.');
  // Đơn đã từng được trừ ví thành công (dù trạng thái đơn bị sửa về unpaid) không bao giờ được trừ lần hai.
  if(await Tx.exists({orderId:String(order._id),type:'debit',status:'done'}))throw refused('OP_STATE','Đơn hàng không hợp lệ hoặc đã được thanh toán.');
  // Thẻ còn giao dịch đã ký/đã gửi chưa đối soát (của bất kỳ đơn nào): phải khôi phục biên nhận trước, không tạo debit mồ côi.
  if(await Tx.exists(E.unresolvedFilter({cardId:req.card.cardId})))throw refused('OP_STATE',PAY_SYNC_MESSAGE);
  const open=await Tx.find({orderId:String(order._id),type:'debit',status:{$ne:'done'}}).lean();
  // Giao dịch đã ký (sent, hoặc pending-card/failed còn dấu signedOpId) cần khôi phục biên nhận trước.
  if(open.some(tx=>tx.status==='sent'||tx.signedOpId))throw refused('OP_STATE',PAY_SYNC_MESSAGE);
  if(req.card.balance<order.total)throw refused('INSUFFICIENT_BALANCE','Số dư ví không đủ');
  // Giao dịch chưa từng ký (người dùng bỏ giữa chừng) dùng lại được, tránh kẹt đơn vĩnh viễn.
  let tx=open.find(item=>item.cardId===req.card.cardId&&item.status==='pending-card'&&item.amount===order.total&&item.txRef===order.cardTxRef);
  if(!tx){
    const txRef=crypto.randomBytes(8).toString('hex').toUpperCase();
    const claim=await Order.updateOne({_id:order._id,customerId,deleted:false,paymentMethod:'card',paymentStatus:'unpaid',status:{$ne:'cancel'},total:order.total,cardTxRef:order.cardTxRef===undefined?{$exists:false}:order.cardTxRef},{$set:{cardTxRef:txRef}});
    if(claim.modifiedCount!==1)throw refused('OP_STATE','Đơn hàng vừa thay đổi, vui lòng thử lại.');
    tx=await Tx.create({txRef,cardId:req.card.cardId,type:'debit',source:'order',amount:order.total,orderId:String(order._id),createdBy:customerId});
  }
  const op=await E.createOp({cardId:req.card.cardId,type:'debit',params:{txRef:tx.txRef},actorType:'customer',actorId:customerId});
  await cardLog.write({action:'card-pay-prepare',cardId:req.card.cardId,actorType:'customer',actorId:customerId,result:'success',detail:{opId:op.id,orderId:String(order._id),txRef:tx.txRef,amount:order.total},req});
  res.json({code:'success',message:'Đã chuẩn bị thanh toán bằng ví thẻ.',opId:op.id,amount:order.total});
},true);
// U5 nạp online: tạo giao dịch credit chờ thanh toán rồi chuyển khách sang cổng.
const TOPUP_RETURN_PATH='/account/card?topup=1';
async function topupZaloPay(tx) {
  return zalopayHelper.createOrder({
    appUser:'topup-'+tx.id,
    amount:tx.amount,
    description:`Nạp ví thẻ ${tx.txRef}`,
    redirectUrl:`${process.env.DOMAIN_WEBSITE}${TOPUP_RETURN_PATH}`,
    callbackPath:'/card-api/topup-zalopay-result',
    expireSeconds:E.TOPUP_EXPIRE_MINUTES*60
  });
}
function topupVnpay(tx,req) {
  const ipAddr=req.headers['x-forwarded-for']||req.socket?.remoteAddress||req.ip;
  try {
    return vnpayHelper.buildPaymentUrl({txnRef:tx.txRef,amount:tx.amount,orderInfo:'Nap vi the '+tx.txRef,returnPath:'/card-api/topup-vnpay-result',ipAddr,expireMinutes:E.TOPUP_EXPIRE_MINUTES});
  }
  catch {
    return null;
  }
}
module.exports.topupZaloPay=topupZaloPay;
module.exports.topupVnpay=topupVnpay;
const TOPUP_IN_PROGRESS_MESSAGE='Bạn còn một giao dịch nạp ví online chưa hoàn tất. Vui lòng hoàn tất hoặc chờ giao dịch hết hạn (khoảng 20 phút) rồi thử lại.';
module.exports.topupPost=customerHandler(customerValidation.topup,'card-topup-prepare',async(req,res,body)=>{
  const customerId=String(req.customer._id);
  const fresh={$gt:new Date(Date.now()-E.TOPUP_STALE_MS)};
  let tx;
  const session=await mongoose.startSession();
  try {
    await session.withTransaction(async()=> {
      // Khoá thẻ: hai tab nạp đồng thời xung đột ghi thay vì cùng lọt qua kiểm tra.
      const card=await Card.findOneAndUpdate({cardId:req.card.cardId,cardType:'customer',status:'active',isCurrent:true},{$inc:{__v:1}},{session,new:true}).lean();
      if(!card)
        throw new E.CardOpError('AUTH_REQUIRED');
      // Mỗi thẻ chỉ một khoản nạp online đang dở (Ruling 12): chip tự chặn vượt 50 000 000, khoản đã thu mà không ghi được sẽ kẹt thẻ.
      if(await Tx.exists({cardId:card.cardId,type:'credit',source:{$in:['zalopay','vnpay']},$or:[{status:'awaiting-payment',createdAt:fresh},{status:{$in:['pending-card','sent']}}]}).session(session)) {
        const error=refused('TOPUP_IN_PROGRESS',TOPUP_IN_PROGRESS_MESSAGE);
        error.httpStatus=409;
        throw error;
      }
      // Khoản chờ ghi thẻ, đang đối soát và khoản chờ cổng chưa hết hạn đều chiếm hạn mức (spec 5.4, Ruling 12).
      const [pending]=await Tx.aggregate([{$match:{cardId:card.cardId,type:'credit',$or:[{status:{$in:['pending-card','sent']}},{status:'awaiting-payment',createdAt:fresh}]}},{$group:{_id:null,sum:{$sum:'$amount'}}}]).session(session);
      const rule=checkOnlineTopup({balance:card.balance,pendingSum:pending?.sum||0,amount:body.amount});
      if(rule) {
        const error=refused('TOPUP_LIMIT',rule);
        error.httpStatus=400;
        throw error;
      }
      [tx]=await Tx.create([{txRef:crypto.randomBytes(8).toString('hex').toUpperCase(),cardId:card.cardId,type:'credit',source:body.method,amount:body.amount,status:'awaiting-payment',createdBy:customerId}],{session});
    });
  }
  finally {
    await session.endSession();
  }
  const redirectUrl=body.method==='zalopay'?await topupZaloPay(tx):topupVnpay(tx,req);
  if(!redirectUrl) {
    // Chưa có tiền nào đi qua cổng: bỏ giao dịch chờ để không để lại rác.
    await Tx.deleteOne({_id:tx._id,status:'awaiting-payment'});
    throw refused('GATEWAY_UNAVAILABLE','Không thể kết nối cổng thanh toán, vui lòng thử lại sau.');
  }
  await cardLog.write({action:'card-topup-prepare',cardId:req.card.cardId,actorType:'customer',actorId:customerId,result:'success',detail:{txRef:tx.txRef,amount:tx.amount,method:body.method},req});
  res.json({code:'success',message:'Đã tạo yêu cầu nạp ví.',redirectUrl});
},true);
// Ghi nhật ký khi khoản nạp chuyển sang chờ ghi thẻ (chỉ lần chuyển đầu tiên).
const topupPaidLog=(tx,source,req)=>cardLog.write({action:'card-topup-paid',cardId:tx.cardId,actorType:'system',result:'success',detail:{txRef:tx.txRef,amount:tx.amount,source},req});
// Mọi từ chối/thất bại của callback hoặc return đều có dấu vết; chỉ ghi lý do, txRef, số tiền (không ghi chữ ký).
const topupFailLog=(req,source,reason,tx,extra={})=>cardLog.write({action:'card-topup-callback',cardId:tx?.cardId,actorType:'system',result:'fail',detail:{source,reason,...(tx?{txRef:tx.txRef,amount:tx.amount}:{}),...extra},req});
const PAID_STATES=['pending-card','sent','done'];
// Đã thu tiền: đang/đã ghi thẻ, đã ký chờ biên nhận, hoặc đã chuyển sang thẻ cấp lại/hoàn tiền mặt khi thu hồi.
const PAID_MATCH=[{status:{$in:PAID_STATES}},{status:'failed',signedOpId:{$exists:true}},{status:'failed',failReason:{$in:['moved','refunded']}}];
// Tiền đã thu nhưng khoản nạp đã đóng (hết hạn) và thẻ không còn nhận được: cần nhân viên đối soát.
const topupManual=(req,source,tx)=>topupFailLog(req,source,'cần đối soát thủ công',tx);
module.exports.topupZaloPayResult=async(req,res)=> {
  let tx;
  try {
    const verified=zalopayHelper.verifyCallback(req.body);
    if(!verified.valid) {
      await topupFailLog(req,'zalopay','chữ ký hoặc dữ liệu callback không hợp lệ');
      return res.json({return_code:-1,return_message:'mac not equal'});
    }
    const match=/^topup-([a-fA-F0-9]{24})$/.exec(verified.data.app_user);
    if(!match) {
      await topupFailLog(req,'zalopay','app_user không phải khoản nạp ví',undefined,{amount:verified.data.amount});
      return res.json({return_code:-1,return_message:'invalid payment'});
    }
    const identity={_id:match[1],type:'credit',source:'zalopay',amount:verified.data.amount};
    tx=await Tx.findOne(identity).lean();
    if(!tx||!['awaiting-payment','failed',...PAID_STATES].includes(tx.status)) {
      await topupFailLog(req,'zalopay','không tìm thấy khoản nạp khớp hoặc trạng thái không hợp lệ',undefined,{txId:match[1],amount:verified.data.amount});
      return res.json({return_code:-1,return_message:'invalid payment'});
    }
    if(await E.markTopupPaid(tx._id,'zalopay'))
      await topupPaidLog(tx,'zalopay',req);
    // Callback lặp chỉ được ACK khi cùng identity/amount đã ở trạng thái đã thanh toán.
    else if(!await Tx.exists({...identity,$or:PAID_MATCH})) {
      if(tx.status==='failed'&&tx.failReason==='expired')
        await topupManual(req,'zalopay',tx);
      else
        await topupFailLog(req,'zalopay','khoản nạp đã đóng, không cộng tiền',tx);
      return res.json({return_code:-1,return_message:'invalid payment'});
    }
    return res.json({return_code:1,return_message:'success'});
  }
  catch {
    await topupFailLog(req,'zalopay','lỗi xử lý callback',tx);
    return res.json({return_code:0,return_message:'processing failed'});
  }
};
module.exports.topupVnpayResult=async(req,res)=> {
  let tx;
  try {
    const verified=vnpayHelper.verifyReturn(req.query);
    const rawAmount=req.query.vnp_Amount;
    if(!verified.valid) {
      await topupFailLog(req,'vnpay','chữ ký return không hợp lệ');
      return res.redirect('/account/card');
    }
    const scaled=typeof rawAmount==='string'&&/^[1-9][0-9]*$/.test(rawAmount)?Number(rawAmount):NaN;
    if(!process.env.VNPAY_CODE||req.query.vnp_TmnCode!==process.env.VNPAY_CODE||!/^[a-fA-F0-9]{16}$/.test(verified.txnRef)||!Number.isSafeInteger(scaled)||scaled%100!==0) {
      await topupFailLog(req,'vnpay','merchant, mã tham chiếu hoặc số tiền không hợp lệ');
      return res.redirect('/account/card');
    }
    const identity={txRef:verified.txnRef.toUpperCase(),type:'credit',source:'vnpay',amount:scaled/100};
    tx=await Tx.findOne(identity).lean();
    if(!tx||!['awaiting-payment','failed',...PAID_STATES].includes(tx.status)) {
      await topupFailLog(req,'vnpay','không tìm thấy khoản nạp khớp hoặc trạng thái không hợp lệ',undefined,{txRef:identity.txRef,amount:identity.amount});
      return res.redirect('/account/card');
    }
    if(!verified.success) {
      // Cổng báo thất bại (đã ký): đóng khoản chờ, không bao giờ nạp lại.
      await E.markTopupFailed(tx._id,'vnpay');
      await topupFailLog(req,'vnpay','thanh toán không thành công',tx,{responseCode:String(req.query.vnp_ResponseCode||'')});
      return res.redirect('/account/card?topup=fail');
    }
    if(await E.markTopupPaid(tx._id,'vnpay'))
      await topupPaidLog(tx,'vnpay',req);
    else if(!await Tx.exists({...identity,$or:PAID_MATCH})) {
      if(tx.status==='failed'&&tx.failReason==='expired')
        await topupManual(req,'vnpay',tx);
      else
        await topupFailLog(req,'vnpay','khoản nạp đã đóng, không cộng tiền',tx);
      return res.redirect('/account/card?topup=fail');
    }
    return res.redirect(TOPUP_RETURN_PATH);
  }
  catch {
    await topupFailLog(req,'vnpay','lỗi xử lý return',tx);
    return res.redirect('/account/card');
  }
};
// Mount trực tiếp tại app để bắt cả lỗi parser xảy ra trước router con.
module.exports.errorHandler=(error,req,res,next)=> {
  if(res.headersSent)
    return next(error);
  const invalid=['entity.parse.failed','entity.too.large','encoding.unsupported','charset.unsupported','request.aborted','request.size.invalid'].includes(error?.type);
  return res.status(invalid?400:500).json({code:'error',errorCode:invalid?'INVALID_INPUT':'INTERNAL',message:'Không thể xử lý yêu cầu thẻ.'});
};
