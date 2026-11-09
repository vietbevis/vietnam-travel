const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/generate-card-key.js');

test('keygen creates PKCS8 RSA1024 and one master line in an isolated temp directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-keygen-'));
  try {
    const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    // Không đưa stdout/stderr vào assertion: stdout chứa master mới sinh.
    assert.ok(result.status === 0, 'keygen phải chạy thành công');
    assert.ok(/^CARD_ESCROW_MASTER=[0-9a-fA-F]{64}\r?\n$/.test(result.stdout), 'master phải là một dòng 32 byte hex');
    assert.ok(result.stderr === '');
    const pem = fs.readFileSync(path.join(dir, 'keys/card-server-private.pem'));
    assert.ok(pem.toString().startsWith('-----BEGIN PRIVATE KEY-----'));
    const key = crypto.createPrivateKey(pem);
    assert.equal(key.asymmetricKeyDetails.modulusLength, 1024);
    assert.ok(key.asymmetricKeyDetails.publicExponent === 65537n);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('keygen refuses overwrite and preserves existing bytes without printing a master', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-keygen-existing-'));
  try {
    fs.mkdirSync(path.join(dir, 'keys'));
    const target = path.join(dir, 'keys/card-server-private.pem');
    fs.writeFileSync(target, 'du-lieu-phai-giu-nguyen');
    const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    assert.ok(result.status !== 0, 'keygen phải từ chối ghi đè');
    assert.ok(result.stdout === '', 'không sinh master khi ghi đè bị chặn');
    assert.ok(fs.readFileSync(target, 'utf8') === 'du-lieu-phai-giu-nguyen');
    assert.ok(/tồn tại/i.test(result.stderr), 'phải báo lý do từ chối');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
