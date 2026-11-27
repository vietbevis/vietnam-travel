const mongoose = require('mongoose');
const Order = require('../models/order.model');
const Tx = require('../models/card-transaction.model');
const { restoreOrderStock } = require('./order-stock.helper');

const HOLD_MS = 20 * 60 * 1000;
const EXPIRED_MESSAGE = 'Thời gian giữ chỗ đã hết. Hãy kiểm tra đơn trước khi bắt đầu đơn mới.';
const unpaidWallet = { paymentMethod: 'card', paymentStatus: 'unpaid', status: { $nin: ['cancel', 'cancelled'] }, deleted: false, stockRestoredAt: { $exists: false } };
const holdExpired = (order, now = new Date()) => Boolean(order.walletHoldExpiresAt && order.walletHoldExpiresAt <= now);

async function availableBalance(card, session, exceptOrderId) {
  if (!Number.isSafeInteger(card.balance) || card.balance < 0 || card.balance > 50_000_000) return 0;
  const filter = { ...unpaidWallet, customerId: card.ownerId, walletHoldExpiresAt: { $gt: new Date() } };
  if (exceptOrderId) filter._id = { $ne: exceptOrderId };
  const [holds] = await Order.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: '$total' } } }]).session(session || null);
  const reserved = holds?.total ?? 0;
  return Number.isSafeInteger(reserved) && reserved >= 0 ? Math.max(0, card.balance - reserved) : 0;
}

async function expireWalletHold(orderId, now = new Date()) {
  const { voidUnsignedDebits } = require('./card-op.helper');
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const filter = { ...unpaidWallet, _id: orderId, walletHoldExpiresAt: { $lte: now }, 'items.ticketStatus': { $nin: ['written', 'used', 'pending', 'pending-delete', 'deleted'] }, 'items.checkedInAt': { $exists: false } };
      const order = await Order.findOne(filter).session(session).lean();
      if (!order) return false;
      // Cùng write conflict trên Order/Tx với ký hoặc ghi nhận biên nhận. Giữ chỗ nếu chip có thể đã trừ tiền.
      const debit = { orderId: String(order._id), type: 'debit' };
      if (await Tx.exists({ ...debit, $or: [{ status: { $in: ['done', 'sent', 'reconciliation'] } }, { signedOpId: { $exists: true } }] }).session(session)) return false;
      const claimed = await Order.updateOne(filter, { $set: { status: 'cancel', stockRestoredAt: now, walletHoldReleasedAt: now } }, { session });
      if (claimed.modifiedCount !== 1) return false;
      await voidUnsignedDebits(debit, session);
      await restoreOrderStock(order.items, session);
      return true;
    });
  } finally {
    await session.endSession();
  }
}

function startWalletHoldRelease() {
  let running = false;
  const timer = setInterval(async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      const now = new Date();
      const holds = Order.find({ ...unpaidWallet, walletHoldExpiresAt: { $lte: now } }).select('_id').lean().cursor();
      for await (const { _id } of holds) {
        try { await expireWalletHold(_id, now); }
        catch { console.error('[Ví thẻ] Hoàn chỗ tự động đang chờ thử lại.'); }
      }
    } catch {
      console.error('[Ví thẻ] Không thể kiểm tra thời hạn giữ chỗ.');
    } finally {
      running = false;
    }
  }, 60_000);
  timer.unref();
}

module.exports = { HOLD_MS, EXPIRED_MESSAGE, holdExpired, availableBalance, expireWalletHold, startWalletHoldRelease };
