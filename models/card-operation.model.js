const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  cardId:{type:String,required:true,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  type:{type:String,required:true,enum:['set-state','reset-pin','credit','debit','write-ticket','use-ticket','delete-ticket','commit-write']},
  params:{type:mongoose.Schema.Types.Mixed,default:()=>({})},
  challenge:{type:String,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  status:{type:String,required:true,enum:['draft','prepared','done','failed'],default:'draft'},
  actorType:{type:String,required:true,enum:['admin','customer','system']},
  actorId:String,
  expireAt:{type:Date,required:true,expires:0,default:()=>new Date(Date.now()+300_000)}
},{timestamps:true});
module.exports=mongoose.model('CardOperation',schema,'card-operations');
