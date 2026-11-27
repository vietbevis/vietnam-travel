'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { test } = require('node:test');

async function listen(server, host, t) {
  server.listen(0, host);
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

async function setup(t, options = {}) {
  const state = { mode: 'sim', reader: 'jCardSim', cardPresent: true, slot: 0, slotCount: 4, busy: false };
  let switches = 0;
  const agent = http.createServer(async (req, res) => {
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.origin, undefined);
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/v1/status') return res.end(JSON.stringify(state));
    if (req.method === 'POST' && req.url === '/v1/sim/slot') {
      let body = '';
      for await (const chunk of req) body += chunk;
      switches += 1;
      if (options.beforeSwitch) await options.beforeSwitch();
      if (state.busy) {
        res.statusCode = 409;
        return res.end('{"error":"busy"}');
      }
      state.slot = JSON.parse(body).slot;
      return res.end(JSON.stringify({ slot: state.slot }));
    }
    assert.fail(`Unexpected Agent request: ${req.method} ${req.url}`);
  });
  const agentPort = await listen(agent, '127.0.0.1', t);
  const { createConsoleServer } = require('../scripts/simulator-console.cjs');
  const server = createConsoleServer(agentPort);
  const port = await listen(server, '::1', t);
  const origin = `http://[::1]:${port}`;
  const status = () => fetch(`${origin}/api/status`).then(res => res.json());
  const select = (slot, headers = {}) => fetch(`${origin}/api/slot`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ slot })
  });
  return { agent, origin, port, state, status, select, getSwitches: () => switches };
}

test('console renders and reads live slots without switching on navigation or refresh', async t => {
  const env = await setup(t);
  const page = await fetch(env.origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Mô phỏng thẻ/);
  const current = await env.status();
  assert.equal(current.slot, 0);
  assert.equal(current.slotCount, 4);
  for (const slot of [1, 2, 3, 0]) {
    const res = await env.select(slot, { Cookie: 'fixture=ignore-me' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { slot });
    assert.equal((await env.status()).slot, slot);
  }
  assert.equal((await env.select(0)).status, 200);
  assert.equal((await env.status()).slot, 0);
  assert.equal(env.getSwitches(), 4);
  env.state.slotCount = 2;
  assert.equal((await env.status()).slotCount, 2);
  assert.equal((await env.select(2)).status, 400);
  assert.equal(env.getSwitches(), 4);
});

test('console restricts Origin, Host, JSON slots and its list of routes', async t => {
  const env = await setup(t);
  assert.equal((await env.select(1, { Origin: 'http://127.0.0.1:3302' })).status, 403);
  const withoutOrigin = await fetch(`${env.origin}/api/slot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"slot":1}'
  });
  assert.equal(withoutOrigin.status, 403);
  assert.equal((await env.select(1, { 'Content-Type': 'text/plain' })).status, 415);
  const invalidHost = await new Promise((resolve, reject) => http.get(`${env.origin}/api/status`, {
    headers: { Host: `127.0.0.1:${env.port}` }
  }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  assert.equal(invalidHost, 403);
  for (const slot of [-1, 4, 1.5, '2', null]) assert.equal((await env.select(slot)).status, 400);
  assert.equal((await fetch(`${env.origin}/v1/sim/reset`)).status, 404);
  assert.equal((await fetch(`${env.origin}/v1/transmit`)).status, 404);
  assert.equal(env.getSwitches(), 0);
});

test('console treats physical mode and outdated Agents as read-only', async t => {
  const env = await setup(t);
  env.state.mode = 'pcsc';
  env.state.slot = null;
  delete env.state.slotCount;
  delete env.state.busy;
  assert.equal((await env.status()).mode, 'pcsc');
  assert.equal((await env.select(1)).status, 409);
  env.state.mode = 'sim';
  env.state.slot = 0;
  assert.equal((await env.status()).canSwitch, false);
  assert.equal((await env.select(1)).status, 409);
  assert.equal(env.getSwitches(), 0);
});

test('console rejects concurrent switches and surfaces an atomic Agent busy response', async t => {
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  t.after(() => resume.resolve());
  const env = await setup(t, { beforeSwitch: async () => { started.resolve(); await resume.promise; } });
  const first = env.select(1);
  await started.promise;
  try {
    const duplicate = await env.select(2);
    assert.equal(duplicate.status, 409);
    env.state.busy = true;
  } finally {
    resume.resolve();
  }
  const result = await first;
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), { error: 'busy' });
  assert.equal((await env.status()).slot, 0);
  assert.equal(env.getSwitches(), 1);
});

test('console remains available and blocks switching while Agent is offline', async t => {
  const env = await setup(t);
  await new Promise(resolve => env.agent.close(resolve));
  const current = await env.status();
  assert.equal(current.connected, false);
  assert.equal((await env.select(1)).status, 503);
  assert.equal(env.getSwitches(), 0);
});
