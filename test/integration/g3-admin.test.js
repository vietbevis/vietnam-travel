const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const cookies = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../helpers/db');
const Account = require('../../models/account-admin.model');
const Role = require('../../models/role.model');
const Order = require('../../models/order.model');
const Customer = require('../../models/customer.model');
const Card = require('../../models/card.model');
const CardLog = require('../../models/card-log.model');
const Tx = require('../../models/card-transaction.model');
const payment = require('../../helpers/order-payment.helper');

const it = (name, fn) => test(name, { skip: !db.enabled }, fn);
let server, base;
before(async () => {
  if (!db.enabled) return;
  process.env.JWT_SECRET = 'g3-isolated-test';
  global.pathAdmin = 'admin';
  await db.connect();
  for (const model of [Account, Role, Order, Customer, Card, Tx]) await model.init();
  const app = express();
  app.set('view engine', 'pug');
  app.set('views', path.resolve('views'));
  app.locals.pathAdmin = 'admin';
  app.locals.messages = {};
  app.use(express.json(), cookies());
  app.use('/admin', require('../../routes/admin/index.route'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
beforeEach(async () => { if (db.enabled) await db.reset(); });
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db.enabled) await db.close();
});

async function actor(...permissions) {
  const role = await Role.create({ name: 'G3 test', permissions });
  const account = await Account.create({ email: role.id + '@example.test', fullName: 'G3 Staff', role: role.id, status: 'active' });
  return jwt.sign({ id: account.id, email: account.email }, process.env.JWT_SECRET);
}
function request(route, token, body) {
  return fetch(base + '/admin' + route, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { cookie: 'token=' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
}
const time = value => new Date(value + 'Z');
const nov = time('2026-10-31T17:00:00');
const dec = time('2026-11-30T17:00:00');
const item = { name: 'G3 Ticket', ticketStatus: 'used' };

it('settlement ghi snapshot và mốc một lần, rollback khi cập nhật khách lỗi', async t => {
  for (const method of ['money', 'bank', 'vnpay', 'zalopay']) {
    const order = await Order.create({ paymentMethod: method, paymentStatus: 'unpaid', total: 900, createdAt: nov });
    const started = new Date();
    assert.equal(await payment.markOrderPaid({ _id: order.id }, method), true);
    const paid = await Order.collection.findOne({ _id: order._id });
    assert.equal(paid.paymentStatus, 'paid');
    assert.equal(paid.paidAmount, 900);
    assert.ok(paid.paidAt instanceof Date && paid.paidAt >= started && paid.paidAt <= new Date());
    assert.equal(await payment.markOrderPaid({ _id: order.id }, method), false);
    assert.deepEqual((await Order.findById(order.id)).paidAt, paid.paidAt);
  }
  const customer = await Customer.create({ email: 'rollback@example.test' });
  const order = await Order.create({ paymentMethod: 'money', paymentStatus: 'unpaid', total: 450, customerId: customer.id });
  t.mock.method(Customer, 'updateOne', () => { throw new Error('fixture customer write failure'); });
  await assert.rejects(payment.markOrderPaid({ _id: order.id }, 'money'), /fixture customer write failure/);
  const stored = await Order.collection.findOne({ _id: order._id });
  assert.equal(stored.paymentStatus, 'unpaid');
  assert.equal(stored.paidAt, undefined);
  assert.equal(stored.paidAmount, undefined);
});

it('Dashboard đối chiếu gộp/method/ròng trên thời điểm sự kiện VN và tách legacy', async () => {
  const token = await actor('dashboard-view', 'card-view', 'order-view');
  const customer = await Customer.create({ email: 'credit@example.test' });
  const cardId = 'A'.repeat(32);
  await Card.create({ cardId, cardType: 'customer', ownerId: customer.id, status: 'active' });
  const sale = (paymentMethod, paidAmount, other = {}) => ({
    paymentMethod, total: paidAmount, paidAmount, paidAt: nov, paymentStatus: 'paid', status: 'done',
    createdAt: time('2026-10-01T04:00:00'), deleted: false, ...other
  });
  const [wallet] = await Order.insertMany([
    sale('card', 400, { customerId: customer.id, status: 'cancel', deleted: true, cardTxRef: '1111111111111111', refundTxRef: '2222222222222222' }),
    sale('money', 100), sale('bank', 200, { deleted: true, adminVisibleAfterRestore: true }),
    sale('vnpay', 300, { paidAt: new Date(dec - 1) }), sale('zalopay', 500, { paidAt: dec }),
    sale('money', 900, { paymentStatus: 'unpaid', paidAmount: undefined, paidAt: undefined }),
    sale('bank', 999, { paidAmount: undefined, paidAt: undefined }),
    sale('money', undefined, { paidAt: undefined })
  ]);
  const { confirmedTransaction } = require('../../scripts/acceptance-g3-seed.cjs');
  await Tx.insertMany([
    confirmedTransaction({ txRef: wallet.cardTxRef, orderId: wallet.id, cardId, type: 'debit', source: 'order', amount: 400, completedAt: nov }, 600, 1),
    { txRef: wallet.refundTxRef, orderId: wallet.id, cardId, type: 'credit', source: 'refund', amount: 400, status: 'failed', failReason: 'moved', createdAt: nov },
    confirmedTransaction({ txRef: '3333333333333333', cardId, type: 'credit', source: 'refund', amount: 400,
      movedFrom: wallet.refundTxRef, completedAt: dec }, 1000, 2),
    confirmedTransaction({ txRef: '4444444444444444', cardId, type: 'credit', source: 'cash', amount: 800,
      createdAt: nov, completedAt: dec }, 1800, 3),
    { txRef: '5555555555555555', cardId, type: 'credit', source: 'transfer', amount: 2000, status: 'pending-card', createdAt: nov },
    { txRef: '6666666666666666', cardId, type: 'credit', source: 'refund', amount: 3000, status: 'done', createdAt: dec, completedAt: dec }
  ]);
  const chart = (month, year, access = token) => request('/dashboard/revenue-chart', access, {
    currentMonth: month, currentYear: year, arrayDay: [31, 31]
  });
  const response = await chart(11, 2026);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.period.days.length, 30);
  assert.deepEqual(result.period.methods, { money: 100, bank: 200, vnpay: 300, zalopay: 0, card: 400 });
  assert.equal(result.period.gross, 1000);
  assert.equal(result.period.refunded, 0);
  assert.equal(result.period.net, 1000);
  assert.equal(result.period.days[0].net, 700);
  assert.equal(result.period.days[29].net, 300);
  assert.equal(result.period.refundObligations, 400);
  assert.equal(result.wallet.topupReceived, 800);
  assert.equal(result.wallet.topupChip, 0);
  assert.equal(result.reconciliation.salesMissingTime.count, 2);
  assert.equal(result.reconciliation.salesMissingAmount, 1);
  const december = await (await chart(12, 2026)).json();
  assert.equal(december.period.refunded, 400);
  assert.equal(december.period.net, 100);
  assert.equal(december.wallet.topupChip, 800);
  for (const [month, year, days] of [[2, 2025, 28], [2, 2024, 29], [1, 2027, 31]]) {
    const empty = await (await chart(month, year)).json();
    assert.equal(empty.period.days.length, days);
    assert.ok(empty.period.days.every(day => day.net === 0));
    if (month === 1) assert.equal(empty.previous.year, 2026);
  }
  assert.equal((await chart(13, 2026)).status, 400);
  assert.equal((await chart(1, 2026, await actor('card-view'))).status, 403);
  assert.equal((await chart(1, 2026, '')).status, 401);
  const dashboardOnly = await (await chart(11, 2026, await actor('dashboard-view'))).json();
  assert.equal(dashboardOnly.wallet, undefined);
  assert.equal(dashboardOnly.period.gross, 1000);
});

it('Danh sách khách hơn 200, tìm literal/có dấu, lọc trước phân trang và giữ quyền các tab', async () => {
  const staff = await actor('customer-view', 'order-view', 'order-trash', 'card-view');
  const customerReadOnly = await actor('customer-view');
  const issuer = await actor('card-issue');
  const other = await Customer.create({ fullName: 'Khách thứ hai', email: 'other@example.test' });
  const customer = await Customer.create({ fullName: 'Đặng Hà (G3)', email: 'unique@example.test', phone: '0900000033', totalSpent: 30000000 });
  await Customer.insertMany(Array.from({ length: 205 }, (_, i) => ({ fullName: 'Fixture G3 ' + i, email: i + '@example.test' })));
  await Customer.create({ fullName: 'Đã xóa', email: 'deleted@example.test', deleted: true });
  await Card.insertMany([
    { cardId: 'B'.repeat(32), cardType: 'customer', ownerId: customer.id, status: 'revoked', balance: 1000 },
    { cardId: 'C'.repeat(32), cardType: 'customer', ownerId: customer.id, status: 'locked', balance: 2000 }
  ]);
  await Card.collection.updateOne({ cardId: 'C'.repeat(32) }, { $set: { issuance: { pinCipher: 'PIN_SECRET_TEST' } } });
  await Order.insertMany([
    { orderCode: 'G3-LINKED', customerId: customer.id, paymentStatus: 'paid', total: 400, deleted: true, status: 'cancel', items: [item] },
    { orderCode: 'G3-GUEST', fullName: customer.fullName, phone: customer.phone },
    { orderCode: 'G3-OTHER', customerId: other.id }
  ]);
  const list = route => request('/user/list' + route, staff).then(response => response.text());
  assert.match(await list('?page=999'), /Hiển thị 201 - 207 của 207/);
  for (const keyword of ['Dang Ha', 'Đặng Hà', '(G3)', 'unique@', '0900000033']) {
    const page = await list('?keyword=' + encodeURIComponent(keyword) + '&cardStatus=locked&tier=gold');
    assert.match(page, /Hiển thị 1 - 1 của 1/);
    assert.match(page, /Đặng Hà/);
  }
  assert.match(await list('?keyword=.*'), /Không có khách hàng phù hợp/);
  assert.match(await list('?cardStatus=none'), /của 206/);
  assert.match(await list('?cardStatus=revoked'), /Không có khách hàng phù hợp/);
  const detail = '/user/detail/' + customer.id;
  const orders = await request(detail + '?tab=orders', staff).then(response => response.text());
  assert.match(orders, /G3-LINKED/);
  assert.doesNotMatch(orders, /G3-GUEST|G3-OTHER|PIN_SECRET_TEST/);
  assert.match(await request(detail + '?tab=tickets', staff).then(response => response.text()), /G3 Ticket/);
  const noTrash = await actor('customer-view', 'order-view', 'card-view');
  assert.doesNotMatch(await request(detail + '?tab=orders', noTrash).then(response => response.text()), /G3-LINKED/);
  assert.doesNotMatch(await request(detail + '?tab=tickets', noTrash).then(response => response.text()), /G3 Ticket/);
  assert.equal((await request(detail + '?tab=wallet', customerReadOnly)).status, 403);
  assert.equal((await request(detail, issuer)).status, 403);
  assert.equal((await request('/user/detail/invalid', staff)).status, 404);
  assert.equal((await request('/user/detail/' + '0'.repeat(24), staff)).status, 404);
  assert.equal((await request(detail, staff, { totalSpent: 0 })).status, 404);
  assert.equal((await Customer.findById(customer.id)).totalSpent, 30000000);
});

it('Oracle nghiệm thu cố định kiểm hoàn qua chip/tiền mặt, âm khác kỳ và nghĩa vụ nạp', async () => {
  const seed = require('../../scripts/acceptance-g3-seed.cjs');
  const fixture = await seed({ Role, Account, Order, Customer, Card, Tx, hash: 'fixture-only',
    domain: '@fixture.test', item: { name: 'G3 Ticket' } });
  const token = await actor('dashboard-view', 'order-view', 'order-trash', 'customer-view', 'card-view');
  const read = async (currentMonth, currentYear) => {
    const response = await request('/dashboard/revenue-chart', token, { currentMonth, currentYear });
    assert.equal(response.status, 200);
    return response.json();
  };
  const november = await read(11, 2026);
  assert.equal(november.period.orderCount, 10);
  assert.equal(november.period.net, 3_900_000);
  assert.equal(november.period.refundObligations, 1_100_000);
  assert.equal(november.reconciliation.refundsPending, 400_000);
  assert.equal(november.reconciliation.salesMissingTime.snapshotAmount, 500_000);
  assert.equal(november.wallet.topupReceived, 950_000);
  assert.equal(november.wallet.topupCapHeld, 250_000);
  assert.equal(november.wallet.topupAwaitingPayment, 80_000);
  assert.equal(november.wallet.topupFailed, 20_000);
  assert.deepEqual(november.wallet.unresolvedDebit, { count: 1, amount: 123_000 });
  assert.deepEqual(november.wallet.unlinkedDebit, { count: 0, amount: 0 });
  assert.deepEqual(november.wallet.unlinkedDebit, { count: 0, amount: 0 });
  const december = await read(12, 2026);
  assert.equal(december.previous.orderCount, 10);
  assert.equal(december.period.net, -400_000);
  assert.equal(december.period.refundChip, 600_000);
  assert.equal(december.wallet.topupChip, 700_000);
  const january = await read(1, 2027);
  assert.equal(january.period.net, -100_000);
  assert.equal(january.period.refundCash, 100_000);
  assert.equal(january.period.days[0].net, -100_000);
  const member = '/user/detail/' + fixture.customerId;
  const wallet = await request(member + '?tab=wallet&pageSize=5&page=999', token).then(response => response.text());
  assert.match(wallet, /Hiển thị 11 - 14 của 14/);
  const cards = await request(member + '?tab=cards', token).then(response => response.text());
  assert.match(cards, /Đã thu hồi/);
  assert.doesNotMatch(cards, /00000000000000000000000000000311/);
  const revoked = await request('/user/list?cardStatus=revoked', token).then(response => response.text());
  assert.match(revoked, /Hiển thị 1 - 1 của 1/);
  assert.match(revoked, /G3 Thẻ Đã Thu Hồi/);
});

it('Đối soát giữ tiền cổng đã thu, nghĩa vụ thẻ cũ và receipt muộn duy nhất', async () => {
  const token = await actor('dashboard-view', 'customer-view', 'card-view');
  const customer = await Customer.create({ email: 'owner@example.test' });
  const old = await Card.create({ ownerId: customer.id, cardType: 'customer', cardId: 'B'.repeat(32), status: 'revoked' });
  const missing = 'C'.repeat(32);
  await Tx.insertMany([
    { txRef: 'B'.repeat(16), cardId: old.cardId, source: 'vnpay', type: 'credit', amount: 321000,
      status: 'reconciliation', reconciliationReason: 'card-unavailable', paymentReceivedAt: nov },
    { txRef: 'C'.repeat(16), cardId: missing, source: 'zalopay', type: 'credit', amount: 789000,
      status: 'reconciliation', reconciliationReason: 'card-unavailable', paymentReceivedAt: nov },
    { txRef: 'D'.repeat(16), cardId: old.cardId, source: 'order', type: 'debit', amount: 456000,
      status: 'failed', failReason: 'not-on-card' }
  ]);
  const log = { cardId: old.cardId, action: 'card-receipt-recovery', result: 'fail', actorType: 'system',
    detail: { releasedButApplied: true, txRef: 'D'.repeat(16), amount: 456000, type: 'debit' } };
  await CardLog.insertMany([log, log]);
  const report = await (await request('/dashboard/revenue-chart', token, { currentMonth: 11, currentYear: 2026 })).json();
  assert.equal(report.wallet.topupReceived, 1110000);
  assert.equal(report.wallet.topupPending, 1110000);
  assert.deepEqual(report.wallet.lateDebit, { count: 1, amount: 456000 });
  assert.equal(report.period.gross, 0);
  const profile = await request('/user/detail/' + customer.id, token).then(r => r.text());
  assert.match(profile, /321\.000 đ/);
  assert.match(profile, /456\.000 đ/);
  assert.doesNotMatch(profile, /789\.000 đ/);
});

it('Chứng cứ chip có hình thức hex nhưng lệch amount bị loại và báo đối soát', async () => {
  const token = await actor('dashboard-view', 'customer-view', 'card-view');
  const customer = await Customer.create({ email: 'receipt-owner@example.test' });
  const card = await Card.create({ ownerId: customer.id, cardType: 'customer', cardId: 'B'.repeat(32), status: 'active' });
  const order = await Order.create({ cardTxRef: 'D'.repeat(16), customerId: customer.id, paymentMethod: 'card',
    paymentStatus: 'paid', paidAt: nov, paidAmount: 456000, total: 456000 });
  const { confirmedTransaction } = require('../../scripts/acceptance-g3-seed.cjs');
  const tx = confirmedTransaction({ cardId: card.cardId, txRef: order.cardTxRef, source: 'order',
    type: 'debit', amount: 455999, orderId: order.id, completedAt: nov }, 9999, 1);
  await Tx.create({ ...tx, amount: 456000 });
  const report = await (await request('/dashboard/revenue-chart', token, { currentMonth: 11, currentYear: 2026 })).json();
  assert.equal(report.period.gross, 0);
  assert.equal(report.reconciliation.salesUnverifiedAmount, 1);
  const profile = await request('/user/detail/' + customer.id, token).then(r => r.text());
  assert.doesNotMatch(profile, /9\.999 đ/);
  const history = await request('/user/detail/' + customer.id + '?tab=wallet', token).then(r => r.text());
  assert.match(history, /Cần đối soát/);
  assert.doesNotMatch(history, new RegExp(tx.receiptHex.slice(0, 52), 'i'));
});
