const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../public/assets/js/card/card-shared');

// Đọc env khi gọi để module không giữ cấu hình lúc require; khóa chỉ cache theo đường dẫn.
const serverKeys = new Map();
function serverKey() {
  const configuredPath = process.env.CARD_SERVER_KEY_PATH;
  if (!configuredPath) throw new Error('CARD_SERVER_KEY_PATH_REQUIRED');
  const keyPath = path.resolve(configuredPath);
  if (!serverKeys.has(keyPath)) {
    const key = crypto.createPrivateKey(fs.readFileSync(keyPath));
    const details = key.asymmetricKeyDetails;
    if (key.asymmetricKeyType !== 'rsa' || details.modulusLength !== 1024 || details.publicExponent !== 65537n) throw new Error('INVALID_SERVER_KEY');
    serverKeys.set(keyPath, key);
  }
  return serverKeys.get(keyPath);
}

function fixedHex(value, length) {
  const bytes = Buffer.from(S.fromHex(value));
  if (bytes.length !== length) throw new Error('INVALID_HEX_LENGTH');
  return bytes;
}

function getServerModulusHex() {
  const jwk = crypto.createPublicKey(serverKey()).export({ format: 'jwk' });
  return Buffer.from(jwk.n, 'base64url').toString('hex').toUpperCase();
}

function signServer(buf) {
  return crypto.sign('sha256', buf, { key: serverKey(), padding: crypto.constants.RSA_PKCS1_PADDING });
}

function verifyCardSignature(modulusHex, msg, sig) {
  try {
    const modulus = fixedHex(modulusHex, 128);
    if (!(sig instanceof Uint8Array) || sig.length !== 128) return false;
    const key = crypto.createPublicKey({ key: { kty: 'RSA', n: modulus.toString('base64url'), e: 'AQAB' }, format: 'jwk' });
    return crypto.verify('sha256', msg, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, sig);
  } catch { return false; }
}

function deriveEscrowKey(cardIdHex) {
  const master = fixedHex(process.env.CARD_ESCROW_MASTER, 32);
  const cardId = fixedHex(cardIdHex, 16);
  return crypto.createHmac('sha256', master).update(cardId).digest().subarray(0, 16);
}

function encryptResetPin(cardIdHex, pin) {
  if (!S.isPinFormat(pin)) throw new Error('INVALID_PIN');
  const clear = Buffer.alloc(16);
  clear.write(pin, 0, 6, 'ascii');
  const cipher = crypto.createCipheriv('aes-128-ecb', deriveEscrowKey(cardIdHex), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(clear), cipher.final()]);
}

function generatePin(dob) {
  let pin;
  do { pin = crypto.randomInt(0, 1000000).toString().padStart(6, '0'); } while (S.isWeakPin(pin, dob));
  return pin;
}

function randomHex(nBytes) {
  if (!Number.isInteger(nBytes) || nBytes < 0) throw new Error('INVALID_RANDOM_LENGTH');
  return crypto.randomBytes(nBytes).toString('hex').toUpperCase();
}

module.exports = { getServerModulusHex, signServer, verifyCardSignature, deriveEscrowKey, encryptResetPin, generatePin, randomHex };
