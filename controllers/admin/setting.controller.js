const SettingWebsiteInfo = require("../../models/setting-website-info.model")
const Role = require("../../models/role.model");
const AccountAdmin = require("../../models/account-admin.model");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Joi = require("joi");
const { isCategoryId: isId } = require("../../helpers/category.helper");
const { loginEmail, newPassword } = require("../../validates/admin/credential-fields");
const { parseImageChanges, applyImageChange } = require("../../helpers/image-change.helper");
const { discardNewFormImages, writeWithFormImages } = require("../../middlewares/admin/image-upload.middleware");

const permissionConfig = require("../../config/permission");
const hasPermission = permissionConfig.hasPermission;
const permissionKeys = permissionConfig.permissionList.map(item => item.value);
const isManager = permissions => hasPermission(permissions, "role-edit") && hasPermission(permissions, "account-admin-edit");
const canDelegate = (actor, values) => values.every(value => hasPermission(actor, value)) &&
  permissionConfig.effectivePermissions(values).every(value => hasPermission(actor, value));
const canManageRole = (actor, values = []) => canDelegate(actor, values) && (!isManager(values) || isManager(actor));
const roleRef = id => new RegExp("^" + id + "$", "i");
const emailRef = email => new RegExp("^" + email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
const reject = (res, message) => res.json({ code: "error", message });

async function transaction(work) {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => work(session)); }
  finally { await session.endSession(); }
}

async function canRemoveManagers(session, affected) {
  const roles = await Role.find({ deleted: false }).select("permissions").session(session).lean();
  const managerRoles = roles.filter(role => isManager(role.permissions)).map(role => roleRef(String(role._id)));
  const filter = { role: { $in: managerRoles }, status: "active", deleted: false };
  const rows = await AccountAdmin.find(filter).select("_id email password").session(session).lean();
  const managers = rows.filter(account => !loginEmail.required().validate(account.email).error &&
    /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(account.password || ""));
  if (!managers.some(row => !affected.has(String(row._id)))) return false;
  // Losing two different accounts concurrently must contend on the same manager set.
  await AccountAdmin.updateMany({ ...filter, _id: { $in: managers.map(row => row._id) } }, { $inc: { __v: 1 } }, { session });
  return true;
}

const websiteFields = Joi.object({
  websiteName: Joi.string().trim().max(150).allow(''),
  email: Joi.string().trim().email({ tlds: { allow: false } }).max(254).allow(''),
  phone: Joi.string().trim().max(30).allow(''),
  address: Joi.string().trim().max(300).allow(''),
  imageChanges: Joi.string().max(16000),
  logo: Joi.valid('', 'null', null).strip(),
  favicon: Joi.valid('', 'null', null).strip()
}).unknown(false);

module.exports.list = async (req, res) => {
  res.render("admin/pages/setting-list", {
    pageTitle: "Cài đặt chung"
  })
}

module.exports.websiteInfo = async (req, res) => {
  const settingWebsiteInfo = await SettingWebsiteInfo.findOne({}) || {};

  res.render("admin/pages/setting-website-info", {
    pageTitle: "Thông tin website",
    settingWebsiteInfo: settingWebsiteInfo
  })
}

module.exports.websiteInfoPatch = async (req, res) => {
  const rejectImage = async (status, message) => {
    await discardNewFormImages(req);
    return res.status(status).json({ code: 'error', message });
  };
  const { value, error } = websiteFields.validate(req.body || {});
  if (error) return rejectImage(200, "Thông tin website không hợp lệ.");
  const settingWebsiteInfo = await writeWithFormImages(req, () => SettingWebsiteInfo.findOne({}));
  const { imageChanges, ...update } = value;
  const changes = parseImageChanges(imageChanges, ['logo', 'favicon']);
  if (!changes) return rejectImage(400, 'Yêu cầu cập nhật ảnh không hợp lệ.');
  const filter = { _id: settingWebsiteInfo?.id };
  const conflict = () => rejectImage(409, 'Ảnh đã thay đổi. Vui lòng tải lại trang.');
  for (const name of ['logo', 'favicon']) {
    if (!applyImageChange({ name, changes, file: req.files?.[name]?.[0], current: settingWebsiteInfo, filter, update })) {
      return conflict();
    }
  }
  if(settingWebsiteInfo) {
    const result = await writeWithFormImages(req, () => SettingWebsiteInfo.updateOne(filter, { $set: update }));
    if (!result.matchedCount) return conflict();
  } else {
    const newRecord = new SettingWebsiteInfo(update);
    await writeWithFormImages(req, () => newRecord.save());
  }

  req.flash("success", "Cập nhật thành công!")

  res.json({
    code: "success"
  })
}

module.exports.accountAdminList = async (req, res) => {
  const { paginate } = require("../../helpers/admin-pagination.helper");
  const filter = { deleted: false };
  const pagination = paginate(req.query, await AccountAdmin.countDocuments(filter));
  const accountAdminList = await AccountAdmin
    .find(filter).sort({ createdAt: "desc", _id: "desc" }).skip(pagination.skip).limit(pagination.limit);

  for(const item of accountAdminList) {
    if(item.role) {
      const roleInfo = await Role.findOne({
        _id: item.role
      });

      if(roleInfo) {
        item.roleName = roleInfo.name;
      }
    }
  }

  res.render("admin/pages/setting-account-admin-list", {
    pageTitle: "Tài khoản quản trị",
    accountAdminList, pagination
  })
}

module.exports.accountAdminCreate = async (req, res) => {
  const roleList = await Role.find({
    deleted: false
  })

  res.render("admin/pages/setting-account-admin-create", {
    pageTitle: "Tạo tài khoản quản trị",
    roleList: roleList.filter(role => canManageRole(req.permissions, role.permissions))
  })
}

// Chỉ nhận đúng các trường form tài khoản gửi lên (dạng chuỗi).
// cardRequired, deleted, createdBy... do server quản lý, không bao giờ lấy từ body.
const ACCOUNT_FORM_FIELDS = ["fullName", "email", "phone", "role", "positionCompany", "status", "password"];
const accountFormData = (body) => {
  const data = {};
  for (const key of ACCOUNT_FORM_FIELDS) {
    if (body?.[key] === undefined) continue;
    if (typeof body[key] !== "string") return null;
    data[key] = body[key];
  }
  if (isId(data.role)) data.role = data.role.toLowerCase();
  if (data.email !== undefined) {
    const checked = loginEmail.validate(data.email);
    if (checked.error) return null;
    data.email = checked.value;
  }
  if (data.password && newPassword.validate(data.password, { convert: false }).error) return null;
  return data;
}

const validStatus = status => status === undefined || ["initial", "active", "inactive"].includes(status);
const canUseRole = async (id, permissions, session) => {
  if (!isId(id)) return false;
  const row = await Role.findOne({ _id: id, deleted: false }).select("permissions").session(session || null).lean();
  return !!row && canManageRole(permissions, row.permissions);
};

module.exports.accountAdminCreatePost = async (req, res) => {
  const data = accountFormData(req.body);

  if(!data?.email || !data.password || !validStatus(data.status) ||
      !await writeWithFormImages(req, () => canUseRole(data.role, req.permissions || []))) {
    await discardNewFormImages(req);
    res.json({
      code: "error",
      message: "Dữ liệu tài khoản không hợp lệ!"
    })
    return;
  }

  const existAccount = await writeWithFormImages(req, () => AccountAdmin.findOne({
    email: emailRef(data.email)
  }));

  if(existAccount) {
    await discardNewFormImages(req);
    res.json({
      code: "error",
      message: "Email đã tồn tại trong hệ thống!"
    })
    return;
  }

  data.createdBy = req.account.id;
  data.updatedBy = req.account.id;
  data.avatar = req.file ? req.file.path : "";

  // Mã hóa mật khẩu với bcrypt
  const salt = await bcrypt.genSalt(10); // Tạo ra chuỗi ngẫu nhiên có 10 ký tự
  data.password = await bcrypt.hash(data.password, salt);

  const newAccount = new AccountAdmin(data);
  await writeWithFormImages(req, () => newAccount.save());

  req.flash("success", "Tạo tài khoản quản trị thành công!");

  res.json({
    code: "success"
  })
}

module.exports.accountAdminEdit = async (req, res) => {
  try {
    const roleList = await Role.find({
      deleted: false
    })
  
    const id = req.params.id;
    const accountAdminDetail = await AccountAdmin.findOne({
      _id: id,
      deleted: false
    })
  
    if(!accountAdminDetail) {
      res.redirect(`/${pathAdmin}/setting/account-admin/list`);
      return;
    }
  
    const currentRole = roleList.find(role => role.id === accountAdminDetail.role?.toLowerCase());
    const subjectEditable = canManageRole(req.permissions, currentRole?.permissions);
    const isOwnAccount = String(req.account.id) === accountAdminDetail.id;
    res.render("admin/pages/setting-account-admin-edit", {
      pageTitle: "Chỉnh sửa tài khoản quản trị",
      roleList: roleList.filter(role => role === currentRole || canManageRole(req.permissions, role.permissions)),
      accountAdminDetail, subjectEditable, isOwnAccount
    })
  } catch (error) {
    res.redirect(`/${pathAdmin}/setting/account-admin/list`);
  }
}

module.exports.accountAdminEditPatch = async (req, res) => {
  const id = req.params.id;
  const actor = req.permissions || [];
  const data = accountFormData(req.body);
  if (!isId(id) || !data || !validStatus(data.status)) {
    await discardNewFormImages(req);
    return reject(res, "Dữ liệu tài khoản không hợp lệ.");
  }
  const images = parseImageChanges(req.body?.imageChanges, ['avatar']);
  if (!images) {
    await discardNewFormImages(req);
    return res.status(400).json({ code: 'error', message: 'Yêu cầu cập nhật ảnh không hợp lệ.' });
  }
  data.updatedBy = req.account.id;
  if (data.password) data.password = await bcrypt.hash(data.password, 10);
  else delete data.password;
  const message = await writeWithFormImages(req, () => transaction(async session => {
    const target = await AccountAdmin.findOne({ _id: id, deleted: false }).session(session);
    if (!target) return "Không tìm thấy tài khoản.";
    const roleChanged = data.role !== undefined && data.role !== target.role?.toLowerCase();
    const statusChanged = data.status !== undefined && data.status !== target.status;
    const emailChanged = data.email !== undefined && data.email !== target.email;
    if (String(target._id) === String(req.account.id) && (roleChanged || statusChanged || emailChanged || data.password)) {
      return "Không được tự đổi nhóm quyền, trạng thái, email đăng nhập hoặc đặt lại mật khẩu tại đây.";
    }
    const before = isId(target.role) ? await Role.findOne({ _id: target.role, deleted: false }).session(session).lean() : null;
    if (!canDelegate(actor, before?.permissions || []) || (isManager(before?.permissions) && !isManager(actor))) {
      return "Nhóm quyền hiện tại của tài khoản vượt phạm vi được quản lý.";
    }
    if (data.role !== undefined && !await canUseRole(data.role, actor, session)) return "Nhóm quyền không hợp lệ.";
    if (emailChanged && await AccountAdmin.exists({ _id: { $ne: id }, email: emailRef(data.email) }).session(session)) {
      return "Email đã tồn tại trong hệ thống!";
    }
    if (statusChanged && data.status === "active" &&
        (!isId(data.role ?? target.role) || loginEmail.required().validate(data.email ?? target.email).error ||
          (!data.password && typeof target.password !== "string"))) return "Tài khoản chưa đủ dữ liệu để kích hoạt.";
    const next = roleChanged ? await Role.findById(data.role).session(session).lean() : before;
    if (target.status === "active" && isManager(before?.permissions) &&
        ((statusChanged && data.status !== "active") || !isManager(next?.permissions)) &&
        !await canRemoveManagers(session, new Set([id.toLowerCase()]))) {
      return "Phải giữ ít nhất một quản trị viên có quyền quản lý hệ thống.";
    }
    const filter = { _id: id, deleted: false };
    const update = { ...data };
    if (!applyImageChange({ name: 'avatar', changes: images, file: req.file, current: target, filter, update })) {
      return "Ảnh đã thay đổi hoặc có thao tác xóa và thay cùng lúc. Vui lòng tải lại trang.";
    }
    const change = { $set: update };
    if (roleChanged || statusChanged || data.password || emailChanged) {
      change.$inc = { sessionVersion: 1 };
    }
    const result = await AccountAdmin.updateOne(filter, change, { session });
    if (!result.matchedCount) return "Ảnh hoặc tài khoản đã thay đổi. Vui lòng tải lại trang.";
  }));
  if (message) {
    await discardNewFormImages(req);
    return reject(res, message);
  }
  req.flash("success", "Cập nhật tài khoản quản trị thành công!");
  return res.json({ code: "success" });
}

module.exports.roleList = async (req, res) => {
  const { paginate } = require("../../helpers/admin-pagination.helper");
  const filter = { deleted: false };
  const pagination = paginate(req.query, await Role.countDocuments(filter));
  const roleList = await Role.find(filter).sort({ _id: 1 }).skip(pagination.skip).limit(pagination.limit);

  res.render("admin/pages/setting-role-list", {
    pageTitle: "Nhóm quyền",
    roleList, pagination
  })
}

module.exports.roleCreate = async (req, res) => {
  res.render("admin/pages/setting-role-create", {
    pageTitle: "Tạo nhóm quyền",
    permissionList: permissionConfig.permissionList,
    grantable: permissionConfig.effectivePermissions(req.permissions)
  })
}

const roleFields = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().trim().max(500).allow(''),
  permissions: Joi.array().items(Joi.string().valid(...permissionKeys)).unique().max(permissionKeys.length).required()
}).required().unknown(false);

module.exports.roleCreatePost = async (req, res) => {
  const { value, error } = roleFields.validate(req.body);
  if (error || !canDelegate(req.permissions, value.permissions) ||
      (isManager(value.permissions) && !isManager(req.permissions))) return reject(res, "Nhóm quyền không hợp lệ.");
  const newRecord = new Role({ ...value, createdBy: req.account.id, updatedBy: req.account.id });
  await newRecord.save();

  req.flash("success", "Tạo nhóm quyền thành công!");

  res.json({
    code: "success"
  })
}

module.exports.roleEdit = async (req, res) => {
  try {
    const id = req.params.id;

    const roleDetail = await Role.findOne({
      _id: id,
      deleted: false
    })

    if(roleDetail) {
      const isOwnRole = roleDetail.id === req.account.role?.toLowerCase();
      res.render("admin/pages/setting-role-edit", {
        pageTitle: "Chỉnh sửa nhóm quyền",
        permissionList: permissionConfig.permissionList,
        roleDetail,
        grantable: permissionConfig.effectivePermissions(req.permissions),
        editable: canManageRole(req.permissions, roleDetail.permissions),
        isOwnRole
      })
    } else {
      res.redirect(`/${pathAdmin}/setting/role/list`);
    }
  } catch (error) {
    res.redirect(`/${pathAdmin}/setting/role/list`);
  }
}

module.exports.roleEditPatch = async (req, res) => {
  const id = req.params.id?.toLowerCase();
  const actor = req.permissions || [];
  const { value, error } = roleFields.validate(req.body);
  if (!isId(id) || error || !canDelegate(actor, value.permissions) ||
      (isManager(value.permissions) && !isManager(actor))) return reject(res, "Nhóm quyền không hợp lệ.");
  const message = await transaction(async session => {
    const current = await Role.findOne({ _id: id, deleted: false }).session(session);
    if (!current || !canDelegate(actor, current.permissions) ||
        (isManager(current.permissions) && !isManager(actor))) return "Không thể sửa nhóm quyền này.";
    const changed = value.permissions.length !== current.permissions.length ||
      value.permissions.some(permission => !current.permissions.includes(permission));
    if (changed && id === req.account.role?.toLowerCase()) return "Không được tự đổi quyền của mình.";
    if (changed && isManager(current.permissions) && !isManager(value.permissions)) {
      const members = await AccountAdmin.find({ role: roleRef(id), status: "active", deleted: false }).select("_id").session(session).lean();
      if (members.length && !await canRemoveManagers(session, new Set(members.map(member => String(member._id))))) {
        return "Phải giữ ít nhất một quản trị viên có quyền quản lý hệ thống.";
      }
    }
    await Role.updateOne({ _id: id, deleted: false }, { $set: { ...value, updatedBy: req.account.id } }, { session });
    if (changed) await AccountAdmin.updateMany({ role: roleRef(id), deleted: false }, { $inc: { sessionVersion: 1 } }, { session });
  });
  if (message) return reject(res, message);
  req.flash("success", "Cập nhật nhóm quyền thành công!");
  return res.json({ code: "success" });
}
