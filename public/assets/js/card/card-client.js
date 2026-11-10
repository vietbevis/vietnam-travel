(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root, require('./card-shared.js'));
  else {
    root.CardClient = factory(root, root.CardShared);
    root.cardClient = root.CardClient.create({ agentUrl: root.CARD_AGENT_URL });
  }
}(typeof window !== 'undefined' ? window : globalThis, function (root, S) {
  'use strict';

  class CardError extends Error {
    constructor(sw) { super(S.swMessage(sw)); this.name = 'CardError'; this.sw = sw; this.code = sw; }
  }
  const fail = code => { const error = new Error(code); error.code = code; return error; };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const hex = (value, bytes) => typeof value === 'string' && value.length === bytes * 2 && /^[0-9a-f]*$/i.test(value);
  const u32 = (bytes, offset) => (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
  function exact(bytes, length) { if (bytes.length !== length) throw fail('CARD_RESPONSE'); return bytes; }
  function validApdu(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length % 2) return false;
    const n = value.length / 2;
    if (n < 4 || n > 261) return false;
    return n <= 5 || n === 5 + parseInt(value.slice(8, 10), 16) || n === 6 + parseInt(value.slice(8, 10), 16);
  }
  let pendingPin = null;
  // Mỗi trang dùng một đầu đọc: giữ khóa cả khi gọi server và gửi APDU.
  // Instance thứ hai không được thay challenge của lệnh đang chờ chữ ký.
  let queue = Promise.resolve();
  function modalPin(title, owner) {
    if (pendingPin) return Promise.reject(fail('PIN_BUSY'));
    const document = root.document;
    const modal = document && document.querySelector('[card-pin-modal]');
    if (!modal || typeof modal.showModal !== 'function') return Promise.reject(fail('PIN_MODAL_UNAVAILABLE'));
    const input = modal.querySelector('[card-pin-input]');
    const form = modal.querySelector('form');
    const cancelButton = modal.querySelector('[card-pin-cancel]');
    const status = modal.querySelector('[card-pin-status]');
    const heading = modal.querySelector('[card-pin-title]');
    const previous = document.activeElement;
    return new Promise((resolve, reject) => {
      let settled = false;
      function finish(error, value) {
        if (settled) return;
        settled = true;
        input.value = ''; status.textContent = '';
        form.removeEventListener('submit', submit);
        cancelButton.removeEventListener('click', cancel);
        modal.removeEventListener('cancel', cancel);
        modal.removeEventListener('close', closed);
        pendingPin = null;
        if (modal.open) modal.close();
        if (previous && typeof previous.focus === 'function') previous.focus();
        if (error) reject(error); else resolve(value);
      }
      function cancel(event) { if (event) event.preventDefault(); finish(fail('PIN_CANCELLED')); }
      // Sự kiện close của dialog được xếp hàng, có thể tới khi hộp nhập sau
      // đã mở lại; sự kiện cũ đó không phải yêu cầu hủy hộp nhập hiện tại.
      function closed(event) { if (!modal.open) cancel(event); }
      function submit(event) {
        event.preventDefault();
        if (!S.isPinFormat(input.value)) { status.textContent = 'Mã PIN phải gồm đúng 6 chữ số.'; input.value = ''; input.focus(); return; }
        finish(null, input.value);
      }
      input.value = ''; status.textContent = ''; heading.textContent = title || 'Nhập mã PIN';
      form.addEventListener('submit', submit);
      cancelButton.addEventListener('click', cancel);
      modal.addEventListener('cancel', cancel);
      modal.addEventListener('close', closed);
      pendingPin = { owner, cancel };
      try { modal.showModal(); input.focus(); } catch { finish(fail('PIN_MODAL_UNAVAILABLE')); }
    });
  }

  function create(options) {
    options = options || {};
    const fetcher = options.fetch || (root.fetch && root.fetch.bind(root));
    const origin = options.origin || (root.location && root.location.origin);
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.min(options.timeoutMs, 60000) : 15000;
    let disposed = false, suspended = false, generation = 0, activeGeneration = 0, photoUrl = null;
    const controllers = new Set();
    const cancellations = new Set();
    const owner = {};
    function ensureActive(expectedGeneration) {
      if (disposed) throw fail('CLIENT_DISPOSED');
      if (suspended) throw fail('CLIENT_SUSPENDED');
      if (expectedGeneration !== generation) throw fail('CLIENT_STALE');
    }
    const serial = work => {
      const requestedGeneration = generation;
      const result = queue.then(() => {
        ensureActive(requestedGeneration);
        activeGeneration = requestedGeneration;
        return work();
      });
      queue = result.catch(() => {});
      return result;
    };
    function clearPhoto() {
      if (photoUrl) { root.URL.revokeObjectURL(photoUrl); photoUrl = null; }
    }
    function agentBase() {
      let url;
      try { url = new URL(options.agentUrl === undefined || options.agentUrl === '' ? 'http://127.0.0.1:31999' : options.agentUrl); } catch { throw fail('AGENT_URL'); }
      if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw fail('AGENT_URL');
      return url.origin;
    }
    function serverUrl(value) {
      if (typeof value !== 'string' || !value || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) throw fail('SERVER_URL');
      let url;
      const base = origin || 'http://localhost';
      if (!origin && !value.startsWith('/')) throw fail('SERVER_URL');
      try { url = new URL(value, base); } catch { throw fail('SERVER_URL'); }
      if (url.origin !== base || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw fail('SERVER_URL');
      return value;
    }
    async function request(url, body, agentRequest, credentials) {
      const requestGeneration = activeGeneration;
      ensureActive(requestGeneration);
      if (!fetcher) throw fail(agentRequest ? 'Không kết nối được Card Agent' : 'SERVER_UNAVAILABLE');
      const controller = new AbortController();
      controllers.add(controller);
      let timer, cancelRequest;
      try {
        const result = await Promise.race([
          (async () => {
            const response = await fetcher(url, { method: body === undefined ? 'GET' : 'POST', credentials: credentials || (agentRequest ? 'omit' : 'same-origin'), redirect: 'error', cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
            ensureActive(requestGeneration);
            const json = await response.json();
            ensureActive(requestGeneration);
            if (!object(json)) throw fail(agentRequest ? 'AGENT_RESPONSE' : 'SERVER_RESPONSE');
            if (!response.ok) throw fail(agentRequest ? 'AGENT_HTTP' : (json.errorCode || 'SERVER_HTTP'));
            return json;
          })(),
          new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail('REQUEST_TIMEOUT')); }, timeoutMs); }),
          new Promise((resolve, reject) => { cancelRequest = () => reject(fail(disposed ? 'CLIENT_DISPOSED' : 'CLIENT_SUSPENDED')); cancellations.add(cancelRequest); })
        ]);
        return result;
      } catch (error) {
        ensureActive(requestGeneration);
        if (agentRequest && error.code !== 'AGENT_RESPONSE') throw fail('Không kết nối được Card Agent');
        throw error;
      } finally { clearTimeout(timer); controller.abort(); controllers.delete(controller); cancellations.delete(cancelRequest); }
    }
    async function server(url, body, credentials, allowFailure) {
      const json = await request(serverUrl(url), body, false, credentials);
      if (!allowFailure && (json.code === 'error' || json.ok === false || json.errorCode)) throw fail(json.errorCode || 'SERVER_REJECTED');
      return json;
    }
    async function transmit(apdus) {
      if (!Array.isArray(apdus) || apdus.length < 1 || apdus.length > 64 || !apdus.every(validApdu)) throw fail('INVALID_APDU');
      const json = await request(agentBase() + '/v1/transmit', { apdus }, true);
      const responses = json.responses;
      if (!Array.isArray(responses) || !responses.length || responses.length > apdus.length) throw fail('AGENT_RESPONSE');
      const normalized = responses.map((item, index) => {
        if (!object(item) || typeof item.data !== 'string' || item.data.length > 512 || item.data.length % 2 || !/^[0-9a-f]*$/i.test(item.data) || !hex(item.sw, 2) || (index < responses.length - 1 && item.sw.toUpperCase() !== '9000')) throw fail('AGENT_RESPONSE');
        return { data: item.data.toUpperCase(), sw: item.sw.toUpperCase() };
      });
      if (responses.length < apdus.length && normalized.at(-1).sw === '9000') throw fail('AGENT_RESPONSE');
      return normalized;
    }
    async function cmd(ins, p1, p2, bytes) {
      const [result] = await transmit([S.apdu(ins, p1, p2, bytes)]);
      if (result.sw !== '9000') throw new CardError(result.sw);
      return S.fromHex(result.data);
    }
    async function publicInfo() {
      const bytes = exact(await cmd(S.INS.GET_PUBLIC_INFO, 0, 0), 21);
      if (![0, 1, 2].includes(bytes[16]) || !Object.values(S.STATE).includes(bytes[17]) || bytes[18] > 1 || bytes[19] > 5 || bytes[20] !== 1) throw fail('CARD_RESPONSE');
      return { cardId: S.toHex(bytes.subarray(0, 16)), cardType: bytes[16], state: bytes[17], mustChangePin: bytes[18] === 1, triesRemaining: bytes[19], version: bytes[20] };
    }
    async function challenge() { return S.toHex(exact(await cmd(S.INS.GET_CHALLENGE, 0, 0), 16)); }
    async function execute(apdu, confirmUrl, body, credentials) {
      const [raw] = await transmit([apdu]);
      let result;
      try { result = await server(confirmUrl, { ...body, response: raw.data, sw: raw.sw }, credentials, raw.sw !== '9000'); }
      catch (error) { if (raw.sw === '9000') throw error; const cardError = new CardError(raw.sw); cardError.confirmationFailed = true; throw cardError; }
      if (raw.sw !== '9000') throw new CardError(raw.sw);
      return result;
    }
    function targetMax(target) {
      if (target === S.TARGET.PROFILE) return S.PROFILE_MAX;
      if (target === S.TARGET.PHOTO) return S.PHOTO_MAX;
      throw fail('INVALID_TARGET');
    }
    async function readTarget(target) {
      const maximum = targetMax(target);
      const lengthBytes = exact(await cmd(S.INS.READ_DATA, target, 255), 2);
      const length = (lengthBytes[0] << 8) | lengthBytes[1];
      if (length > maximum) throw fail('TARGET_LENGTH');
      const bytes = new Uint8Array(length);
      for (let offset = 0, chunk = 0; offset < length; offset += S.CHUNK, chunk++) {
        bytes.set(exact(await cmd(S.INS.READ_DATA, target, chunk), Math.min(S.CHUNK, length - offset)), offset);
      }
      return bytes;
    }
    const client = {
      status: () => serial(async () => {
        try {
          const json = await request(agentBase() + '/v1/status', undefined, true);
          if (!['sim', 'pcsc'].includes(json.mode) || typeof json.reader !== 'string' || typeof json.cardPresent !== 'boolean' || !(json.slot === null || (Number.isInteger(json.slot) && json.slot >= 0 && json.slot <= 3))) return null;
          return json;
        } catch { return null; }
      }),
      transmit: apdus => serial(() => transmit(apdus)),
      cmd: (ins, p1, p2, bytes) => serial(() => cmd(ins, p1, p2, bytes)),
      openSession: (settings = {}) => serial(async () => {
        clearPhoto();
        const base = settings.syncBase === undefined ? '/card-api/sync' : settings.syncBase;
        serverUrl(base + '/next'); serverUrl(base + '/confirm'); serverUrl(base + '/receipt');
        const [selected] = await transmit(['00A4040008' + S.AID_HEX + '00']);
        if (selected.sw !== '9000') throw new CardError(selected.sw);
        let info = await publicInfo();
        // TERMINATE đã xóa cardId; chỉ trả trạng thái, không gửi yêu cầu đồng bộ.
        if (info.state === S.STATE.TERMINATED) return info;
        for (let round = 0; round < 10; round++) {
          if ([S.STATE.CREATED, S.STATE.TERMINATED].includes(info.state)) return info;
          if (settings.expectedCardId !== undefined && (!hex(settings.expectedCardId, 16) || info.cardId !== settings.expectedCardId.toUpperCase())) throw new Error('Đang cắm thẻ khác. Hãy cắm đúng thẻ đang xem trước khi đồng bộ.');
          const credentials = info.mustChangePin ? 'omit' : 'same-origin';
          const next = await server(base + '/next', { cardId: info.cardId, cardState: info.state, challenge: await challenge() }, credentials);
          if (next.step === null) return { ...info, ...(next.requiresAuth === true ? { requiresAuth: true } : {}) };
          const step = next.step;
          if (!object(step) || !validApdu(step.apdu)) throw fail('SERVER_RESPONSE');
          if (step.kind === 'receipt') {
            if (!hex(step.txRef, 8) || step.apdu.toUpperCase() !== S.apdu(S.INS.GET_RECEIPT, 0, 0, S.fromHex(step.txRef))) throw fail('SERVER_RESPONSE');
            await execute(step.apdu, base + '/receipt', { cardId: info.cardId, txRef: step.txRef }, 'omit');
          } else if (step.kind === 'op' && hex(step.opId, 12)) await execute(step.apdu, base + '/confirm', { opId: step.opId }, credentials);
          else throw fail('SERVER_RESPONSE');
          info = await publicInfo();
        }
        if ([S.STATE.CREATED, S.STATE.TERMINATED].includes(info.state)) return info;
        throw fail('SYNC_LOOP');
      }),
      verifyPin: pin => serial(async () => {
        if (!S.isPinFormat(pin)) throw fail('PIN_FORMAT');
        await cmd(S.INS.VERIFY_PIN, 0, 0, new TextEncoder().encode(pin));
      }),
      changePin: (oldPin, newPin, dob) => serial(async () => {
        if (!S.isPinFormat(oldPin) || !S.isPinFormat(newPin)) throw fail('PIN_FORMAT');
        if (S.isWeakPin(newPin, dob)) throw fail('WEAK_PIN');
        await cmd(S.INS.CHANGE_PIN, 0, 0, new TextEncoder().encode(oldPin + newPin));
      }),
      getChallenge: () => serial(challenge),
      runSignedOp: ({ signUrl, confirmUrl, opId }) => serial(async () => {
        serverUrl(signUrl); serverUrl(confirmUrl);
        if (!hex(opId, 12)) throw fail('INVALID_OP_ID');
        const signed = await server(signUrl, { opId, challenge: await challenge() });
        if (!validApdu(signed.apdu)) throw fail('INVALID_APDU');
        return execute(signed.apdu, confirmUrl, { opId });
      }),
      writeTarget: (target, bytes) => serial(async () => {
        if (!(bytes instanceof Uint8Array) || bytes.length > targetMax(target)) throw fail('TARGET_LENGTH');
        await cmd(S.INS.BEGIN_WRITE, target, 0, new Uint8Array([bytes.length >> 8, bytes.length & 255]));
        for (let offset = 0, chunk = 0; offset < bytes.length; offset += S.CHUNK, chunk++) await cmd(S.INS.WRITE_CHUNK, target, chunk, bytes.subarray(offset, offset + S.CHUNK));
      }),
      readTarget: target => serial(() => readTarget(target)),
      readProfile: () => serial(async () => S.decodeProfile(await readTarget(S.TARGET.PROFILE))),
      readPhotoUrl: () => serial(async () => {
        clearPhoto();
        try {
          const bytes = await readTarget(S.TARGET.PHOTO);
          ensureActive(activeGeneration);
          photoUrl = root.URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
          return photoUrl;
        } catch (error) { clearPhoto(); throw error; }
      }),
      readBalance: () => serial(async () => { const bytes = exact(await cmd(S.INS.GET_BALANCE, 0, 0), 8); return { balance: u32(bytes, 0), counter: u32(bytes, 4) }; }),
      readTxLog: () => serial(async () => {
        const bytes = await cmd(S.INS.READ_TX_LOG, 0, 0);
        if (!bytes.length || bytes[0] > 10) throw fail('CARD_RESPONSE');
        exact(bytes, 1 + bytes[0] * 21);
        const result = [];
        for (let offset = 1; offset < bytes.length; offset += 21) {
          if (![1, 2].includes(bytes[offset])) throw fail('CARD_RESPONSE');
          result.push({ type: bytes[offset], amount: u32(bytes, offset + 1), balanceAfter: u32(bytes, offset + 5), counter: u32(bytes, offset + 9), txRef: S.toHex(bytes.subarray(offset + 13, offset + 21)) });
        }
        return result;
      }),
      readTickets: () => serial(async () => {
        const bytes = await cmd(S.INS.READ_TICKETS, 0, 0);
        if (!bytes.length || bytes[0] > 5) throw fail('CARD_RESPONSE');
        exact(bytes, 1 + bytes[0] * 34);
        const result = [];
        for (let offset = 1; offset < bytes.length; offset += 34) {
          const order = bytes.subarray(offset + 1, offset + 13), departure = bytes.subarray(offset + 25, offset + 33);
          if (![1, 2].includes(bytes[offset]) || order.some(byte => byte > 127) || departure.some(byte => byte < 48 || byte > 57)) throw fail('CARD_RESPONSE');
          result.push({ status: bytes[offset], orderCode: String.fromCharCode(...order), tourId: S.toHex(bytes.subarray(offset + 13, offset + 25)), departure: String.fromCharCode(...departure), pax: bytes[offset + 33] });
        }
        return result;
      }),
      authenticate: ({ challengeUrl, verifyUrl, body = {} }) => serial(async () => {
        serverUrl(challengeUrl); serverUrl(verifyUrl);
        if (!object(body)) throw fail('INVALID_BODY');
        const info = await publicInfo();
        const result = await server(challengeUrl, {});
        if (!hex(result.nonce, 16)) throw fail('SERVER_RESPONSE');
        const auth = exact(await cmd(S.INS.AUTHENTICATE, 0, 0, S.fromHex(result.nonce)), 132);
        return server(verifyUrl, { ...body, cardId: info.cardId, nonce: result.nonce, counter: u32(auth, 0), signature: S.toHex(auth.subarray(4)) });
      }),
      askPin: title => {
        const requestedGeneration = generation;
        try { ensureActive(requestedGeneration); } catch (error) { return Promise.reject(error); }
        return options.askPin ? Promise.resolve().then(() => { ensureActive(requestedGeneration); return options.askPin(title); }).then(pin => { ensureActive(requestedGeneration); return pin; }) : modalPin(title, owner);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true; generation++; cleanup();
        if (root.removeEventListener) {
          root.removeEventListener('pagehide', hide);
          root.removeEventListener('pageshow', show);
        }
      }
    };
    function cleanup() {
      clearPhoto();
      for (const controller of controllers) controller.abort();
      for (const cancelRequest of cancellations) cancelRequest();
      if (pendingPin && pendingPin.owner === owner) pendingPin.cancel();
    }
    function hide() {
      if (disposed) return;
      suspended = true; generation++; cleanup();
    }
    function show() { if (!disposed) suspended = false; }
    if (root.addEventListener) {
      root.addEventListener('pagehide', hide);
      root.addEventListener('pageshow', show);
    }
    return client;
  }
  return { create, CardError };
}));
