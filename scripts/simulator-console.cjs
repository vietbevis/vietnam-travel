'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const HOST = '::1';
const PORT = 3304;
const AGENT_PORTS = { fixture: 32033, demo: 31999 };
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/console.css', ['console.css', 'text/css; charset=utf-8']],
  ['/console.js', ['console.js', 'text/javascript; charset=utf-8']]
]);
const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

function reply(res, status, data, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...headers, 'Content-Type': contentType });
  res.end(contentType.startsWith('application/json') ? JSON.stringify(data) : data);
}

async function readSlot(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 128) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data && Object.keys(data).length === 1 && Number.isInteger(data.slot) && data.slot >= 0) return data.slot;
  } catch {
    // Invalid JSON is a validation error.
  }
  return null;
}

function createConsoleServer(agentPort) {
  if (!Number.isInteger(agentPort) || agentPort < 1 || agentPort > 65535) throw new TypeError('Invalid Agent port');
  const base = `http://127.0.0.1:${agentPort}`;
  let switching = false;

  function agent(pathname, body) {
    const slotRequest = body !== undefined;
    return fetch(base + pathname, {
      redirect: 'error', signal: AbortSignal.timeout(2000),
      ...(slotRequest ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
  }

  async function status() {
    try {
      const response = await agent('/v1/status');
      if (!response.ok) throw new Error('Invalid Agent status');
      const { mode, reader, cardPresent, slot, slotCount, busy } = await response.json();
      if (!['sim', 'pcsc'].includes(mode) || typeof reader !== 'string' || typeof cardPresent !== 'boolean' ||
          (mode === 'sim' ? !Number.isInteger(slot) || slot < 0 : slot !== null)) throw new Error('Invalid Agent status');
      const supported = mode === 'sim' && Number.isInteger(slotCount) && slotCount > slot && slotCount <= 64 && typeof busy === 'boolean';
      return { connected: true, mode, reader, cardPresent, slot, slotCount: supported ? slotCount : null,
        busy: supported && busy, canSwitch: supported && cardPresent, agentPort };
    } catch {
      return { connected: false, canSwitch: false, agentPort };
    }
  }

  async function switchSlot(req, res) {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) {
      return reply(res, 415, { error: 'content-type' });
    }
    const slot = await readSlot(req);
    if (slot === null) return reply(res, 400, { error: 'slot' });
    if (switching) return reply(res, 409, { error: 'busy' });
    switching = true;
    try {
      const current = await status();
      if (!current.connected) return reply(res, 503, { error: 'offline' });
      if (!current.canSwitch) return reply(res, 409, { error: 'simulator-unavailable' });
      if (slot >= current.slotCount) return reply(res, 400, { error: 'slot' });
      if (slot === current.slot) return reply(res, 200, { slot });
      if (current.busy) return reply(res, 409, { error: 'busy' });
      const result = await agent('/v1/sim/slot', { slot });
      if (result.status === 409) return reply(res, 409, { error: 'busy' });
      if (!result.ok || (await result.json()).slot !== slot) throw new Error('Unconfirmed switch');
      return reply(res, 200, { slot });
    } catch {
      return reply(res, 502, { error: 'switch-unconfirmed' });
    } finally {
      switching = false;
    }
  }

  const server = http.createServer({ requestTimeout: 6000, headersTimeout: 3000, connectionsCheckingInterval: 1000 }, async (req, res) => {
    const expectedHost = `[${HOST}]:${server.address().port}`;
    const origin = `http://${expectedHost}`;
    const requestOrigin = req.headers.origin;
    if (req.headers.host !== expectedHost ||
        (requestOrigin !== undefined && requestOrigin !== origin) ||
        (req.method === 'POST' && requestOrigin !== origin)) return reply(res, 403, { error: 'origin' });

    try {
      if (req.method === 'GET') {
        const file = assets.get(req.url);
        if (file) return reply(res, 200, await fs.promises.readFile(path.join(__dirname, 'simulator-console', file[0])), file[1]);
        if (req.url === '/api/status') {
          const current = await status();
          return reply(res, 200, { ...current, busy: current.busy || switching });
        }
      }
      if (req.method === 'POST' && req.url === '/api/slot') return await switchSlot(req, res);
      return reply(res, 404, { error: 'not-found' });
    } catch {
      if (!res.headersSent) reply(res, 500, { error: 'console-error' });
    }
  });
  return server;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const mode = args.length === 0 ? 'fixture' : args.length === 1 && args[0] === '--demo' ? 'demo' : null;
  if (!mode) {
    console.error('Cách dùng: node scripts/simulator-console.cjs [--demo]');
    process.exitCode = 1;
  } else {
    const server = createConsoleServer(AGENT_PORTS[mode]);
    server.once('error', error => { console.error(`Không mở được Console trên [::1]:${PORT} (${error.code}).`); process.exitCode = 1; });
    server.listen(PORT, HOST, () => {
      console.log(`Simulator Console http://[::1]:${PORT}/ · Agent ${mode} :${AGENT_PORTS[mode]} · Dừng bằng Ctrl+C`);
    });
  }
}

module.exports = { createConsoleServer };
