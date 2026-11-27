const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  state: { type: String, enum: ['booked', 'expired'], required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model('CheckoutAttempt', schema, 'checkout-attempts');
