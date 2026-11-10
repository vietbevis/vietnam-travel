const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  action:{type:String,required:true},
  cardId:{type:String,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  actorType:{type:String,required:true,enum:['admin','customer','system']},
  actorId:String,
  result:{type:String,required:true,enum:['success','fail']},
  detail:mongoose.Schema.Types.Mixed,
  ip:String
},{timestamps:{createdAt:true,updatedAt:false}});
module.exports=mongoose.model('CardLog',schema,'card-logs');
