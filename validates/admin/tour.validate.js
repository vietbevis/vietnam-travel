const Joi = require('joi');
const { parse, tourMaximum } = require('../../public/assets/js/vnd-money');
const { isCategoryId } = require('../../helpers/category.helper');

const price = label => Joi.any().custom((raw, helper) => {
  const value = parse(raw, { max: tourMaximum });
  return Number.isNaN(value) ? helper.error('any.invalid') : (value ?? '');
}).messages({ 'any.invalid': `${label} phải là số tiền VND nguyên hợp lệ (ví dụ 1.000.000).` });

const stock = Joi.any().custom((raw, helper) => {
  if (raw === '') return 0;
  const value = typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw)) ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : helper.error('any.invalid');
}).messages({ 'any.invalid': 'Số chỗ phải là số nguyên không âm.' });

module.exports.createPost = (req, res, next) => {
  const schema = Joi.object({
    name: Joi.string()
      .trim().required()
      .messages({
        "string.empty": "Vui lòng nhập tên tour!"
      }),
    category: Joi.string().allow('').custom((value, helper) => isCategoryId(value) ? value : helper.error('any.invalid'))
      .messages({ 'any.invalid': 'Danh mục tour không hợp lệ.' }),
    position: Joi.string().allow('').custom((value, helper) =>
      /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? value : helper.error('any.invalid'))
      .messages({ 'any.invalid': 'Vị trí phải là số nguyên dương.' }),
    status: Joi.string().valid('active', 'inactive').messages({ 'any.only': 'Trạng thái tour không hợp lệ.' }),
    avatar: Joi.string().allow(''),
    priceAdult: price('Giá cũ người lớn'),
    priceChildren: price('Giá cũ trẻ em'),
    priceBaby: price('Giá cũ em bé'),
    priceNewAdult: price('Giá mới người lớn'),
    priceNewChildren: price('Giá mới trẻ em'),
    priceNewBaby: price('Giá mới em bé'),
    stockAdult: stock,
    stockChildren: stock,
    stockBaby: stock,
    stockBaseline: Joi.string().max(240),
    locations: Joi.string().allow(''),
    time: Joi.string().trim().max(100).allow('').messages({ 'string.max': 'Thời lượng tối đa 100 ký tự.' }),
    vehicle: Joi.string().trim().max(100).allow(''),
    departureDate: Joi.string().allow(''),
    information: Joi.string().allow(''),
    schedules: Joi.string().allow(''),
    images: Joi.string().allow(''),
    savedImages: Joi.string().max(2000),
    imageRevision: Joi.string().length(64).hex(),
    removeAvatar: Joi.string().valid('true'),
  });

  const { error, value } = schema.validate(req.body);

  if(error) {
    const errorMessage = error.details[0].message;

    return res.status(400).json({
      code: "error",
      message: errorMessage
    });
  }

  req.body = value;
  return next();
}
