const Joi = require("joi");
const { isCategoryId } = require("../../helpers/category.helper");

const schema = Joi.object({
  name: Joi.string().trim().required().messages({
    "any.required": "Vui lòng nhập tên danh mục!",
    "string.empty": "Vui lòng nhập tên danh mục!",
    "string.base": "Tên danh mục không hợp lệ!"
  }),
  parent: Joi.string().trim().lowercase().allow("").default("").custom((value, helpers) => {
    return isCategoryId(value) ? value : helpers.error("any.invalid");
  }).messages({
    "any.invalid": "Danh mục cha không hợp lệ!",
    "string.base": "Danh mục cha không hợp lệ!"
  }),
  position: Joi.any().default("").custom((value, helpers) => {
    if (typeof value === "string") {
      value = value.trim();
      if (!value) return "";
      if (/^\d+$/.test(value)) value = Number(value);
    }
    return Number.isSafeInteger(value) && value > 0 ? value : helpers.error("any.invalid");
  }).messages({ "any.invalid": "Vị trí phải là số nguyên dương!" }),
  status: Joi.string().valid("active", "inactive").default("active").messages({
    "any.only": "Trạng thái danh mục không hợp lệ!",
    "string.base": "Trạng thái danh mục không hợp lệ!"
  }),
  // Biểu mẫu cũ gửi chuỗi "null" nếu không có ảnh.
  avatar: Joi.string().valid("", "null").strip().messages({
    "any.only": "Vui lòng chọn tệp ảnh đại diện!",
    "string.base": "Vui lòng chọn tệp ảnh đại diện!"
  }),
  description: Joi.string().allow("")
}).messages({ "object.unknown": "Biểu mẫu danh mục chứa trường không hợp lệ!" });

module.exports.save = (req, res, next) => {
  const { error, value } = schema.validate(req.body || {});
  if (error) {
    return res.status(400).json({ code: "error", message: error.details[0].message });
  }
  req.categoryInput = value;
  next();
};
