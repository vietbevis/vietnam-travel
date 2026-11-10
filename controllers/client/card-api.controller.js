const Joi=require('joi');
const jwt=require('jsonwebtoken');
const adminTokenHelper=require('../../helpers/admin-token.helper');
const Card=require('../../models/card.model');
const Tx=require('../../models/card-transaction.model');
const Op=require('../../models/card-operation.model');
const Customer=require('../../models/customer.model');
const Account=require('../../models/account-admin.model');
const Role=require('../../models/role.model');
const E=require('../../helpers/card-op.helper');
const P=require('../../helpers/card-sync.helper');
const S=require('../../public/assets/js/card/card-shared');
const customerAuth=require('../../middlewares/client/customer-auth.middleware');
const cardAuth=require('../../helpers/card-auth.helper');
const cardLog=require('../../helpers/card-log.helper');
const customerValidation=require('../../validates/client/card.validate');
const Order=require('../../models/order.model');
const mongoose=require('mongoose');
const crypto=require('node:crypto');
const hex=n=>Joi.string().pattern(new RegExp(`^[a-fA-F0-9]{${n}}$`)).required();
const response=Joi.string().allow('').pattern(/^([a-fA-F0-9]{2})*$/).max(332).required();
const schemas={
  next:Joi.object({cardId:hex(32),cardState:Joi.number().integer().valid(0,2,3,127).required(),challenge:hex(32)}).required().unknown(false),
  sign:Joi.object({opId:hex(24),challenge:hex(32)}).required().unknown(false),
  confirm:Joi.object({opId:hex(24),response,sw:hex(4)}).required().unknown(false),
  receipt:Joi.object({
    cardId:hex(32),
    txRef:hex(16),
    response,
    sw:hex(4)
  }).required().unknown(false)
};
// Thông báo cụ thể chỉ cho các mã lỗi thanh toán an toàn để hiển thị cho khách.
const payMessages={
  INSUFFICIENT_BALANCE:'Số dư ví không đủ',
  UNRESOLVED_TX:'Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ',
  ORDER_STATE:'Đơn hàng không thể thanh toán bằng ví thẻ.'
};
const problem=(res,status,errorCode)=>res.status(status).json({code:'error',errorCode,message:payMessages[errorCode]||'Yêu cầu thẻ không hợp lệ hoặc không được phép.'});
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
      problem(res,status,code);
    }
  };
}
const deny=()=> {
  throw new E.CardOpError('OP_FORBIDDEN');
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
  if(!permission||!role?.permissions?.includes(permission))
    deny();
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
module.exports.next=handler('next',async(req,res,body)=> {
  const card=await Card.findOne({cardId:body.cardId.toUpperCase()}).lean();
  if(!card||!['active','locked','revoked'].includes(card.status))
    return res.json({code:'success',message:'Không có bước đồng bộ.',step:null});
  const step=P.planNextSync({card,cardState:body.cardState,...await P.loadSyncContext(card)});
  if(!step)
    return res.json({code:'success',message:'Không có bước đồng bộ.',step:null});
  if(step.kind==='receipt')
    return res.json({code:'success',message:'Cần khôi phục biên nhận.',step:{...step,apdu:S.apdu(S.INS.GET_RECEIPT,0,0,Buffer.from(step.txRef,'hex'))}});
  let binding;
  if(step.type!=='set-state') {
    const resolved=await actor(req,{
      cardId:card.cardId,
      type:step.type,
      params:step.params,
      actorType:req.cookies?.customerToken?'customer':'admin',
      actorId:req.cookies?.customerToken?card.ownerId:undefined
    });
    if(!resolved)
      return res.json({
        code:'success',
        message:'Đăng nhập để đồng bộ dữ liệu thẻ.',
        step:null,
        requiresAuth:true
      });
    binding=resolved;
  }
  const op=await E.createOp({
    cardId:card.cardId,
    type:step.type,
    params:step.params,
    actorType:'system',
    actorId:binding?`${binding.actorType}:${binding.actorId}`:undefined
  });
  const {apdu}=await E.signOp({opId:op.id,challengeHex:body.challenge,...(binding||{actorType:'system'})});
  res.json({code:'success',message:'Đã chuẩn bị bước đồng bộ.',step:{kind:'op',opId:op.id,apdu}});
});
module.exports.sign=handler('sign',async(req,res,body)=> {
  const ctx=await owned(req,res,body.opId,false);
  if(ctx)
    res.json({code:'success',message:'Đã ký thao tác thẻ.',...await E.signOp({opId:body.opId,challengeHex:body.challenge,...ctx.actor})});
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
module.exports.receipt=handler('receipt',async(req,res,body)=> {
  const card=await Card.findOne({cardId:body.cardId.toUpperCase()}).lean();
  const tx=await Tx.findOne({cardId:body.cardId.toUpperCase(),txRef:body.txRef.toUpperCase()}).lean();
  if(!card||!tx||!tx.signedOpId)
    return problem(res,404,'OP_NOT_FOUND');
  let ok=false;
  if(body.sw.toUpperCase()==='9000')
    ok=await E.applyReceipt({
      card,
      tx,
      responseHex:body.response,
      req
    });
  else
  if(body.sw.toUpperCase()==='6A88')
    await Tx.updateOne({_id:tx._id,status:{$ne:'done'},signedOpId:tx.signedOpId},{$set:{status:'failed'}});
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
      problem(res,error.httpStatus||(['CARD_AUTH_INVALID','AUTH_REQUIRED'].includes(errorCode)?401:errorCode==='OP_FORBIDDEN'?403:errorCode==='INVALID_PROFILE'?400:errorCode==='INTERNAL'?500:409),errorCode);
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
const CARD_MAX_AMOUNT=50000000;
// Một transaction: kiểm đơn/thẻ/số dư, khóa đơn bằng CAS cardTxRef và tạo (hoặc dùng lại) đúng một debit.
async function reserveDebit(customer,cardDoc,orderId) {
  const session=await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async()=> {
      result=undefined;
      const order=await Order.findOne({_id:orderId,customerId:String(customer._id),paymentMethod:'card'}).session(session).lean();
      if(!order||order.deleted)
        throw new E.CardOpError('OP_FORBIDDEN');
      if(order.paymentStatus!=='unpaid'||order.status==='cancel'||!Number.isSafeInteger(order.total)||order.total<1||order.total>CARD_MAX_AMOUNT)
        throw new E.CardOpError('ORDER_STATE');
      const card=await Card.findOne({_id:cardDoc._id,cardType:'customer',ownerId:String(customer._id),status:'active',isCurrent:true}).session(session).lean();
      if(!card)
        throw new E.CardOpError('CARD_STATE');
      let tx=order.cardTxRef?await Tx.findOne({txRef:order.cardTxRef}).session(session).lean():null;
      if(order.cardTxRef&&!tx)
        throw new E.CardOpError('UNRESOLVED_TX');
      if(tx) {
        if(tx.type!=='debit'||tx.source!=='order'||tx.orderId!==String(order._id)||['done','awaiting-payment'].includes(tx.status))
          throw new E.CardOpError('ORDER_STATE');
        // sent/failed hoặc đã có chữ ký: chưa biết thẻ đã trừ hay chưa, chỉ receipt mới giải quyết được.
        if(tx.status!=='pending-card'||tx.signedOpId)
          throw new E.CardOpError('UNRESOLVED_TX');
      }
      if(card.balance<order.total)
        throw new E.CardOpError('INSUFFICIENT_BALANCE');
      if(tx) {
        // Debit chưa ký nên được dùng lại; chỉ chỉnh về thẻ hiện hành và số tiền cố định của đơn.
        if(tx.cardId!==card.cardId||tx.amount!==order.total) {
          const moved=await Tx.updateOne({_id:tx._id,status:'pending-card',signedOpId:{$exists:false}},{$set:{cardId:card.cardId,amount:order.total}},{session});
          if(moved.modifiedCount!==1)
            throw new E.CardOpError('UNRESOLVED_TX');
        }
      }
      else {
        const txRef=crypto.randomBytes(8).toString('hex').toUpperCase();
        // Hai prepare song song cùng ghi order: một bên write-conflict, retry rồi đi nhánh dùng lại.
        const lock=await Order.updateOne({_id:order._id,paymentStatus:'unpaid',status:{$ne:'cancel'},cardTxRef:{$exists:false}},{$set:{cardTxRef:txRef}},{session});
        if(lock.modifiedCount!==1)
          throw new E.CardOpError('UNRESOLVED_TX');
        await Tx.create([{cardId:card.cardId,txRef,type:'debit',source:'order',amount:order.total,orderId:String(order._id),status:'pending-card',createdBy:String(customer._id)}],{session});
        tx={txRef};
      }
      result={txRef:tx.txRef,amount:order.total,cardId:card.cardId};
    });
  }
  finally {
    await session.endSession();
  }
  return result;
}
module.exports.payPrepare=customerHandler(customerValidation.payPrepare,'customer-pay-prepare',async(req,res,body)=>{
  const reserved=await reserveDebit(req.customer,req.card,body.orderId);
  const op=await E.createOp({cardId:reserved.cardId,type:'debit',params:{txRef:reserved.txRef},actorType:'customer',actorId:String(req.customer._id)});
  await cardLog.write({action:'customer-pay-prepare',cardId:reserved.cardId,actorType:'customer',actorId:String(req.customer._id),result:'success',detail:{opId:op.id,txRef:reserved.txRef,orderId:body.orderId},req});
  // Số tiền chỉ để hiển thị; APDU do server dựng từ giao dịch đã lưu.
  res.json({code:'success',message:'Đã chuẩn bị thanh toán.',opId:op.id,amount:reserved.amount});
},true);
// Mount trực tiếp tại app để bắt cả lỗi parser xảy ra trước router con.
module.exports.errorHandler=(error,req,res,next)=> {
  if(res.headersSent)
    return next(error);
  const invalid=['entity.parse.failed','entity.too.large','encoding.unsupported','charset.unsupported','request.aborted','request.size.invalid'].includes(error?.type);
  return res.status(invalid?400:500).json({code:'error',errorCode:invalid?'INVALID_INPUT':'INTERNAL',message:'Không thể xử lý yêu cầu thẻ.'});
};
