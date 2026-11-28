const { Types } = require("mongoose");
const Category = require("../../models/category.model");
const Tour = require("../../models/tour.model");
const { storeFormImage, discardNewFormImages, writeWithFormImages } = require("../../middlewares/admin/image-upload.middleware");
const { statuses, listPage, listActors, vietnamDate, selectedIds } = require("../../helpers/admin-list.helper");
const { sanitizeTourHtml } = require('../../helpers/tour-rich-text.helper');
const { parseImageChanges, applyImageChange } = require('../../helpers/image-change.helper');
const {
  buildCategoryTree, categoryReferences, isCategoryId, liveCategory, validateParent, withCategoryWrite
} = require("../../helpers/category.helper");

const existingCategoryMessage = "Danh mục đã bị xóa hoặc không tồn tại!";
const permissionMessage = "Không có quyền sử dụng tính năng này!";
const respondError = (res, status, message) => res.status(status).json({ code: "error", message });
function listCategories(trash) {
  return async (req, res) => {
    const actor = trash ? "deletedBy" : "createdBy";
    const where = trash ? { deleted: true } : liveCategory;
    const page = await listPage(Category, req.query, {
      where, enums: trash ? {} : { status: statuses }, idFields: [actor],
      dateField: trash ? "deletedAt" : "createdAt", sort: trash ? { deletedAt: -1, _id: -1 } : { position: -1, _id: -1 }
    });
    const categoryList = page.rows;
    const accountAdminList = await listActors(Category, where, categoryList, trash ? [actor] : [actor, "updatedBy"]);
    for (const item of categoryList) {
      item.createdAtFormat = vietnamDate(item.createdAt);
      item.updatedAtFormat = vietnamDate(item.updatedAt);
      item.deletedAtFormat = vietnamDate(item.deletedAt);
    }
    if (trash) {
      const parentIds = [...new Set(categoryList.map(item => item.parent).filter(isCategoryId))];
      const parents = await Category.find({ _id: { $in: parentIds } }).select("name");
      const parentNames = new Map(parents.map(item => [item.id, item.name]));
      for (const item of categoryList) item.parentName = parentNames.get(item.parent?.toLowerCase());
    }
    return res.status(page.listError ? 400 : 200).render(trash ? "admin/pages/category-trash" : "admin/pages/category-list", {
      ...page, pageTitle: trash ? "Thùng rác danh mục" : "Quản lý danh mục", categoryList, accountAdminList
    });
  };
}

module.exports.list = listCategories(false);
module.exports.trash = listCategories(true);

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
  categoryDetail.description = sanitizeTourHtml(categoryDetail.description);
  const candidates = await Category.find({ _id: { $ne: categoryDetail.id }, ...liveCategory });
  res.render("admin/pages/category-edit", {
    pageTitle: "Chỉnh sửa danh mục",
    categoryList: buildCategoryTree(candidates),
    categoryDetail,
    selectedParent: categoryDetail.parent?.toLowerCase()
  });
};

function saveCategory(editing) {
  return async (req, res) => {
    const id = editing ? req.params.id.toLowerCase() : null;
    const filter = { _id: id, ...liveCategory };
    const current = editing ? await Category.findOne(filter).select('avatar').lean() : null;
    if (editing && !current) {
      return respondError(res, 404, existingCategoryMessage);
    }
    const { imageChanges, ...fields } = req.categoryInput;
    const changes = parseImageChanges(imageChanges, editing ? ['avatar'] : []);
    if (!changes) return respondError(res, 400, 'Yêu cầu cập nhật ảnh không hợp lệ.');
    const data = { ...fields, updatedBy: req.account.id };
    if (data.description !== undefined) data.description = sanitizeTourHtml(data.description);
    const parentError = await validateParent(data.parent, id);
    if (parentError) return respondError(res, 400, parentError);

    if (editing && !applyImageChange({ name: 'avatar', changes, file: req.file, current, filter, update: data })) {
      return respondError(res, 409, 'Ảnh đã thay đổi hoặc có thao tác xóa và thay cùng lúc. Vui lòng tải lại trang.');
    }
    if (req.file) {
      try {
        data.avatar = await storeFormImage(req.file);
      } catch (error) {
        return respondError(res, 502, "Không thể tải ảnh đại diện lên. Vui lòng thử lại!");
      }
    }

    const refusal = await writeWithFormImages(req, () => withCategoryWrite(async session => {
      const invalidParent = await validateParent(data.parent, id, session);
      if (invalidParent) return [400, invalidParent];
      const position = data.position === "" ? await Category.countDocuments({}, { session }) + 1 : data.position;
      const fields = { ...data, position };
      if (editing) {
        const result = await Category.updateOne(filter, { $set: fields }, { session });
        if (!result.matchedCount) return Object.hasOwn(filter, "avatar")
          ? [409, "Ảnh đã thay đổi. Vui lòng tải lại trang."] : [404, existingCategoryMessage];
      } else {
        await Category.create([{ ...fields, createdBy: req.account.id, avatar: data.avatar || "" }], { session });
      }
    }));
    if (refusal) {
      await discardNewFormImages(req);
      return respondError(res, ...refusal);
    }
    req.flash("success", editing ? "Cập nhật danh mục thành công!" : "Tạo danh mục thành công!");
    return res.json({ code: "success" });
  };
}

module.exports.createPost = saveCategory(false);
module.exports.editPatch = saveCategory(true);

async function changeCategories(req, res, option, ids) {
  const refusal = await withCategoryWrite(async session => {
    const filter = { _id: { $in: ids }, ...liveCategory };
    if (await Category.countDocuments(filter, { session }) !== ids.length) {
      return [404, existingCategoryMessage];
    }

    let update;
    if (option === "delete") {
      const child = await Category.exists({ parent: { $in: ids }, ...liveCategory })
        .collation({ locale: "en", strength: 2 }).session(session);
      if (child) {
        return [409, "Không thể xóa danh mục khi còn danh mục con chưa xóa. Vui lòng xử lý danh mục con trước!"];
      }
      const tour = await Tour.exists({ category: { $in: ids }, ...liveCategory })
        .collation({ locale: "en", strength: 2 }).session(session);
      if (tour) {
        return [409, "Không thể xóa danh mục khi còn tour chưa xóa. Vui lòng chuyển tour sang danh mục khác hoặc xử lý tour trước!"];
      }
      update = [{ $set: { statusBeforeDelete: "$status", deleted: true, deletedBy: req.account.id, deletedAt: new Date() } }];
    } else {
      update = { $set: { status: option, updatedBy: req.account.id } };
    }
    const result = await Category.updateMany(filter, update, { session });
    if (result.matchedCount !== ids.length) throw new Error("Danh mục đã thay đổi trong lúc cập nhật.");
  });
  if (refusal) return respondError(res, ...refusal);
  req.flash("success", option === "delete" ? "Xóa danh mục thành công!" : "Đổi trạng thái thành công!");
  return res.json({ code: "success" });
}

module.exports.deletePatch = (req, res) => changeCategories(req, res, "delete", [req.params.id.toLowerCase()]);

module.exports.changeMultiPatch = (req, res) => {
  const { option, ids } = req.body || {};
  if (option !== "delete" && !statuses.includes(option)) {
    return respondError(res, 400, "Hành động hàng loạt không hợp lệ!");
  }
  const permission = option === "delete" ? "category-delete" : "category-edit";
  if (!req.permissions.includes(permission)) return respondError(res, 403, permissionMessage);
  const unique = Array.isArray(ids) && ids.length <= 100 && ids.every(isCategoryId)
    ? selectedIds([...new Set(ids.map(id => id.toLowerCase()))]) : null;
  if (!unique) {
    return respondError(res, 400, "Vui lòng chọn danh mục hợp lệ để thực hiện!");
  }
  return changeCategories(req, res, option, unique);
};

async function restoreCategories(ids) {
  return withCategoryWrite(async session => {
    const filter = { _id: { $in: ids }, deleted: true };
    const selected = await Category.find(filter).select("parent").session(session).lean();
    if (selected.length !== ids.length) return "Tất cả danh mục phải còn trong thùng rác.";
    const restoring = new Map(selected.map(item => [String(item._id), item]));
    for (const item of selected) {
      const error = await validateParent(item.parent, String(item._id), session, restoring);
      if (error) return error;
    }
    const result = await Category.updateMany(filter, [
      { $set: { deleted: false, status: { $cond: [{ $in: ["$statusBeforeDelete", statuses] }, "$statusBeforeDelete", "inactive"] } } },
      { $unset: ["statusBeforeDelete", "deletedAt", "deletedBy"] }
    ], { session });
    if (result.matchedCount !== ids.length) throw new Error("Danh mục đã thay đổi trong lúc khôi phục.");
  });
}

async function deleteCategoriesPermanently(ids) {
  return withCategoryWrite(async session => {
    const filter = { _id: { $in: ids }, deleted: true };
    if (await Category.countDocuments(filter, { session }) !== ids.length) {
      return "Tất cả danh mục phải còn trong thùng rác.";
    }
    // Đọc trực tiếp để kiểm cả liên kết String và ObjectId từ dữ liệu cũ.
    const references = [...categoryReferences(ids), ...ids.map(id => new Types.ObjectId(id))];
    const options = { session, projection: { _id: 1 } };
    if (await Category.collection.findOne({ parent: { $in: references } }, options)) {
      return "Không thể xóa vĩnh viễn khi còn danh mục con, kể cả danh mục con đã vào thùng rác. Hãy xóa danh mục con trước.";
    }
    if (await Tour.collection.findOne({ category: { $in: references } }, options)) {
      return "Không thể xóa vĩnh viễn khi còn tour tham chiếu, kể cả tour đã vào thùng rác.";
    }
    const result = await Category.deleteMany(filter, { session });
    if (result.deletedCount !== ids.length) throw new Error("Danh mục đã thay đổi trong lúc xóa vĩnh viễn.");
  });
}

async function updateTrash(req, res, values, option) {
  if (!["undo", "delete-destroy"].includes(option)) {
    return respondError(res, 400, "Thao tác danh mục không hợp lệ.");
  }
  const restore = option === "undo";
  const permission = restore ? "category-edit" : "category-delete";
  if (!req.permissions.includes(permission)) return respondError(res, 403, permissionMessage);
  const ids = selectedIds(values);
  if (!ids) return respondError(res, 400, "Danh sách danh mục không hợp lệ.");
  const refusal = await (restore ? restoreCategories(ids) : deleteCategoriesPermanently(ids));
  if (refusal) return respondError(res, 409, refusal);
  req.flash("success", restore ? "Đã khôi phục danh mục." : "Đã xóa vĩnh viễn danh mục.");
  return res.json({ code: "success", count: ids.length });
}

module.exports.undoPatch = (req, res) => updateTrash(req, res, [req.params.id], "undo");
module.exports.deleteDestroyPatch = (req, res) => updateTrash(req, res, [req.params.id], "delete-destroy");
module.exports.trashChangeMultiPatch = (req, res) => updateTrash(req, res, req.body?.ids, req.body?.option);
