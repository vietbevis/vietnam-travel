const Joi=require('joi');
const jwt=require('jsonwebtoken');
const Card=require('../../models/card.model');
const Tx=require('../../models/card-transaction.model');
const Op=require('../../models/card-operation.model');
const Customer=require('../../models/customer.model');
const Account=require('../../models/account-admin.model');
const Role=require('../../models/role.model');
const E=require('../../helpers/card-op.helper');
const P=require('../../helpers/card-sync.helper');
const S=require('../../public/assets/js/card/card-shared');
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
const problem=(res,status,errorCode)=>res.status(status).json({code:'error',errorCode,message:'Yêu cầu thẻ không hợp lệ hoặc không được phép.'});
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
    if(typeof decoded.customerId!=='string'||!/^[a-fA-F0-9]{24}$/.test(decoded.customerId)||decoded.customerId!==op.actorId||decoded.cardId!==op.cardId)
      deny();
    const [customer,card]=await Promise.all([Customer.findOne({_id:decoded.customerId,status:'active',deleted:false}).lean(),Card.findOne({
      cardId:op.cardId,
      cardType:'customer',
      ownerId:decoded.customerId,
      status:'active',
      isCurrent:true
    }).lean()]);
    if(!customer||!card)
      deny();
    return{actorType:'customer',actorId:decoded.customerId};
  }
  if(op.actorType!=='admin')
    deny();
  if(typeof decoded.id!=='string'||!/^[a-fA-F0-9]{24}$/.test(decoded.id)||(op.actorId!==undefined&&decoded.id!==op.actorId))
    deny();
  const account=await Account.findOne({
    _id:decoded.id,
    email:decoded.email,
    status:'active',
    deleted:false
  }).lean();
  if(!account||!/^[a-fA-F0-9]{24}$/.test(account.role))
    deny();
  const role=await Role.findOne({_id:account.role,deleted:false}).lean();
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
    const at=decoded.stepUpAt;
    const time=typeof at==='number'?at:Date.parse(at);
    if(!Number.isFinite(time)||time>Date.now()||Date.now()-time>300000)
      deny();
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
// Mount trực tiếp tại app để bắt cả lỗi parser xảy ra trước router con.
module.exports.errorHandler=(error,req,res,next)=> {
  if(res.headersSent)
    return next(error);
  const invalid=['entity.parse.failed','entity.too.large','encoding.unsupported','charset.unsupported','request.aborted','request.size.invalid'].includes(error?.type);
  return res.status(invalid?400:500).json({code:'error',errorCode:invalid?'INVALID_INPUT':'INTERNAL',message:'Không thể xử lý yêu cầu thẻ.'});
};
