const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const V = require('../smartcard/test-vectors/vectors.json');

// Luôn dùng fixture công khai; không nạp .env hoặc khóa của ứng dụng.
process.env.CARD_SERVER_KEY_PATH = path.resolve(__dirname, '../smartcard/test-vectors/server-test-key.pem');
process.env.CARD_ESCROW_MASTER = V.escrowMaster;
const A = require('../helpers/card-apdu.helper');
const C = require('../helpers/card-crypto.helper');
const S = require('../public/assets/js/card/card-shared');

const agentUrl = process.env.AGENT_URL;
// Top-level tests chạy tuần tự; không bật concurrency vì dùng chung slot 0.
const options = { concurrency: false, timeout: 30000, skip: agentUrl === undefined ? 'AGENT_URL chưa được đặt; cần agent --sim thật để chạy E2E' : false };
const initialPin = '482915';
const activePin = '715043';
const resetPin = '903172';
const cardId = V.cardId.toUpperCase();

async function request(method, endpoint, body) {
  let response;
  try {
    const base = new URL(agentUrl);
    assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname) && !base.username && !base.password,
      'AGENT_URL phải là HTTP loopback không có credentials');
    response = await fetch(new URL(endpoint, base), {
      method,
      redirect: 'error',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw new Error(`Agent request failed: ${method} ${endpoint} (network/configuration/timeout)`);
  }
  assert.equal(response.status, 200, `Agent HTTP: ${method} ${endpoint}`);
  try { return await response.json(); }
  catch { throw new Error(`Agent response is not JSON: ${method} ${endpoint}`); }
}

async function resetSlot() {
  const before = await request('GET', '/v1/status');
  assert.equal(before.mode, 'sim', 'Từ chối mutation nếu agent không ở mode sim');
  const reset = await request('POST', '/v1/sim/reset', { slot: 0 });
  assert.equal(reset.slot, 0, 'Reset slot 0');
  const selected = await request('POST', '/v1/sim/slot', { slot: 0 });
  assert.equal(selected.slot, 0, 'Chọn slot 0');
  const after = await request('GET', '/v1/status');
  assert.equal(after.mode, 'sim');
  assert.equal(after.slot, 0, 'Slot hoạt động phải là slot 0');
  assert.equal(after.cardPresent, true);
}

async function transmit(apdu, label, expectedSw = '9000') {
  const result = await request('POST', '/v1/transmit', { apdus: [apdu] });
  assert.ok(Array.isArray(result.responses), `${label}: missing responses`);
  assert.equal(result.responses.length, 1, `${label}: response count`);
  const response = result.responses[0];
  assert.ok(response && typeof response.sw === 'string' && /^[0-9a-f]{4}$/i.test(response.sw), `${label}: invalid SW`);
  assert.equal(response.sw.toUpperCase(), expectedSw, `${label}: SW`);
  assert.ok(typeof response.data === 'string' && /^(?:[0-9a-f]{2})*$/i.test(response.data), `${label}: invalid data encoding`);
  return Buffer.from(response.data, 'hex');
}

const command = (ins, p1 = 0, p2 = 0, data) => S.apdu(ins, p1, p2, data);
async function publicInfo() {
  return A.parsePublicInfo((await transmit(command(S.INS.GET_PUBLIC_INFO), 'GET_PUBLIC_INFO')).toString('hex'));
}

async function issue() {
  await transmit('00A4040008' + S.AID_HEX + '00', 'SELECT');
  const blank = await publicInfo();
  assert.equal(blank.state, S.STATE.CREATED, 'Reset phải tạo applet trắng');
  assert.ok(blank.cardId === '00'.repeat(16), 'Card ID trắng sau reset');
  const data = A.buildInitData({ cardIdHex: cardId, cardType: 1, pin: initialPin, kEscrow: C.deriveEscrowKey(cardId) });
  const modulus = await transmit(command(S.INS.INIT, 0, 0, data), 'INIT');
  assert.equal(modulus.length, 128, 'INIT trả RSA-1024 modulus');
  const info = await publicInfo();
  assert.ok(info.cardId === cardId, 'INIT giữ đúng card ID');
  assert.equal(info.cardType, 1);
  assert.equal(info.state, S.STATE.ACTIVE);
  assert.equal(info.mustChangePin, true);
  assert.equal(info.triesRemaining, 5);
  assert.equal(info.version, 1);
  return modulus.toString('hex');
}

async function changePin() {
  await transmit(command(S.INS.CHANGE_PIN, 0, 0, Buffer.from(initialPin + activePin, 'ascii')), 'CHANGE_PIN');
  assert.equal((await publicInfo()).mustChangePin, false);
}

async function verifyPin(pin = activePin) {
  await transmit(command(S.INS.VERIFY_PIN, 0, 0, Buffer.from(pin, 'ascii')), 'VERIFY_PIN');
}

async function signed(ins, p1 = 0, payload = Buffer.alloc(0)) {
  const challenge = await transmit(command(S.INS.GET_CHALLENGE), 'GET_CHALLENGE');
  assert.equal(challenge.length, 16, 'Challenge length');
  return transmit(A.signedApdu({ challengeHex: challenge.toString('hex'), cardIdHex: cardId, ins, p1, p2: 0, payload }),
    `Signed INS=${ins.toString(16).toUpperCase()}`);
}

// Catches broken INIT layout, PIN transition, auth message binding or card signing.
test('issue → change pin → auth', options, async () => {
  await resetSlot();
  const modulus = await issue();
  await changePin();
  await verifyPin();
  const nonceHex = C.randomHex(16);
  const auth = await transmit(command(S.INS.AUTHENTICATE, 0, 0, Buffer.from(nonceHex, 'hex')), 'AUTHENTICATE');
  assert.equal(auth.length, 132, 'AUTHENTICATE counter4 + signature128');
  const counter = auth.readUInt32BE(0);
  assert.equal(counter, 0, 'Thẻ mới chưa có giao dịch ví');
  const message = A.buildAuthMessage({ nonceHex, cardIdHex: cardId, counter });
  assert.ok(C.verifyCardSignature(modulus, message, auth.subarray(4)), 'Card auth signature');
  const wrongNonce = Buffer.from(nonceHex, 'hex');
  wrongNonce[0] ^= 1;
  const wrongMessage = A.buildAuthMessage({ nonceHex: wrongNonce.toString('hex'), cardIdHex: cardId, counter });
  assert.ok(!C.verifyCardSignature(modulus, wrongMessage, auth.subarray(4)), 'Auth signature binds nonce');
});

// Catches a missing SET_STATE transition, incorrect signed P1 or a locked card that cannot unlock.
test('signed lock/unlock', options, async () => {
  await resetSlot();
  await issue();
  await changePin();
  await signed(S.INS.SET_STATE, S.STATE.LOCKED);
  assert.equal((await publicInfo()).state, S.STATE.LOCKED);
  await transmit(command(S.INS.VERIFY_PIN, 0, 0, Buffer.from(activePin, 'ascii')), 'LOCKED blocks VERIFY_PIN', '6985');
  await signed(S.INS.SET_STATE, S.STATE.ACTIVE);
  assert.equal((await publicInfo()).state, S.STATE.ACTIVE);
  await verifyPin();
});

// Catches incorrect wallet arithmetic, receipt fields/signing, counters or missing debit PIN reset.
test('credit/debit receipts verify', options, async () => {
  await resetSlot();
  const modulus = await issue();
  await changePin();
  const creditRef = '0102030405060708';
  const debitRef = '1112131415161718';
  const credit = A.parseReceipt((await signed(S.INS.CREDIT, 0, A.walletPayload(creditRef, 1500000))).toString('hex'));
  assert.ok(credit, 'Credit receipt structure');
  assert.ok(C.verifyCardSignature(modulus, credit.message, credit.signature), 'Credit receipt signature');
  assert.ok(credit.cardId === cardId, 'Credit card ID');
  assert.equal(credit.type, 'credit');
  assert.equal(credit.txRef, creditRef);
  assert.equal(credit.amount, 1500000);
  assert.equal(credit.balanceAfter, 1500000);
  assert.equal(credit.txCounter, 1);
  await verifyPin();
  const debit = A.parseReceipt((await signed(S.INS.DEBIT, 0, A.walletPayload(debitRef, 400000))).toString('hex'));
  assert.ok(debit, 'Debit receipt structure');
  assert.ok(C.verifyCardSignature(modulus, debit.message, debit.signature), 'Debit receipt signature');
  assert.ok(debit.cardId === cardId, 'Debit card ID');
  assert.equal(debit.type, 'debit');
  assert.equal(debit.txRef, debitRef);
  assert.equal(debit.amount, 400000);
  assert.equal(debit.balanceAfter, 1100000);
  assert.equal(debit.txCounter, 2);
  await transmit(command(S.INS.GET_BALANCE), 'DEBIT clears PIN session', '6982');
  await verifyPin();
  const balance = await transmit(command(S.INS.GET_BALANCE), 'GET_BALANCE');
  assert.equal(balance.length, 8);
  assert.equal(balance.readUInt32BE(0), 1100000);
  assert.equal(balance.readUInt32BE(4), 2);
});

// Catches a wrong escrow derivation/encryption, missing PIN replacement or mustChangePin flag.
test('reset pin via escrow', options, async () => {
  await resetSlot();
  await issue();
  await changePin();
  await signed(S.INS.RESET_PIN, 0, C.encryptResetPin(cardId, resetPin));
  const info = await publicInfo();
  assert.equal(info.mustChangePin, true);
  assert.equal(info.triesRemaining, 5);
  await verifyPin(resetPin);
  await transmit(command(S.INS.VERIFY_PIN, 0, 0, Buffer.from(activePin, 'ascii')), 'RESET_PIN rejects previous PIN', '63C4');
  await verifyPin(resetPin);
});

// Catches wrong chunk offsets/target, incompatible commit layout or truncated decrypted reads.
test('profile write+commit', options, async () => {
  await resetSlot();
  await issue();
  await changePin();
  await verifyPin();
  const profile = {
    fullName: 'Nguyễn An', dob: '20040215', gender: 'Nam', phone: '0900000000',
    idNumber: 'TEST00000001', emergencyName: 'Người liên hệ thử nghiệm',
    emergencyPhone: '0910000000', bloodType: 'O+', allergies: 'A'.repeat(120)
  };
  const bytes = Buffer.from(S.encodeProfile(profile));
  assert.equal(bytes.length, 228, 'Fixture TLV 228B: hai chunk 224B + 4B');
  const length = Buffer.from([0x00, 0xE4]);
  await transmit(command(S.INS.BEGIN_WRITE, S.TARGET.PROFILE, 0, length), 'BEGIN_WRITE profile');
  await transmit(command(S.INS.WRITE_CHUNK, S.TARGET.PROFILE, 0, bytes.subarray(0, 224)), 'WRITE_CHUNK profile 0');
  await transmit(command(S.INS.WRITE_CHUNK, S.TARGET.PROFILE, 1, bytes.subarray(224)), 'WRITE_CHUNK profile 1');
  const digest = crypto.createHash('sha256').update(bytes).digest();
  await signed(S.INS.COMMIT_WRITE, S.TARGET.PROFILE, Buffer.concat([digest, length]));
  const storedLength = await transmit(command(S.INS.READ_DATA, S.TARGET.PROFILE, 0xFF), 'READ_DATA profile length');
  assert.equal(storedLength.length, 2);
  assert.equal(storedLength.readUInt16BE(0), 228);
  const first = await transmit(command(S.INS.READ_DATA, S.TARGET.PROFILE, 0), 'READ_DATA profile 0');
  const last = await transmit(command(S.INS.READ_DATA, S.TARGET.PROFILE, 1), 'READ_DATA profile 1');
  assert.equal(first.length, 224);
  assert.equal(last.length, 4, 'Chunk cuối cắt padding đúng độ dài');
  const readBack = Buffer.concat([first, last]);
  assert.ok(readBack.equals(bytes), 'Profile read-back equals original TLV bytes');
  assert.deepEqual(S.decodeProfile(readBack), profile);
});

// Catches wrong ticket layout, USE state machine, delete slot reuse or idempotent write/delete semantics on the real applet.
test('ticket write → read → use → delete', options, async () => {
  await resetSlot();
  await issue();
  await changePin();
  const ticket = { orderCode: 'OD0000000001', tourId: '0123456789abcdef01234567', departureDate: new Date('2026-12-15T00:00:00Z'), pax: 3 };
  await signed(S.INS.WRITE_TICKET, 0, A.encodeTicket(ticket));
  // Ghi lại cùng orderCode + tourId đang VALID coi như thành công.
  await signed(S.INS.WRITE_TICKET, 0, A.encodeTicket(ticket));
  await verifyPin();
  let list = await transmit(command(S.INS.READ_TICKETS), 'READ_TICKETS valid');
  assert.equal(list[0], 1);
  assert.equal(list[1], 1, 'VALID');
  assert.equal(list.subarray(2, 14).toString('ascii'), ticket.orderCode);
  await signed(S.INS.USE_TICKET, 0, A.ticketKey(ticket));
  await verifyPin();
  list = await transmit(command(S.INS.READ_TICKETS), 'READ_TICKETS used');
  assert.equal(list[1], 2, 'USED');
  await signed(S.INS.DELETE_TICKET, 0, A.ticketKey(ticket));
  await verifyPin();
  list = await transmit(command(S.INS.READ_TICKETS), 'READ_TICKETS empty');
  assert.equal(list[0], 0);
});
// Xoá vé không còn trên thẻ: ghi nhận SW thật để engine xử lý đúng (6A88 được coi là đã xoá).
test('delete of an absent ticket returns 6A88', options, async () => {
  await resetSlot();
  await issue();
  await changePin();
  const challenge = await transmit(command(S.INS.GET_CHALLENGE), 'GET_CHALLENGE');
  await transmit(A.signedApdu({ challengeHex: challenge.toString('hex'), cardIdHex: cardId, ins: S.INS.DELETE_TICKET, p1: 0, p2: 0, payload: A.ticketKey({ orderCode: 'OD0000000009', tourId: '0123456789abcdef01234567' }) }), 'DELETE absent', '6A88');
});

// Ruling 17 (L7): GET_CHALLENGE ngay trước GET_RECEIPT trong cùng batch làm APDU ví đã ký (gắn challenge cũ) không
// bao giờ chạy được nữa; nếu thiếu bước đổi challenge thì APDU cũ VẪN chạy được sau 6A88 (đối chứng).
test('rotating the challenge before GET_RECEIPT 6A88 makes a stale signed credit unrunnable', options, async () => {
  await resetSlot();
  const modulus = await issue();
  await changePin();
  const staleRef = '2122232425262728';
  const controlRef = '3132333435363738';
  async function balance() {
    await verifyPin();
    const out = await transmit(command(S.INS.GET_BALANCE), 'GET_BALANCE');
    return { balance: out.readUInt32BE(0), counter: out.readUInt32BE(4) };
  }
  // Server ký CREDIT theo challenge cũ nhưng APDU chưa tới thẻ (mất mạng, đóng tab...).
  const oldChallenge = (await transmit(command(S.INS.GET_CHALLENGE), 'GET_CHALLENGE old')).toString('hex');
  const stale = A.signedApdu({ challengeHex: oldChallenge, cardIdHex: cardId, ins: S.INS.CREDIT, p1: 0, p2: 0, payload: A.walletPayload(staleRef, 1500000) });
  // Bước khôi phục biên nhận của client: một batch [GET_CHALLENGE, GET_RECEIPT].
  const batch = await request('POST', '/v1/transmit', { apdus: [command(S.INS.GET_CHALLENGE), command(S.INS.GET_RECEIPT, 0, 0, Buffer.from(staleRef, 'hex'))] });
  assert.equal(batch.responses.length, 2);
  assert.equal(batch.responses[0].sw.toUpperCase(), '9000');
  assert.equal(batch.responses[0].data.length, 32);
  assert.ok(batch.responses[0].data.toLowerCase() !== oldChallenge.toLowerCase(), 'Challenge mới phải khác challenge đã ký');
  assert.equal(batch.responses[1].sw.toUpperCase(), '6A88', 'Thẻ chưa có giao dịch');
  // APDU cũ giờ bị từ chối chữ ký; lần thử tiếp theo không còn challenge nào.
  await transmit(stale, 'Stale CREDIT after rotation', '6F20');
  await transmit(stale, 'Stale CREDIT replay', '6F21');
  assert.deepEqual(await balance(), { balance: 0, counter: 0 });
  // Server mở lại khoản nạp và ký lại cùng txRef theo challenge mới: áp dụng đúng một lần.
  const credit = A.parseReceipt((await signed(S.INS.CREDIT, 0, A.walletPayload(staleRef, 1500000))).toString('hex'));
  assert.ok(C.verifyCardSignature(modulus, credit.message, credit.signature));
  assert.equal(credit.txRef, staleRef);
  assert.equal(credit.balanceAfter, 1500000);
  assert.equal(credit.txCounter, 1);
  await transmit(stale, 'Stale CREDIT after re-sign', '6F21');
  assert.deepEqual(await balance(), { balance: 1500000, counter: 1 });
  // Đối chứng: GET_RECEIPT 6A88 KHÔNG kèm đổi challenge không chứng minh được gì, APDU cũ vẫn chạy.
  const controlChallenge = (await transmit(command(S.INS.GET_CHALLENGE), 'GET_CHALLENGE control')).toString('hex');
  const control = A.signedApdu({ challengeHex: controlChallenge, cardIdHex: cardId, ins: S.INS.CREDIT, p1: 0, p2: 0, payload: A.walletPayload(controlRef, 200000) });
  await transmit(command(S.INS.GET_RECEIPT, 0, 0, Buffer.from(controlRef, 'hex')), 'GET_RECEIPT control', '6A88');
  const late = A.parseReceipt((await transmit(control, 'Control CREDIT still runs')).toString('hex'));
  assert.equal(late.txRef, controlRef);
  assert.equal(late.txCounter, 2);
  // Giao dịch đã chạy luôn được tìm thấy, kể cả khi đổi challenge trước GET_RECEIPT.
  const found = await request('POST', '/v1/transmit', { apdus: [command(S.INS.GET_CHALLENGE), command(S.INS.GET_RECEIPT, 0, 0, Buffer.from(controlRef, 'hex'))] });
  assert.equal(found.responses[1].sw.toUpperCase(), '9000');
  const recovered = A.parseReceipt(found.responses[1].data);
  assert.equal(recovered.txRef, controlRef);
  assert.equal(recovered.balanceAfter, 1700000);
  assert.ok(C.verifyCardSignature(modulus, recovered.message, recovered.signature));
});
