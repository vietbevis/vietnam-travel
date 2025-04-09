const AccountAdmin = require("../../models/account-admin.model")
const ForgotPassword = require("../../models/forgot-password.model")
const bcrypt = require("bcryptjs")
const jwt = require('jsonwebtoken')

const generateHelper = require("../../helpers/generate.helper");
const mailHelper = require("../../helpers/mail.helper");

module.exports.login = async (req, res) => {
  res.render("admin/pages/login", {
    pageTitle: "Đăng nhập"
  })
}

module.exports.loginPost = async (req, res) => {
  const { email, password, rememberPassword } = req.body;

  const existAccount = await AccountAdmin.findOne({
    email: email
  });

  if(!existAccount) {
    res.json({
      code: "error",
      message: "Email không tồn tại trong hệ thống!"
    });
    return;
  }

  const isPasswordValid = await bcrypt.compare(password, existAccount.password);
  if(!isPasswordValid) {
    res.json({
      code: "error",
      message: "Mật khẩu không đúng!"
    });
    return;
  }

  if(existAccount.status != "active") {
    res.json({
      code: "error",
      message: "Tài khoản chưa được kích hoạt!"
    });
    return;
  }

  // Tạo JWT
  const token = jwt.sign(
    {
      id: existAccount.id,
      email: existAccount.email
    },
    process.env.JWT_SECRET,
    {
      expiresIn: rememberPassword ? '30d' : '1d' // Token có thời hạn 30 ngày hoặc 1 ngày
    }
  )

  // Lưu token vào cookie
  res.cookie("token", token, {
    maxAge: rememberPassword ? (30 * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000), // Token có hiệu lực trong 30 ngày hoặc 1 ngày
    httpOnly: true,
    sameSite: "strict"
  })

  res.json({
    code: "success",
    message: "Đăng nhập tài khoản thành công!"
  });
}

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
    email: email
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

module.exports.otpPasswordPost = async (req, res) => {
  const { otp, email } = req.body;

  // Kiểm tra có tồn tại bản ghi trong ForgotPassword
  const existRecord = await ForgotPassword.findOne({
    otp: otp,
    email: email
  })

  if(!existRecord) {
    res.json({
      code: "error",
      message: "Mã OTP không chính xác!"
    })
    return;
  }

  // Tìm thông tin của người dùng trong AccountAdmin
  const account = await AccountAdmin.findOne({
    email: email
  })

  // Tạo JWT
  const token = jwt.sign(
    {
      id: account.id,
      email: account.email
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '1d' // Token có thời hạn 1 ngày
    }
  )

  // Lưu token vào cookie
  res.cookie("token", token, {
    maxAge: 24 * 60 * 60 * 1000, // Token có hiệu lực trong 1 ngày
    httpOnly: true,
    sameSite: "strict"
  })

  res.json({
    code: "success",
    message: "Xác thực OTP thành công!"
  })
}

module.exports.resetPassword = async (req, res) => {
  res.render("admin/pages/reset-password", {
    pageTitle: "Đổi mật khẩu"
  })
}

module.exports.logoutPost = async (req, res) => {
  res.clearCookie("token");
  res.json({
    code: "success",
    message: "Đăng xuất thành công!"
  })
}