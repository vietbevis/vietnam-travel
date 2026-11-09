const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../public/assets/js/card/card-shared');

test('apdu with data', () => assert.ok(S.apdu(0x20, 0, 0, S.fromHex('343832393135')) === '802000000634383239313500'));
test('apdu without data', () => assert.equal(S.apdu(0x10, 0, 0), '8010000000'));
test('hex preserves bytes and emits uppercase', () => {
  assert.equal(S.toHex(new Uint8Array([0, 171, 255])), '00ABFF');
  assert.deepEqual(S.fromHex('00abFF'), new Uint8Array([0, 171, 255]));
  assert.equal(S.fromHex('').length, 0);
});
test('hex rejects truncated or non-hex input', () => {
  for (const input of ['0', 'GG', '00 11', null, 12]) assert.throws(() => S.fromHex(input));
});
test('apdu rejects out-of-byte headers and oversized short data', () => {
  for (const args of [[256, 0, 0], [1, -1, 0], [1, 0, 0.5], [1, 0, 0, new Uint8Array(256)]]) {
    assert.throws(() => S.apdu(...args));
  }
});
test('profile roundtrip utf8', () => {
  const p = { fullName: 'Nguyễn Văn Việt', dob: '20040215', phone: '0901234567', allergies: 'Hải sản' };
  assert.deepEqual(S.decodeProfile(S.encodeProfile(p)), p);
});
test('profile skips empty fields', () => assert.equal(S.encodeProfile({ fullName: 'A', phone: '' }).length, 3));
test('profile uses specified TLV tags and UTF8 byte lengths', () => {
  assert.equal(S.toHex(S.encodeProfile({ fullName: 'An', gender: 'male', bloodType: 'O' })), '0102416E03046D616C6508014F');
  assert.throws(() => S.encodeProfile({ fullName: 'ệ'.repeat(21) }), /FIELD_TOO_LONG:fullName/);
});
test('profile field limit', () => assert.throws(() => S.encodeProfile({ fullName: 'x'.repeat(61) }), /FIELD_TOO_LONG:fullName/));
test('profile rejects truncated TLV and invalid UTF8', () => {
  for (const data of ['01', '010241', '0101FF']) assert.throws(() => S.decodeProfile(S.fromHex(data)));
});
test('profile decoder rejects buffers beyond profile capacity', () => assert.throws(() => S.decodeProfile(new Uint8Array(449)), /PROFILE_TOO_LARGE/));
test('PIN format accepts exactly six ASCII digits', () => {
  assert.ok(S.isPinFormat('482915'));
  for (const p of ['12345', '1234567', '１２３４５６', '12345a', 482915, null]) assert.ok(!S.isPinFormat(p));
});
test('weak pins', () => {
  for (const p of ['000000', '123456', '654321', '012345', '987654', '150204']) assert.ok(S.isWeakPin(p, '20040215'));
  assert.ok(!S.isWeakPin('482915', '20040215'));
});
test('swMessage 63C2', () => assert.equal(S.swMessage('63C2'), 'Sai mã PIN, còn 2 lần thử'));
test('all specified SW values have Vietnamese messages', () => {
  for (const sw of ['9000', '6700', '6982', '6983', '6985', '6986', '6A80', '6A84', '6A86', '6A88', '6D00', '6E00', '6F10', '6F11', '6F20', '6F21']) {
    assert.ok(S.swMessage(sw).length > 0 && !S.swMessage(sw).includes(sw));
  }
  assert.equal(S.swMessage('63c0'), 'Sai mã PIN, còn 0 lần thử');
});
test('browser UMD exports usable APDU and UTF8 profile APIs without CommonJS', () => {
  const context = { window: {}, TextEncoder, TextDecoder, Uint8Array };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/assets/js/card/card-shared'), 'utf8'), context);
  const browser = context.window.CardShared;
  assert.equal(browser.apdu(browser.INS.GET_PUBLIC_INFO, 0, 0), '8010000000');
  assert.equal(browser.decodeProfile(browser.encodeProfile({ fullName: 'Đức' })).fullName, 'Đức');
  assert.equal(Object.keys(browser.INS).length, 22);
});
