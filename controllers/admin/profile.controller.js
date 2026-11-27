const AccountAdmin = require('../../models/account-admin.model');
const bcrypt = require('bcryptjs');
const Joi = require('joi');
const adminToken = require('../../helpers/admin-token.helper');
const { newPassword } = require('../../validates/admin/credential-fields');
const { parseImageChanges, applyImageChange } = require('../../helpers/image-change.helper');
const { discardNewFormImages, writeWithFormImages } = require('../../middlewares/admin/image-upload.middleware');

const personalFields = Joi.object({
  fullName: Joi.string().trim().min(1).max(100),
  email: Joi.string().trim().email({ tlds: { allow: false } }).max(254),
  phone: Joi.string().trim().max(25).pattern(/^\+?[0-9 .()-]+$/).custom((value, helpers) =>
    value.replace(/\D/g, '').length >= 7 ? value : helpers.error('string.pattern.base')),
  imageChanges: Joi.string().max(16000),
  avatar: Joi.valid('', 'null', null).strip()
}).required().unknown(false);

const passwordFields = Joi.object({
  currentPassword: Joi.string().max(256).required(),
  password: newPassword.required(),
  confirmPassword: Joi.valid(Joi.ref('password')).required()
}).required().unknown(false);

const flashFailure = (res, status, message) => res.status(status).json({ code: 'error', message });

module.exports.edit = (req, res) => res.render('admin/pages/profile-edit', { pageTitle: 'Thông tin cá nhân' });

module.exports.editPatch = async (req, res) => {
  const reject = async (status, message) => {
    await discardNewFormImages(req);
    return flashFailure(res, status, message);
  };
  const { value, error } = personalFields.validate(req.body || {});
  if (error) return reject(400, 'Thông tin cá nhân không hợp lệ.');

  const { id, email } = req.account;
  if (value.email !== undefined && value.email !== email) {
    return reject(400, 'Email đăng nhập chỉ được thay đổi qua quy trình quản trị tài khoản.');
  }
  const { email: _email, imageChanges, ...fields } = value;
  const changes = parseImageChanges(imageChanges, ['avatar']);
  if (!changes) return reject(400, 'Yêu cầu cập nhật ảnh không hợp lệ.');
  const update = { ...fields, updatedBy: id };
  const filter = { _id: id, deleted: false, status: 'active' };
  if (!applyImageChange({ name: 'avatar', changes, file: req.file, current: req.account, filter, update })) {
    return reject(409, 'Ảnh đã thay đổi hoặc có thao tác xóa và thay cùng lúc. Vui lòng tải lại trang.');
  }
  const result = await writeWithFormImages(req, () => AccountAdmin.updateOne(
    filter, { $set: update }, { runValidators: true }
  ));
  if (!result.matchedCount) return Object.hasOwn(filter, 'avatar')
    ? reject(409, 'Ảnh đã thay đổi. Vui lòng tải lại trang.')
    : reject(404, 'Không tìm thấy tài khoản.');

  req.flash('success', 'Cập nhật thông tin thành công!');
  return res.json({ code: 'success' });
};

module.exports.changePassword = (req, res) => res.render('admin/pages/profile-change-password', { pageTitle: 'Đổi mật khẩu' });

module.exports.changePasswordPatch = async (req, res) => {
  const { value, error } = passwordFields.validate(req.body, { convert: false });
  if (error) {
    return flashFailure(res, 400, 'Vui lòng kiểm tra mật khẩu hiện tại, mật khẩu mới và xác nhận.');
  }
  const { id, password: hash } = req.account;
  if (typeof hash !== 'string' || !await bcrypt.compare(value.currentPassword, hash)) {
    return flashFailure(res, 403, 'Mật khẩu hiện tại không đúng.');
  }

  const password = await bcrypt.hash(value.password, 10);
  const result = await AccountAdmin.updateOne(
    { _id: id, deleted: false, status: 'active', password: hash, sessionVersion: adminToken.versionFilter(req.account) },
    { $set: { password, updatedBy: id }, $inc: { sessionVersion: 1 } }
  );
  if (!result.matchedCount) return flashFailure(res, 409, 'Tài khoản vừa thay đổi. Vui lòng đăng nhập lại.');

  adminToken.clear(res);
  req.flash('success', 'Đổi mật khẩu thành công!');
  return res.json({ code: 'success', requiresLogin: true });
};
