const AccountAdmin = require("../../models/account-admin.model")
const bcrypt = require("bcryptjs")
const jwt = require('jsonwebtoken')
const Card=require('../../models/card.model');
const adminToken=require('../../helpers/admin-token.helper');
const cardAuth=require('../../helpers/card-auth.helper');
const Joi=require('joi');
const { newPassword } = require('../../validates/admin/credential-fields');

const adminOtp = require("../../helpers/admin-otp.helper");
const mailHelper = require("../../helpers/mail.helper");
const adminStart = '/' + require('../../config/variable').pathAdmin + '/start';

module.exports.login = async (req, res) => {
  res.render("admin/pages/login", {
    pageTitle: "Đăng nhập"
  })
}

module.exports.loginPost=async(req,res)=>{
  const {email,password,rememberPassword}=req.body||{};
  const invalid=()=>res.json({code:'error',message:'Email, mật khẩu không đúng hoặc tài khoản chưa được kích hoạt.'});
  // Chỉ nhận chuỗi: object toán tử ({"$ne":null}) không được chọn tài khoản, mật khẩu không phải chuỗi không làm bcrypt ném lỗi.
  if(typeof email!=='string'||typeof password!=='string'||!email||!password||email.length>254||password.length>256)return invalid();
  if(!await adminOtp.quota('login',email.trim().toLowerCase(),req.ip||'',new Date()))return invalid();
  const account=await AccountAdmin.findOne({email,deleted:false});
  if(!account||typeof account.password!=='string'||!await bcrypt.compare(password,account.password)||account.status!=='active')return invalid();
  if(account.cardRequired){
    if(!await Card.exists({ownerId:account.id,cardType:'staff',status:'active',isCurrent:true}))return res.json({code:'error',message:'Thẻ nhân viên đã bị khoá hoặc thu hồi. Liên hệ quản trị viên.'});
    res.clearCookie('token');res.clearCookie('resetToken');
    res.cookie('preToken',jwt.sign({id:account.id,email:account.email,sv:adminToken.version(account),stage:'card',remember:rememberPassword===true},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'5m'}),{...adminToken.flags,maxAge:300000});
    return res.json({code:'card-required'});
  }
  res.clearCookie('preToken');res.clearCookie('resetToken');adminToken.issue(res,{account,remember:rememberPassword===true});
  res.json({code:'success',redirectTo:adminStart});
};

module.exports.register = async (req, res) => {
  res.render("admin/pages/register", {
    pageTitle: "Đăng ký"
  })
}

module.exports.registerPost = async (req, res) => {
  const { fullName, email, password } = req.body;

  const existAccount = await AccountAdmin.findOne({
    email: email
  });

  if(existAccount) {
    res.json({
      code: "error",
      message: "Email đã tồn tại trong hệ thống!"
    });
    return;
  }

  // Mã hóa mật khẩu với bcrypt
  const salt = await bcrypt.genSalt(10); // Tạo ra chuỗi ngẫu nhiên có 10 ký tự
  const hashedPassword = await bcrypt.hash(password, salt);

  const newAccount = new AccountAdmin({
    fullName: fullName,
    email: email,
    password: hashedPassword,
    status: "initial"
  });

  await newAccount.save();

  res.json({
    code: "success",
    message: "Đăng ký tài khoản thành công!"
  });
}

module.exports.registerInitial = async (req, res) => {
  res.render("admin/pages/register-initial", {
    pageTitle: "Tài khoản đã được khởi tạo"
  })
}

module.exports.forgotPassword = async (req, res) => {
  res.render("admin/pages/forgot-password", {
    pageTitle: "Quên mật khẩu"
  })
}

const otpEmail = Joi.string().trim().email({ tlds: { allow: false } }).max(254).required();
const otpInput = Joi.object({ email: otpEmail, otp: Joi.string().pattern(/^\d{6}$/).required() }).unknown(false);
const otpFailure = 'Mã OTP sai, đã dùng, hết hạn hoặc vượt giới hạn thử. Vui lòng kiểm tra mã hoặc yêu cầu mã mới.';
let pendingMail = 0;

async function activeResetAccount(email) {
  const escaped = email.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  const matches = await AccountAdmin.find({ email: new RegExp('^' + escaped + '$', 'i'), status: 'active', deleted: false }).limit(2);
  return matches.length === 1 ? matches[0] : null;
}

module.exports.forgotPasswordPost = async (req, res) => {
  const started = Date.now();
  const checked = otpEmail.validate(req.body?.email);
  if (!checked.error) {
    const email = checked.value.toLowerCase();
    try {
      const now = new Date();
      if (await adminOtp.quota('send', email, req.ip || '', now)) {
        const account = await activeResetAccount(email);
        if (!account) {
          await adminOtp.createCode(email, null, now);
        } else if (pendingMail < 4) {
          pendingMail++;
          let code;
          try {
            code = await adminOtp.createCode(email, account, now);
          } finally {
            if (!code) pendingMail--;
          }
          if (code) {
            Promise.resolve().then(() => mailHelper.sendMail(account.email, 'Mã OTP lấy lại mật khẩu',
              'Mã xác nhận của bạn là <b>' + code + '</b>. Mã có hiệu lực 5 phút.'))
              .catch(() => {}).finally(() => { pendingMail--; });
          }
        }
      }
    } catch {
      console.error('Không thể xử lý yêu cầu gửi OTP Admin.');
    }
  }
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 120 - (Date.now() - started))));
  return res.json({ code: 'success', message: 'Nếu tài khoản hợp lệ, mã OTP sẽ được gửi tới email.' });
};

module.exports.otpPassword = async (req, res) => {
  res.render("admin/pages/otp-password", {
    pageTitle: "Nhập mã OTP"
  })
}

module.exports.otpPasswordPost = async (req, res) => {
  const { error, value } = otpInput.validate(req.body);
  if (error) return res.json({ code: 'error', message: otpFailure });
  const email = value.email.toLowerCase();
  const now = new Date();
  if (!await adminOtp.quota('verify', email, req.ip || '', now)) return res.json({ code: 'error', message: otpFailure });
  const account = await activeResetAccount(email);
  if (!account || !await adminOtp.consumeCode(email, value.otp, account, now)) {
    return res.json({ code: 'error', message: otpFailure });
  }
  res.clearCookie('token', adminToken.flags);
  res.clearCookie('preToken', adminToken.flags);
  res.cookie('resetToken', jwt.sign({
    id: account.id, email: account.email, sv: adminToken.version(account),
    stage: 'reset-password', passwordTag: adminToken.resetTag(account)
  }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' }), { ...adminToken.flags, maxAge: 300000 });
  return res.json({ code: 'success' });
};

module.exports.resetPassword = async (req, res) => {
  res.render("admin/pages/reset-password", {
    pageTitle: "Đổi mật khẩu"
  })
}

module.exports.resetPasswordPost = async (req, res) => {
  const password = await bcrypt.hash(req.body.password, 10);
  const result = await AccountAdmin.updateOne({
    _id: req.account.id, deleted: false, status: 'active', password: req.account.password,
    sessionVersion: adminToken.versionFilter(req.account)
  }, { $set: { password }, $inc: { sessionVersion: 1 } });
  if (!result.matchedCount) return res.status(403).json({ code: 'error' });
  adminToken.clear(res);
  return res.json({ code: 'success', requiresLogin: true });
};

module.exports.logoutPost = async (req, res) => {
  res.clearCookie("token");
  res.clearCookie("preToken");
  res.clearCookie("resetToken");
  res.json({
    code: "success",
    message: "Đăng xuất thành công!"
  })
}
const authHex=n=>Joi.string().pattern(new RegExp('^[a-fA-F0-9]{'+n+'}$')).required();
const cardSchemas={challenge:Joi.object({}).required().unknown(false),verify:Joi.object({cardId:authHex(32),nonce:authHex(32),counter:Joi.number().integer().min(0).max(0xffffffff).required(),signature:authHex(256)}).required().unknown(false)};
cardSchemas.reset=Joi.object({password:newPassword.required()}).required().unknown(false);
module.exports.cardInput=(schema)=>async(req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!req.is('application/json'))return res.status(415).json({code:'error',errorCode:'INVALID_INPUT'});
  if(req.headers.origin){try{if(new URL(req.headers.origin).origin!==req.protocol+'://'+req.get('host'))throw new Error();}catch{return res.status(403).json({code:'error',errorCode:'OP_FORBIDDEN'});}}
  if(schema&&cardSchemas[schema].validate(req.body,{convert:false}).error)return res.status(400).json({code:'error',errorCode:'INVALID_INPUT'});
  next();
};
async function preAccount(req){
  const decoded=adminToken.decode(req.cookies?.preToken);
  if(decoded.stage!=='card'||typeof decoded.id!=='string'||!(/^[a-fA-F0-9]{24}$/).test(decoded.id)||typeof decoded.email!=='string'||typeof decoded.remember!=='boolean')throw new Error();
  const account=await AccountAdmin.findOne({_id:decoded.id,email:decoded.email,status:'active',deleted:false,cardRequired:true});
  if(!account||!adminToken.isCurrent(decoded,account)||!await Card.exists({ownerId:account.id,cardType:'staff',status:'active',isCurrent:true}))throw new Error();
  return {account,remember:decoded.remember};
}
module.exports.loginCardChallenge=async(req,res)=>{
  try{const {account}=await preAccount(req);res.json({code:'success',nonce:await cardAuth.issueNonce({purpose:'login-staff',accountId:account.id})});}catch{res.clearCookie('preToken');res.status(401).json({code:'error',errorCode:'AUTH_REQUIRED',message:'Phiên xác thực thẻ đã hết hạn. Hãy đăng nhập lại.'});}
};
module.exports.loginCardVerify=async(req,res)=>{
  let ctx;try{ctx=await preAccount(req);}catch{res.clearCookie('preToken');return res.status(401).json({code:'error',errorCode:'AUTH_REQUIRED'});}
  try{
    const result=await cardAuth.verify({...req.body,purpose:'login-staff',accountId:ctx.account.id});
    if(result.error)return res.status(403).json({code:'error',errorCode:result.error,message:'Thẻ không hợp lệ hoặc đã bị khoá.'});
    const current=await adminToken.resolve({id:ctx.account.id,email:ctx.account.email,sv:adminToken.version(ctx.account),cardId:result.card.cardId});
    if(!current)return res.status(403).json({code:'error',errorCode:'OP_FORBIDDEN'});
    adminToken.issue(res,{account:current.account,cardId:result.card.cardId,stepUpAt:Date.now(),remember:ctx.remember});res.clearCookie('preToken',adminToken.flags);res.json({code:'success',redirectTo:adminStart});
  }catch{res.status(500).json({code:'error',errorCode:'INTERNAL'});}
};
