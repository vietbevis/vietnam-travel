const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const V = require('../smartcard/test-vectors/vectors.json');
process.env.CARD_SERVER_KEY_PATH = 'smartcard/test-vectors/server-test-key.pem';
process.env.CARD_ESCROW_MASTER = V.escrowMaster;
const C = require('../helpers/card-crypto.helper');
const A = require('../helpers/card-apdu.helper');
const S = require('../public/assets/js/card/card-shared');

// So sánh bằng boolean để lỗi test không in PIN, master hay khóa ra log.
test('server modulus matches applet vectors', () => assert.ok(C.getServerModulusHex() === V.serverModulus.toUpperCase()));
test('server signature byte-identical to Java', () => assert.ok(C.signServer(Buffer.from(V.command.message, 'hex')).toString('hex') === V.command.signature.toLowerCase()));
test('verifies card auth signature from applet', () => {
  const msg = A.buildAuthMessage({ nonceHex: V.auth.nonce, cardIdHex: V.cardId, counter: parseInt(V.auth.counter, 16) });
  assert.ok(C.verifyCardSignature(V.cardModulus, msg, Buffer.from(V.auth.signature, 'hex')));
});
test('card signature rejects tampered message, signature and wrong key', () => {
  const msg = Buffer.from(V.command.message, 'hex');
  const sig = Buffer.from(V.command.signature, 'hex');
  assert.ok(C.verifyCardSignature(V.serverModulus, msg, sig));
  msg[0] ^= 1;
  assert.ok(!C.verifyCardSignature(V.serverModulus, msg, sig));
  msg[0] ^= 1;
  sig[0] ^= 1;
  assert.ok(!C.verifyCardSignature(V.serverModulus, msg, sig));
  assert.ok(!C.verifyCardSignature(V.cardModulus, msg, Buffer.from(V.command.signature, 'hex')));
});
test('card signature rejects malformed key or signature', () => {
  for (const modulus of ['GG', '00', null]) assert.equal(C.verifyCardSignature(modulus, Buffer.alloc(0), Buffer.alloc(128)), false);
  assert.equal(C.verifyCardSignature(V.cardModulus, Buffer.alloc(0), Buffer.alloc(127)), false);
});
test('escrow key matches applet', () => assert.ok(C.deriveEscrowKey(V.cardId).toString('hex') === V.escrowKey.toLowerCase()));
test('reset pin matches applet', () => assert.ok(C.encryptResetPin(V.cardId, V.resetPin.newPin).toString('hex') === V.resetPin.encPin.toLowerCase()));
test('escrow reads environment lazily and rejects malformed master', () => {
  const original = process.env.CARD_ESCROW_MASTER;
  try {
    process.env.CARD_ESCROW_MASTER = '00'.repeat(32);
    assert.ok(!C.deriveEscrowKey(V.cardId).equals(Buffer.from(V.escrowKey, 'hex')));
    for (const invalid of ['', 'GG'.repeat(32), '00'.repeat(31)]) {
      process.env.CARD_ESCROW_MASTER = invalid;
      assert.throws(() => C.deriveEscrowKey(V.cardId));
    }
  } finally { process.env.CARD_ESCROW_MASTER = original; }
});
test('escrow rejects malformed card IDs and PINs', () => {
  for (const cardId of ['', '00'.repeat(15), 'GG'.repeat(16)]) assert.throws(() => C.deriveEscrowKey(cardId));
  for (const pin of ['', '12345a', 123456]) assert.throws(() => C.encryptResetPin(V.cardId, pin));
});
test('server key path changes after require and cache is per path', () => {
  const original = process.env.CARD_SERVER_KEY_PATH;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-crypto-'));
  try {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 1024, publicExponent: 65537 });
    const keyPath = path.join(dir, 'test.pem');
    fs.writeFileSync(keyPath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    process.env.CARD_SERVER_KEY_PATH = keyPath;
    assert.ok(C.getServerModulusHex() !== V.serverModulus.toUpperCase());
    assert.ok(crypto.verify('sha256', Buffer.from('thử'), pair.publicKey, C.signServer(Buffer.from('thử'))));
    fs.unlinkSync(keyPath);
    assert.equal(C.getServerModulusHex().length, 256);
    process.env.CARD_SERVER_KEY_PATH = original;
    assert.ok(C.getServerModulusHex() === V.serverModulus.toUpperCase());
  } finally {
    process.env.CARD_SERVER_KEY_PATH = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('generatePin never weak', () => {
  for (let i = 0; i < 500; i++) {
    const p = C.generatePin('20040215');
    assert.ok(S.isPinFormat(p) && !S.isWeakPin(p, '20040215'));
  }
});
test('randomHex returns the requested byte length and rejects invalid lengths', () => {
  assert.match(C.randomHex(16), /^[0-9A-Fa-f]{32}$/);
  assert.equal(C.randomHex(0), '');
  for (const n of [-1, 0.5, '16']) assert.throws(() => C.randomHex(n));
});
