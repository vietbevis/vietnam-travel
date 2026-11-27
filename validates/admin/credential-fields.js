const Joi = require('joi');

const loginEmail = Joi.string().trim().email().max(254);
const newPassword = Joi.string().min(8).max(72)
  .pattern(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&]).+$/)
  .custom((value, helpers) => Buffer.byteLength(value, 'utf8') <= 72 ? value : helpers.error('string.max', { limit: 72 }));

module.exports = { loginEmail, newPassword };
