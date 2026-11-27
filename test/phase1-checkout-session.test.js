const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const router = require('../routes/client/order.route');

test('checkout prepares an intent with a stable HttpOnly guest cookie before any stock write', async t => {
  t.mock.method(Date, 'now', () => 1795650000000);
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'checkout-session-fixture';
  t.after(() => {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  });
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(cookieParser());
  app.use('/order', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/order/checkout-session';
    const first = await fetch(url);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const value = first.headers.get('set-cookie');
    assert.match(value, /HttpOnly/i);
    assert.match(value, /SameSite=Lax/i);
    assert.match(value, /Max-Age=2592000/i);
    assert.doesNotMatch(value, /Domain=/i);
    const second = await fetch(url, { headers: { Cookie: value.split(';')[0] } });
    assert.equal(second.status, 200);
    const initial = await first.json();
    const next = await second.json();
    assert.equal(initial.scopeTag, next.scopeTag);
    assert.notEqual(initial.intentId, next.intentId);
    assert.equal(second.headers.get('set-cookie'), null);
    const secure = await fetch(url, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(secure.status, 200);
    const secureCookie = secure.headers.get('set-cookie');
    assert.match(secureCookie, /^__Host-travelCheckout=/);
    assert.match(secureCookie, /; Secure(?:;|$)/);
    assert.match(secureCookie, /; Path=\/(?:;|$)/);
    assert.doesNotMatch(secureCookie, /Domain=/i);
    await secure.json();
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
