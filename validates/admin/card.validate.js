const Joi=require('joi');
const id=Joi.string().hex().length(24);
const cardId=Joi.string().hex().length(32).required();
const text=max=>Joi.string().trim().max(max).allow('');
const customer=Joi.object({
  fullName:Joi.string().trim().min(1).max(60).required(),email:Joi.string().email({tlds:{allow:false}}).max(254).required(),
  phone:text(15),dob:Joi.string().isoDate(),gender:Joi.string().valid('male','female','other'),idNumber:text(20),
  emergencyName:text(60),emergencyPhone:text(15),bloodType:text(3),allergies:text(120)
}).unknown(false);
module.exports.schemas={
  profile:Joi.object({cardId,fields:Joi.object({fullName:Joi.string().min(1).max(60),phone:text(15),dob:Joi.string().pattern(/^\d{8}$/),gender:Joi.string().valid('male','female','other'),idNumber:text(20),emergencyName:text(60),emergencyPhone:text(15),bloodType:text(3),allergies:text(120)}).min(1).unknown(false),photoBase64:Joi.string().max(13463)}).or('fields','photoBase64').unknown(false),
  replace:Joi.object({cardId,reason:Joi.string().trim().min(1).max(500).required()}).unknown(false),
  cash:Joi.object({cardId,amount:Joi.number().integer().min(10000).max(50000000).required()}).unknown(false),
  status:Joi.object({cardId,action:Joi.string().valid('lock','unlock','revoke').required(),reason:Joi.string().max(500).allow(''),refunded:Joi.boolean()}).unknown(false).custom((value,helpers)=>{
    if(value.action==='revoke'&&!(value.reason||'').trim())return helpers.error('any.invalid');
    return value;
  }),
  prepare:Joi.object({requestId:Joi.string().hex().length(32),ownerType:Joi.string().valid('customer','staff').required(),customerId:id,customer,accountId:id,photoBase64:Joi.string().max(13463).required(),replaceOf:Joi.string().hex().length(32)}).unknown(false).custom((value,helpers)=>{
    if(value.ownerType==='customer' ? (!value.customerId===!value.customer)||value.accountId : !value.accountId||value.customerId||value.customer)return helpers.error('any.invalid');
    return value;
  }),
  init:Joi.object({cardId,response:Joi.string().hex().length(256).required(),sw:Joi.string().hex().length(4).required()}).unknown(false),
  card:Joi.object({cardId}).unknown(false),
  cancel:Joi.object({cardId:Joi.string().hex().length(32),requestId:Joi.string().hex().length(32)}).xor('cardId','requestId').unknown(false)
};

// Kiểm cấu trúc JPEG trên server, kể cả chiều ảnh và luồng marker sau SOS.
module.exports.decodePhoto=function(value){
  if(typeof value!=='string')throw new Error('INVALID_PHOTO');
  const raw=value.replace(/^data:image\/jpeg;base64,/, '');
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))throw new Error('INVALID_PHOTO');
  const b=Buffer.from(raw,'base64');
  if(b.length<16||b.length>10080||b[0]!==255||b[1]!==216||b[b.length-2]!==255||b[b.length-1]!==217)throw new Error('INVALID_PHOTO');
  let offset=2,frame=false,scan=false,entropy=false;
  while(offset<b.length){
    if(entropy){
      if(b[offset++]!==255)continue;
      if(b[offset]===0){offset++;continue;}
      if(b[offset]>=208&&b[offset]<=215){offset++;continue;}
      offset--;
    }
    if(b[offset++]!==255)throw new Error('INVALID_PHOTO');
    while(b[offset]===255)offset++;
    const marker=b[offset++];
    if(marker===217){if(offset!==b.length||!frame||!scan)throw new Error('INVALID_PHOTO');return b;}
    if(marker===0||marker===216||marker===undefined||marker>=208&&marker<=215)throw new Error('INVALID_PHOTO');
    if(offset+2>b.length)throw new Error('INVALID_PHOTO');
    const length=b.readUInt16BE(offset);
    if(length<2||offset+length>b.length-2)throw new Error('INVALID_PHOTO');
    if([192,193,194].includes(marker)){
      if(length<11||b[offset+2]!==8||b.readUInt16BE(offset+3)<1||b.readUInt16BE(offset+5)<1||b.readUInt16BE(offset+3)>65535||length!==8+3*b[offset+7])throw new Error('INVALID_PHOTO');
      frame=true;
    }
    if(marker===218){if(!frame||length<8||length!==6+2*b[offset+2])throw new Error('INVALID_PHOTO');scan=true;entropy=true;}
    else entropy=false;
    offset+=length;
  }
  throw new Error('INVALID_PHOTO');
};
