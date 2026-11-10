const AccountAdmin = require("../../models/account-admin.model")
const ForgotPassword = require("../../models/forgot-password.model")
const bcrypt = require("bcryptjs")
const jwt = require('jsonwebtoken')
const Card=require('../../models/card.model');
const adminToken=require('../../helpers/admin-token.helper');
const cardAuth=require('../../helpers/card-auth.helper');
const Joi=require('joi');

const generateHelper = require("../../helpers/generate.helper");
const mailHelper = require("../../helpers/mail.helper");

module.exports.login = async (req, res) => {
  res.render("admin/pages/login", {
    pageTitle: "Đăng nhập"
  })
}

module.exports.loginPost=async(req,res)=>{
  const {email,password,rememberPassword}=req.body;
  const account=await AccountAdmin.findOne({email,deleted:false});
  if(!account||!await bcrypt.compare(password,account.password)||account.status!=='active')return res.json({code:'error',message:'Email, mật khẩu không đúng hoặc tài khoản chưa được kích hoạt.'});
  if(account.cardRequired){
    if(!await Card.exists({ownerId:account.id,cardType:'staff',status:'active',isCurrent:true}))return res.json({code:'error',message:'Thẻ nhân viên đã bị khoá hoặc thu hồi. Liên hệ quản trị viên.'});
    res.clearCookie('token');res.clearCookie('resetToken');
    res.cookie('preToken',jwt.sign({id:account.id,email:account.email,stage:'card',remember:rememberPassword===true},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'5m'}),{...adminToken.flags,maxAge:300000});
    return res.json({code:'card-required'});
  }
  res.clearCookie('preToken');res.clearCookie('resetToken');adminToken.issue(res,{account,remember:rememberPassword===true});
  res.json({code:'success'});
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

module.exports.forgotPasswordPost = async (req, res) => {
  const { email } = req.body;

  // Kiểm tra xem email có tồn tại trong hệ thống không
  const existAccount = await AccountAdmin.findOne({
    email: email
  })

  if(!existAccount) {
    res.json({
      code: "error",
      message: "Email không tồn tại trong hệ thông!"
    })
    return;
  }

  // Kiểm tra email đã tồn tại trong ForgotPassword chưa
  const existEmailInForgotPassword = await ForgotPassword.findOne({
    email: email,
    $or:[{purpose:'admin-reset'},{purpose:{$exists:false}}]
  })

  if(existEmailInForgotPassword) {
    res.json({
      code: "error",
      message: "Vui lòng gửi lại yêu cầu sau 5 phút!"
    })
    return;
  }

  // Tạo mã OTP
  const otp = generateHelper.generateRandomNumber(6);

  // Lưu vào database: email, otp. sau 5 phút sẽ tự động xóa bản ghi.
  const newRecord = new ForgotPassword({
    email: email,
    purpose:'admin-reset',
    otp: otp,
    expireAt: Date.now() + 5*60*1000
  })
  await newRecord.save();

  // Gửi mã OTP qua email cho người dùng tự động
  const subject = `Mã OTP lấy lại mật khẩu`;
  const content = `Mã OTP của bạn là <b style="color: green;">${otp}</b>. Mã OTP có hiệu lực trong 5 phút, vui lòng không cung cấp cho bất kỳ ai.`;
  mailHelper.sendMail(email, subject, content);

  res.json({
    code: "success",
    message: "Đã gửi mã OTP qua email"
  });
}

module.exports.otpPassword = async (req, res) => {
  res.render("admin/pages/otp-password", {
    pageTitle: "Nhập mã OTP"
  })
}

module.exports.otpPasswordPost=async(req,res)=>{
  const {otp,email}=req.body;
  if(typeof otp!=='string'||typeof email!=='string')return res.json({code:'error',message:'Mã OTP không chính xác!'});
  const account=await AccountAdmin.findOne({email,status:'active',deleted:false});
  if(!account)return res.json({code:'error',message:'Tài khoản không khả dụng.'});
  const record=await ForgotPassword.findOneAndDelete({email,otp,expireAt:{$gt:new Date()},$or:[{purpose:'admin-reset'},{purpose:{$exists:false}}]});
  if(!record)return res.json({code:'error',message:'Mã OTP không chính xác hoặc đã hết hạn!'});
  if(account.cardRequired){
    res.clearCookie('token');res.clearCookie('preToken');
    res.cookie('resetToken',jwt.sign({id:account.id,email:account.email,stage:'reset-password',passwordTag:adminToken.resetTag(account)},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'5m'}),{...adminToken.flags,maxAge:300000});
  }else{res.clearCookie('resetToken');adminToken.issue(res,{account});}
  res.json({code:'success'});
};

module.exports.resetPassword = async (req, res) => {
  res.render("admin/pages/reset-password", {
    pageTitle: "Đổi mật khẩu"
  })
}

module.exports.resetPasswordPost=async(req,res)=>{
  const hashedPassword=await bcrypt.hash(req.body.password,10);
  const result=await AccountAdmin.updateOne({_id:req.account.id,deleted:false,status:'active',...(req.resetOnly?{password:req.account.password}:{})},{$set:{password:hashedPassword}});
  if(!result.matchedCount)return res.status(403).json({code:'error'});
  res.clearCookie('resetToken');if(req.resetOnly)res.clearCookie('token');
  res.json({code:'success',requiresLogin:!!req.resetOnly});
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
cardSchemas.reset=Joi.object({password:Joi.string().min(8).max(72).pattern(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&]).+$/).required()}).required().unknown(false);
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
  if(!account||!await Card.exists({ownerId:account.id,cardType:'staff',status:'active',isCurrent:true}))throw new Error();
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
    const current=await adminToken.resolve({id:ctx.account.id,email:ctx.account.email,cardId:result.card.cardId});
    if(!current)return res.status(403).json({code:'error',errorCode:'OP_FORBIDDEN'});
    adminToken.issue(res,{account:current.account,cardId:result.card.cardId,stepUpAt:Date.now(),remember:ctx.remember});res.clearCookie('preToken');res.json({code:'success'});
  }catch{res.status(500).json({code:'error',errorCode:'INTERNAL'});}
};
