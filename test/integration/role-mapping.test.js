const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('../helpers/db');
const Account = require('../../models/account-admin.model');
const Role = require('../../models/role.model');
const { permissionList } = require('../../config/permission');

const delegated = [
  'contact-view', 'website-view', 'website-edit', 'account-admin-view',
  'account-admin-create', 'account-admin-edit', 'role-view', 'role-create', 'role-edit'
];
const legacy = permissionList.map(entry => entry.value).filter(value => !delegated.includes(value));
const key = 'ADMIN_LEGACY_PERMISSION_FALLBACK';
const savedGate = process.env[key];
const savedSecret = process.env.JWT_SECRET;
const jwtSecret = 'role-mapping-test-fixture';
let server;

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

before(async () => {
  if (!db.enabled) return;
  process.env.JWT_SECRET = jwtSecret;
  global.pathAdmin = 'admin';
  await db.connect();
  const app = express();
  app.set('view engine', 'pug');
  app.set('views', path.resolve(__dirname, '../../views'));
  app.locals.pathAdmin = 'admin';
  app.locals.messages = {};
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, res, next) => { req.flash = () => {}; next(); });
  app.use('/admin', require('../../routes/admin/index.route'));
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
});

beforeEach(async () => {
  if (!db.enabled) return;
  delete process.env[key];
  await db.reset();
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (db.enabled) await db.close();
  restore(key, savedGate);
  restore('JWT_SECRET', savedSecret);
});

async function fixture(permissions) {
  const role = await Role.create({ name: 'Mapping fixture', permissions });
  const account = await Account.create({
    fullName: 'Fixture Operator', email: 'operator@example.test', status: 'active', role: role.id
  });
  const token = jwt.sign({ id: account.id, email: account.email, sv: 0 }, jwtSecret, { expiresIn: 60 });
  return {
    role,
    async get(path) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/admin${path}`, {
        headers: { cookie: `token=${token}` }
      });
      return { status: response.status, body: await response.text() };
    },
    async post(path, body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/admin${path}`, {
        method: 'POST',
        headers: { cookie: `token=${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      return response.json();
    }
  };
}

const options = { skip: !db.enabled };

test('a full role keeps access through fixture mapping and rollback', options, async () => {
  const { role, get } = await fixture(legacy);
  assert.equal((await get('/setting/list')).status, 200);
  assert.equal((await get('/setting/role/list')).status, 200);
  process.env[key] = '0';
  assert.equal((await get('/setting/role/list')).status, 403);

  const explicitMapping = [...legacy, ...delegated];
  await Role.updateOne({ _id: role.id }, { $set: { permissions: explicitMapping } });
  assert.equal((await get('/setting/role/list')).status, 200);
  assert.equal((await get('/setting/account-admin/list')).status, 200);

  process.env[key] = '1';
  await Role.updateOne({ _id: role.id }, { $set: { permissions: legacy } });
  assert.equal((await get('/setting/role/list')).status, 200);
  assert.equal((await get('/setting/account-admin/list')).status, 200);
});

test('a partially mapped role gets only explicitly granted delegated permissions and links', options, async () => {
  const { get } = await fixture([...legacy, 'role-view']);
  assert.equal((await get('/setting/role/list')).status, 200);
  assert.equal((await get('/setting/account-admin/list')).status, 403);
  assert.equal((await get('/contact/list')).status, 403);
  const page = await get('/setting/list');
  assert.equal(page.status, 200);
  assert.match(page.body, /href="\/admin\/setting\/role\/list"/);
  assert.doesNotMatch(page.body, /href="\/admin\/(?:contact\/list|setting\/account-admin\/list|setting\/website-info)"/);
});

test('a limited legacy role and an invalid switch value do not grant delegated permissions', options, async () => {
  const limited = await fixture(legacy.slice(1));
  assert.equal((await limited.get('/setting/list')).status, 403);
  const full = await fixture(legacy);
  process.env[key] = 'invalid';
  assert.equal((await full.get('/setting/list')).status, 403);
});

test('creating a role requires the actor to hold the target role’s effective permissions', options, async () => {
  const { post } = await fixture([...legacy, 'role-create', 'role-edit', 'account-admin-edit']);
  const deniedName = 'Role beyond fixture scope';
  const denied = await post('/setting/role/create', { name: deniedName, permissions: legacy });
  assert.equal(denied.code, 'error');
  assert.equal(await Role.countDocuments({ name: deniedName }), 0);
  const allowed = await post('/setting/role/create', { name: 'Scoped Role fixture', permissions: ['tour-view'] });
  assert.equal(allowed.code, 'success');
});
