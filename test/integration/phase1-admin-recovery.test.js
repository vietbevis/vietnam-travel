const assert = require('node:assert/strict');
const { test, before, beforeEach, after } = require('node:test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const db = require('../helpers/db');
const Account = require('../../models/account-admin.model');
const Card = require('../../models/card.model');
const CardLog = require('../../models/card-log.model');
const { recoverAccount } = require('../../scripts/admin-card-recover');

const it = (name, fn) => test(name, { skip: !db.enabled }, fn);
before(async () => { if (db.enabled) await db.connect(); });
beforeEach(async () => { if (db.enabled) await db.reset(); });
after(async () => { if (db.enabled) await db.close(); });

it('recovery and its audit commit together while session claims are invalidated', async t => {
  const account = await Account.create({ email: 'recovery@example.com', status: 'active', cardRequired: true });
  const input = { email: account.email, force: false, reason: 'Fixture recovery', operator: 'fixture-operator' };
  const failingAudit = t.mock.method(CardLog, 'create', async () => { throw new Error('audit fixture failure'); });
  await assert.rejects(recoverAccount(input), /audit fixture failure/);
  const original = await Account.findById(account.id);
  assert.equal(original.cardRequired, true);
  assert.equal(original.sessionVersion, 0);
  failingAudit.mock.restore();
  const outcomes = await Promise.all([recoverAccount(input), recoverAccount(input)]);
  assert.equal(outcomes.filter(outcome => outcome.proceed).length, 1);
  const result = await Account.findById(account.id);
  assert.equal(result.cardRequired, false);
  assert.equal(result.sessionVersion, 1);
  const logs = await CardLog.find({ action: 'admin-card-recover' }).lean();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].detail.operator, 'fixture-operator');
});

it('an active staff card is retained and blocks non-forced recovery', async () => {
  const account = await Account.create({ email: 'card@example.com', status: 'active', cardRequired: true });
  const card = await Card.create({ cardId: 'AC'.repeat(16), ownerId: account.id, cardType: 'staff', status: 'active' });
  const outcome = await recoverAccount({ email: account.email, force: false, reason: 'fixture' });
  assert.equal(outcome.proceed, false);
  assert.equal((await Card.findById(card.id)).status, 'active');
  assert.equal((await Account.findById(account.id)).cardRequired, true);
  assert.equal(await CardLog.countDocuments(), 0);
});

it('the recovery CLI dry run leaves the fixture account and audit unchanged', async () => {
  const account = await Account.create({ email: 'dry-run@example.com', status: 'active', cardRequired: true });
  const run = promisify(execFile);
  const cmd = require.resolve('../../scripts/admin-card-recover');
  const log = await run(process.execPath, [cmd, account.email], {
    cwd: __dirname, env: { ...process.env, DATABASE: process.env.TEST_DATABASE },
    timeout: 10000, windowsHide: true
  });
  assert.match(log.stdout, /dry run/);
  assert.equal((await Account.findById(account.id)).cardRequired, true);
  assert.equal((await Account.findById(account.id)).sessionVersion, 0);
  assert.equal(await CardLog.countDocuments(), 0);
});
