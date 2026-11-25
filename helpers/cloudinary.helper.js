const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

module.exports.storage = new CloudinaryStorage({
  cloudinary: cloudinary,
});

module.exports.uploadPhoto = bytes => cloudinary.uploader.upload('data:image/jpeg;base64,' + bytes.toString('base64'), {resource_type:'image',folder:'travel-cards'});

module.exports.uploadCategoryAvatar = bytes => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
    timeout: 15000
  }, (error, result) => {
    if (error || !result?.secure_url) return reject(error || new Error("Cloudinary không trả về URL ảnh"));
    resolve(result.secure_url);
  });
  stream.on("error", reject);
  stream.end(bytes);
});
