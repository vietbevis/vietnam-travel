const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  txRef:{type:String,required:true,match:/^[a-fA-F0-9]{16}$/,uppercase:true},
  cardId:{type:String,required:true,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  type:{type:String,required:true,enum:['credit','debit']},
  source:{type:String,required:true,enum:['cash','zalopay','vnpay','order','transfer','refund']},
  amount:{type:Number,required:true,min:1,max:50_000_000,validate:Number.isSafeInteger},
  orderId:String,
  status:{type:String,required:true,enum:['awaiting-payment','pending-card','sent','done','failed'],default:'pending-card'},
  balanceAfter:{type:Number,min:0,max:50_000_000,validate:{validator:value=>value==null || Number.isSafeInteger(value)}},
  txCounter:{type:Number,min:0,max:0xffffffff,validate:{validator:value=>value==null || Number.isSafeInteger(value)}},
  receiptHex:{type:String,match:/^[a-fA-F0-9]{332}$/,uppercase:true},
  createdBy:String
},{timestamps:true});
schema.index({txRef:1},{unique:true});
module.exports=mongoose.model('CardTransaction',schema,'card-transactions');
