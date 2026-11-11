const test = require('node:test');
const assert = require('node:assert/strict');
const database = require('../config/database');

// L1: Mongo không phải replica set thì thanh toán đơn liên kết thẻ và thao tác thẻ sẽ lỗi; khởi động phải cảnh báo rõ nhưng không dừng (đơn cũ vẫn chạy standalone).
const connection = command => ({ db: { admin: () => ({ command }) } });
test('replica-set check warns clearly on standalone Mongo and never throws', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(await database.checkReplicaSet(connection(async () => ({ isWritablePrimary: true }))), false);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments.join(' ')), /replica set/i);
  assert.equal(await database.checkReplicaSet(connection(async () => { throw new Error('down'); })), false);
  assert.equal(warn.mock.callCount(), 2);
  assert.equal(await database.checkReplicaSet({}), false);
  assert.equal(warn.mock.callCount(), 3);
});
test('replica-set check passes silently on a replica set member', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(await database.checkReplicaSet(connection(async () => ({ setName: 'rs0' }))), true);
  assert.equal(warn.mock.callCount(), 0);
});
