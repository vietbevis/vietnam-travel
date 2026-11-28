'use strict';

const { generateKeyPairSync, sign } = require('node:crypto');
const date = value => new Date(value);
const cardId = position => String(position).padStart(32, '0');
const ref = position => String(position).padStart(16, '0');
let keys;
function confirmedTransaction(row, balanceAfter, txCounter) {
  keys ||= generateKeyPairSync('rsa', { modulusLength: 1024 });
  const message = Buffer.alloc(38);
  message[0] = 0x52;
  Buffer.from(row.cardId, 'hex').copy(message, 1);
  message[17] = row.type === 'credit' ? 1 : 2;
  Buffer.from(row.txRef, 'hex').copy(message, 18);
  message.writeUInt32BE(row.amount, 26);
  message.writeUInt32BE(balanceAfter, 30);
  message.writeUInt32BE(txCounter, 34);
  const receiptHex = Buffer.concat([message, sign('sha256', message, keys.privateKey)]).toString('hex');
  return { ...row, status: 'done', signedOpId: '650000000000000000000010', receiptHex, balanceAfter, txCounter };
}

// Các bản ghi được seed ở trạng thái sau xác nhận để kiểm tra kế toán theo kỳ.
// Kiểm chữ ký, callback và replay thực hiện riêng qua suite engine/route.
module.exports = async function seedG3({ Role, Account, Order, Customer, Card, Tx, hash, domain, item }) {
  for (const [key, permissions] of [
    ['dashboard', ['dashboard-view']],
    ['customer', ['customer-view']],
    ['history', ['customer-view', 'order-view', 'card-view']],
    ['issuer', ['card-issue']]
  ]) {
    const role = await Role.create({ name: 'G3 ' + key, permissions });
    await Account.create({ fullName: 'G3 ' + key, email: 'g3-' + key + domain, role: role.id, password: hash, status: 'active' });
  }

  const joined = date('2026-09-01T17:00:00Z');
  const [member, locked, revoked, withoutCard] = await Customer.insertMany([
    { _id: '650000000000000000000003', fullName: 'G3 Đặng Hà (Hồ sơ)', email: 'g3-dang-ha' + domain, phone: '0900000033', totalSpent: 30_000_000 },
    { _id: '650000000000000000000004', fullName: 'G3 Đặng Hà Đã Khóa', email: 'g3-locked-card' + domain, totalSpent: 10_000_000 },
    { _id: '650000000000000000000005', fullName: 'G3 Thẻ Đã Thu Hồi', email: 'g3-revoked-card' + domain, totalSpent: 9_999_999 },
    { _id: '650000000000000000000006', fullName: 'G3 Chưa Phát Hành', email: 'g3-no-card' + domain, totalSpent: 80_000_000 }
  ].map(row => ({ ...row, createdAt: joined })));
  await Customer.insertMany(Array.from({ length: 205 }, (_, index) => ({
    fullName: 'G3 Phân Trang ' + String(index + 1).padStart(3, '0'),
    email: 'g3-page-' + (index + 1) + domain, createdAt: joined
  })));
  await Customer.create({ fullName: 'G3 Khách Xóa Mềm', email: 'g3-deleted' + domain, deleted: true, createdAt: joined });
  const current = cardId(310), old = cardId(309);
  await Card.insertMany([
    { ownerId: member.id, cardId: current, status: 'active', balance: 2_500_000, activatedAt: joined },
    { ownerId: member.id, cardId: old, status: 'revoked', revokedAt: date('2026-11-26T12:00:00Z') },
    { ownerId: locked.id, cardId: cardId(311), status: 'locked' },
    { ownerId: revoked.id, cardId: cardId(312), status: 'revoked' }
  ].map(row => ({ ...row, cardType: 'customer', createdAt: joined })));

  const booked = date('2026-11-03T05:00:00Z');
  const first = date('2026-10-31T17:00:00Z');
  const boundary = date('2026-11-30T17:00:00Z');
  const payout = date('2026-12-31T17:00:00Z');
  const november = day => date('2026-11-' + String(day).padStart(2, '0') + 'T05:00:00Z');
  const paid = (orderCode, paymentMethod, total, paidAt, extra = {}) => ({
    orderCode, paymentMethod, total, paidAt, paidAmount: total, paymentStatus: 'paid', status: 'done', createdAt: booked, ...extra
  });
  const linked = { customerId: member.id, fullName: member.fullName, phone: member.phone };
  const cancellation = (debit, credit) => ({
    ...linked, status: 'cancel', cardTxRef: ref(debit), refundTxRef: ref(credit), deleted: true
  });
  const rows = await Order.insertMany([
    paid('G3-CASH', 'money', 1_200_000, first, { createdAt: new Date(first - 1), fullName: member.fullName, phone: member.phone }),
    paid('G3-BANK-ARCHIVED', 'bank', 850_000, november(10), { ...linked, deleted: true }),
    paid('G3-VNPAY-RESTORED', 'vnpay', 750_000, new Date(boundary - 1), { ...linked, deleted: true, adminVisibleAfterRestore: true }),
    paid('G3-ZALO-NEXT', 'zalopay', 200_000, boundary, { ...linked, createdAt: november(30), items: [{ ...item, ticketStatus: 'written' }] }),
    paid('G3-WALLET-REFUND-DONE', 'card', 600_000, november(12), cancellation(301, 401)),
    paid('G3-WALLET-REFUND-PENDING', 'card', 400_000, november(15), cancellation(302, 402)),
    paid('G3-WALLET-CASH-REFUND', 'card', 100_000, november(21), cancellation(303, 403)),
    { orderCode: 'G3-UNPAID', paymentMethod: 'money', paymentStatus: 'unpaid', status: 'initial', total: 999_999, createdAt: november(30) },
    { orderCode: 'G3-CALLBACK-FAILED', paymentMethod: 'vnpay', paymentStatus: 'unpaid', status: 'initial', total: 960_000, createdAt: november(28) },
    { orderCode: 'G3-OLD-TIME', paymentMethod: 'bank', paymentStatus: 'paid', status: 'done', total: 500_000, createdAt: booked },
    { orderCode: 'G3-OLD-AMOUNT', paymentMethod: 'money', paymentStatus: 'paid', status: 'done', createdAt: booked }
  ]);
  await Order.insertMany(Array.from({ length: 11 }, (_, index) => ({
    ...linked, orderCode: 'G3-HISTORY-' + String(index + 1).padStart(2, '0'),
    createdAt: date('2026-10-15T03:00:00Z'), total: 150_000,
    paymentMethod: 'money', paymentStatus: 'unpaid', status: 'cancel', deleted: true
  })));
  const [, , , , refundOnCard, refundPending, refundCash] = rows;
  const originalPayment = (order, number, balance, counter) => confirmedTransaction({
    txRef: ref(number), cardId: old, type: 'debit', source: 'order', amount: order.total,
    orderId: order.id, createdAt: order.createdAt, completedAt: order.paidAt
  }, balance, counter);
  const refund = (order, number, extra) => ({
    txRef: ref(number), cardId: current, type: 'credit', source: 'refund', amount: order.total,
    status: 'pending-card', orderId: order.id, createdAt: november(25), ...extra
  });
  await Tx.insertMany([
    originalPayment(refundOnCard, 301, 1_700_000, 1),
    originalPayment(refundPending, 302, 1_300_000, 2),
    originalPayment(refundCash, 303, 1_200_000, 3),
    refund(refundOnCard, 401, { cardId: old, status: 'failed', failReason: 'moved' }),
    confirmedTransaction({ txRef: ref(411), cardId: current, type: 'credit', source: 'refund', amount: 600_000,
      movedFrom: ref(401), createdAt: november(26), completedAt: boundary }, 1_800_000, 1),
    refund(refundPending, 402),
    refund(refundCash, 403, { cardId: old, status: 'failed', failReason: 'refunded' }),
    { txRef: ref(413), cardId: old, type: 'debit', source: 'refund', amount: 100_000, status: 'done', movedFrom: ref(403), createdAt: payout },
    confirmedTransaction({ txRef: ref(501), cardId: current, type: 'credit', source: 'cash', amount: 700_000,
      createdAt: november(24), completedAt: new Date(boundary.getTime() + 1000) }, 2_500_000, 2),
    { txRef: ref(502), cardId: current, type: 'credit', source: 'vnpay', amount: 250_000, status: 'reconciliation',
      reconciliationReason: 'wallet-cap', createdAt: booked, paymentReceivedAt: november(25) },
    { txRef: ref(503), cardId: current, type: 'credit', source: 'zalopay', amount: 80_000, status: 'awaiting-payment', createdAt: november(25) },
    { txRef: ref(504), cardId: current, type: 'credit', source: 'zalopay', amount: 20_000, status: 'failed',
      failReason: 'gateway', createdAt: november(25) },
    { txRef: ref(505), cardId: current, type: 'credit', source: 'transfer', amount: 2_000_000, status: 'pending-card', createdAt: november(26) },
    { txRef: ref(506), cardId: current, type: 'debit', source: 'order', amount: 123_000, status: 'sent', createdAt: november(29) }
  ]);
  return { customerId: member.id, lockedId: locked.id, revokedId: revoked.id, withoutCardId: withoutCard.id };
};
module.exports.confirmedTransaction = confirmedTransaction;
