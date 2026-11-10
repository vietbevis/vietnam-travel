const nodemailer = require('nodemailer');

module.exports.sendMail = (email, subject, content) => {
  // Create a transporter object
  const secure = process.env.EMAIL_SECURE == "true";

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: secure, // false: http, true: https
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    }
  });

  // Configure the mailoptions object
  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: email,
    subject: subject,
    html: content
  };

  // Trả kết quả an toàn cho caller cũ lẫn mới, không ghi nội dung mail hoặc lỗi SMTP chứa dữ liệu riêng.
  return transporter.sendMail(mailOptions).then(() => ({sent:true}), () => ({sent:false}));
}
