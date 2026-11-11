const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const pug = require('pug');
const S = require('../public/assets/js/card/card-shared');
let C = {};
try { C = require('../public/assets/js/card/card-client'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const origin = 'https://travel.test';
const info = '11'.repeat(16) + '0102000501';
const nonce = '22'.repeat(16);
const opId = 'a'.repeat(24);
const signed = '8070030080' + '00'.repeat(128) + '00';
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 409, json: async () => body });
function make(handler, extra = {}) {
  assert.equal(typeof C.create, 'function', 'CardClient.create must implement the browser protocol');
  const calls = [];
  const client = C.create({ origin, agentUrl: 'http://127.0.0.1:31999', fetch: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, ...options, body });
    return handler(url, body, options, calls);
  }, ...extra });
  return { client, calls };
}
const agent = (data = '', sw = '9000') => response({ responses: [{ data, sw }] });
function cardHandler(server) {
  return (url, body, options, calls) => {
    if (url.endsWith('/v1/transmit')) {
      const ins = body.apdus[0].slice(2, 4);
      return agent(ins === '10' ? info : ins === '30' ? nonce : '');
    }
    return server(url, body, options, calls);
  };
}

// Break caught: returning an unvalidated response or losing the card SW.
test('cmd preserves PIN failure as CardError and Vietnamese message', async () => {
  const { client } = make(() => agent('', '63c3'));
  await assert.rejects(client.cmd(0x20, 0, 0), error => error.name === 'CardError' && error.sw === '63C3' && error.message === 'Sai mã PIN, còn 3 lần thử');
});
test('status is lazy and returns null when Agent is down', async () => {
  const { client, calls } = make(() => { throw Error('offline'); });
  assert.equal(calls.length, 0);
  assert.equal(await client.status(), null);
  await assert.rejects(client.cmd(0x10, 0, 0), /Không kết nối được Card Agent/);
});
test('status returns the real Agent presence information', async () => {
  const status = { mode: 'sim', reader: 'sim', cardPresent: true, slot: 0 };
  const { client, calls } = make(() => response(status));
  assert.deepEqual(await client.status(), status);
  assert.equal(calls[0].credentials, 'omit');
});
test('Agent URL rejects remote, credentials, query and hash without sending data', async () => {
  for (const agentUrl of ['https://evil.test', 'http://user@localhost:31999', 'http://localhost:31999/?x=1', 'http://localhost:31999/#x', 'javascript:alert(1)']) {
    const { client, calls } = make(() => agent(), { agentUrl });
    await assert.rejects(client.cmd(0x10, 0, 0), /AGENT_URL/);
    assert.equal(calls.length, 0);
  }
});
test('transmit validates input batch size and Agent early-stop shape', async () => {
  const { client, calls } = make(() => response({ responses: [{ data: '', sw: '6985' }] }));
  assert.deepEqual(await client.transmit(['8010000000', '8030000000']), [{ data: '', sw: '6985' }]);
  for (const apdus of [[], new Array(65).fill('8010000000'), ['GG'], ['00']]) await assert.rejects(client.transmit(apdus), /APDU/);
  assert.equal(calls.length, 1);
});
for (const responses of [[], [{ data: '', sw: '9000' }], [{ data: '0', sw: '9000' }], [{ data: '', sw: 'xyz!' }], [{ data: '00'.repeat(257), sw: '9000' }], [{ data: '', sw: '6985' }, { data: '', sw: '9000' }]]) {
  test('malformed Agent count/hex/length/early-stop fails closed: ' + JSON.stringify(responses).slice(0, 70), async () => {
    const { client } = make(() => response({ responses }));
    await assert.rejects(client.transmit(['8010000000', '8030000000']), /AGENT_RESPONSE/);
  });
}
test('runSignedOp forwards raw failure SW before throwing and never retries', async () => {
  const run = make((url, body) => url.endsWith('/v1/transmit') ? agent(body.apdus[0].slice(2, 4) === '30' ? nonce : 'AB', body.apdus[0].slice(2, 4) === '70' ? '6985' : '9000') : url.endsWith('/sign') ? response({ apdu: signed }) : response({ code: 'error', ok: false }));
  await assert.rejects(run.client.runSignedOp({ signUrl: '/sign', confirmUrl: '/confirm', opId }), error => error.sw === '6985');
  assert.deepEqual(run.calls.map(call => call.url.split('/').pop()), ['transmit', 'sign', 'transmit', 'confirm']);
  assert.deepEqual(run.calls[3].body, { opId, response: 'AB', sw: '6985' });
  assert.equal(run.calls[0].credentials, 'omit');
  assert.equal(run.calls[1].credentials, 'same-origin');
});
test('runSignedOp returns backend success and transport ambiguity never confirms or retries', async () => {
  let fail = false;
  const { client, calls } = make((url, body) => {
    if (url.endsWith('/v1/transmit')) { if (fail && body.apdus[0] === signed) throw Error('lost'); return agent(body.apdus[0].slice(2, 4) === '30' ? nonce : ''); }
    if (url === '/sign') return response({ apdu: signed });
    return response({ code: 'success', ok: true });
  });
  assert.deepEqual(await client.runSignedOp({ signUrl: '/sign', confirmUrl: '/confirm', opId }), { code: 'success', ok: true });
  fail = true;
  const before = calls.length;
  await assert.rejects(client.runSignedOp({ signUrl: '/sign', confirmUrl: '/confirm', opId }), /Không kết nối/);
  assert.equal(calls.length - before, 3);
});
test('composite signed flows serialize challenge/sign/execute/confirm', async () => {
  const { client, calls } = make(cardHandler(async url => { await new Promise(resolve => setImmediate(resolve)); return response(url === '/sign' ? { apdu: signed } : { ok: true }); }));
  await Promise.all([client.runSignedOp({ signUrl: '/sign', confirmUrl: '/confirm', opId }), client.runSignedOp({ signUrl: '/sign', confirmUrl: '/confirm', opId })]);
  assert.deepEqual(calls.map(call => call.url.split('/').pop()), ['transmit', 'sign', 'transmit', 'confirm', 'transmit', 'sign', 'transmit', 'confirm']);
});
test('two clients in one realm cannot invalidate each other signed challenges', async () => {
  const order = [];
  const handler = cardHandler(async (url) => { order.push(url); await new Promise(resolve => setImmediate(resolve)); return response(url === '/sign' ? { apdu: signed } : { ok: true }); });
  const wrap = (url, body, options, calls) => { if (url.endsWith('/v1/transmit')) order.push(body.apdus[0].slice(2, 4)); return handler(url, body, options, calls); };
  const first = make(wrap).client, second = make(wrap).client;
  await Promise.all([first.runSignedOp({ signUrl: '/sign', confirmUrl: '/confirm', opId }), second.runSignedOp({ signUrl: '/sign', confirmUrl: '/confirm', opId })]);
  assert.deepEqual(order, ['30', '/sign', '70', '/confirm', '30', '/sign', '70', '/confirm']);
});
test('openSession syncs two operations then null, refreshes info and respects Task5 envelope', async () => {
  let next = 0;
  const { client, calls } = make(cardHandler(url => response(url.endsWith('/next') ? { code: 'success', step: ++next <= 2 ? { kind: 'op', opId, apdu: signed } : null } : { code: 'success', ok: true })));
  const result = await client.openSession();
  assert.equal(result.cardId, '11'.repeat(16));
  assert.equal(calls.filter(c => c.url.endsWith('/confirm')).length, 2);
  assert.equal(calls.filter(c => c.url.endsWith('/next')).length, 3);
  assert.equal(calls.filter(c => c.body?.apdus?.[0] === '8030000000').length, 3);
  assert.equal(calls[0].body.apdus[0], '00A4040008F054524156454C0100');
});
test('openSession refuses an eleventh next request', async () => {
  const { client, calls } = make(cardHandler(url => response(url.endsWith('/next') ? { step: { kind: 'op', opId, apdu: signed } } : { ok: true })));
  await assert.rejects(client.openSession(), /SYNC_LOOP/);
  assert.equal(calls.filter(c => c.url.endsWith('/next')).length, 10);
  assert.equal(calls.filter(c => c.url.endsWith('/confirm')).length, 10);
});
// Agent giả trả lời từng APDU trong batch và dừng ở SW lỗi đầu tiên như agent thật.
function batchAgent(swFor = () => '9000') {
  return body => {
    const responses = [];
    for (const apdu of body.apdus) {
      const ins = apdu.slice(2, 4), sw = swFor(ins);
      responses.push({ data: sw !== '9000' ? '' : ins === '10' ? info : ins === '30' ? nonce : '', sw });
      if (sw !== '9000') break;
    }
    return response({ responses });
  };
}
const receiptStep = { step: { kind: 'receipt', txRef: '33'.repeat(8), apdu: '8054000008' + '33'.repeat(8) + '00' } };
test('sync receipt rotates the challenge in the same batch and forwards it with the raw missing-receipt SW', async () => {
  const transmit = batchAgent(ins => ins === '54' ? '6A88' : '9000');
  const { client, calls } = make((url, body) => url.endsWith('/v1/transmit') ? transmit(body) : response(url.endsWith('/next') ? receiptStep : { code: 'error', ok: false }));
  await assert.rejects(client.openSession(), error => error.sw === '6A88');
  const batch = calls.filter(c => c.url.endsWith('/v1/transmit')).find(c => c.body.apdus.includes(receiptStep.step.apdu));
  assert.equal(batch.body.apdus.length, 2);
  assert.equal(batch.body.apdus[0].slice(2, 4), '30', 'GET_CHALLENGE phải đi trước GET_RECEIPT trong cùng batch');
  assert.equal(batch.body.apdus[1], receiptStep.step.apdu);
  assert.deepEqual(calls.at(-1).body, { cardId: '11'.repeat(16), txRef: '33'.repeat(8), challenge: nonce.toUpperCase(), response: '', sw: '6A88' });
  assert.equal(calls.at(-1).credentials, 'omit');
});
test('sync continues after the server releases a transaction the card never received', async () => {
  const transmit = batchAgent(ins => ins === '54' ? '6A88' : '9000');
  let nexts = 0;
  const { client, calls } = make((url, body) => {
    if (url.endsWith('/v1/transmit')) return transmit(body);
    if (url.endsWith('/next')) return response(nexts++ === 0 ? receiptStep : { code: 'success', step: null });
    return response({ code: 'success', ok: false, released: true, result: null });
  });
  assert.equal((await client.openSession()).cardId, '11'.repeat(16));
  assert.equal(calls.filter(c => c.url.endsWith('/next')).length, 2);
});
test('sync receipt never sends GET_RECEIPT alone when the challenge rotation fails', async () => {
  // GET_CHALLENGE cho /sync/next thành công; GET_CHALLENGE trong batch biên nhận thất bại.
  let challenges = 0;
  const transmit = batchAgent(ins => ins === '30' && ++challenges === 2 ? '6985' : ins === '54' ? '6A88' : '9000');
  const { client, calls } = make((url, body) => url.endsWith('/v1/transmit') ? transmit(body) : response(url.endsWith('/next') ? receiptStep : { code: 'success', released: true }));
  await assert.rejects(client.openSession(), error => error.sw === '6985');
  assert.equal(challenges, 2);
  assert.equal(calls.filter(c => c.url.endsWith('/receipt')).length, 0);
});
test('requiresAuth is returned without an authentication loop; mustChangePin omits cookies', async () => {
  const { client, calls } = make((url, body) => url.endsWith('/v1/transmit') ? agent(body.apdus[0].slice(2, 4) === '10' ? '11'.repeat(16) + '0102010501' : body.apdus[0].slice(2, 4) === '30' ? nonce : '') : response({ code: 'success', step: null, requiresAuth: true }));
  assert.equal((await client.openSession()).requiresAuth, true);
  assert.equal(calls.find(c => c.url.endsWith('/next')).credentials, 'omit');
});
test('CREATED and TERMINATED skip sync; termination during sync sends no later challenge', async () => {
  for (const state of ['00', '7F']) {
    const { client, calls } = make(() => agent('00'.repeat(16) + '00' + state + '000501'));
    assert.equal((await client.openSession()).state, parseInt(state, 16));
    assert.equal(calls.length, 2);
  }
  let changed = false;
  const { client, calls } = make((url, body) => {
    if (url.endsWith('/v1/transmit')) return agent(body.apdus[0].slice(2, 4) === '10' ? (changed ? '00'.repeat(16) + '007F000001' : info) : body.apdus[0].slice(2, 4) === '30' ? nonce : '');
    if (url.endsWith('/confirm')) { changed = true; return response({ ok: true }); }
    return response({ step: { kind: 'op', opId, apdu: signed } });
  });
  assert.equal((await client.openSession()).state, 127);
  assert.equal(calls.filter(c => c.body?.apdus?.[0] === '8030000000').length, 1);
});
test('writeTarget PHOTO splits 500 bytes into 224/224/52 and never commits', async () => {
  const { client, calls } = make(() => agent());
  await client.writeTarget(S.TARGET.PHOTO, new Uint8Array(500));
  assert.equal(calls[0].body.apdus[0], '804102000201F400');
  assert.deepEqual(calls.slice(1).map(c => c.body.apdus[0].slice(0, 10)), ['80420200E0', '80420201E0', '8042020234']);
  assert.equal(calls.length, 4);
  await assert.rejects(client.writeTarget(S.TARGET.PROFILE, new Uint8Array(500)), /TARGET_LENGTH/);
  await assert.rejects(client.writeTarget(3, new Uint8Array(1)), /TARGET/);
  await assert.rejects(client.writeTarget(S.TARGET.PHOTO, new Uint8Array(10081)), /TARGET_LENGTH/);
  assert.equal(calls.length, 4);
});
test('readTarget bounds length and requires exact chunk lengths', async () => {
  const bytes = 'AA'.repeat(224);
  const { client, calls } = make((url, body) => agent(body.apdus[0].slice(6, 8) === 'FF' ? '01C0' : bytes));
  assert.equal((await client.readTarget(1)).length, 448);
  assert.deepEqual(calls.map(c => c.body.apdus[0]), ['804001FF00', '8040010000', '8040010100']);
  for (const length of ['01C1', '00', '0001']) {
    const run = make((url, body) => agent(body.apdus[0].slice(6, 8) === 'FF' ? length : ''));
    await assert.rejects(run.client.readTarget(1), /CARD_RESPONSE|TARGET_LENGTH/);
    assert.ok(run.calls.length <= 2);
  }
});
test('PIN formats and weak new PIN reject before sending APDU; optional DOB is respected', async () => {
  const { client, calls } = make(() => agent());
  await assert.rejects(client.verifyPin('a12345'), /PIN_FORMAT/);
  for (const pin of ['111111', '123456', '654321']) await assert.rejects(client.changePin('135790', pin), /WEAK_PIN/);
  await assert.rejects(client.changePin('135790', '010100', '20000101'), /WEAK_PIN/);
  assert.equal(calls.length, 0);
  await client.verifyPin('135790');
  await client.changePin('135790', '246809');
  assert.deepEqual(calls.map(c => c.body.apdus[0]), ['802000000631333537393000', '802100000C31333537393032343638303900']);
});
test('wrappers parse protocol bytes and profile UTF8 rather than trusting arbitrary data', async () => {
  const profileHex = '0105416E6820C3'; // deliberately invalid UTF8
  const { client } = make((url, body) => {
    const a = body.apdus[0];
    if (a.slice(2, 4) === '50') return agent('000F424000000003');
    if (a.slice(2, 4) === '53') return agent('0102000000640000038400000004AABBCCDDEEFF0011');
    if (a.slice(2, 4) === '61') return agent('0101' + Buffer.from('ORDER0000001').toString('hex') + '12'.repeat(12) + Buffer.from('20261110').toString('hex') + '02');
    return agent(a.slice(6, 8) === 'FF' ? '0007' : profileHex);
  });
  assert.deepEqual(await client.readBalance(), { balance: 1000000, counter: 3 });
  assert.deepEqual(await client.readTxLog(), [{ type: 2, amount: 100, balanceAfter: 900, counter: 4, txRef: 'AABBCCDDEEFF0011' }]);
  assert.deepEqual(await client.readTickets(), [{ status: 1, orderCode: 'ORDER0000001', tourId: '12'.repeat(12), departure: '20261110', pax: 2 }]);
  await assert.rejects(client.readProfile());
});
test('wrappers reject short/oversized records before parsing', async () => {
  for (const [method, data] of [['readBalance', '00'], ['readTxLog', '0B'], ['readTxLog', '0100'], ['readTickets', '06'], ['readTickets', '0100'], ['getChallenge', '00']]) {
    const { client } = make(() => agent(data));
    await assert.rejects(client[method](), /CARD_RESPONSE/);
  }
});
test('authenticate binds protected fields, forwards extra body and uses same-origin only', async () => {
  const { client, calls } = make((url, body) => url.endsWith('/v1/transmit') ? agent(body.apdus[0].slice(2, 4) === '10' ? info : '00000007' + 'AB'.repeat(128)) : response(url === '/challenge' ? { nonce } : { code: 'success' }));
  assert.deepEqual(await client.authenticate({ challengeUrl: '/challenge', verifyUrl: '/verify', body: { label: 'x', cardId: 'evil', nonce: 'evil', counter: 0, signature: 'evil' } }), { code: 'success' });
  assert.deepEqual(calls.at(-1).body, { label: 'x', cardId: '11'.repeat(16), nonce, counter: 7, signature: 'AB'.repeat(128) });
  const before = calls.length;
  await assert.rejects(client.authenticate({ challengeUrl: 'https://evil.test/challenge', verifyUrl: '/verify' }), /SERVER_URL/);
  await assert.rejects(client.authenticate({ challengeUrl: '/challenge', verifyUrl: '//evil.test/verify' }), /SERVER_URL/);
  assert.equal(calls.length, before);
});
test('server error envelopes and malformed signed APDU never reach the card', async () => {
  for (const value of [{ code: 'error', errorCode: 'OP_FORBIDDEN' }, { code: 'success', apdu: 'zz' }, { apdu: '00' }]) {
    const { client, calls } = make(cardHandler(() => response(value)));
    await assert.rejects(client.runSignedOp({ signUrl: '/sign', confirmUrl: '/confirm', opId }), /OP_FORBIDDEN|APDU/);
    assert.equal(calls.length, 2);
  }
});

// Small DOM fixture: native DOM events/resources are external; all PIN lifecycle logic is real.
class Element {
  constructor() { this.listeners = new Map(); this.value = ''; this.textContent = ''; this.open = false; this.focused = false; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, detail = {}) { let prevented = false; for (const fn of [...(this.listeners.get(name) || [])]) fn({ ...detail, preventDefault() { prevented = true; } }); return prevented; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; setTimeout(() => this.emit('close'), 0); }
}
function browser() {
  const modal = new Element(), form = new Element(), input = new Element(), cancel = new Element(), title = new Element(), status = new Element(), previous = new Element();
  modal.querySelector = selector => ({ form, '[card-pin-input]': input, '[card-pin-cancel]': cancel, '[card-pin-title]': title, '[card-pin-status]': status })[selector];
  const page = new Element();
  page.document = { activeElement: previous, querySelector: selector => selector === '[card-pin-modal]' ? modal : null };
  const revoked = [];
  let created = 0;
  const context = vm.createContext({ window: page, URL: { createObjectURL: () => 'blob:' + ++created, revokeObjectURL: url => revoked.push(url) }, Blob, TextEncoder, TextDecoder, Uint8Array, URLSearchParams, setTimeout, clearTimeout, AbortController, URL: class extends URL {} });
  context.URL.createObjectURL = () => 'blob:' + ++created;
  context.URL.revokeObjectURL = url => revoked.push(url);
  page.URL = context.URL;
  page.location = { origin };
  let fetchCount = 0;
  page.fetch = async () => { fetchCount++; return agent(); };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/assets/js/card/card-shared.js'), 'utf8'), context);
  const file = path.join(__dirname, '../public/assets/js/card/card-client.js');
  assert.ok(fs.existsSync(file), 'browser UMD script must exist');
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return { ...{ modal, form, input, cancel, title, status, previous, page, revoked }, fetchCount: () => fetchCount, C: page.CardClient };
}
test('browser UMD creates window.cardClient without fetching at load', () => {
  const b = browser();
  assert.equal(typeof b.page.cardClient.openSession, 'function');
  assert.equal(b.fetchCount(), 0);
});
test('PIN modal clears on submit, rejects concurrent prompt, removes listeners and restores focus', async () => {
  const b = browser();
  const promise = b.page.cardClient.askPin('Xác thực');
  assert.equal(b.modal.open, true); assert.equal(b.input.focused, true); assert.equal(b.title.textContent, 'Xác thực');
  await assert.rejects(b.page.cardClient.askPin('second'), /PIN_BUSY/);
  b.input.value = '135790'; b.form.emit('submit');
  assert.equal(await promise, '135790'); assert.equal(b.input.value, ''); assert.equal(b.modal.open, false); assert.equal(b.previous.focused, true);
  for (const element of [b.modal, b.form, b.cancel]) for (const handlers of element.listeners.values()) assert.equal(handlers.size, 0);
});
test('PIN modal form rejects invalid input locally; cancel, Escape, close and dispose all clear', async () => {
  for (const exit of ['cancel', 'escape', 'close', 'dispose']) {
    const b = browser(); const promise = b.page.cardClient.askPin('PIN');
    b.input.value = 'abc'; b.form.emit('submit'); assert.equal(b.modal.open, true); assert.ok(b.status.textContent);
    b.input.value = '135790';
    if (exit === 'cancel') b.cancel.emit('click');
    if (exit === 'escape') assert.equal(b.modal.emit('cancel'), true);
    if (exit === 'close') b.modal.close();
    if (exit === 'dispose') b.page.cardClient.dispose();
    await assert.rejects(promise, /PIN_CANCELLED/); assert.equal(b.input.value, ''); assert.equal(b.modal.open, false);
  }
});
test('queued close from a completed PIN prompt cannot cancel its immediately opened successor', async () => {
  const b = browser();
  const first = b.page.cardClient.askPin('First');
  b.input.value = '135790'; b.form.emit('submit');
  assert.equal(await first, '135790');
  let outcome = 'pending';
  const second = b.page.cardClient.askPin('Second').then(value => { outcome = 'resolved'; return value; }, error => { outcome = error.code; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(outcome, 'pending');
  assert.equal(b.modal.open, true);
  b.input.value = '246809'; b.form.emit('submit');
  assert.equal(await second, '246809');
  assert.equal(b.input.value, '');
  assert.equal(b.previous.focused, true);
});
test('pagehide clears PIN/blob and pageshow restores the same client without auto-fetch; explicit dispose is terminal', async () => {
  const b = browser();
  const original = b.page.cardClient;
  const pending = original.askPin('Before navigation').then(() => 'resolved', error => error.code);
  b.input.value = '135790';
  b.page.emit('pagehide', { persisted: true });
  assert.equal(await pending, 'PIN_CANCELLED');
  assert.equal(b.input.value, '');
  assert.equal(b.modal.open, false);
  await assert.rejects(original.askPin('Hidden'), /CLIENT_SUSPENDED/);
  b.page.emit('pageshow', { persisted: true });
  assert.equal(b.page.cardClient, original);
  assert.equal(b.fetchCount(), 0);
  const restored = original.askPin('Restored').then(() => 'resolved', error => error.code);
  assert.equal(b.modal.open, true);
  b.cancel.emit('click'); assert.equal(await restored, 'PIN_CANCELLED');
  original.dispose();
  b.page.emit('pageshow', { persisted: true });
  await assert.rejects(original.askPin('Disposed'), /CLIENT_DISPOSED/);
  await assert.rejects(original.cmd(0x10, 0, 0), /CLIENT_DISPOSED/);
});
test('pagehide invalidates in-flight and queued signed work across restore without confirming or retrying APDU', async () => {
  for (const pendingStage of ['transport', 'json']) {
  const b = browser();
  const calls = [];
  let resolveLate;
  const c = b.C.create({ origin, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/transmit')) {
      const apdu = JSON.parse(options.body).apdus[0];
      if (apdu.slice(2, 4) === '30') return agent(nonce);
      if (apdu.slice(2, 4) === '10') return agent('AB');
      if (pendingStage === 'transport') return new Promise(resolve => { resolveLate = resolve; });
      return { ok: true, json: () => new Promise(resolve => { resolveLate = resolve; }) };
    }
    return response({ apdu: signed });
  } });
  const flow = c.runSignedOp({ signUrl: '/sign', confirmUrl: '/confirm', opId }).then(() => 'resolved', error => error.code);
  const queued = c.cmd(0x10, 0, 0).then(() => 'resolved', error => error.code);
  while (!resolveLate) await new Promise(resolve => setImmediate(resolve));
  b.page.emit('pagehide', { persisted: true });
  b.page.emit('pageshow', { persisted: true });
  resolveLate(pendingStage === 'transport' ? agent() : { responses: [{ data: '', sw: '9000' }] });
  assert.match(await flow, /CLIENT_SUSPENDED|CLIENT_STALE/);
  assert.match(await queued, /CLIENT_SUSPENDED|CLIENT_STALE/);
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).options.signal.aborted, true);
  assert.equal(S.toHex(await c.cmd(0x10, 0, 0)), 'AB');
  assert.equal(calls.length, 4);
  const pin = c.askPin('After restore').then(() => 'resolved', error => error.code);
  assert.equal(b.modal.open, true); b.cancel.emit('click'); assert.equal(await pin, 'PIN_CANCELLED');
  }
});
test('photo URLs revoke on replacement, read failure, dispose and pagehide', async () => {
  const b = browser(); let fail = false;
  const c = b.C.create({ origin, fetch: async (url, options) => fail ? agent('', '6982') : agent(JSON.parse(options.body).apdus[0].slice(6, 8) === 'FF' ? '0001' : 'AA') });
  assert.equal(await c.readPhotoUrl(), 'blob:1'); assert.equal(await c.readPhotoUrl(), 'blob:2');
  fail = true; await assert.rejects(c.readPhotoUrl()); assert.deepEqual(b.revoked, ['blob:1', 'blob:2']);
  fail = false; await c.readPhotoUrl(); c.dispose(); assert.deepEqual(b.revoked, ['blob:1', 'blob:2', 'blob:3']);
  const d = b.C.create({ origin, fetch: async (url, options) => agent(JSON.parse(options.body).apdus[0].slice(6, 8) === 'FF' ? '0001' : 'AA') });
  await d.readPhotoUrl(); b.page.emit('pagehide'); assert.deepEqual(b.revoked, ['blob:1', 'blob:2', 'blob:3', 'blob:4']);
});
test('both rendered layouts escape hostile config, configure before shared/client, hide accessible dialog', () => {
  const hostile = '\"></script><script>globalThis.pwned=true</script>';
  for (const area of ['admin', 'client']) {
    const html = pug.renderFile(path.join(__dirname, '../views/' + area + '/layouts/default.pug'), { pageTitle: 'Test', cardAgentUrl: hostile, pathAdmin: '/admin', messages: {}, settingWebsiteInfo: {}, permissions: [], account: {}, categoryList: [], categoryTree: [], settingWebsite: {} });
    assert.equal(html.includes('<script>globalThis.pwned'), false);
    assert.ok(html.includes('data-card-agent-url="&quot;&gt;&lt;/script&gt;'));
    const config = html.indexOf('window.CARD_AGENT_URL');
    assert.ok(config >= 0 && config < html.indexOf('src="/assets/js/card/card-shared.js"'));
    assert.ok(html.indexOf('src="/assets/js/card/card-shared.js"') < html.indexOf('src="/assets/js/card/card-client.js"'));
    assert.match(html, /<dialog[^>]*card-pin-modal[^>]*>/);
    assert.doesNotMatch(html.match(/<dialog[^>]*>/)[0], /\bopen\b/);
    assert.match(html, /type="password"/); assert.match(html, /inputmode="numeric"/); assert.match(html, /maxlength="6"/); assert.match(html, /aria-labelledby=/);
    assert.match(html, /<form[^>]*novalidate/);
  }
});
test('Node factory contract supports relative server endpoints without browser globals', async () => {
  const { client } = make(cardHandler(() => response({ step: null })), { origin: undefined });
  assert.equal((await client.openSession()).state, 2);
});
test('readProfile decodes valid Vietnamese UTF8 and browser askPin injection returns only a value', async () => {
  const { client, calls } = make((url, body) => agent(body.apdus[0].slice(6, 8) === 'FF' ? '0005' : '010342C3A9'), { askPin: title => title === 'Xác thực' ? '135790' : '' });
  assert.deepEqual(await client.readProfile(), { fullName: 'Bé' });
  assert.equal(await client.askPin('Xác thực'), '135790');
  assert.equal(calls.length, 2);
});
test('invalid public info, nonce and auth response lengths never verify with backend', async () => {
  for (const malformed of ['info', 'nonce', 'auth']) {
    const { client, calls } = make((url, body) => {
      if (!url.endsWith('/v1/transmit')) return response({ nonce: malformed === 'nonce' ? 'AA' : nonce });
      if (body.apdus[0].slice(2, 4) === '10') return agent(malformed === 'info' ? 'AA' : info);
      return agent('00'.repeat(131));
    });
    await assert.rejects(client.authenticate({ challengeUrl: '/challenge', verifyUrl: '/verify' }), /CARD_RESPONSE|SERVER_RESPONSE/);
    assert.equal(calls.filter(c => c.url === '/verify').length, 0);
  }
});
test('HTTP error and hanging Agent/body receive bounded friendly failure without retry', async () => {
  for (const handler of [() => response({ error: 'no-card' }, false), () => new Promise(() => {}), () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    const { client, calls } = make(handler, { timeoutMs: 10 });
    await assert.rejects(client.cmd(0x10, 0, 0), /Không kết nối được Card Agent/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, true);
  }
});
