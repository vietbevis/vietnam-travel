const mongoose = require('mongoose');
const current = status => ['issuing','active','locked'].includes(status);
const schema = new mongoose.Schema({
  cardId:{type:String,required:true,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  cardType:{type:String,required:true,enum:['customer','staff']},
  ownerId:{type:String,required:true},
  // INIT trả modulus sau khi tạo bản ghi issuing, nên trường này chưa bắt buộc.
  publicKeyModulus:{type:String,match:/^[a-fA-F0-9]{256}$/,uppercase:true},
  status:{type:String,required:true,enum:['issuing','active','locked','revoked','failed'],default:'issuing'},
  isCurrent:{type:Boolean,default:function(){return current(this.status);},validate:{validator:function(value){return value===current(this.status);},message:'isCurrent phải khớp trạng thái thẻ.'}},
  balance:{type:Number,default:0,min:0,max:50_000_000,validate:Number.isSafeInteger},
  txCounter:{type:Number,default:0,min:0,max:0xffffffff,validate:Number.isSafeInteger},
  issuedBy:String,
  issuedAt:Date,
  activatedAt:Date,
  lockedReason:String,
  revokedBy:String,
  revokedAt:Date,
  revokedReason:String,
  replaceOf:{type:String,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  // Claim bền: giữ đích đã hoàn tất để nguồn không cấp vốn cho thẻ thứ hai.
  replacement:{type:new mongoose.Schema({actorId:String,reason:String,targetCardId:String,completedAt:Date},{_id:false})},
  writeOpIds:{type:new mongoose.Schema({profile:String,photo:String},{_id:false})},
  // Chỉ đọc rõ metadata ở luồng phát hành; không đưa PIN hoặc APDU INIT vào dữ liệu công khai.
  issuance:{type:new mongoose.Schema({pinCipher:String,expireAt:Date,profileOpId:String,photoOpId:String,requestId:String},{_id:false}),select:false},
  lastSeenAt:Date
},{timestamps:true});
schema.index({cardId:1},{unique:true});
schema.index({ownerId:1,cardType:1},{unique:true,partialFilterExpression:{isCurrent:true}});
module.exports=mongoose.model('Card',schema,'cards');
