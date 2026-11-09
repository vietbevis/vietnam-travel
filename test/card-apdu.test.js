const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../smartcard/test-vectors/vectors.json');
process.env.CARD_SERVER_KEY_PATH = 'smartcard/test-vectors/server-test-key.pem';
const A = require('../helpers/card-apdu.helper');
const C = require('../helpers/card-crypto.helper');
const S = require('../public/assets/js/card/card-shared');
const command = () => ({ challengeHex: V.command.challenge, cardIdHex: V.cardId, ins: S.INS.SET_STATE, p1: S.STATE.LOCKED, p2: 0, payload: Buffer.alloc(0) });

test('cmd message layout == vectors', () => assert.ok(A.buildCmdMessage(command()).toString('hex') === V.command.message.toLowerCase()));
test('signed APDU includes payload then signature then Le', () => {
  const args = { ...command(), payload: Buffer.from('010203', 'hex') };
  const bytes = Buffer.from(A.signedApdu(args), 'hex');
  assert.equal(bytes.subarray(0, 5).toString('hex'), '8070030083');
  assert.equal(bytes.subarray(5, 8).toString('hex'), '010203');
  assert.ok(C.verifyCardSignature(V.serverModulus, A.buildCmdMessage(args), bytes.subarray(8, 136)));
  assert.equal(bytes[136], 0);
});
test('cmd rejects malformed fixed fields and short APDU overflow', () => {
  for (const update of [{ challengeHex: '00' }, { cardIdHex: 'GG'.repeat(16) }, { ins: -1 }, { p1: 256 }]) {
    assert.throws(() => A.buildCmdMessage({ ...command(), ...update }));
  }
  assert.throws(() => A.signedApdu({ ...command(), payload: Buffer.alloc(128) }));
});
test('parseReceipt from applet', () => {
  const r = A.parseReceipt(V.receipt.hex);
  assert.equal(r.type, 'credit');
  assert.ok(r.cardId === V.cardId.toUpperCase());
  assert.equal(r.txRef, '3333333333333333');
  assert.equal(r.amount, 250000);
  assert.equal(r.balanceAfter, 250000);
  assert.equal(r.txCounter, 1);
  assert.equal(r.message.length, 38);
  assert.equal(r.signature.length, 128);
  assert.ok(C.verifyCardSignature(V.cardModulus, r.message, r.signature));
});
test('parseReceipt rejects wrong length', () => assert.equal(A.parseReceipt('52'.padEnd(330, '0')), null));
test('parseReceipt rejects malformed hex, wrong context and unknown type', () => {
  for (const value of ['GG'.repeat(166), '5' + V.receipt.hex, '41' + V.receipt.hex.slice(2), V.receipt.hex.slice(0, 34) + '03' + V.receipt.hex.slice(36)]) {
    assert.equal(A.parseReceipt(value), null);
  }
});
test('receipt parsing does not authenticate tampered bytes', () => {
  const bytes = Buffer.from(V.receipt.hex, 'hex');
  bytes[29] ^= 1;
  const r = A.parseReceipt(bytes.toString('hex'));
  assert.ok(r && !C.verifyCardSignature(V.cardModulus, r.message, r.signature));
});
test('initData length 167 and exact field offsets', () => {
  const init = A.buildInitData({ cardIdHex: V.cardId, cardType: 1, pin: '482915', kEscrow: Buffer.alloc(16) });
  assert.equal(init.length, 167);
  assert.ok(init.subarray(0, 16).toString('hex') === V.cardId);
  assert.equal(init[16], 1);
  assert.ok(init.subarray(17, 145).toString('hex') === V.serverModulus);
  assert.ok(init.subarray(145, 151).toString() === '482915');
  assert.ok(init.subarray(151).equals(Buffer.alloc(16)));
});
test('initData rejects bad card type, PIN and escrow length', () => {
  const input = { cardIdHex: V.cardId, cardType: 1, pin: '482915', kEscrow: Buffer.alloc(16) };
  for (const update of [{ cardType: 0 }, { cardType: 3 }, { pin: '12345a' }, { kEscrow: Buffer.alloc(15) }]) assert.throws(() => A.buildInitData({ ...input, ...update }));
});
test('public info parses the 21-byte layout', () => {
  const info = A.parsePublicInfo(V.cardId + '0102010501');
  assert.ok(info.cardId === V.cardId.toUpperCase());
  assert.deepEqual({ ...info, cardId: '' }, { cardId: '', cardType: 1, state: 2, mustChangePin: true, triesRemaining: 5, version: 1 });
  assert.throws(() => A.parsePublicInfo('00'.repeat(20)));
});
test('auth message uses big endian uint32 counter', () => {
  const msg = A.buildAuthMessage({ nonceHex: '22'.repeat(16), cardIdHex: V.cardId, counter: 0x01020304 });
  assert.equal(msg.length, 37);
  assert.equal(msg[0], 0x41);
  assert.equal(msg.subarray(33).toString('hex'), '01020304');
  for (const counter of [-1, 0x100000000, 1.5]) assert.throws(() => A.buildAuthMessage({ nonceHex: '22'.repeat(16), cardIdHex: V.cardId, counter }));
});
test('wallet payload uses txRef8 then amount4 big endian', () => {
  assert.equal(A.walletPayload('0123456789ABCDEF', 50000000).toString('hex'), '0123456789abcdef02faf080');
  for (const amount of [0, -1, 50000001, 1.5]) assert.throws(() => A.walletPayload('0123456789ABCDEF', amount));
  assert.throws(() => A.walletPayload('00', 1));
});
test('ticket encoding', () => {
  const t = A.encodeTicket({ orderCode: 'OD1234567890', tourId: '65f0a1b2c3d4e5f601234567', departureDate: new Date('2026-12-14T20:00:00Z'), pax: 3 });
  assert.equal(t.length, 33);
  assert.equal(t.subarray(0, 24).toString('hex'), '4f443132333435363738393065f0a1b2c3d4e5f601234567');
  assert.equal(t.subarray(24, 32).toString(), '20261215');
  assert.equal(t[32], 3);
});
test('ticket key is orderCode12 followed by ObjectId12', () => {
  assert.equal(A.ticketKey({ orderCode: 'OD1234567890', tourId: '65f0a1b2c3d4e5f601234567' }).toString('hex'), '4f443132333435363738393065f0a1b2c3d4e5f601234567');
});
test('ticket encoding rejects lossy order codes, bad ObjectIds, invalid dates and byte overflow', () => {
  const t = { orderCode: 'OD1234567890', tourId: '65f0a1b2c3d4e5f601234567', departureDate: new Date('2026-12-14T20:00:00Z'), pax: 3 };
  for (const update of [{ orderCode: 'OD1' }, { orderCode: 'ĐD1234567890' }, { tourId: 'GG'.repeat(12) }, { departureDate: new Date(NaN) }, { pax: 256 }]) assert.throws(() => A.encodeTicket({ ...t, ...update }));
});
test('ticket encoding refuses dates that cannot fit YYYYMMDD in eight bytes', () => {
  const t = { orderCode: 'OD1234567890', tourId: '65f0a1b2c3d4e5f601234567', pax: 3 };
  assert.throws(() => A.encodeTicket({ ...t, departureDate: new Date('+010000-01-01T00:00:00Z') }));
});
