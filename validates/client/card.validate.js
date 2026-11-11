const Joi=require('joi');
const text=n=>Joi.string().max(n).allow('').required();
module.exports={
  empty:Joi.object({}).unknown(false).required(),
  login:Joi.object({cardId:Joi.string().pattern(/^[a-f0-9]{32}$/i).required(),nonce:Joi.string().pattern(/^[a-f0-9]{32}$/i).required(),counter:Joi.number().integer().min(0).max(0xffffffff).required(),signature:Joi.string().pattern(/^[a-f0-9]{256}$/i).required()}).unknown(false).required(),
  profile:Joi.object({phone:text(15),emergencyName:text(60),emergencyPhone:text(15)}).unknown(false).required(),
  payPrepare:Joi.object({orderId:Joi.string().pattern(/^[a-fA-F0-9]{24}$/).required()}).unknown(false).required(),
  email:Joi.object({email:Joi.string().email({tlds:{allow:false}}).max(254).required()}).unknown(false).required(),
  otp:Joi.object({email:Joi.string().email({tlds:{allow:false}}).max(254).required(),otp:Joi.string().pattern(/^\d{6}$/).required()}).unknown(false).required()
};
