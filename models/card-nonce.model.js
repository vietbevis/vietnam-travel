const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  nonce:{type:String,required:true,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  purpose:{type:String,required:true,enum:['login-customer','login-staff','step-up']},
  accountId:String,
  expireAt:{type:Date,required:true,expires:0,default:()=>new Date(Date.now()+60_000)},
  used:{type:Boolean,required:true,default:false}
},{timestamps:true});
module.exports=mongoose.model('CardNonce',schema,'card-nonces');
