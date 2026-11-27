const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const Order = require('../models/order.model');
const CheckoutAttempt = require('../models/checkout-attempt.model');
const Tour = require('../models/tour.model');
const City = require('../models/city.model');
const checkout = require('../helpers/checkout-access.helper');
const { createPost } = require('../controllers/client/order.controller');

test('checkout writes a server-priced snapshot from validated booking fields without mutating the caller input', async t => {
  const tourId = '1'.repeat(24);
  const locationFrom = '2'.repeat(24);
  const departureDate = new Date('2030-12-01T00:00:00.000Z');
  const customer = { _id: '3'.repeat(24) };
  const previousKey = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'checkout-snapshot-fixture';
  t.after(() => {
    if (previousKey === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousKey;
  });
  t.mock.method(Order, 'init', async () => {});
  t.mock.method(CheckoutAttempt, 'init', async () => {});
  t.mock.method(CheckoutAttempt, 'updateOne', async () => ({ upsertedCount: 1 }));
  t.mock.method(Order, 'findOne', () => ({ select: () => ({ session: async () => null }) }));
  t.mock.method(mongoose, 'startSession', async () => ({ withTransaction: work => work(), endSession: async () => {} }));
  t.mock.method(Tour, 'exists', async () => true);
  t.mock.method(Tour, 'findOneAndUpdate', async () => ({ name: 'Fixture', locations: [locationFrom], departureDate, priceNewAdult: 50000, priceNewChildren: 25000, priceNewBaby: 0 }));
  t.mock.method(City, 'exists', () => ({ session: async () => true }));
  const save = t.mock.method(Order.prototype, 'save', async function () {
    assert.equal(this.items[0].locationFrom, locationFrom);
    assert.equal(this.items[0].departureDate.toISOString(), departureDate.toISOString());
    assert.equal(this.total, 50000);
    assert.equal(this.paymentStatus, 'unpaid');
  });
  const body = { fullName: 'Fixture', phone: '0901111111', paymentMethod: 'money', intentId: checkout.issueIntent('customer:' + customer._id), items: [{ tourId, locationFrom, quantityAdult: 1, quantityChildren: 0, quantityBaby: 0 }] };
  const original = structuredClone(body);
  const res = { set() {}, json(data) { this.body = data; } };
  await createPost({ body, customer }, res);
  assert.equal(res.body.code, 'success');
  assert.equal(save.mock.callCount(), 1);
  assert.deepEqual(body, original);
});
