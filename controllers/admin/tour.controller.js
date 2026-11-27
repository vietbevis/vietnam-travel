const moment = require("moment");
const mongoose = require("mongoose");
const { createHash } = require("node:crypto");
const Order = require("../../models/order.model");
const Category = require("../../models/category.model");
const City = require("../../models/city.model");
const Tour = require("../../models/tour.model");
const AccountAdmin = require("../../models/account-admin.model");

const categoryHelper = require("../../helpers/category.helper");
const { paginate } = require("../../helpers/admin-pagination.helper");
const { sanitizeTourHtml } = require("../../helpers/tour-rich-text.helper");
const { discardNewTourImages } = require('../../middlewares/admin/image-upload.middleware');

const textError = (res, status, message) => res.status(status).json({ code: "error", message });
const rejectedTourWrite = error => error instanceof mongoose.Error.ValidationError ||
  error instanceof mongoose.Error.CastError || error.code === 11000;

function unconfirmedTourWrite(req, res, message) {
  if (req.newTourImages?.length) console.error('Chưa xác định được kết quả lưu ảnh tour.', req.newTourImages);
  return textError(res, 503, message);
}
const prices = [
  ["priceAdult", "priceNewAdult"],
  ["priceChildren", "priceNewChildren"],
  ["priceBaby", "priceNewBaby"]
];

function applyPrices(data, creating) {
  for (const [base, current] of prices) {
    if (creating || data[base] !== undefined) data[base] = data[base] === undefined || data[base] === "" ? 0 : data[base];
    if (data[current] === "" && data[base] === undefined) throw new Error('Cần có giá cũ để mặc định giá mới.');
    if (data[base] !== undefined && (data[current] === undefined || data[current] === "")) data[current] = data[base];
  }
}

const stockFields = ['stockAdult', 'stockChildren', 'stockBaby'];

function addStockConditions(filter, body) {
  if (body.stockBaseline === undefined) return;
  const baseline = JSON.parse(body.stockBaseline);
  delete body.stockBaseline;
  if (!baseline || Array.isArray(baseline) || typeof baseline !== 'object' ||
      Object.keys(baseline).some(field => !stockFields.includes(field))) throw new Error('Số chỗ không hợp lệ.');
  for (const field of stockFields) {
    if (body[field] === undefined) continue;
    const previous = baseline[field];
    if (previous !== null && (!Number.isSafeInteger(previous) || previous < 0)) throw new Error('Số chỗ không hợp lệ.');
    filter[field] = previous;
  }
}

const imageRevision = tour => createHash('sha256')
  .update(JSON.stringify([tour.avatar || '', tour.images || []])).digest('hex');

function cleanSchedule(schedules) {
  if (!Array.isArray(schedules)) throw new Error("Lịch trình không hợp lệ.");
  return schedules.map(item => ({
    title: typeof item?.title === "string" ? item.title.slice(0, 250) : "",
    description: sanitizeTourHtml(item?.description)
  }));
}

const canLinkCategory = id => !id || categoryHelper.isAvailableCategory(id);
const saveTourLink = (data, save) => categoryHelper.withCategoryWrite(async () => {
  if (!await canLinkCategory(data.category)) return false;
  if (data.category) data.category = data.category.toLowerCase();
  await save();
  return true;
});
const invalidTourCategory = res => res.json({
  code: "error",
  message: "Danh mục của tour đã bị xóa hoặc không tồn tại. Vui lòng chọn danh mục hợp lệ!"
});

module.exports.list = async (req, res) => {
  const find = {
    deleted: false
  };
  const pagination = paginate(req.query, await Tour.countDocuments(find));

  const tourList = await Tour
    .find(find)
    .sort({
      position: "desc",
      _id: "asc"
    }).skip(pagination.skip).limit(pagination.limit);

  for (const item of tourList) {
    if(item.createdBy) {
      const infoAccountCreated = await AccountAdmin.findOne({
        _id: item.createdBy
      })
      item.createdByFullName = infoAccountCreated?.fullName;
    }

    if(item.updatedBy) {
      const infoAccountUpdated = await AccountAdmin.findOne({
        _id: item.updatedBy
      })
      item.updatedByFullName = infoAccountUpdated?.fullName;
    }

    item.createdAtFormat = item.createdAt && moment(item.createdAt).utcOffset(420).format("HH:mm - DD/MM/YYYY");
    item.updatedAtFormat = item.updatedAt && moment(item.updatedAt).utcOffset(420).format("HH:mm - DD/MM/YYYY");
  }

  res.render("admin/pages/tour-list", {
    pageTitle: "Quản lý tour",
    tourList, pagination
  })
}

module.exports.create = async (req, res) => {
  const categoryList = await Category.find({
    deleted: false
  })

  const categoryTree = categoryHelper.buildCategoryTree(categoryList);

  const cityList = await City.find({});

  res.render("admin/pages/tour-create", {
    pageTitle: "Tạo tour",
    categoryList: categoryTree,
    cityList: cityList
  })
}

module.exports.createPost = async (req, res) => {
  if(!req.permissions.includes("tour-create")) {
    res.json({
      code: "error",
      message: "Không có quyền sử dụng tính năng này!"
    })
    return;
  }

  let writeStarted = false;
  try {
    if(req.body.position) {
      req.body.position = parseInt(req.body.position);
    } else {
      const totalRecord = await Tour.countDocuments({});
      req.body.position = totalRecord + 1;
    }

    req.body.createdBy = req.account.id;
    req.body.updatedBy = req.account.id;
    if(req.files && req.files.avatar) {
      req.body.avatar = req.files.avatar[0].path;
    } else {
      delete req.body.avatar;
    }

    applyPrices(req.body, true);
    for (const field of stockFields) req.body[field] ??= 0;
    delete req.body.stockBaseline;
    req.body.locations = req.body.locations ? JSON.parse(req.body.locations) : [];
    req.body.departureDate = req.body.departureDate ? new Date(req.body.departureDate) : null;
    req.body.schedules = cleanSchedule(req.body.schedules ? JSON.parse(req.body.schedules) : []);
    if (req.body.information !== undefined) req.body.information = sanitizeTourHtml(req.body.information);
    delete req.body.imageRevision;
    delete req.body.savedImages;
    delete req.body.removeAvatar;

    if(req.files && req.files.images && req.files.images.length > 0) {
      req.body.images = req.files.images.map(file => file.path);
    } else {
      delete req.body.images;
    }

    const saved = await saveTourLink(req.body, () => {
      writeStarted = true;
      return Tour.create(req.body);
    });
    if (!saved) {
      await discardNewTourImages(req);
      return invalidTourCategory(res);
    }
  } catch (error) {
    if (writeStarted && !rejectedTourWrite(error)) return unconfirmedTourWrite(req, res,
      'Chưa xác nhận được kết quả tạo tour. Vui lòng kiểm tra danh sách trước khi gửi lại.');
    await discardNewTourImages(req);
    if (writeStarted) return textError(res, 400, 'Không thể tạo tour. Vui lòng kiểm tra dữ liệu và thử lại.');
    return res.json({ code: "error", message: "Không thể tạo tour. Vui lòng thử lại!" });
  }

  req.flash("success", "Tạo tour thành công!")

  res.json({
    code: "success"
  })
}

module.exports.trash = async (req, res) => {
  const find = {
    deleted: true
  };
  const pagination = paginate(req.query, await Tour.countDocuments(find));

  const tourList = await Tour
    .find(find)
    .sort({
      deletedAt: "desc",
      _id: "asc"
    }).skip(pagination.skip).limit(pagination.limit);

  for (const item of tourList) {
    if(item.createdBy) {
      const infoAccountCreated = await AccountAdmin.findOne({
        _id: item.createdBy
      })
      item.createdByFullName = infoAccountCreated?.fullName;
    }

    if(item.deletedBy) {
      const infoAccountDeleted = await AccountAdmin.findOne({
        _id: item.deletedBy
      })
      item.deletedByFullName = infoAccountDeleted?.fullName;
    }

    item.createdAtFormat = item.createdAt && moment(item.createdAt).utcOffset(420).format("HH:mm - DD/MM/YYYY");
    item.deletedAtFormat = item.deletedAt && moment(item.deletedAt).utcOffset(420).format("HH:mm - DD/MM/YYYY");
  }

  res.render("admin/pages/tour-trash", {
    pageTitle: "Thùng rác tour",
    tourList, pagination
  })
}

module.exports.edit = async (req, res) => {
  try {
    const id = req.params.id;

    const tourDetail = await Tour.findOne({
      _id: id,
      deleted: false
    })

    if(tourDetail) {
      tourDetail.departureDateFormat = tourDetail.departureDate ? moment(tourDetail.departureDate).format("YYYY-MM-DD") : "";
      tourDetail.information = sanitizeTourHtml(tourDetail.information);
      tourDetail.schedules = cleanSchedule(tourDetail.schedules || []);

      const categoryList = await Category.find({
        deleted: false
      })
  
      const categoryTree = categoryHelper.buildCategoryTree(categoryList);
  
      const cityList = await City.find({});
  
      res.render("admin/pages/tour-edit", {
        pageTitle: "Chỉnh sửa tour",
        categoryList: categoryTree,
        cityList: cityList,
        tourDetail: tourDetail,
        imageRevision: imageRevision(tourDetail)
      })
    } else {
      res.redirect(`/${pathAdmin}/tour/list`);
    }
  } catch (error) {
    res.redirect(`/${pathAdmin}/tour/list`);
  }
}

module.exports.prepareTourImages = async (req, res, next) => {
  const { savedImages, removeAvatar, imageRevision: revision } = req.body;
  if (savedImages === undefined && !removeAvatar && !revision) return next();
  const tour = await Tour.findOne({ _id: req.params.id, deleted: false }).select('images avatar').lean();
  if (!tour) return textError(res, 404, 'Không tìm thấy tour đang quản lý!');
  if (revision !== imageRevision(tour)) {
    return textError(res, 409, 'Ảnh của tour đã thay đổi. Vui lòng mở lại trang rồi kiểm tra ảnh trước khi lưu.');
  }
  if (removeAvatar && req.files?.avatar?.length) return textError(res, 400, 'Chọn xóa hoặc thay ảnh đại diện.');

  if (savedImages !== undefined) {
    let retained;
    try { retained = JSON.parse(savedImages); } catch { retained = null; }
    const images = tour.images || [];
    if (!Array.isArray(retained) || new Set(retained).size !== retained.length ||
        retained.some(index => !Number.isInteger(index) || index < 0 || index >= images.length) ||
        retained.length + (req.files?.images?.length || 0) > Math.max(10, images.length)) {
      return textError(res, 400, 'Danh sách ảnh không hợp lệ hoặc vượt quá giới hạn.');
    }
    req.tourImages = { before: tour.images, retained: retained.map(index => images[index]) };
  }
  if (removeAvatar || req.files?.avatar?.length) req.tourAvatarBefore = { value: tour.avatar };
  if (removeAvatar) req.removedTourAvatar = true;
  return next();
};

module.exports.editPatch = async (req, res) => {
  if(!req.permissions.includes("tour-edit")) {
    res.json({
      code: "error",
      message: "Không có quyền sử dụng tính năng này!"
    })
    return;
  }
  
  let writeStarted = false;
  try {
    const id = req.params.id;

    if (req.body.position) {
      req.body.position = parseInt(req.body.position);
    } else if (req.body.position === "") {
      const totalRecord = await Tour.countDocuments({});
      req.body.position = totalRecord + 1;
    }

    req.body.updatedBy = req.account.id;
    if(req.files && req.files.avatar) {
      req.body.avatar = req.files.avatar[0].path;
    } else if (req.removedTourAvatar) {
      req.body.avatar = "";
    } else {
      delete req.body.avatar;
    }

    applyPrices(req.body, false);
    if (req.body.locations !== undefined) req.body.locations = req.body.locations ? JSON.parse(req.body.locations) : [];
    if (req.body.departureDate !== undefined) req.body.departureDate = req.body.departureDate ? new Date(req.body.departureDate) : null;
    if (req.body.schedules !== undefined) req.body.schedules = cleanSchedule(req.body.schedules ? JSON.parse(req.body.schedules) : []);
    if (req.body.information !== undefined) req.body.information = sanitizeTourHtml(req.body.information);

    delete req.body.imageRevision;
    delete req.body.savedImages;
    delete req.body.removeAvatar;
    const filter = { _id: id, deleted: false };
    const hadStockBaseline = req.body.stockBaseline !== undefined;
    addStockConditions(filter, req.body);
    if (req.tourAvatarBefore) filter.avatar = req.tourAvatarBefore.value ?? { $exists: false };
    if (req.tourImages) {
      filter.images = req.tourImages.before ?? { $exists: false };
      req.body.images = [...req.tourImages.retained, ...(req.files?.images || []).map(file => file.path)];
    } else if(req.files && req.files.images && req.files.images.length > 0) {
      req.body.images = req.files.images.map(file => file.path);
    } else {
      delete req.body.images;
    }

    let result;
    const saved = await saveTourLink(req.body, async () => {
      writeStarted = true;
      result = await Tour.updateOne(filter, req.body);
    });
    if (!saved) {
      await discardNewTourImages(req);
      return invalidTourCategory(res);
    }
    if (!result.matchedCount) {
      await discardNewTourImages(req);
      return textError(res, req.tourImages || req.tourAvatarBefore || hadStockBaseline ? 409 : 404,
        'Tour đã thay đổi hoặc không còn tồn tại. Vui lòng kiểm tra lại trước khi lưu.');
    }

  } catch (error) {
    if (writeStarted && !rejectedTourWrite(error)) return unconfirmedTourWrite(req, res,
      'Chưa xác nhận được kết quả cập nhật tour. Vui lòng kiểm tra tour trước khi gửi lại.');
    await discardNewTourImages(req);
    return textError(res, 400, 'Không thể cập nhật tour. Vui lòng kiểm tra dữ liệu và thử lại.');
  }
  req.flash("success", "Cập nhật tour thành công!");
  return res.json({ code: "success" });
}

const trashError = (res, status, message) => res.status(status).json({ code: "error", message });
const tourIds = values => Array.isArray(values) && values.length >= 1 && values.length <= 100 &&
  values.every(categoryHelper.isCategoryId) ? [...new Set(values.map(id => id.toLowerCase()))] : null;

module.exports.deletePatch = async (req, res) => {
  if (!req.permissions?.includes("tour-delete")) return trashError(res, 403, "Không có quyền sử dụng tính năng này!");
  const ids = tourIds([req.params.id]);
  if (!ids) return trashError(res, 400, "Mã tour không hợp lệ!");
  const result = await Tour.updateOne({ _id: ids[0], deleted: { $ne: true } }, [{
    $set: { statusBeforeDelete: "$status", status: "inactive", deleted: true, deletedBy: req.account.id, deletedAt: new Date() }
  }]);
  if (!result.matchedCount) return trashError(res, 404, "Không tìm thấy tour đang quản lý!");
  req.flash("success", "Xóa tour thành công!");
  return res.json({ code: "success" });
};

async function inTourTransaction(work) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

const restoreUpdate = [
  { $set: { deleted: false, status: { $ifNull: ["$statusBeforeDelete", "$status"] } } },
  { $unset: ["statusBeforeDelete", "deletedAt", "deletedBy"] }
];

async function restoreTours(ids) {
  return categoryHelper.withCategoryWrite(async () => {
    const filter = { _id: { $in: ids }, deleted: true };
    const check = async session => {
      const rows = await Tour.find(filter).select("category").session(session).lean();
      if (rows.length !== ids.length) return false;
      if (rows.some(row => !categoryHelper.isCategoryId(row.category))) return false;
      const categories = [...new Set(rows.map(row => row.category.toLowerCase()))];
      const count = await Category.countDocuments({ _id: { $in: categories }, ...categoryHelper.liveCategory }).session(session);
      if (count !== categories.length) return false;

      const result = await Tour.updateMany(filter, restoreUpdate, { session });
      if (result.matchedCount !== ids.length) {
        if (session) throw new Error("Tour đã thay đổi trong lúc khôi phục.");
        return false;
      }
      return true;
    };
    return ids.length > 1 ? inTourTransaction(check) : check(null);
  });
}

async function deleteToursPermanently(ids) {
  return inTourTransaction(async session => {
    const filter = { _id: { $in: ids }, deleted: true, status: "inactive" };
    if (await Tour.countDocuments(filter).session(session) !== ids.length) return false;

    // Old orders may store the tour ID as a string or as an ObjectId in the item.
    const references = ids.flatMap(id => [new mongoose.Types.ObjectId(id), new RegExp("^" + id + "$", "i")]);
    const linkedOrder = await Order.collection.findOne({ "items.tourId": { $in: references } }, { session, projection: { _id: 1 } });
    if (linkedOrder) return false;

    const result = await Tour.deleteMany(filter, { session });
    if (result.deletedCount !== ids.length) throw new Error("Tour đã thay đổi trong lúc xóa.");
    return true;
  });
}

async function updateTrash(req, res, values, option) {
  if (!req.permissions?.includes("tour-trash")) return trashError(res, 403, "Không có quyền sử dụng tính năng này!");
  const ids = tourIds(values);
  if (!ids || !["undo", "delete-destroy"].includes(option)) {
    return trashError(res, 400, "Thao tác hoặc danh sách tour không hợp lệ.");
  }

  const restore = option === "undo";
  const changed = restore ? await restoreTours(ids) : await deleteToursPermanently(ids);
  if (!changed) return trashError(res, 409, restore ?
    "Không thể khôi phục. Tất cả tour phải ở trong thùng rác và có danh mục hợp lệ." :
    "Không thể xóa. Tất cả tour phải ở trong thùng rác, tạm dừng và không có lịch sử đặt tour.");
  req.flash("success", restore ? "Khôi phục tour thành công!" : "Đã xóa vĩnh viễn tour thành công!");
  return res.json({ code: "success", count: ids.length });
}

module.exports.undoPatch = (req, res) => updateTrash(req, res, [req.params.id], "undo");
module.exports.deleteDestroyPatch = (req, res) => updateTrash(req, res, [req.params.id], "delete-destroy");
module.exports.trashChangeMultiPatch = (req, res) => updateTrash(req, res, req.body?.ids, req.body?.option);
