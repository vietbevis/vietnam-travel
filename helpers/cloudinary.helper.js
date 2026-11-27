const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { randomUUID } = require('node:crypto');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

module.exports.storage = new CloudinaryStorage({
  cloudinary: cloudinary,
});

module.exports.uploadPhoto = bytes => cloudinary.uploader.upload('data:image/jpeg;base64,' + bytes.toString('base64'), {resource_type:'image',folder:'travel-cards'});

const uploadImage = (bytes, options = {}) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
    timeout: 15000,
    ...options
  }, (error, result) => {
    if (error || !result?.secure_url) return reject(error || new Error("Cloudinary không trả về URL ảnh"));
    resolve(result);
  });
  stream.on("error", reject);
  stream.end(bytes);
});

async function uploadManagedImage(bytes, folder) {
  const publicId = folder + '/' + randomUUID();
  try {
    const image = await uploadImage(bytes, { public_id: publicId, overwrite: false });
    if (image.public_id !== publicId || image.existing || image.resource_type !== 'image') {
      throw new Error('Cloudinary không xác nhận quyền sở hữu ảnh mới.');
    }
    return { url: image.secure_url, publicId };
  } catch (error) {
    console.error('Ảnh tải lên chưa có xác nhận từ nhà cung cấp.', publicId);
    throw error;
  }
}

module.exports.uploadTourImage = bytes => uploadManagedImage(bytes, 'travel-tour-uploads');
module.exports.uploadFormImage = bytes => uploadManagedImage(bytes, 'travel-form-uploads');

async function removeManagedImage(publicId, folder) {
  const [prefix, uuid, remainder] = String(publicId).split('/');
  if (prefix !== folder || remainder !== undefined ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(uuid)) {
    throw new Error('Mã ảnh mới không hợp lệ.');
  }
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image', timeout: 15000 });
  if (!['ok', 'not found'].includes(result?.result)) throw new Error('Cloudinary không xác nhận xóa ảnh mới.');
}

module.exports.removeNewTourImage = publicId => removeManagedImage(publicId, 'travel-tour-uploads');
module.exports.removeNewFormImage = publicId => removeManagedImage(publicId, 'travel-form-uploads');
