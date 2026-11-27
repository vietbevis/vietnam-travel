const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { createHmac, randomBytes } = require('node:crypto');
const db = require('../helpers/db');
const access = require('../../helpers/checkout-access.helper');
const Order = require('../../models/order.model');
const Tour = require('../../models/tour.model');
const City = require('../../models/city.model');
const Customer = require('../../models/customer.model');
const Card = require('../../models/card.model');

const it = (name, run) => test(name, { skip: !db.enabled }, run);
let server, base, city, tour;
before(async () => {
  if (!db.enabled) return;
  process.env.JWT_SECRET = 'g16-checkout-test-only';
  await db.connect();
  await Promise.all([Order, Tour, City, Customer, Card].map(model => model.init()));
  const app = express();
  app.set('view engine', 'pug');
  Object.assign(app.locals, { messages: {}, settingWebsiteInfo: {}, categoryList: [] });
  app.use(cookieParser(), express.json());
  app.use((req, res, next) => {
    if (req.path === '/order/create' && req.get('x-fixture-drop') === 'yes') res.json = () => res.destroy();
    next();
  });
  app.use(require('../../middlewares/client/customer-auth.middleware').optional);
  app.use('/order', require('../../routes/client/order.route'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
beforeEach(async () => {
  if (!db.enabled) return;
  await db.reset();
  city = await City.create({ name: 'Fixture city' });
  tour = await makeTour('Fixture tour');
});
after(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await db.close();
});

function makeTour(name) {
  return Tour.create({
    name, status: 'active', locations: [city.id], departureDate: new Date('2030-12-01'),
    priceNewAdult: 50000, priceNewChildren: 25000, priceNewBaby: 0, stockAdult: 3, stockChildren: 3, stockBaby: 3
  });
}

function request(url, { cookie, body, drop } = {}) {
  return fetch(base + '/order/' + url, {
    method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(drop ? { 'x-fixture-drop': 'yes' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000)
  });
}

async function start(cookie) {
  const response = await request('checkout-session', { cookie });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie, intentId: (await response.json()).intentId };
}

function place(checkout, items, options = {}) {
  return request('create', {
    cookie: checkout.cookie, drop: options.drop,
    body: {
      fullName: 'Private fixture guest', phone: '0901234567', paymentMethod: options.method || 'money',
      items: items || [{ tourId: tour.id, locationFrom: city.id, quantityAdult: 1, quantityChildren: 0, quantityBaby: 0 }],
      intentId: checkout.intentId
    }
  });
}

async function member() {
  const customer = await Customer.create({ email: 'member@example.invalid', fullName: 'Member fixture' });
  const card = await Card.create({ ownerId: customer.id, cardType: 'customer', status: 'active', cardId: customer.id.repeat(2).slice(0,32) });
  const token = jwt.sign({ customerId: customer.id, cardId: card.cardId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { customer, ...(await start('customerToken=' + token)) };
}

it('concurrent guest clicks and repeated requests for the last seat return the same order', async () => {
  await Tour.updateOne({ _id: tour.id }, { stockAdult: 1 });
  const guest = await start();
  const replies = await Promise.all([place(guest), place(guest), place(guest)]);
  assert.deepEqual(replies.map(r => r.status), [200, 200, 200]);
  const results = await Promise.all(replies.map(r => r.json()));
  assert.equal(new Set(results.map(r => r.orderId)).size, 1);
  assert.equal(results.filter(r => !r.replayed).length, 1);
  assert.equal(await Order.countDocuments(), 1);
  const row = await Order.findOne().select('+checkout').lean();
  assert.match(row.checkout.scope, /^guest:[a-f0-9]{64}$/);
  assert.ok(!guest.cookie.includes(row.checkout.scope.slice(6)));
  assert.equal((await Tour.findById(tour.id)).stockAdult, 0);
});

it('retry after the response is dropped following commit preserves the order and stock', async () => {
  const guest = await start();
  await assert.rejects(place(guest, undefined, { drop: true }), /fetch failed/);
  const stored = await Order.findOne();
  assert.ok(stored);
  const recovered = await request('checkout-status', { cookie: guest.cookie, body: { intentId: guest.intentId } });
  const result = await recovered.json();
  assert.equal(result.orderId, stored.id);
  assert.ok(!Object.hasOwn(result, 'phone') && !Object.hasOwn(result, 'fullName'));
  const retry = await (await place(guest)).json();
  assert.equal(retry.orderId, stored.id);
  assert.equal(retry.replayed, true);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Tour.findById(tour.id)).stockAdult, 2);
});

it('a committed intent refuses changes to the guest count or selected tour', async () => {
  const guest = await start();
  assert.equal((await place(guest)).status, 200);
  const second = await makeTour('Another tour');
  const changed = [
    { tourId: tour.id, quantityAdult: 2 },
    { tourId: second.id, quantityAdult: 1 }
  ];
  for (const item of changed) {
    const response = await place(guest, [{ ...item, locationFrom: city.id, quantityChildren: 0, quantityBaby: 0 }]);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).errorCode, 'INTENT_CONFLICT');
  }
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Tour.findById(second.id)).stockAdult, 3);
});

it('guest cookies and member sessions authorize only their own orders and intents', async () => {
  const guest = await start();
  const otherGuest = await start();
  const a = await member();
  const b = await member();
  const guestOrder = await (await place(guest)).json();
  const memberOrder = await (await place(a)).json();
  assert.equal((await place({ cookie: otherGuest.cookie, intentId: guest.intentId })).status, 400);
  assert.equal((await request('checkout-status', { cookie: otherGuest.cookie, body: { intentId: guest.intentId } })).status, 400);
  assert.equal((await place({ cookie: b.cookie, intentId: a.intentId })).status, 400);
  assert.equal((await (await place(a)).json()).orderId, memberOrder.orderId);
  for (const [order, owner, foreign] of [
    [guestOrder, guest.cookie, otherGuest.cookie], [memberOrder, a.cookie, b.cookie]
  ]) {
    const url = 'success?orderId=' + order.orderId;
    assert.match(await (await request(url, { cookie: owner })).text(), /Private fixture guest/);
    assert.equal((await request(url, { cookie: foreign })).headers.get('location'), '/');
    assert.equal((await request(url + '&phone=0901234567')).headers.get('location'), '/');
  }
  const legacy = await Order.create({ orderCode: 'LEGACY', phone: '0901234567' });
  assert.equal((await request('success?orderId='+legacy.id+'&phone=0901234567', { cookie:guest.cookie })).headers.get('location'), '/');
  assert.equal((await Order.findById(guestOrder.orderId)).customerId, undefined);
  assert.equal((await Order.findById(memberOrder.orderId)).customerId, a.customer.id);
});

it('an expired intent can neither recreate a committed order nor create a first order', async t => {
  const guest = await start();
  const first = await (await place(guest)).json();
  const stored = await Order.findById(first.orderId).select('+checkout').lean();
  const oldIntent = access.issueIntent(stored.checkout.scope, Date.now() - 25 * 3600000);
  const expired = await place({ cookie: guest.cookie, intentId: oldIntent });
  assert.equal(expired.status, 409);
  assert.equal((await expired.json()).errorCode, 'INTENT_EXPIRED');
  const future = Date.now() + 25 * 3600000;
  const clock = t.mock.method(Date, 'now', () => future);
  try {
    const expiredReplay = await place(guest);
    assert.equal(expiredReplay.status, 409);
    assert.equal((await expiredReplay.json()).errorCode, 'INTENT_EXPIRED');
  } finally {
    clock.mock.restore();
  }
  const original = await Order.findById(first.orderId).select('+checkout').lean();
  assert.deepEqual(original.checkout, stored.checkout);
  assert.equal(await Order.countDocuments(), 1);
  await Order.updateOne({ _id: first.orderId }, { deleted: true });
  const replay = await place(guest);
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).errorCode, 'INTENT_CLOSED');
  assert.equal((await Tour.findById(tour.id)).stockAdult, 2);
});

it('an Order write failure rolls back stock and can retry with the original intent', async t => {
  const guest = await start();
  const failure = t.mock.method(Order.prototype, 'save', async () => { throw new Error('fixture error writing Order'); });
  const failed = await (await place(guest)).json();
  assert.equal(failed.errorCode, 'ORDER_CREATE_FAILED');
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Tour.findById(tour.id)).stockAdult, 3);
  failure.mock.restore();
  assert.equal((await (await place(guest)).json()).replayed, false);
  assert.equal(await Order.countDocuments(), 1);
});

it('expired checkout distinguishes a fenced failed attempt from an order committed after its response was lost', async t => {
  const guest = await start();
  const beforeExpiry = await start(guest.cookie);
  const failure = t.mock.method(Order.prototype, 'save', async () => { throw new Error('fixture abort'); });
  assert.equal((await (await place(beforeExpiry)).json()).errorCode, 'ORDER_CREATE_FAILED');
  failure.mock.restore();
  await assert.rejects(place(guest, undefined, { drop: true }), /fetch failed/);
  const stored = await Order.findOne().select('+checkout').lean();
  const status = intentId => request('checkout-status', { cookie: guest.cookie, body: { intentId } });
  const issuedAt = Date.now() - 1000;
  const oldKey = randomBytes(16).toString('hex');
  const oldSignature = createHmac('sha256', process.env.SESSION_SECRET || process.env.JWT_SECRET)
    .update(JSON.stringify(['tour-intent-v1', stored.checkout.scope, oldKey, issuedAt])).digest('hex');
  const originalClock = Date.now();
  t.mock.method(Date, 'now', () => originalClock + 25 * 3600000);
  assert.equal((await (await status(guest.intentId)).json()).orderId, String(stored._id));
  const [a, b] = await Promise.all([status(beforeExpiry.intentId), status(beforeExpiry.intentId)]);
  for (const result of [a, b]) {
    assert.equal(result.status, 409);
    assert.equal((await result.json()).errorCode, 'INTENT_EXPIRED_NOT_CREATED');
  }
  assert.equal((await (await status([oldKey, issuedAt, oldSignature].join('.'))).json()).errorCode, 'INTENT_EXPIRED');
  assert.equal((await (await place(beforeExpiry)).json()).errorCode, 'INTENT_EXPIRED');
  const other = await start();
  assert.equal((await request('checkout-status', { cookie: other.cookie, body: { intentId: beforeExpiry.intentId } })).status, 400);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Tour.findById(tour.id)).stockAdult, 2);
});

it('expiry status and a request already writing the same order converge on its committed result', async t => {
  const guest = await start();
  const originalSave = Order.prototype.save;
  const writing = Promise.withResolvers(), release = Promise.withResolvers();
  t.mock.method(Order.prototype, 'save', async function (...args) {
    writing.resolve();
    await release.promise;
    return originalSave.apply(this, args);
  });
  const submit = place(guest);
  await writing.promise;
  const originalClock = Date.now();
  t.mock.method(Date, 'now', () => originalClock + 25 * 3600000);
  const status = request('checkout-status', { cookie: guest.cookie, body: { intentId: guest.intentId } });
  await new Promise(resolve => setTimeout(resolve, 75));
  release.resolve();
  const [placed, resolved] = await Promise.all([submit, status]);
  assert.equal(placed.status, 200);
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).orderId, (await placed.json()).orderId);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Tour.findById(tour.id)).stockAdult, 2);
});

it('gateway and processing URLs require ownership while an anonymous payment-return page is neutral', async () => {
  const guest = await start();
  const other = await start();
  const order = await (await place(guest, undefined, { method: 'vnpay' })).json();
  for (const route of ['processing', 'payment-vnpay', 'payment-zalopay']) {
    assert.equal((await request(route + '?orderId=' + order.orderId, { cookie: other.cookie })).headers.get('location'), '/');
  }
  assert.match(await (await request('processing?orderId=' + order.orderId, { cookie: guest.cookie })).text(), /Mã đơn hàng/);
  const returned = await request('success?orderId=' + order.orderId + '&return=payment');
  assert.equal(returned.status, 200);
  const html = await returned.text();
  assert.match(html, /Mở đơn hàng/);
  assert.doesNotMatch(html, /Private fixture guest|0901234567|Mã đơn hàng/);
  const resume = 'processing?orderId=' + order.orderId + '&return=resume';
  assert.equal((await request(resume)).headers.get('location'), '/account/login?orderId=' + order.orderId + '&destination=processing');
  assert.doesNotMatch(await (await request(resume, { cookie: other.cookie })).text(), /Private fixture guest|0901234567|Mã đơn hàng/);
  assert.match(await (await request(resume, { cookie: guest.cookie })).text(), /Mã đơn hàng/);
});
