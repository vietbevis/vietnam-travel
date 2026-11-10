const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  fullName:String,
  email:{type:String,required:true},
  phone:String,
  dob:Date,
  gender:{type:String,enum:['male','female','other']},
  idNumber:String,
  emergencyName:String,
  emergencyPhone:String,
  bloodType:String,
  allergies:String,
  avatar:String,
  totalSpent:{type:Number,default:0,min:0,validate:Number.isSafeInteger},
  status:{type:String,required:true,default:'active',enum:['active']},
  createdBy:String,
  updatedBy:String,
  deleted:{type:Boolean,default:false},
  deletedBy:String,
  deletedAt:Date
},{timestamps:true});
module.exports=mongoose.model('Customer',schema,'customers');
