const jwt=require('jsonwebtoken');
const Customer=require('../../models/customer.model');
const Card=require('../../models/card.model');
const flags=()=>({httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/'});
function clear(res){res.clearCookie('customerToken',flags());}
async function resolve(token){
  if(!token)return null;
  try{
    const decoded=jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});
    if(typeof decoded.customerId!=='string'||!/^[a-f0-9]{24}$/i.test(decoded.customerId)||typeof decoded.cardId!=='string'||!/^[a-f0-9]{32}$/i.test(decoded.cardId)||decoded.stage!==undefined||!Number.isFinite(decoded.exp))return null;
    const customer=await Customer.findOne({_id:decoded.customerId,status:'active',deleted:false}).lean();
    const card=await Card.findOne({cardId:decoded.cardId,cardType:'customer',ownerId:decoded.customerId,status:'active',isCurrent:true}).lean();
    return customer&&card?{customer,card}:null;
  }catch{return null;}
}
async function optional(req,res,next){
  req.customer=null;req.card=null;res.locals.customer=null;
  const context=await resolve(req.cookies?.customerToken);
  if(context){Object.assign(req,context);res.locals.customer=context.customer;}
  else if(req.cookies?.customerToken)clear(res);
  next();
}
function required(req,res,next){res.set('Cache-Control','no-store');if(req.customer&&req.card)return next();return res.redirect('/account/login');}
function apiRequired(req,res,next){res.set('Cache-Control','no-store');if(req.customer&&req.card)return next();return res.status(401).json({code:'error',errorCode:'AUTH_REQUIRED',message:'Vui lòng đăng nhập bằng thẻ.'});}
module.exports={optional,required,apiRequired,resolve,clear,flags};
