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

// Ngày sinh dạng YYYYMMDD cho kiểm tra PIN yếu (DDMMYY). Bên gọi có thể truyền Date, chuỗi ISO hoặc YYYYMMDD;
// Date/ISO có giờ được đổi theo ngày Asia/Ho_Chi_Minh và cả ngày UTC (cách hồ sơ thẻ đang ghi), từ chối PIN trùng một trong hai.
const VN_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
function dobDigits(dob) {
  if (typeof dob === 'string' && /^\d{8}$/.test(dob)) return [dob];
  if (typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob)) return [dob.replace(/-/g, '')];
  if (!(dob instanceof Date) && typeof dob !== 'string') return [];
  const date = new Date(dob);
  if (!Number.isFinite(date.getTime())) return [];
  return [...new Set([VN_DAY.format(date).replace(/-/g, ''), date.toISOString().slice(0, 10).replace(/-/g, '')])];
}
function generatePin(dob) {
  const dates = dobDigits(dob);
  let pin;
  do { pin = crypto.randomInt(0, 1000000).toString().padStart(6, '0'); } while (S.isWeakPin(pin) || dates.some(date => S.isWeakPin(pin, date)));
  return pin;
}

function randomHex(nBytes) {
  if (!Number.isInteger(nBytes) || nBytes < 0) throw new Error('INVALID_RANDOM_LENGTH');
  return crypto.randomBytes(nBytes).toString('hex').toUpperCase();
}

module.exports = { getServerModulusHex, signServer, verifyCardSignature, deriveEscrowKey, encryptResetPin, generatePin, dobDigits, randomHex };
