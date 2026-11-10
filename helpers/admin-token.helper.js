const jwt=require('jsonwebtoken');
const crypto=require('node:crypto');
const Account=require('../models/account-admin.model');
const Role=require('../models/role.model');
const Card=require('../models/card.model');
const verified=new WeakMap();
const objectId=value=>typeof value==='string'&&/^[a-fA-F0-9]{24}$/.test(value);
const flags={httpOnly:true,sameSite:'strict'};
function issue(res,{account,cardId,stepUpAt,remember=false,expiresAt}) {
  const now=Math.floor(Date.now()/1000),exp=expiresAt===undefined?now+(remember?30:1)*86400:Math.floor(expiresAt);
  if(!Number.isFinite(exp)||exp<=now)throw new Error('AUTH_EXPIRED');
  const payload={id:String(account._id||account.id),email:account.email,iat:now,exp};
  if(cardId)payload.cardId=cardId;
  if(stepUpAt!==undefined)payload.stepUpAt=new Date(stepUpAt).getTime();
  res.cookie('token',jwt.sign(payload,process.env.JWT_SECRET,{algorithm:'HS256'}),{...flags,maxAge:(exp-now)*1000});
}
function decode(token){return jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});}
async function resolve(decoded) {
  if(!decoded||decoded.stage!==undefined||!objectId(decoded.id)||typeof decoded.email!=='string')return null;
  const account=await Account.findOne({_id:decoded.id,email:decoded.email,status:'active',deleted:false});
  if(!account||!objectId(account.role))return null;
  const role=await Role.findOne({_id:account.role,deleted:false});
  if(!role)return null;
  let card;
  if(account.cardRequired||decoded.cardId!==undefined){
    if(typeof decoded.cardId!=='string'||!/^[a-fA-F0-9]{32}$/.test(decoded.cardId))return null;
    card=await Card.findOne({cardId:decoded.cardId,ownerId:account.id,cardType:'staff',status:'active',isCurrent:true});
    if(!card)return null;
  }
  return {account,role,card,decoded};
}
function attach(req,context){
  verified.set(req,context);req.account=context.account;req.permissions=context.role.permissions||[];
  req.stepUpAt=typeof context.decoded.stepUpAt==='number'?new Date(context.decoded.stepUpAt):undefined;
}
const context=req=>verified.get(req);
const stepUp={isFresh(req){const ctx=verified.get(req),at=ctx?.decoded.stepUpAt;return !!ctx?.card&&typeof at==='number'&&Number.isFinite(at)&&at<=Date.now()&&Date.now()-at<=300000;}};
function resetTag(account){return crypto.createHmac('sha256',process.env.JWT_SECRET).update(account.password||'').digest('hex');}
module.exports={issue,decode,resolve,attach,context,stepUp,flags,resetTag};
