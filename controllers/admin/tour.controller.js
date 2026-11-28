const mongoose = require("mongoose");
const { createHash } = require("node:crypto");
const Order = require("../../models/order.model");
const Category = require("../../models/category.model");
const City = require("../../models/city.model");
const Tour = require("../../models/tour.model");

const categoryHelper = require("../../helpers/category.helper");
const inTransaction = require("../../helpers/mongo-transaction.helper");
const { statuses, selectedIds, dayInVietnam, vietnamDate, listPage, listActors } = require("../../helpers/admin-list.helper");
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
class TourInputError extends Error {}

function applyPrices(data, creating) {
  for (const [base, current] of prices) {
    if (creating || data[base] !== undefined) data[base] = data[base] === undefined || data[base] === "" ? 0 : data[base];
    if (data[current] === "" && data[base] === undefined) throw new TourInputError("Cần có giá cũ để mặc định giá mới.");
    if (data[base] !== undefined && (data[current] === undefined || data[current] === "")) data[current] = data[base];
    if (data[base] > 0 && data[current] > data[base]) throw new TourInputError("Giá mới không được vượt giá gốc.");
  }
}

const stockFields = ['stockAdult', 'stockChildren', 'stockBaby'];

function addStockConditions(filter, body) {
  if (body.stockBaseline === undefined) {
    if (stockFields.some(field => body[field] !== undefined)) throw new TourInputError("Mở lại tour để lấy số chỗ hiện tại trước khi chỉnh sửa.");
    return;
  }
  const baseline = JSON.parse(body.stockBaseline);
  delete body.stockBaseline;
  if (!baseline || Array.isArray(baseline) || typeof baseline !== 'object' ||
      Object.keys(baseline).some(field => !stockFields.includes(field))) throw new TourInputError("Số chỗ không hợp lệ.");
  for (const field of stockFields) {
    if (body[field] === undefined) continue;
    const previous = baseline[field];
    if (previous !== null && (!Number.isSafeInteger(previous) || previous < 0)) throw new TourInputError("Số chỗ không hợp lệ.");
    filter[field] = previous;
  }
}

const imageRevision = tour => createHash('sha256')
  .update(JSON.stringify([tour.avatar || '', tour.images || []])).digest('hex');

function cleanSchedule(schedules) {
  if (!Array.isArray(schedules)) throw new TourInputError("Lịch trình không hợp lệ.");
  return schedules.map(item => ({
    title: typeof item?.title === "string" ? item.title.slice(0, 250) : "",
    description: sanitizeTourHtml(item?.description)
  }));
}

function saveTourLink(data, save) {
  if (!data.category) return Promise.resolve(save(null)).then(() => true);
  return categoryHelper.withCategoryWrite(async session => {
    if (!await categoryHelper.isAvailableCategory(data.category, session)) return false;
    data.category = data.category.toLowerCase();
    await save(session);
    return true;
  });
}

async function tourLocations(raw) {
  const list = raw ? JSON.parse(raw) : [];
  const ids = Array.isArray(list) && !list.length ? [] : selectedIds(list);
  if (!ids || (ids.length && await City.countDocuments({ _id: { $in: ids } }) !== ids.length)) {
    throw new TourInputError("Vui lòng chọn điểm xuất phát hợp lệ.");
  }
  return ids;
}

function tourDepartureDate(value) {
  if (!value) return null;
  if (!dayInVietnam(value)) throw new TourInputError("Ngày khởi hành không hợp lệ.");
  // Giữ cách lưu ngày date-only của tour đang có.
  return new Date(value);
}
const invalidTourCategory = res => res.json({
  code: "error",
  message: "Danh mục của tour đã bị xóa hoặc không tồn tại. Vui lòng chọn danh mục hợp lệ!"
});

const priceBands = {
  "under-2m": { $gte: 0, $lt: 2_000_000 },
  "2m-4m": { $gte: 2_000_000, $lt: 4_000_000 },
  "4m-8m": { $gte: 4_000_000, $lt: 8_000_000 },
  "from-8m": { $gte: 8_000_000 }
};

function listTours(trash) {
  return async (req, res) => {
    const actor = trash ? "deletedBy" : "createdBy";
    const where = trash ? { deleted: true } : categoryHelper.liveCategory;
    const page = await listPage(Tour, req.query, {
      where, priceBands, enums: trash ? {} : { status: statuses, price: Object.keys(priceBands) },
      idFields: trash ? [actor] : [actor, "category"], dateField: trash ? "deletedAt" : "createdAt",
      sort: trash ? { deletedAt: -1, _id: 1 } : { position: -1, _id: 1 }
    });
    const tourList = page.rows;
    const accountAdminList = await listActors(Tour, where, tourList, trash ? [actor, "createdBy"] : [actor, "updatedBy"]);
    const categoryList = trash ? [] : await Category.find(categoryHelper.liveCategory).select("name").sort({ position: -1, _id: 1 });
    for (const item of tourList) {
      item.createdAtFormat = vietnamDate(item.createdAt);
      item.updatedAtFormat = vietnamDate(item.updatedAt);
      item.deletedAtFormat = vietnamDate(item.deletedAt);
    }
    return res.status(page.listError ? 400 : 200).render(trash ? "admin/pages/tour-trash" : "admin/pages/tour-list", {
      ...page, pageTitle: trash ? "Thùng rác tour" : "Quản lý tour", tourList, accountAdminList, categoryList
    });
  };
}

module.exports.list = listTours(false);
module.exports.trash = listTours(true);

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
    req.body.locations = await tourLocations(req.body.locations);
    req.body.departureDate = tourDepartureDate(req.body.departureDate);
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

    const saved = await saveTourLink(req.body, session => {
      writeStarted = true;
      return session ? Tour.create([req.body], { session }) : Tour.create(req.body);
    });
    if (!saved) {
      await discardNewTourImages(req);
      return invalidTourCategory(res);
    }
  } catch (error) {
    if (writeStarted && !rejectedTourWrite(error)) return unconfirmedTourWrite(req, res,
      'Chưa xác nhận được kết quả tạo tour. Vui lòng kiểm tra danh sách trước khi gửi lại.');
    await discardNewTourImages(req);
    if (error instanceof TourInputError || error instanceof SyntaxError) return textError(res, 400,
      error instanceof TourInputError ? error.message : "Điểm xuất phát hoặc lịch trình không hợp lệ.");
    if (writeStarted) return textError(res, 400, 'Không thể tạo tour. Vui lòng kiểm tra dữ liệu và thử lại.');
    return res.json({ code: "error", message: "Không thể tạo tour. Vui lòng thử lại!" });
  }

  req.flash("success", "Tạo tour thành công!")

  res.json({
    code: "success"
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
      tourDetail.departureDateFormat = vietnamDate(tourDetail.departureDate, "YYYY-MM-DD");
      tourDetail.information = sanitizeTourHtml(tourDetail.information);
      tourDetail.schedules = cleanSchedule(tourDetail.schedules || []);

      const categoryList = await Category.find({
        deleted: false
      })
  
      const categoryTree = categoryHelper.buildCategoryTree(categoryList);
      const linkedCategory = categoryHelper.findCategoryNode(categoryTree, item => item.id === tourDetail.category?.toLowerCase());
  
      const cityList = await City.find({});
  
      res.render("admin/pages/tour-edit", {
        pageTitle: "Chỉnh sửa tour",
        categoryList: categoryTree,
        cityList: cityList,
        tourDetail: tourDetail,
        linkedCategory,
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
    if (req.body.locations !== undefined) req.body.locations = await tourLocations(req.body.locations);
    if (req.body.departureDate !== undefined) req.body.departureDate = tourDepartureDate(req.body.departureDate);
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
    const categoryToCheck = req.body.category === undefined && req.body.status === "active"
      ? (await Tour.findOne(filter).select("category").lean())?.category : req.body.category;
    const links = { category: categoryToCheck };
    if (req.body.category === undefined && req.body.status === "active") filter.category = categoryToCheck ?? null;
    for (const [base, current] of prices) {
      if (req.body[base] === undefined && req.body[current] !== undefined) {
        filter.$and ||= [];
        filter.$and.push({ $or: [
          { [base]: { $gte: req.body[current] } }, { [base]: { $lte: 0 } }, { [base]: null }
        ] });
      }
    }
    const saved = await saveTourLink(links, async session => {
      if (req.body.category) req.body.category = links.category;
      writeStarted = true;
      result = await Tour.updateOne(filter, req.body, session ? { session } : undefined);
    });
    if (!saved) {
      await discardNewTourImages(req);
      return invalidTourCategory(res);
    }
    if (!result.matchedCount) {
      await discardNewTourImages(req);
      return textError(res, req.tourImages || req.tourAvatarBefore || hadStockBaseline || filter.$and ? 409 : 404,
        'Tour đã thay đổi, giá mới vượt giá gốc hoặc tour không còn tồn tại. Vui lòng kiểm tra lại trước khi lưu.');
    }

  } catch (error) {
    if (writeStarted && !rejectedTourWrite(error)) return unconfirmedTourWrite(req, res,
      'Chưa xác nhận được kết quả cập nhật tour. Vui lòng kiểm tra tour trước khi gửi lại.');
    await discardNewTourImages(req);
    if (error instanceof TourInputError) return textError(res, 400, error.message);
    return textError(res, 400, 'Không thể cập nhật tour. Vui lòng kiểm tra dữ liệu và thử lại.');
  }
  req.flash("success", "Cập nhật tour thành công!");
  return res.json({ code: "success" });
}

const trashError = (res, status, message) => res.status(status).json({ code: "error", message });
const trashedTour = actor => [{
  $set: { statusBeforeDelete: "$status", status: "inactive", deleted: true, deletedBy: actor, deletedAt: new Date() }
}];

module.exports.deletePatch = async (req, res) => {
  if (!req.permissions?.includes("tour-delete")) return trashError(res, 403, "Không có quyền sử dụng tính năng này!");
  const ids = selectedIds([req.params.id]);
  if (!ids) return trashError(res, 400, "Mã tour không hợp lệ!");
  const result = await Tour.updateOne({ _id: ids[0], ...categoryHelper.liveCategory }, trashedTour(req.account.id));
  if (!result.matchedCount) return trashError(res, 404, "Không tìm thấy tour đang quản lý!");
  req.flash("success", "Xóa tour thành công!");
  return res.json({ code: "success" });
};

module.exports.changeMultiPatch = async (req, res) => {
  const { option, ids: values } = req.body || {};
  const ids = selectedIds(values);
  if (!ids || ![...statuses, "delete"].includes(option)) return trashError(res, 400, "Thao tác hoặc danh sách tour không hợp lệ.");
  if (!req.permissions?.includes(option === "delete" ? "tour-delete" : "tour-edit")) {
    return trashError(res, 403, "Không có quyền sử dụng tính năng này!");
  }
  const filter = { _id: { $in: ids }, ...categoryHelper.liveCategory };
  const change = async session => {
    const rows = await Tour.find(filter).select("category").session(session).lean();
    if (rows.length !== ids.length) return false;
    if (option === "active") {
      for (const id of new Set(rows.map(row => row.category).filter(Boolean))) {
        if (!await categoryHelper.isAvailableCategory(id, session)) return false;
      }
    }
    const update = option === "delete" ? trashedTour(req.account.id) : { $set: { status: option, updatedBy: req.account.id } };
    const result = await Tour.updateMany(filter, update, { session });
    if (result.matchedCount !== ids.length) throw new Error("Tour đã thay đổi trong lúc cập nhật.");
    return true;
  };
  const changed = await (option === "active" ? categoryHelper.withCategoryWrite(change) : inTransaction(change));
  if (!changed) return trashError(res, 409, "Tất cả tour phải còn trong danh sách và có danh mục hợp lệ khi cho hoạt động.");
  req.flash("success", option === "delete" ? "Đã chuyển tour vào thùng rác." : "Đã cập nhật trạng thái tour.");
  return res.json({ code: "success", count: ids.length });
};

const restoreUpdate = [
  { $set: { deleted: false, status: { $cond: [{ $in: ["$statusBeforeDelete", statuses] }, "$statusBeforeDelete", "inactive"] } } },
  { $unset: ["statusBeforeDelete", "deletedAt", "deletedBy"] }
];

async function restoreTours(ids) {
  return categoryHelper.withCategoryWrite(async session => {
    const filter = { _id: { $in: ids }, deleted: true };
    const rows = await Tour.find(filter).select("category").session(session).lean();
    if (rows.length !== ids.length) return false;
    for (const id of new Set(rows.map(row => row.category))) {
      if (!await categoryHelper.isAvailableCategory(id, session)) return false;
    }
    const result = await Tour.updateMany(filter, restoreUpdate, { session });
    if (result.matchedCount !== ids.length) throw new Error("Tour đã thay đổi trong lúc khôi phục.");
    return true;
  });
}

async function deleteToursPermanently(ids) {
  return inTransaction(async session => {
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
  const ids = selectedIds(values);
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
