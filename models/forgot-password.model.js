const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    email: String,
    otp: String,
    purpose: String,
    key: String,
    cardId: String,
    customerId: String,
    otpHash: String,
    salt: String,
    attempts: {type:Number,default:0},
    consumedAt: Date,
    windowStart: Date,
    count: Number,
    nextSendAt: Date,
    emailStatus: String,
    expireAt: {
      type: Date,
      expires: 0
    }
  },
  {
    timestamps: true, // Tự động sinh ra trường createdAt và updatedAt
  }
);
schema.index({key:1},{unique:true,sparse:true});

const ForgotPassword = mongoose.model('ForgotPassword', schema, "forgot-password");

module.exports = ForgotPassword;
