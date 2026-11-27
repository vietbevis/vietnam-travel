const mongoose = require("mongoose");

// Giữ mọi trường item cũ chưa được khai báo, không tự thêm _id vào dữ liệu cũ.
const itemSchema = new mongoose.Schema({
  ticketStatus: {
    type: String,
    enum: ['none', 'pending', 'written', 'used', 'pending-delete', 'deleted'],
    default: 'none'
  },
  checkedInAt: Date,
  checkedInBy: String,
  checkinOpId: String
}, { strict: false, _id: false });

const checkoutSchema = new mongoose.Schema({
  scope: { type: String, required: true },
  intent: { type: String, required: true },
  fingerprint: { type: String, required: true },
  issuedAt: { type: Date, required: true }
}, { _id: false });

const schema = new mongoose.Schema(
  {
    orderCode: String,
    fullName: String,
    phone: String,
    note: String,
    items: [itemSchema],
    customerId: String,
    checkout: { type: checkoutSchema, select: false },
    cardTxRef: { type: String, match: /^[a-fA-F0-9]{16}$/, uppercase: true },
    // Credit hoàn tiền về ví thẻ khi admin huỷ đơn đã trừ ví (một lần duy nhất).
    refundTxRef: { type: String, match: /^[a-fA-F0-9]{16}$/, uppercase: true },
    subTotal: Number,
    discount: {
      type: Number,
      default: 0
    },
    total: Number,
    paymentMethod: String,
    paymentStatus: String,
    status: String,
    stockRestoredAt: {
      type: Date,
      default: undefined
    },
    walletHoldExpiresAt: Date,
    walletHoldReleasedAt: Date,
    updatedBy: String,
    deleted: {
      type: Boolean,
      default: false
    },
    deletedBy: String,
    deletedAt: Date
  },
  {
    timestamps: true, // Tự động sinh ra trường createdAt và updatedAt
  }
);

schema.index({ 'checkout.scope': 1, 'checkout.intent': 1 }, {
  name: 'unique_checkout_scope_intent', unique: true,
  partialFilterExpression: { 'checkout.scope': { $type: 'string' }, 'checkout.intent': { $type: 'string' } }
});
schema.index({ paymentMethod: 1, paymentStatus: 1, walletHoldExpiresAt: 1 }, {
  name: 'expiring_wallet_stock_holds', partialFilterExpression: { walletHoldExpiresAt: { $exists: true } }
});

const Order = mongoose.model('Order', schema, "orders");

module.exports = Order;
