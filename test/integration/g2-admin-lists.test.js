const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const { on, once } = require('node:events');
const express = require('express');
const cookies = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { Types } = require('mongoose');
const db = require('../helpers/db');
const Category = require('../../models/category.model');
const Tour = require('../../models/tour.model');
const City = require('../../models/city.model');
const Order = require('../../models/order.model');
const Account = require('../../models/account-admin.model');
const Role = require('../../models/role.model');
const Tx = require('../../models/card-transaction.model');
const Website = require('../../models/setting-website-info.model');
const adminRoutes = require('../../routes/admin/index.route');
const publicRoutes = require('../../routes/client/index.route');
const checkout = require('../../controllers/client/order.controller');
const checkoutAccess = require('../../helpers/checkout-access.helper');
const categoryHelper = require('../../helpers/category.helper');
const tickets = require('../../helpers/ticket.helper');

const it = (name, run) => test(name, { skip: !db.enabled }, run);
const permissions = [
  'category-view', 'category-create', 'category-edit', 'category-delete', 'category-trash',
  'tour-view', 'tour-create', 'tour-edit', 'tour-delete', 'tour-trash',
  'order-view', 'order-edit', 'order-delete', 'order-trash'
];
let server, base, admin;
before(async () => {
  if (!db.enabled) return;
  process.env.JWT_SECRET = 'isolated-g2-fixture';
  global.pathAdmin = 'admin';
  await db.connect();
  for (const model of [Category, Tour, Order, Account, Role, Tx]) await model.init();
  const app = express();
  app.set('views', path.resolve(__dirname, '../../views'));
  app.set('view engine', 'pug');
  app.locals.pathAdmin = 'admin';
  app.locals.messages = {};
  app.use(express.json(), cookies(), (req, res, next) => {
    req.flash = () => [];
    next();
  });
  app.use('/admin', adminRoutes);
  app.use('/', publicRoutes);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
beforeEach(async () => {
  if (!db.enabled) return;
  await db.reset();
  admin = await staff(permissions);
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db.enabled) await db.close();
});

async function staff(permitted) {
  const role = await Role.create({ name: 'G2 fixture', permissions: permitted });
  return Account.create({ email: role.id + '@example.test', fullName: 'G2 Operator', role: role.id, status: 'active' });
}

async function request(route, { method = 'GET', data, actor = admin, origin = base } = {}) {
  const headers = { origin };
  if (actor) headers.cookie = 'token=' + jwt.sign({ id: actor.id, email: actor.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const native = data instanceof URLSearchParams;
  if (data) headers['content-type'] = native ? 'application/x-www-form-urlencoded' : 'application/json';
  const response = await fetch(base + route, { method, headers, body: native ? data : data ? JSON.stringify(data) : undefined, redirect: 'manual' });
  const result = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
  return { status: response.status, result };
}

const patch = (route, data, actor) => request('/admin' + route, { method: 'PATCH', data, actor });
const category = (name, data = {}) => Category.create({ name, parent: '', status: 'active', position: 1, createdBy: admin.id, ...data });

it('TEST 09 A/B uses Vietnamese day boundaries and paginates real category matches', async () => {
  for (let index = 0; index < 12; index++) await category('Đà Nẵng G2 ' + index, { createdAt: new Date('2026-11-27T17:00:00Z') });
  await category('Đà Nẵng G2 previous', { createdAt: new Date('2026-11-27T16:59:59.999Z') });
  for (const [size, first, last] of [[5, 11, 12], [10, 11, 12], [20, 1, 12], [50, 1, 12], [100, 1, 12]]) {
    const { status, result } = await request('/admin/category/list?keyword=Da+Nang&status=active&page=999&createdBy=' + admin.id +
      '&startDate=2026-11-28&endDate=2026-11-28&pageSize=' + size);
    assert.equal(status, 200);
    assert.match(result, new RegExp(`Hiển thị ${first} - ${last} của 12`));
    assert.doesNotMatch(result, /Đà Nẵng G2 previous/);
  }
  assert.equal((await request('/admin/category/list?status[$ne]=active')).status, 400);
  assert.equal((await request('/admin/category/list?keyword=' + 'x'.repeat(101))).status, 400);
});

it('TEST 09 C restores selected related categories atomically and preserves legacy status policy', async () => {
  const parent = await category('Root C', { deleted: true, status: 'inactive', statusBeforeDelete: 'active' });
  const child = await category('Hạ Long C', { deleted: true, parent: parent.id, deletedBy: admin.id, deletedAt: new Date('2026-11-27T17:00:00Z') });
  const list = await request('/admin/category/trash?keyword=Ha+Long&deletedBy=' + admin.id + '&startDate=2026-11-28&endDate=2026-11-28');
  assert.equal(list.status, 200);
  assert.match(list.result, /Hạ Long C/);
  assert.equal((await patch('/category/undo/' + child.id)).status, 409);
  assert.equal((await patch('/category/trash/change-multi', { option: 'undo', ids: [parent.id, new Types.ObjectId().toString()] })).status, 409);
  assert.equal((await patch('/category/trash/change-multi', { option: 'undo', ids: [parent.id, parent.id.toUpperCase()] })).status, 400);
  assert.equal((await patch('/category/trash/change-multi', { option: 'undo', ids: [child.id, parent.id] })).result.code, 'success');
  assert.equal((await Category.findById(parent.id)).status, 'active');
  assert.equal((await Category.findById(child.id)).status, 'inactive');
  assert.equal((await patch('/category/undo/' + child.id)).status, 409);
});

it('trash read and restore require their distinct role permissions', async () => {
  const reader = await staff(['category-view', 'tour-view', 'order-view']);
  const trash = await staff(['category-trash', 'order-trash']);
  const row = await category('RBAC C', { deleted: true, status: 'inactive' });
  const order = await Order.create({ orderCode: 'G2RBAC', deleted: true, status: 'cancel' });
  for (const type of ['category', 'order']) {
    assert.equal((await request('/admin/' + type + '/trash', { actor: reader })).status, 403);
    assert.equal((await request('/admin/' + type + '/trash', { actor: trash })).status, 200);
  }
  assert.equal((await patch('/category/undo/' + row.id, undefined, trash)).status, 403);
  assert.equal((await patch('/order/undo/' + order.id, undefined, trash)).status, 403);
  assert.equal((await request('/admin/category/undo/' + row.id, { method: 'PATCH', origin: 'http://unrelated.example.test' })).status, 403);
});

const destroyCategory = (id, actor) => patch('/category/delete-destroy/' + id, undefined, actor);
const destroyCategories = (ids, actor) => patch('/category/trash/change-multi', { option: 'delete-destroy', ids }, actor);

it('G2.1 permanently deletes only trash entries and rejects repeat, invalid, unauthorized and cross-origin requests', async () => {
  const live = await category('G2.1 Live');
  const trash = await category('G2.1 Empty Trash', { status: 'active', avatar: 'https://example.test/shared.jpg' });
  assert.equal((await patch('/category/delete/' + trash.id)).result.code, 'success');
  const editor = await staff(['category-trash', 'category-edit']);
  const deleter = await staff(['category-delete']);
  const reader = await staff(['category-trash']);
  const trashPage = '/admin/category/trash?keyword=G2.1';
  assert.doesNotMatch((await request(trashPage, { actor: reader })).result, /data-list-(action|bulk)/);
  assert.match((await request(trashPage, { actor: editor })).result, /data-list-action="undo"/);
  assert.doesNotMatch((await request(trashPage, { actor: editor })).result, /delete-destroy/);
  const trashDeleter = await staff(['category-trash', 'category-delete']);
  const deleteOnlyPage = await request(trashPage, { actor: trashDeleter });
  assert.match(deleteOnlyPage.result, /data-list-action="delete-destroy"/);
  assert.doesNotMatch(deleteOnlyPage.result, /data-list-action="undo"/);
  assert.equal((await patch('/category/undo/' + trash.id, undefined, trashDeleter)).status, 403);
  assert.equal((await patch('/category/trash/change-multi', { option: 'undo', ids: [trash.id] }, trashDeleter)).status, 403);
  for (const actor of [reader, editor, deleter]) {
    assert.equal((await destroyCategory(trash.id, actor)).status, 403);
    assert.equal((await destroyCategories([trash.id], actor)).status, 403);
  }
  assert.equal((await request('/admin/category/delete-destroy/' + trash.id, { method: 'PATCH', origin: 'http://unrelated.example.test' })).status, 403);
  assert.equal((await destroyCategory('invalid')).status, 400);
  assert.equal((await destroyCategory(live.id)).status, 409);
  assert.equal((await destroyCategory(new Types.ObjectId().toHexString())).status, 409);
  assert.deepEqual((await destroyCategory(trash.id.toUpperCase(), trashDeleter)).result, { code: 'success', count: 1 });
  assert.equal(await Category.findById(trash.id), null);
  assert.doesNotMatch((await request(trashPage)).result, /G2\.1 Empty Trash/);
  assert.equal((await destroyCategory(trash.id)).status, 409);
  assert.ok(await Category.findById(live.id));
});

it('G2.1 blocks every child state, including parent and child in the same bulk, and supports leaf-first deletion', async () => {
  const parent = await category('G2.1 Parent', { deleted: true });
  for (const [status, deleted] of [['active', false], ['inactive', false], ['inactive', true]]) {
    const child = await category('G2.1 Child ' + status + ' ' + deleted, { parent: parent.id.toUpperCase(), status, deleted });
    const blocked = await destroyCategory(parent.id);
    assert.equal(blocked.status, 409);
    assert.match(blocked.result.message, /danh mục con/i);
    if (!deleted) assert.equal((await patch('/category/delete/' + child.id)).result.code, 'success');
    assert.equal((await destroyCategory(child.id)).result.code, 'success');
  }
  const legacy = await Category.collection.insertOne({ name: 'G2.1 BSON Parent Link', slug: 'g21-bson-parent', parent: parent._id, deleted: true });
  const ids = [parent.id, String(legacy.insertedId)];
  const blocked = await destroyCategories(ids);
  assert.equal(blocked.status, 409);
  assert.match(blocked.result.message, /danh mục con/i);
  assert.equal(await Category.countDocuments({ deleted: true }), 2);
  assert.equal((await destroyCategory(ids[1])).result.code, 'success');
  assert.equal((await destroyCategory(parent.id)).result.code, 'success');
  assert.equal(await Category.countDocuments(), 0);
});

it('G2.1 blocks active, inactive and archived tour references while preserving linked order, ticket and ledger data', async () => {
  for (const [index, data, bson] of [[1, { status: 'active' }, false], [2, { status: 'inactive' }, false],
    [3, { status: 'inactive', deleted: true }, true], [4, { status: 'inactive', deleted: true }, false]]) {
    const row = await category('G2.1 Tour Category ' + index, { deleted: true });
    const tour = await Tour.collection.insertOne({ name: 'G2.1 Tour ' + index, slug: 'g21-tour-' + index,
      category: bson ? row._id : row.id.toUpperCase(), ...data });
    const order = await Order.create({ orderCode: 'G21-' + index, deleted: true, items: [{ tourId: String(tour.insertedId), ticketStatus: 'used' }] });
    const tx = await Tx.create({ txRef: String(index).repeat(16), cardId: 'A1'.repeat(16), type: 'debit',
      source: 'order', amount: 100, status: 'done', orderId: order.id });
    const before = await Promise.all([Tour.collection.findOne({ _id: tour.insertedId }), Order.findById(order.id).lean(), Tx.findById(tx.id).lean()]);
    const blocked = await destroyCategory(row.id);
    assert.equal(blocked.status, 409);
    assert.match(blocked.result.message, /còn tour/i);
    assert.ok(await Category.findById(row.id));
    assert.deepEqual(await Promise.all([Tour.collection.findOne({ _id: tour.insertedId }), Order.findById(order.id).lean(), Tx.findById(tx.id).lean()]), before);
  }
});

it('G2.1 rejects malformed and mixed bulk sets and rolls back an actual delete when the DB fails mid-operation', async t => {
  const first = await category('G2.1 First Bulk', { deleted: true });
  const last = await category('G2.1 Last Bulk', { deleted: true });
  const live = await category('G2.1 Live Bulk');
  const ids = [first.id, last.id];
  for (const invalid of [[], first.id, [first.id, 'invalid'], [first.id, first.id.toUpperCase()], Array(101).fill(first.id)]) {
    assert.equal((await destroyCategories(invalid)).status, 400);
  }
  assert.equal((await patch('/category/trash/change-multi', { option: 'delete', ids })).status, 400);
  for (const invalid of [live.id, new Types.ObjectId().toHexString()]) {
    assert.equal((await destroyCategories([first.id, invalid])).status, 409);
    assert.ok(await Category.findById(first.id));
  }
  const deleteOne = Category.deleteOne.bind(Category);
  let didWrite = 0;
  const failure = t.mock.method(Category, 'deleteMany', async (filter, { session }) => {
    didWrite = (await deleteOne({ ...filter, _id: first.id }, { session })).deletedCount;
    throw new Error('G2.1 fixture interrupts bulk after first Mongo delete');
  });
  assert.equal((await destroyCategories(ids)).status, 500);
  assert.equal(didWrite, 1);
  assert.equal(await Category.countDocuments({ deleted: true }), 2);
  failure.mock.restore();
  assert.deepEqual((await destroyCategories(ids)).result, { code: 'success', count: 2 });
  assert.equal(await Category.countDocuments(), 1);
});

async function raceCategoryTrash(t, method) {
  const deletingFirst = method === 'deleteMany';
  const target = await category('G2.1 Concurrent Category ' + method, { deleted: true, statusBeforeDelete: 'active' });
  const original = await category('G2.1 Tour Original ' + method);
  const tour = await Tour.create({ name: 'G2.1 Concurrent Tour ' + method, category: original.id, status: 'active' });
  const workers = [];
  const entered = Promise.withResolvers();
  const contender = Promise.withResolvers();
  const release = Promise.withResolvers();
  const ensureLock = categoryHelper.ensureCategoryLock;
  let acquisitions = 0;
  const observeLock = t.mock.method(categoryHelper, 'ensureCategoryLock', () => {
    if (++acquisitions === 2) contender.resolve();
    return ensureLock();
  });
  const originalWrite = Category[method].bind(Category);
  const holdWrite = t.mock.method(Category, method, async (...args) => {
    const { session } = args.at(-1);
    const locks = Category.db.collection('category_write_locks');
    const key = { _id: 'category-tree' };
    const inside = await locks.findOne(key, { session });
    const outside = await locks.findOne(key);
    assert.equal(inside.revision, outside.revision + 1);
    entered.resolve();
    await release.promise;
    return originalWrite(...args);
  });
  try {
    const writes = await Promise.all(['category-create', 'tour-edit'].map(async action => {
      const worker = fork(path.resolve(__dirname, '../helpers/g2-category-worker.cjs'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      workers.push(worker);
      const [ready] = await once(worker, 'message', { signal: AbortSignal.timeout(8000) });
      assert.equal(ready, 'ready');
      return () => {
        const replies = on(worker, 'message', { signal: AbortSignal.timeout(8000) });
        worker.send({ category: target.id, actorId: admin.id, action, tourId: tour.id, reportStart: true });
        return replies;
      };
    }));
    const destroy = () => destroyCategory(target.id);
    const restore = () => patch('/category/undo/' + target.id);
    const first = (deletingFirst ? destroy : restore)();
    await Promise.race([entered.promise, first.then(result => assert.fail('First mutation finished before its checkpoint: ' + result.status))]);
    const second = (deletingFirst ? restore : destroy)();
    await Promise.race([contender.promise, second.then(result => assert.fail('Second mutation finished before trying the lock: ' + result.status))]);
    const replies = writes.map(write => write());
    for (const reply of replies) assert.equal((await reply.next()).value[0], 'started');
    release.resolve();
    const results = replies.map(async reply => {
      const { value: [result] } = await reply.next();
      await reply.return();
      return result;
    });
    const [winner, loser, child, linked] = await Promise.all([first, second, ...results]);
    assert.equal(winner.status, 200);
    assert.equal(loser.status, 409);
    const saved = await Category.findById(target.id);
    const savedChild = await Category.findOne({ parent: target.id });
    const savedTour = await Tour.findById(tour.id);
    assert.ok(['error', 'success'].includes(child));
    assert.ok(['error', 'success'].includes(linked));
    assert.equal(Boolean(savedChild), child === 'success');
    assert.equal(savedTour.category === target.id, linked === 'success');
    if (deletingFirst) {
      assert.equal(saved, null);
      assert.equal(savedChild, null);
      assert.equal(savedTour.category, original.id);
    } else {
      assert.equal(saved.deleted, false);
    }
  } finally {
    release.resolve();
    holdWrite.mock.restore();
    observeLock.mock.restore();
    await Promise.all(workers.map(async worker => {
      if (worker.connected) worker.disconnect();
      if (worker.exitCode == null && worker.signalCode == null) await once(worker, 'exit', { signal: AbortSignal.timeout(8000) });
    }));
  }
}

it('G2.1 hard delete wins the lock against restore, child creation and tour re-link across processes', t => raceCategoryTrash(t, 'deleteMany'));
it('G2.1 restore wins the lock against hard delete while child and tour writers race across processes', t => raceCategoryTrash(t, 'updateMany'));

it('tour list combines real category, actor, date and adult price and bulk rejects partial writes', async () => {
  const group = await category('Tour group');
  const createdAt = new Date('2026-11-27T17:00:00Z');
  const good = await Tour.create({ name: 'Tour Đà Lạt', category: group.id, status: 'active', priceNewAdult: 2000000, createdBy: admin.id, createdAt });
  const other = await Tour.create({ name: 'Tour Đà Lạt khác', category: group.id, status: 'active', priceNewAdult: 4000000, createdBy: admin.id, createdAt });
  const query = new URLSearchParams({ category: group.id, createdBy: admin.id, keyword: 'Da Lat', status: 'active',
    price: '2m-4m', startDate: '2026-11-28', endDate: '2026-11-28', pageSize: '5' });
  const listing = await request('/admin/tour/list?' + query);
  assert.equal(listing.status, 200);
  assert.match(listing.result, /Hiển thị 1 - 1 của 1/);
  assert.doesNotMatch(listing.result, /Tour Đà Lạt khác/);
  assert.equal((await patch('/tour/change-multi', { option: 'delete', ids: [good.id, new Types.ObjectId().toString()] })).status, 409);
  assert.equal((await Tour.findById(good.id)).deleted, false);
  assert.equal((await patch('/tour/change-multi', { option: 'delete', ids: [good.id, other.id] })).result.code, 'success');
  const trash = await request('/admin/tour/trash?deletedBy=' + admin.id + '&keyword=Da+Lat');
  assert.match(trash.result, /Hiển thị 1 - 2 của 2/);
  assert.equal((await Tour.findById(good.id)).statusBeforeDelete, 'active');
});

it('tour restore refuses a broken ancestor and keeps legacy trash inactive when prior status is absent', async () => {
  const parent = await category('Ancestor', { deleted: true });
  const child = await category('Descendant', { parent: parent.id });
  const tour = await Tour.create({ name: 'Archived legacy tour', category: child.id, deleted: true, status: 'active' });
  assert.equal((await patch('/tour/undo/' + tour.id)).status, 409);
  await Category.updateOne({ _id: parent.id }, { $set: { deleted: false } });
  assert.equal((await patch('/tour/undo/' + tour.id)).result.code, 'success');
  assert.equal((await Tour.findById(tour.id)).status, 'inactive');
});

it('order trash search and visibility-only restore preserve records and atomically reject mixed selections', async () => {
  const tour = await Tour.create({ name: 'Stock before restore', stockAdult: 3 });
  const customerId = new Types.ObjectId().toString();
  const archive = await Order.create({
    orderCode: 'OD-G2ABCDEF0', fullName: 'Đặng Hà', phone: '0901111111', status: 'cancel', paymentStatus: 'paid', customerId,
    paymentMethod: 'card', deleted: true, deletedBy: admin.id, deletedAt: new Date('2026-11-27T17:00:00Z'),
    stockRestoredAt: new Date('2026-11-27T17:00:00Z'), cardTxRef: 'A'.repeat(16), refundTxRef: 'B'.repeat(16),
    total: 123000, items: [{ tourId: tour.id, quantityAdult: 1, ticketStatus: 'pending-delete' }]
  });
  const live = await Order.create({ orderCode: 'OD-LIVE-G2', status: 'initial' });
  const ledger = await Tx.create({ txRef: archive.refundTxRef, cardId: '1'.repeat(32), orderId: archive.id,
    type: 'credit', source: 'refund', amount: archive.total, status: 'pending-card' });
  const before = await Order.collection.findOne({ _id: archive._id });
  const beforeLedger = await Tx.collection.findOne({ _id: ledger._id });
  const list = await request('/admin/order/trash?q=Dang+Ha&paymentMethod=card&paymentStatus=paid&status=cancel&pageSize=5');
  assert.equal(list.status, 200);
  assert.match(list.result, /OD-G2/);
  assert.doesNotMatch(list.result, /OD-LIVE-G2/);
  assert.equal((await patch('/order/trash/change-multi', { option: 'undo', ids: [archive.id, live.id] })).status, 409);
  assert.deepEqual(await Order.collection.findOne({ _id: archive._id }), before);
  const races = await Promise.all([patch('/order/undo/' + archive.id), patch('/order/undo/' + archive.id)]);
  assert.deepEqual(races.map(result => result.status).sort(), [200, 409]);
  assert.equal(await tickets.pendingItem({ ownerId: customerId }, 'delete-ticket'), null);
  assert.deepEqual(await Order.collection.findOne({ _id: archive._id }), { ...before, adminVisibleAfterRestore: true });
  assert.deepEqual(await Tx.collection.findOne({ _id: ledger._id }), beforeLedger);
  assert.equal((await Tour.findById(tour.id)).stockAdult, 3);
});

it('a separate Node process cannot link a tour after a concurrent category delete', async () => {
  const categoryToLink = await category('Cross-process category');
  const worker = fork(path.resolve(__dirname, '../helpers/g2-category-worker.cjs'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  try {
    const [ready] = await once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    assert.equal(ready, 'ready');
    const response = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.send({ category: categoryToLink.id, actorId: admin.id });
    const [deleted, [added]] = await Promise.all([patch('/category/delete/' + categoryToLink.id), response]);
    assert.equal([deleted.result.code, added].filter(code => code === 'success').length, 1);
    const saved = await Category.findById(categoryToLink.id).lean();
    assert.equal(await Tour.countDocuments({ category: categoryToLink.id }), saved.deleted ? 0 : 1);
  } finally {
    if (worker.connected) worker.disconnect();
    if (worker.exitCode == null && worker.signalCode == null) await once(worker, 'exit', { signal: AbortSignal.timeout(8000) });
  }
});

it('inactive ancestor hides linked tours in Client browsing, cart and transactional checkout', async () => {
  await Website.create({ websiteName: 'G2 Fixture' });
  const root = await category('G2 Parent Hidden', { status: 'inactive' });
  const child = await category('G2 Child Hidden', { parent: root.id });
  const city = await City.create({ name: 'G2 City' });
  const tour = await Tour.create({ name: 'G2 Hidden Departure', category: child.id, status: 'active', locations: [city.id],
    departureDate: new Date('2030-12-01'), priceNewAdult: 100000, priceNewChildren: 50000, priceNewBaby: 0,
    stockAdult: 2, stockChildren: 1, stockBaby: 1 });
  for (const route of ['/', '/search?locationTo=Hidden']) {
    const output = await request(route, { actor: null });
    assert.equal(output.status, 200);
    assert.doesNotMatch(output.result, /G2 Hidden Departure|G2 Child Hidden/);
  }
  for (const route of ['/category/' + child.slug, '/tour/detail/' + tour.slug]) {
    assert.equal((await request(route, { actor: null })).status, 404);
  }
  const cart = { tourId: tour.id, locationFrom: city.id, quantityAdult: 1, quantityChildren: 0, quantityBaby: 0 };
  assert.deepEqual((await request('/cart/detail', { method: 'POST', actor: null, data: [cart] })).result.cart, []);
  const customer = { _id: new Types.ObjectId().toString() };
  const payload = { fullName: 'G2 Fixture', phone: '0901111111', paymentMethod: 'money', items: [cart] };
  const out = { set() {}, status(code) { this.statusCode = code; return this; }, json(result) { this.result = result; } };
  const place = () => checkout.createPost({
    customer, body: { ...payload, intentId: checkoutAccess.issueIntent('customer:' + customer._id) }
  }, out);
  await place();
  assert.equal(out.result.errorCode, 'INVALID_TOUR');
  assert.equal((await Tour.findById(tour.id)).stockAdult, 2);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await patch('/category/change-multi', { option: 'active', ids: [root.id] })).result.code, 'success');
  assert.match((await request('/search?locationTo=Hidden', { actor: null })).result, /G2 Hidden Departure/);
  await Tour.collection.insertOne({ name: 'G2 Tour legacy price', slug: 'g2-tour-legacy-price', category: child.id,
    deleted: false, status: 'active', priceAdult: '1.000.000', priceNewAdult: '900.000', departureDate: new Date('2030-12-01') });
  const publicListing = await request('/category/' + child.slug, { actor: null });
  assert.equal(publicListing.status, 200);
  assert.match(publicListing.result, /Giá chưa xác định/);
  assert.equal((await request('/cart/detail', { method: 'POST', actor: null, data: [cart] })).result.cart.length, 1);
  await place();
  assert.equal(out.result.code, 'success');
  assert.equal((await Tour.findById(tour.id)).stockAdult, 1);
});

it('tour form rejects invalid departure, relations, price and stale inventory', async () => {
  const city = await City.create({ name: 'G2 form city' });
  const group = await category('G2 form category');
  const form = { name: 'G2 Tour Form', category: group.id, status: 'active', position: '1',
    priceAdult: '1.000.000', priceNewAdult: '850.000', stockAdult: '5', locations: JSON.stringify([city.id]),
    departureDate: '2031-02-28', schedules: JSON.stringify([{ title: 'Day 1', description: '<script>bad()</script><p>Plan</p>' }]) };
  for (const invalid of [{ position: '-2' }, { departureDate: '2031-02-29' }, { status: 'x' },
    { locations: JSON.stringify([new Types.ObjectId().toString()]) }, { priceNewAdult: '1.200.000' }]) {
    const result = await request('/admin/tour/create', { method: 'POST', data: { ...form, ...invalid } });
    assert.equal(result.status, 400);
  }
  assert.equal(await Tour.countDocuments(), 0);
  assert.equal((await request('/admin/tour/create', { method: 'POST', data: form })).result.code, 'success');
  const saved = await Tour.findOne({ name: form.name });
  assert.deepEqual([saved.stockAdult, saved.priceNewAdult, saved.priceNewBaby], [5, 850000, 0]);
  assert.equal(saved.schedules[0].description, '<p>Plan</p>');
  assert.equal((await patch('/tour/edit/' + saved.id, { name: form.name, stockAdult: '6' })).status, 400);
  assert.equal((await patch('/tour/edit/' + saved.id, { name: form.name, stockAdult: '6', stockBaseline: '{"stockAdult":4}' })).status, 409);
  assert.equal((await Tour.findById(saved.id)).stockAdult, 5);
});

it('order list counts the same filter and gateway edits preserve historical payment and quote fields', async () => {
  const createdAt = new Date('2026-11-27T17:00:00Z');
  await Order.create(Array.from({ length: 12 }, (_, index) => ({
    orderCode: 'G2-LIST-' + index, fullName: 'Đặng Hà', createdAt, status: 'initial',
    paymentMethod: 'vnpay', paymentStatus: 'unpaid', subTotal: 150000, discount: 15000, total: 135000
  })));
  const response = await request('/admin/order/list?q=Dang+Ha&paymentMethod=vnpay&paymentStatus=unpaid&status=initial&startDate=2026-11-28&endDate=2026-11-28&pageSize=5&page=2');
  assert.match(response.result, /Hiển thị 6 - 10 của 12/);
  const order = await Order.findOne({ orderCode: 'G2-LIST-1' });
  for (const body of [{ paymentStatus: 'paid' }, { paymentMethod: 'money' }]) {
    assert.equal((await patch('/order/edit/' + order.id, body)).result.code, 'error');
  }
  assert.equal((await patch('/order/edit/' + order.id, { note: 'G2 update', orderCode: 'changed', total: 1, items: [] })).result.code, 'success');
  const kept = await Order.findById(order.id);
  assert.deepEqual([kept.note, kept.orderCode, kept.total, kept.discount, kept.paymentMethod, kept.paymentStatus],
    ['G2 update', 'G2-LIST-1', 135000, 15000, 'vnpay', 'unpaid']);
  const edit = '/admin/order/edit/' + order.id;
  const post = (data, options = {}) => request(edit, { method: 'POST', data: new URLSearchParams(data), ...options });
  assert.equal((await post({ note: 'G2 Native', status: 'initial' })).status, 303);
  assert.equal((await Order.findById(order.id)).note, 'G2 Native');
  const refused = await post({ status: 'done', note: 'G2 should not save' });
  assert.equal(refused.status, 409);
  assert.match(refused.result, /Hãy bật JavaScript/);
  assert.equal((await post({ note: 'G2 cross-origin' }, { origin: 'http://unrelated.example.test' })).status, 403);
  assert.deepEqual([(await Order.findById(order.id)).status, (await Order.findById(order.id)).note], ['initial', 'G2 Native']);
});

it('bulk order restore rolls back a write failure and a later retry changes only visibility', async t => {
  const orders = await Order.create([
    { orderCode: 'G2-ROLLBACK-01', deleted: true, status: 'cancel', paymentStatus: 'paid', paymentMethod: 'bank' },
    { orderCode: 'G2-ROLLBACK-02', deleted: true, status: 'cancel', paymentStatus: 'unpaid', paymentMethod: 'money' }
  ]);
  const ids = orders.map(order => order.id);
  const updateMany = Order.updateMany.bind(Order);
  let writes = 0;
  const failure = t.mock.method(Order, 'updateMany', async (...args) => {
    await updateMany(...args);
    writes++;
    throw new Error('G2 test rollback after visibility write');
  });
  const apply = () => patch('/order/trash/change-multi', { option: 'undo', ids });
  assert.equal((await apply()).status, 500);
  assert.equal(writes, 1);
  assert.equal(await Order.countDocuments({ deleted: true }), 2);
  failure.mock.restore();
  assert.equal((await apply()).result.code, 'success');
  const kept = await Order.find({ deleted: true, adminVisibleAfterRestore: true }).sort({ orderCode: 1 }).lean();
  assert.deepEqual(kept.map(order => [order.status, order.paymentStatus, order.paymentMethod]), [
    ['cancel', 'paid', 'bank'], ['cancel', 'unpaid', 'money']
  ]);
  assert.equal((await patch('/order/delete-destroy/' + ids[0])).status, 404);
  assert.equal(await Order.countDocuments(), 2);
});

it('restoring a legacy non-cancelled order allows Admin reading without re-opening payment or writes', async t => {
  const owner = new Types.ObjectId().toString();
  const stored = await Order.create({
    orderCode: 'G2-LEGACY-OPEN', deleted: true, status: 'initial', paymentMethod: 'vnpay',
    paymentStatus: 'unpaid', total: 200000, customerId: owner, items: [{ ticketStatus: 'none' }]
  });
  const before = await Order.collection.findOne({ _id: stored._id });
  assert.equal((await patch('/order/undo/' + stored.id)).result.code, 'success');
  assert.deepEqual(await Order.collection.findOne({ _id: stored._id }), { ...before, adminVisibleAfterRestore: true });
  assert.match((await request('/admin/order/list?q=G2-LEGACY-OPEN')).result, /Hiển thị 1 - 1 của 1/);
  assert.match((await request('/admin/order/trash?q=G2-LEGACY-OPEN')).result, /Hiển thị 0 - 0 của 0/);
  const detail = await request('/admin/order/edit/' + stored.id);
  assert.equal(detail.status, 200);
  assert.match(detail.result, /đã khôi phục để tra cứu/);
  assert.doesNotMatch(detail.result, />Cập nhật<\/button>/);
  assert.equal((await patch('/order/edit/' + stored.id, { note: 'cannot write' })).result.code, 'error');
  assert.equal((await patch('/order/undo/' + stored.id)).status, 409);
  const vnpay = require('../../helpers/vnpay.helper');
  const gateway = t.mock.method(vnpay, 'buildPaymentUrl', () => 'https://example.test/');
  const page = { set() {}, redirect(url) { this.destination = url; } };
  await checkout.paymentVNPay({ query: { orderId: stored.id }, customer: { _id: owner }, headers: {} }, page);
  assert.equal(page.destination, '/');
  assert.equal(gateway.mock.callCount(), 0);
});
