const Account=require('../../models/account-admin.model');
const token=require('../../helpers/admin-token.helper');
const CARD_RELOGIN_MESSAGE='Tài khoản đã được yêu cầu đăng nhập bằng thẻ nhân viên. Vui lòng đăng nhập lại bằng mật khẩu và thẻ.';
// Phiên cũ chỉ có mật khẩu nhưng tài khoản vừa bật cardRequired (ví dụ tự phát hành thẻ nhân viên cho mình).
async function needsCardRelogin(decoded){
  try{if(!decoded||decoded.stage!==undefined||decoded.cardId!==undefined||!/^[a-fA-F0-9]{24}$/.test(decoded.id||''))return false;return !!await Account.exists({_id:decoded.id,email:decoded.email,status:'active',deleted:false,cardRequired:true});}catch{return false;}
}
function deny(res,notice){res.clearCookie('token');return res.redirect('/'+pathAdmin+'/account/login'+(notice?'?notice=card-required':''));}
module.exports.verifyToken=async(req,res,next)=>{
  let decoded;try{decoded=token.decode(req.cookies?.token);const ctx=await token.resolve(decoded);if(!ctx)return deny(res,await needsCardRelogin(decoded));token.attach(req,ctx);ctx.account.roleName=ctx.role.name;res.locals.account=ctx.account;res.locals.permissions=req.permissions;next();}catch{return deny(res,await needsCardRelogin(decoded));}
};
module.exports.verifyResetToken=async(req,res,next)=>{
  if(!req.cookies?.resetToken)return module.exports.verifyToken(req,res,next);
  try{const decoded=token.decode(req.cookies.resetToken);if(decoded.stage!=='reset-password'||!(/^[a-fA-F0-9]{24}$/).test(decoded.id))throw new Error();const account=await Account.findOne({_id:decoded.id,email:decoded.email,status:'active',deleted:false});if(!account||decoded.passwordTag!==token.resetTag(account))throw new Error();req.account=account;req.resetOnly=true;next();}catch{res.clearCookie('resetToken');return deny(res);}
};

module.exports.needsCardRelogin=needsCardRelogin;module.exports.CARD_RELOGIN_MESSAGE=CARD_RELOGIN_MESSAGE;
