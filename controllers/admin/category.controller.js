const moment = require("moment");
const slugify = require("slugify");
const Category = require("../../models/category.model");
const AccountAdmin = require("../../models/account-admin.model");
const Tour = require("../../models/tour.model");
const { uploadCategoryAvatar } = require("../../helpers/cloudinary.helper");
const {
  buildCategoryTree, isCategoryId, liveCategory, validateParent, withCategoryWrite
} = require("../../helpers/category.helper");

const statuses = ["active", "inactive"];
const existingCategoryMessage = "Danh mục đã bị xóa hoặc không tồn tại!";
const permissionMessage = "Không có quyền sử dụng tính năng này!";
const respondError = (res, status, message) => res.status(status).json({ code: "error", message });
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function listFilters({ status, createdBy, startDate, endDate, keyword }) {
  const filter = { ...liveCategory };
  if (status !== undefined && status !== "") {
    if (!statuses.includes(status)) return { error: "Bộ lọc trạng thái không hợp lệ!" };
    filter.status = status;
  }
  if (createdBy !== undefined && createdBy !== "") {
    if (!isCategoryId(createdBy)) return { error: "Bộ lọc người tạo không hợp lệ!" };
    filter.createdBy = createdBy.toLowerCase();
  }

  const dateFilter = {};
  for (const [value, bound, day] of [[startDate, "$gte", "startOf"], [endDate, "$lte", "endOf"]]) {
    if (value === undefined || value === "") continue;
    const date = typeof value === "string" && moment(value, "YYYY-MM-DD", true);
    if (!date || !date.isValid()) return { error: "Ngày lọc danh mục không hợp lệ!" };
    dateFilter[bound] = date[day]("day").toDate();
  }
  if (dateFilter.$gte && dateFilter.$lte && dateFilter.$gte > dateFilter.$lte) {
    return { error: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc!" };
  }
  if (Object.keys(dateFilter).length) filter.createdAt = dateFilter;

  if (keyword !== undefined) {
    if (typeof keyword !== "string") return { error: "Từ khóa tìm kiếm không hợp lệ!" };
    const text = keyword.trim();
    if (text) {
      const slug = slugify(text, { lower: true, locale: "vi" });
      filter.$or = [{ name: new RegExp(escapeRegex(text), "i") }];
      if (slug) filter.$or.push({ slug: new RegExp(escapeRegex(slug), "i") });
    }
  }
  return { filter };
}

module.exports.list = async (req, res) => {
  const { filter, error } = listFilters(req.query);
  const accountAdminList = await AccountAdmin.find({}).select("fullName");
  const limit = 5;
  const totalRecord = error ? 0 : await Category.countDocuments(filter);
  const totalPage = Math.ceil(totalRecord / limit);
  const requestedPage = typeof req.query.page === "string" && /^\d+$/.test(req.query.page)
    ? Number(req.query.page)
    : 1;
  const page = Math.max(1, Math.min(requestedPage, totalPage));
  const skip = (page - 1) * limit;
  const categoryList = totalRecord
    ? await Category.find(filter).sort({ position: -1, _id: -1 }).skip(skip).limit(limit)
    : [];

  const adminNames = new Map(accountAdminList.map(item => [item.id, item.fullName]));
  for (const item of categoryList) {
    item.createdByFullName = adminNames.get(item.createdBy?.toLowerCase());
    item.updatedByFullName = adminNames.get(item.updatedBy?.toLowerCase());
    item.createdAtFormat = item.createdAt && moment(item.createdAt).format("HH:mm - DD/MM/YYYY");
    item.updatedAtFormat = item.updatedAt && moment(item.updatedAt).format("HH:mm - DD/MM/YYYY");
  }

  res.status(error ? 400 : 200).render("admin/pages/category-list", {
    pageTitle: "Quản lý danh mục",
    categoryList,
    accountAdminList,
    listError: error,
    pagination: { page, skip, totalRecord, totalPage }
  });
};

module.exports.create = async (req, res) => {
  const categories = await Category.find(liveCategory);
  res.render("admin/pages/category-create", {
    pageTitle: "Tạo danh mục",
    categoryList: buildCategoryTree(categories)
  });
};

module.exports.edit = async (req, res) => {
  const id = req.params.id;
  const categoryDetail = isCategoryId(id) && await Category.findOne({ _id: id, ...liveCategory });
  if (!categoryDetail) {
    return res.status(404).render("admin/pages/error-404", { pageTitle: "Danh mục không tồn tại" });
  }
  const candidates = await Category.find({ _id: { $ne: categoryDetail.id }, ...liveCategory });
  res.render("admin/pages/category-edit", {
    pageTitle: "Chỉnh sửa danh mục",
    categoryList: buildCategoryTree(candidates),
    categoryDetail,
    selectedParent: categoryDetail.parent?.toLowerCase()
  });
};

function saveCategory(editing) {
  return (req, res) => withCategoryWrite(async () => {
    const id = editing ? req.params.id.toLowerCase() : null;
    if (editing && !await Category.exists({ _id: id, ...liveCategory })) {
      return respondError(res, 404, existingCategoryMessage);
    }
    const data = { ...req.categoryInput, updatedBy: req.account.id };
    const parentError = await validateParent(data.parent, id);
    if (parentError) return respondError(res, 400, parentError);
    if (data.position === "") data.position = await Category.countDocuments({}) + 1;

    if (req.file) {
      try {
        data.avatar = await uploadCategoryAvatar(req.file.buffer);
      } catch (error) {
        return respondError(res, 502, "Không thể tải ảnh đại diện lên. Vui lòng thử lại!");
      }
    }

    if (editing) {
      const result = await Category.updateOne({ _id: id, ...liveCategory }, { $set: data });
      if (!result.matchedCount) return respondError(res, 404, existingCategoryMessage);
    } else {
      await Category.create({ ...data, createdBy: req.account.id, avatar: data.avatar || "" });
    }
    req.flash("success", editing ? "Cập nhật danh mục thành công!" : "Tạo danh mục thành công!");
    return res.json({ code: "success" });
  });
}

module.exports.createPost = saveCategory(false);
module.exports.editPatch = saveCategory(true);

function changeCategories(req, res, option, ids) {
  return withCategoryWrite(async () => {
    const filter = { _id: { $in: ids }, ...liveCategory };
    if (await Category.countDocuments(filter) !== ids.length) {
      return respondError(res, 404, existingCategoryMessage);
    }

    let changes;
    let success;
    if (option === "delete") {
      const child = await Category.exists({ parent: { $in: ids }, ...liveCategory })
        .collation({ locale: "en", strength: 2 });
      if (child) {
        return respondError(res, 409, "Không thể xóa danh mục khi còn danh mục con chưa xóa. Vui lòng xử lý danh mục con trước!");
      }
      const tour = await Tour.exists({ category: { $in: ids }, ...liveCategory })
        .collation({ locale: "en", strength: 2 });
      if (tour) {
        return respondError(res, 409, "Không thể xóa danh mục khi còn tour chưa xóa. Vui lòng chuyển tour sang danh mục khác hoặc xử lý tour trước!");
      }
      changes = { deleted: true, deletedBy: req.account.id, deletedAt: new Date() };
      success = "Xóa danh mục thành công!";
    } else {
      changes = { status: option, updatedBy: req.account.id };
      success = "Đổi trạng thái thành công!";
    }
    await Category.updateMany(filter, { $set: changes });
    req.flash("success", success);
    return res.json({ code: "success" });
  });
}

module.exports.deletePatch = (req, res) => changeCategories(req, res, "delete", [req.params.id.toLowerCase()]);

module.exports.changeMultiPatch = (req, res) => {
  const { option, ids } = req.body || {};
  if (option !== "delete" && !statuses.includes(option)) {
    return respondError(res, 400, "Hành động hàng loạt không hợp lệ!");
  }
  const permission = option === "delete" ? "category-delete" : "category-edit";
  if (!req.permissions.includes(permission)) return respondError(res, 403, permissionMessage);
  if (!Array.isArray(ids) || !ids.length || !ids.every(isCategoryId)) {
    return respondError(res, 400, "Vui lòng chọn danh mục hợp lệ để thực hiện!");
  }
  return changeCategories(req, res, option, [...new Set(ids.map(id => id.toLowerCase()))]);
};
