const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve('keys/card-server-private.pem');
try {
  if (fs.existsSync(target)) {
    console.error('Từ chối ghi đè: file khóa đã tồn tại.');
    process.exitCode = 1;
  } else {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024, publicExponent: 65537 });
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    // wx chặn cả trường hợp file xuất hiện sau lần kiểm tra tồn tại phía trên.
    fs.writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
    console.log(`CARD_ESCROW_MASTER=${crypto.randomBytes(32).toString('hex')}`);
  }
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Từ chối ghi đè: file khóa đã tồn tại.' : 'Không thể sinh hoặc lưu khóa thẻ.');
  process.exitCode = 1;
}
