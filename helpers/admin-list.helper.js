const moment = require("moment");
const slugify = require("slugify");
const Account = require("../models/account-admin.model");
const { paginate } = require("./admin-pagination.helper");

const statuses = ["active", "inactive"];
const objectId = value => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const vietnamDate = (value, format = "HH:mm - DD/MM/YYYY") =>
  value ? moment(value).utcOffset(420).format(format) : "";

// Dùng mốc nửa đêm Việt Nam kể cả khi tiến trình Node chạy ở múi giờ khác.
function dayInVietnam(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = moment.parseZone(value + "T00:00:00+07:00", "YYYY-MM-DDTHH:mm:ssZ", true);
  return day.isValid() && day.year() > 0 ? day : null;
}

function selectedIds(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100 || !values.every(objectId)) return null;
  const ids = values.map(value => value.toLowerCase());
  return new Set(ids).size === ids.length ? ids : null;
}

function titleSearch(value) {
  const slug = slugify(value, { lower: true, locale: "vi" });
  const matches = [{ name: new RegExp(escapeRegex(value), "i") }];
  if (slug) matches.push({ slug: new RegExp(escapeRegex(slug), "i") });
  return matches;
}

const vietnameseLetters = {
  a: "aàáảãạăằắẳẵặâầấẩẫậ", d: "dđ", e: "eèéẻẽẹêềếểễệ",
  i: "iìíỉĩị", o: "oòóỏõọôồốổỗộơờớởỡợ", u: "uùúủũụưừứửữự", y: "yỳýỷỹỵ"
};
function personSearch(value) {
  const pattern = [...value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d")]
    .map(letter => vietnameseLetters[letter] ? `[${vietnameseLetters[letter]}]` : escapeRegex(letter)).join("");
  const literal = new RegExp(escapeRegex(value), "i");
  return [{ orderCode: literal }, { phone: literal }, { fullName: new RegExp(pattern || escapeRegex(value), "iu") }];
}

function listFilters(query, { where, enums = {}, idFields = [], dateField, searchKey = "keyword", search = titleSearch }) {
  const filter = { ...where };
  const filters = {};
  const invalid = field => ({ filters, error: "Bộ lọc không hợp lệ: " + field + "." });
  for (const [field, allowed] of Object.entries(enums)) {
    const value = query[field];
    if (value === undefined || value === "") continue;
    if (!allowed.includes(value)) return invalid(field);
    filter[field] = filters[field] = value;
  }
  for (const field of idFields) {
    const value = query[field];
    if (value === undefined || value === "") continue;
    if (!objectId(value)) return invalid(field);
    filters[field] = value.toLowerCase();
    // Một số quan hệ lịch sử lưu ObjectId dưới dạng chuỗi viết hoa.
    filter[field] = new RegExp("^" + filters[field] + "$", "i");
  }
  const days = {};
  for (const field of ["startDate", "endDate"]) {
    const value = query[field];
    if (value === undefined || value === "") continue;
    days[field] = dayInVietnam(value);
    if (!days[field]) return invalid(field);
    filters[field] = value;
  }
  if (days.startDate && days.endDate && days.startDate.isAfter(days.endDate)) {
    return { filters, error: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc!" };
  }
  if (days.startDate || days.endDate) {
    filter[dateField] = {};
    if (days.startDate) filter[dateField].$gte = days.startDate.toDate();
    if (days.endDate) filter[dateField].$lt = days.endDate.add(1, "day").toDate();
  }
  if (query[searchKey] !== undefined) {
    const value = query[searchKey];
    if (typeof value !== "string" || value.length > 100) return invalid(searchKey);
    filters[searchKey] = value.trim().normalize("NFC");
    if (filters[searchKey]) filter.$or = search(filters[searchKey]);
  }
  return { filter, filters };
}

async function listPage(Model, query, config) {
  const { filter, filters, error } = listFilters(query, config);
  if (config.priceBands && !error && filters.price) {
    delete filter.price;
    filter.priceNewAdult = config.priceBands[filters.price];
  }
  const readRows = page => page.totalRecord
    ? Model.find(filter).sort(config.sort).skip(page.skip).limit(page.limit) : [];
  let pagination = paginate(query, error ? 0 : await Model.countDocuments(filter));
  let rows = await readRows(pagination);
  if (pagination.totalRecord && !rows.length) {
    // Mục cuối có thể bị xóa giữa lúc đếm và đọc trang.
    pagination = paginate(query, await Model.countDocuments(filter));
    rows = await readRows(pagination);
  }
  return { rows, filters, listError: error, pagination };
}

async function listActors(Model, where, rows, fields) {
  const actors = await Model.distinct(fields[0], where);
  const ids = new Set([...actors, ...rows.flatMap(row => fields.map(field => row[field]))]
    .filter(objectId).map(id => id.toLowerCase()));
  const accounts = await Account.find({ _id: { $in: [...ids] } }).select("fullName").sort({ fullName: 1, _id: 1 });
  const names = new Map(accounts.map(account => [account.id, account.fullName]));
  for (const row of rows) {
    for (const field of fields) row[field + "FullName"] = names.get(String(row[field]).toLowerCase());
  }
  const knownActors = new Set(actors.filter(objectId).map(id => id.toLowerCase()));
  return accounts.filter(account => knownActors.has(account.id));
}

module.exports = { statuses, objectId, selectedIds, dayInVietnam, vietnamDate, personSearch, listPage, listActors };
