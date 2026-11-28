const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const pug = require('pug');
const auth = require('../middlewares/admin/auth.middleware');
const Order = require('../models/order.model');
const { errorHandler } = require('../middlewares/http-route.middleware');

async function withAdmin(t, permissions, run) {
  const routerPath = require.resolve('../routes/admin/index.route');
  delete require.cache[routerPath];
  const restore = t.mock.method(auth, 'verifyToken', (req, res, next) => {
    req.permissions = permissions;
    Object.assign(res.locals, { permissions, account: { fullName: 'Fixture', roleName: 'Fixture' } });
    next();
  });
  const app = express();
  app.set('view engine', 'pug');
  Object.assign(app.locals, { pathAdmin: 'admin', messages: {} });
  app.use(express.json());
  app.use('/admin', require(routerPath));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await run((url, options) => fetch('http://127.0.0.1:' + server.address().port + url, options));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    restore.mock.restore();
    delete require.cache[routerPath];
  }
}

test('an unknown Admin page renders the existing 404 page with status 404', async t => {
  await withAdmin(t, [], async request => {
    const response = await request('/admin/fixture-unknown-page');
    assert.equal(response.status, 404);
    assert.match(await response.text(), /404 Not Found/);
  });
});

test('the revenue chart refuses an invalid calendar range before querying orders', async t => {
  const find = t.mock.method(Order, 'aggregate', async () => []);
  await withAdmin(t, ['dashboard-view'], async request => {
    const response = await request('/admin/dashboard/revenue-chart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentMonth: 13, currentYear: 2026, previousMonth: 12, previousYear: 2026, arrayDay: [1] })
    });
    assert.equal(response.status, 400);
    assert.equal(find.mock.callCount(), 0);
    assert.equal((await response.json()).code, 'error');
  });
});

test('the Admin landing uses the allowed category page for a category-only role', async t => {
  await withAdmin(t, ['category-view'], async request => {
    const response = await request('/admin/start', { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin/category/list');
  });
});

test('the revenue chart and upload require their own capabilities at the route boundary', async t => {
  const find = t.mock.method(Order, 'aggregate', async () => assert.fail('route should not read orders'));
  await withAdmin(t, ['category-view'], async request => {
    const chart = await request('/admin/dashboard/revenue-chart', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(chart.status, 403);
    assert.equal(find.mock.callCount(), 0);
    const upload = await request('/admin/upload/image', { method: 'POST', body: new FormData() });
    assert.equal(upload.status, 403);
  });
});

test('async chart failures preserve deployment-neutral JSON and do not break a following request', async t => {
  t.mock.method(Order, 'aggregate', async () => { throw new Error('database fixture detail'); });
  t.mock.method(Order, 'countDocuments', async () => 0);
  t.mock.method(require('../models/card-transaction.model'), 'aggregate', async () => []);
  await withAdmin(t, ['dashboard-view'], async request => {
    const response = await request('/admin/dashboard/revenue-chart', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentMonth: 1, currentYear: 2026, previousMonth: 12, previousYear: 2025, arrayDay: [1] })
    });
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /database fixture detail/);
    assert.equal((await request('/admin/fixture-unknown-page')).status, 404);
  });
});

test('the Client layout loads its shared script once', () => {
  const html = pug.renderFile('views/client/pages/account-login.pug', {
    messages: {}, settingWebsiteInfo: {}, categoryList: [], pageTitle: 'Fixture'
  });
  assert.equal((html.match(/src="\/assets\/js\/script\.js"/g) || []).length, 1);
});

test('the card list only offers issue to a role with card-issue', () => {
  const template = pug.compileFile('views/admin/pages/card-list.pug');
  const locals = {
    pathAdmin: 'admin', messages: {}, account: {}, cards: [], filters: {}, statusNames: {},
    pagination: { page: 1, totalPage: 1, total: 0 }
  };
  assert.doesNotMatch(template({ ...locals, permissions: ['card-view'] }), /href="\/admin\/card\/issue"/);
  assert.match(template({ ...locals, permissions: ['card-view', 'card-issue'] }), /href="\/admin\/card\/issue"/);
});
