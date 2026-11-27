const assert = require('node:assert/strict');
const { test } = require('node:test');
const Tour = require('../models/tour.model');
const controller = require('../controllers/admin/tour.controller');
const validate = require('../validates/admin/tour.validate');
const cloud = require('../helpers/cloudinary.helper');
const { Error: MongooseError } = require('mongoose');
const { storeTourImages } = require('../middlewares/admin/image-upload.middleware');

function response() {
  return { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
}

async function create(body, options = {}) {
  const req = { body: { name: 'Tour kiểm thử', position: '1', ...body }, account: { id: 'fixture' },
    permissions: ['tour-create'], flash() {}, ...options };
  const res = response();
  let pending;
  validate.createPost(req, res, () => { pending = controller.createPost(req, res); });
  await pending;
  return res;
}

test('tour saves grouped VND as an integer, preserves explicit zero and defaults only missing new prices', async t => {
  const save = t.mock.method(Tour, 'create', async () => ({}));
  const res = await create({ priceAdult: '1.000.000', priceNewAdult: '', priceChildren: '200000', priceNewChildren: '0' });
  assert.equal(res.body.code, 'success');
  const [data] = save.mock.calls[0].arguments;
  assert.equal(data.priceAdult, 1_000_000);
  assert.equal(data.priceNewAdult, 1_000_000);
  assert.equal(data.priceChildren, 200_000);
  assert.equal(data.priceNewChildren, 0);
  assert.equal(data.priceBaby, 0);
});

test('invalid prices are rejected before any tour write', async t => {
  const save = t.mock.method(Tour, 'create', async () => ({}));
  for (const value of ['1.2', '-1000', '1,000', '1e3', '1.00.000', '1000 đ', '9007199254740992']) {
    const res = await create({ priceAdult: '1.000', priceNewAdult: value });
    assert.equal(res.statusCode, 400, value);
    assert.equal(res.body.code, 'error');
  }
  assert.equal(save.mock.callCount(), 0);
});

async function edit(body, options = {}) {
  const req = { params: { id: '1'.repeat(24) }, body: { name: 'Đổi tên tour', ...body },
    account: { id: 'fixture' }, permissions: ['tour-edit'], flash() {}, ...options };
  const res = response();
  let pending;
  validate.createPost(req, res, () => { pending = controller.editPatch(req, res); });
  await pending;
  return res;
}

test('editing only the name leaves the existing prices, stock, and images out of the update', async t => {
  const save = t.mock.method(Tour, 'updateOne', async () => ({ matchedCount: 1 }));
  const res = await edit({});
  assert.equal(res.body.code, 'success');
  assert.deepEqual(save.mock.calls[0].arguments[1], { name: 'Đổi tên tour', updatedBy: 'fixture' });
});

test('editing stock matches the saved stock and reports a conflict if reservation changed it', async t => {
  const save = t.mock.method(Tour, 'updateOne', async () => ({ matchedCount: 0 }));
  const res = await edit({ stockAdult: '9', stockBaseline: JSON.stringify({ stockAdult: 12 }) });
  assert.equal(res.statusCode, 409);
  const [filter, changed] = save.mock.calls[0].arguments;
  assert.equal(filter.stockAdult, 12);
  assert.equal(changed.stockAdult, 9);
  assert.equal(Object.hasOwn(changed, 'stockBaseline'), false);
});

test('tour upload failure discards only new assets confirmed before the failure', async t => {
  const remove = t.mock.method(cloud, 'removeNewTourImage', async () => {});
  let attempt = 0;
  t.mock.method(cloud, 'uploadTourImage', async () => {
    if (++attempt === 2) throw new Error('Fixture provider failure');
    return { url: 'https://example.com/new', publicId: 'verified-first' };
  });
  const file = () => ({ mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) });
  const res = response();
  await storeTourImages({ files: { images: [file(), file()] } }, res, () => assert.fail('Tour save must not run'));
  assert.equal(res.statusCode, 502);
  assert.deepEqual(remove.mock.calls.map(call => call.arguments), [['verified-first']]);
});

test('tour definite DB rejections discard request images while ambiguous writes keep them', async t => {
  const remove = t.mock.method(cloud, 'removeNewTourImage', async () => {});
  const store = t.mock.method(Tour, 'updateOne', async () => ({ matchedCount: 0 }));
  const options = (newImage) => ({ newTourImages: [newImage], tourImages: { before: ['/old.jpg'], retained: ['/old.jpg'] } });
  assert.equal((await edit({}, options('verified-on-conflict'))).statusCode, 409);
  assert.deepEqual(store.mock.calls[0].arguments[0].images, ['/old.jpg']);
  t.mock.method(Tour, 'create', async () => { throw new MongooseError.ValidationError(); });
  assert.equal((await create({ departureDate: 'invalid' }, { newTourImages: ['verified-on-create-validation'] })).statusCode, 400);
  store.mock.mockImplementation(async () => { throw new MongooseError.CastError('date', 'invalid', 'departureDate'); });
  assert.equal((await edit({ departureDate: 'invalid' }, options('verified-on-edit-cast'))).statusCode, 400);
  store.mock.mockImplementation(async () => { throw new Error('Fixture ambiguous write response'); });
  assert.equal((await edit({}, options('verified-on-ambiguous'))).statusCode, 503);
  assert.deepEqual(remove.mock.calls.map(call => call.arguments[0]),
    ['verified-on-conflict', 'verified-on-create-validation', 'verified-on-edit-cast']);
});
