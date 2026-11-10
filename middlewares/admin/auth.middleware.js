const Account=require('../../models/account-admin.model');
const token=require('../../helpers/admin-token.helper');
function deny(res){res.clearCookie('token');return res.redirect('/'+pathAdmin+'/account/login');}
module.exports.verifyToken=async(req,res,next)=>{
  try{const ctx=await token.resolve(token.decode(req.cookies?.token));if(!ctx)return deny(res);token.attach(req,ctx);ctx.account.roleName=ctx.role.name;res.locals.account=ctx.account;res.locals.permissions=req.permissions;next();}catch{return deny(res);}
};
module.exports.verifyResetToken=async(req,res,next)=>{
  if(!req.cookies?.resetToken)return module.exports.verifyToken(req,res,next);
  try{const decoded=token.decode(req.cookies.resetToken);if(decoded.stage!=='reset-password'||!(/^[a-fA-F0-9]{24}$/).test(decoded.id))throw new Error();const account=await Account.findOne({_id:decoded.id,email:decoded.email,status:'active',deleted:false});if(!account||decoded.passwordTag!==token.resetTag(account))throw new Error();req.account=account;req.resetOnly=true;next();}catch{res.clearCookie('resetToken');return deny(res);}
};
