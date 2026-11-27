const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const Profile = require('../controllers/admin/profile.controller');
const Account = require('../models/account-admin.model');
const cloudinary = require('cloudinary').v2;
const { Writable } = require('node:stream');
const { storeImages } = require('../middlewares/admin/image-upload.middleware');

function response() {
  return {
    statusCode: 200,
    cookiesCleared: [],
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    clearCookie(cookie) { this.cookiesCleared.push(cookie); }
  };
}

test('profile updates only allowed personal fields, with an explicit update document', async t => {
  const update = t.mock.method(Account, 'updateOne', async () => ({ matchedCount: 1 }));
  const res = response();
  await Profile.editPatch({ account: { id: 'fixture' }, body: { fullName: ' Fixture Admin ' }, flash() {} }, res);
  assert.equal(res.body.code, 'success');
  assert.deepEqual(update.mock.calls[0].arguments[1], { $set: { fullName: 'Fixture Admin', updatedBy: 'fixture' } });
});

test('self-service profile does not change the email used for authentication or recovery', async t => {
  const update = t.mock.method(Account, 'updateOne', async () => ({ matchedCount: 1 }));
  const res = response();
  await Profile.editPatch({ account: { id: 'fixture', email: 'current@example.com' }, body: { email: 'changed@example.com' }, flash() {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(update.mock.callCount(), 0);
});

test('avatar clear compares the saved image and leaves a concurrently replaced avatar alone', async t => {
  const update = t.mock.method(Account, 'updateOne', async () => ({ matchedCount: 0 }));
  const res = response();
  await Profile.editPatch({
    account: { id: 'fixture', avatar: '/saved.jpg' },
    body: { imageChanges: JSON.stringify({ avatar: { before: '/saved.jpg', clear: true } }) }
  }, res);
  assert.equal(res.statusCode, 409);
  const [filter, patch] = update.mock.calls[0].arguments;
  assert.equal(filter.avatar, '/saved.jpg');
  assert.equal(patch.$set.avatar, '');
});

test('profile only deletes request-owned uploads after a known DB rejection', async t => {
  const publicIds = [];
  t.mock.method(cloudinary.uploader, 'upload_stream', (options, callback) => new Writable({
    write(_chunk, _encoding, done) { done(); },
    final(done) {
      publicIds.push(options.public_id);
      callback(null, { secure_url: 'https://fixture.invalid/' + options.public_id, public_id: options.public_id, resource_type: 'image' });
      done();
    }
  }));
  const destroy = t.mock.method(cloudinary.uploader, 'destroy', async () => ({ result: 'ok' }));
  const update = t.mock.method(Account, 'updateOne', async () => ({ matchedCount: 0 }));
  const request = () => ({
    account: { id: 'fixture', avatar: '/shared.jpg' },
    body: { imageChanges: JSON.stringify({ avatar: { before: '/shared.jpg', clear: false } }) },
    file: { buffer: Buffer.from('89504e470d0a1a0a', 'hex'), mimetype: 'image/png' },
    flash() {}
  });
  const first = request();
  const rejected = response();
  await storeImages(first, rejected, () => Profile.editPatch(first, rejected));
  assert.equal(rejected.statusCode, 409);
  assert.match(publicIds[0], /^travel-form-uploads\/[0-9a-f-]+$/);
  assert.deepEqual(destroy.mock.calls.map(call => call.arguments[0]), [publicIds[0]]);

  update.mock.mockImplementation(async () => { throw new Error('fixture acknowledgement lost'); });
  const second = request();
  const unclear = response();
  await assert.rejects(storeImages(second, unclear, () => Profile.editPatch(second, unclear)), /acknowledgement lost/);
  assert.notEqual(publicIds[1], publicIds[0]);
  assert.equal(destroy.mock.callCount(), 1);
});

test('change password rejects updates without current password and confirmation', async t => {
  const update = t.mock.method(Account, 'updateOne', async () => ({ matchedCount: 1 }));
  const res = response();
  await Profile.changePasswordPatch({ account: { id: 'fixture' }, body: { password: 'Fixture-A1!' }, flash() {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(update.mock.callCount(), 0);
});

test('change password verifies the current hash and increments session version with the same update', async t => {
  const currentPassword = 'Fixture-A1!';
  const password = 'Fixture-B2!';
  const hash = await bcrypt.hash(currentPassword, 4);
  const update = t.mock.method(Account, 'updateOne', async () => ({ matchedCount: 1 }));
  const res = response();
  await Profile.changePasswordPatch({ account: { id: 'fixture', password: hash }, body: { currentPassword, password, confirmPassword: password }, flash() {} }, res);
  assert.equal(res.body.requiresLogin, true);
  const [query, change] = update.mock.calls[0].arguments;
  assert.equal(query.password, hash);
  assert.equal(await bcrypt.compare(password, change.$set.password), true);
  assert.equal(change.$inc.sessionVersion, 1);
  assert.ok(res.cookiesCleared.includes('token'));
});
