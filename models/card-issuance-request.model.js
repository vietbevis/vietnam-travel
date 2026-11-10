const mongoose=require('mongoose');
// Giữ tombstone sau hủy để request đến muộn không thể tạo lại thẻ; không dùng TTL.
const schema=new mongoose.Schema({
  requestId:{type:String,required:true,match:/^[A-F0-9]{32}$/,uppercase:true,unique:true},
  actorId:{type:String,required:true},
  digest:String,
  ownerId:String,
  ownerType:{type:String,enum:['customer','staff']},
  cardId:String,
  state:{type:String,required:true,enum:['preparing','ready','cancelled','finished']},
  expireAt:{type:Date,required:true,default:()=>new Date(Date.now()+300000)}
},{timestamps:true});
module.exports=mongoose.model('CardIssuanceRequest',schema,'card-issuance-requests');
