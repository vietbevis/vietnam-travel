const mongoose = require("mongoose");

// Giữ mọi trường item cũ chưa được khai báo, không tự thêm _id vào dữ liệu cũ.
const itemSchema = new mongoose.Schema({
  ticketStatus: {
    type: String,
    enum: ['none', 'pending', 'written', 'used', 'pending-delete', 'deleted'],
    default: 'none'
  },
  checkedInAt: Date,
  checkedInBy: String
}, { strict: false, _id: false });

const schema = new mongoose.Schema(
  {
    orderCode: String,
    fullName: String,
    phone: String,
    note: String,
    items: [itemSchema],
    customerId: String,
    cardTxRef: { type: String, match: /^[a-fA-F0-9]{16}$/, uppercase: true },
    subTotal: Number,
    discount: {
      type: Number,
      default: 0
    },
    total: Number,
    paymentMethod: String,
    paymentStatus: String,
    status: String,
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

const Order = mongoose.model('Order', schema, "orders");

module.exports = Order;
