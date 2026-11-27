const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const db = require('../helpers/db');
const Tour = require('../../models/tour.model');
const Order = require('../../models/order.model');
const City = require('../../models/city.model');
const Category = require('../../models/category.model');
const controller = require('../../controllers/admin/tour.controller');
const checkout = require('../../controllers/client/order.controller');
const checkoutAccess = require('../../helpers/checkout-access.helper');

const it = (name, run) => test(name, { skip: !db.enabled }, run);
before(async () => {
  if (db.enabled) {
    process.env.JWT_SECRET = 'checkout-trash-fixture';
    await db.connect();
  }
});
beforeEach(async () => { if (db.enabled) await db.reset(); });
after(async () => { if (db.enabled) await db.close(); });

const response = () => ({ set() {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; } });
const admin = (id, permission) => ({ params: { id }, permissions: [permission], account: { id: 'fixture' }, flash() {} });

async function remove(ids) {
  const result = response();
  const req = { permissions: ['tour-trash'], params: { id: ids[0] }, body: { option: 'delete-destroy', ids }, flash() {} };
  await (ids.length === 1 ? controller.deleteDestroyPatch : controller.trashChangeMultiPatch)(req, result);
  return result;
}

it('permanent deletion only deletes inactive tours in trash with no booking history', async () => {
  const active = await Tour.create({ name: 'Fixture active', deleted: false, status: 'active' });
  const archived = await Tour.create({ name: 'Fixture archived', deleted: true, status: 'inactive' });
  const referenced = await Tour.create({ name: 'Fixture retained', deleted: true, status: 'inactive' });
  await Order.create({ orderCode: 'Fixture', deleted: true, items: [{ tourId: referenced.id }] });
  assert.equal((await remove([active.id])).body.code, 'error');
  assert.equal((await remove([archived.id, referenced.id])).body.code, 'error');
  assert.equal(await Tour.countDocuments(), 3);
  assert.equal((await remove([archived.id])).body.code, 'success');
  assert.ok(await Tour.exists({ _id: referenced.id }));
});

it('concurrent booking and soft deletion cannot leave a booking referencing a permanently deleted tour', async () => {
  const city = await City.create({ name: 'Fixture city' });
  const tour = await Tour.create({
    name: 'Fixture concurrent checkout', status: 'active', locations: [city.id], departureDate: new Date('2030-12-01'),
    priceNewAdult: 50000, priceNewChildren: 25000, priceNewBaby: 0, stockAdult: 1, stockChildren: 1, stockBaby: 1
  });
  const placed = response();
  const archived = response();
  const customer = { _id: '1'.repeat(24) };
  await Promise.all([
    checkout.createPost({ customer, body: { fullName: 'Fixture', phone: '0901234567', paymentMethod: 'money', intentId: checkoutAccess.issueIntent('customer:' + customer._id), items: [
      { tourId: tour.id, locationFrom: city.id, quantityAdult: 1, quantityChildren: 0, quantityBaby: 0 }
    ] } }, placed),
    controller.deletePatch(admin(tour.id, 'tour-delete'), archived)
  ]);
  assert.equal(archived.body.code, 'success');
  const orderCount = await Order.countDocuments({ 'items.tourId': tour.id });
  assert.equal(orderCount, placed.body.code === 'success' ? 1 : 0);
  const result = await remove([tour.id]);
  assert.equal(result.body.code, orderCount ? 'error' : 'success');
  assert.equal(Boolean(await Tour.exists({ _id: tour.id })), Boolean(orderCount));
});

it('restore and permanent deletion of the same trash record have exactly one winner', async () => {
  const category = await Category.create({ name: 'Fixture category', status: 'active' });
  const tour = await Tour.create({ name: 'Fixture restore', status: 'inactive', deleted: true, category: category.id });
  const restored = response();
  const [deleted] = await Promise.all([
    remove([tour.id]),
    controller.undoPatch(admin(tour.id, 'tour-trash'), restored)
  ]);
  assert.equal([deleted, restored].filter(result => result.body.code === 'success').length, 1);
  const current = await Tour.findById(tour.id).lean();
  if (restored.body.code === 'success') assert.equal(current.deleted, false);
  else assert.equal(current, null);
});
