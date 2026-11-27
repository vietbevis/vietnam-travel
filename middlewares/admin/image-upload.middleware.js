const multer = require('multer');
const cloud = require('../../helpers/cloudinary.helper');

const signatures = {
  'image/jpeg': bytes => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/png': bytes => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/gif': bytes => ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
  'image/webp': bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 11, fields: 32, fieldSize: 1024 * 1024 }
});

function imageMatchesType(file) {
  return Buffer.isBuffer(file.buffer) && Object.hasOwn(signatures, file.mimetype) && signatures[file.mimetype](file.buffer);
}

function requestImages(req) {
  return req.file ? [req.file] : Object.values(req.files || {}).flat();
}

async function storeFormImage(file) {
  const image = await cloud.uploadFormImage(file.buffer);
  file.path = image.url;
  file.newImagePublicId = image.publicId;
  return image.url;
}

async function discardNewFormImages(req) {
  await Promise.all(requestImages(req).filter(file => file.newImagePublicId).map(async file => {
    const publicId = file.newImagePublicId;
    delete file.newImagePublicId;
    try {
      await cloud.removeNewFormImage(publicId);
    } catch {
      console.error('Ảnh của yêu cầu bị từ chối đang chờ dọn.', publicId);
    }
  }));
}

async function writeWithFormImages(req, write) {
  try {
    return await write();
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000) await discardNewFormImages(req);
    else for (const file of requestImages(req)) {
      if (file.newImagePublicId) console.error('Chưa xác định được kết quả lưu ảnh.', file.newImagePublicId);
    }
    throw error;
  }
}

async function discardNewTourImages(req) {
  if (!req.newTourImages?.length) return;
  const images = req.newTourImages.splice(0);
  const results = await Promise.allSettled(images.map(publicId => cloud.removeNewTourImage(publicId)));
  if (results.some(result => result.status === 'rejected')) {
    console.error('Không thể dọn toàn bộ ảnh mới của yêu cầu tour đã bị từ chối.');
  }
}

async function storeImages(req, res, next, tourImages = false) {
  const files = requestImages(req);
  if (files.some(file => !imageMatchesType(file))) {
    return res.status(400).json({ code: 'error', message: 'Ảnh phải là tệp JPEG, PNG, GIF hoặc WebP hợp lệ.' });
  }
  try {
    if (tourImages) {
      req.newTourImages = [];
      for (const file of files) {
        const image = await cloud.uploadTourImage(file.buffer);
        file.path = image.url;
        req.newTourImages.push(image.publicId);
      }
    } else {
      for (const file of files) await storeFormImage(file);
    }
  } catch {
    await discardNewTourImages(req);
    await discardNewFormImages(req);
    return res.status(502).json({ code: 'error', message: 'Không thể tải ảnh lên. Thay đổi chưa được lưu, vui lòng thử lại.' });
  }
  return next();
}

const storeTourImages = (req, res, next) => storeImages(req, res, next, true);

module.exports = {
  upload, imageMatchesType, storeImages, storeTourImages, discardNewTourImages,
  storeFormImage, discardNewFormImages, writeWithFormImages
};
