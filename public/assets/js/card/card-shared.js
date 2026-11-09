(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardShared = factory();
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const CLA = 0x80;
  const AID_HEX = 'F054524156454C01';
  const INS = Object.freeze({
    INIT: 0x01, GET_PUBLIC_INFO: 0x10, VERIFY_PIN: 0x20, CHANGE_PIN: 0x21,
    RESET_PIN: 0x22, GET_CHALLENGE: 0x30, AUTHENTICATE: 0x31, GET_CARD_PUBKEY: 0x32,
    READ_DATA: 0x40, BEGIN_WRITE: 0x41, WRITE_CHUNK: 0x42, COMMIT_WRITE: 0x43,
    GET_BALANCE: 0x50, CREDIT: 0x51, DEBIT: 0x52, READ_TX_LOG: 0x53, GET_RECEIPT: 0x54,
    WRITE_TICKET: 0x60, READ_TICKETS: 0x61, USE_TICKET: 0x62, DELETE_TICKET: 0x63, SET_STATE: 0x70
  });
  const STATE = Object.freeze({ CREATED: 0x00, ACTIVE: 0x02, LOCKED: 0x03, TERMINATED: 0x7F });
  const TARGET = Object.freeze({ PROFILE: 1, PHOTO: 2 });
  const CHUNK = 224;
  const PROFILE_MAX = 448;
  const PHOTO_MAX = 10080;
  const FIELDS = [
    ['fullName', 60], ['dob', 8], ['gender', 6], ['phone', 15], ['idNumber', 20],
    ['emergencyName', 60], ['emergencyPhone', 15], ['bloodType', 3], ['allergies', 120]
  ];
  const SW_MESSAGES = {
    '9000': 'Thành công', '6700': 'Sai độ dài', '6982': 'Chưa xác thực PIN',
    '6983': 'PIN đã bị khoá', '6985': 'Sai trạng thái, chưa đổi PIN hoặc vé đã dùng',
    '6986': 'Không cho phép với loại thẻ này', '6A80': 'Dữ liệu sai',
    '6A84': 'Hết chỗ lưu trữ', '6A86': 'P1/P2 sai', '6A88': 'Không tìm thấy dữ liệu',
    '6D00': 'Lệnh không hỗ trợ', '6E00': 'CLA sai', '6F10': 'Số dư không đủ',
    '6F11': 'Vượt hạn mức số dư', '6F20': 'Chữ ký server sai', '6F21': 'Chưa có challenge'
  };

  function toHex(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('INVALID_BYTES');
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function fromHex(hex) {
    if (typeof hex !== 'string' || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('INVALID_HEX');
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }

  function apdu(ins, p1, p2, data) {
    for (const byte of [ins, p1, p2]) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('INVALID_APDU_HEADER');
    }
    const bytes = data === undefined ? new Uint8Array(0) : data;
    if (!(bytes instanceof Uint8Array) || bytes.length > 255) throw new Error('INVALID_APDU_DATA');
    const header = toHex(new Uint8Array([CLA, ins, p1, p2]));
    return header + (bytes.length ? toHex(new Uint8Array([bytes.length])) + toHex(bytes) : '') + '00';
  }

  function swMessage(sw) {
    const hex = String(sw).toUpperCase();
    if (/^63C[0-9A-F]$/.test(hex)) return `Sai mã PIN, còn ${parseInt(hex[3], 16)} lần thử`;
    return SW_MESSAGES[hex] || `Lỗi thẻ không xác định (${hex})`;
  }

  function encodeProfile(profile) {
    if (!profile || typeof profile !== 'object') throw new Error('INVALID_PROFILE');
    const encoder = new TextEncoder();
    const parts = [];
    let total = 0;
    FIELDS.forEach(([field, max], index) => {
      const value = profile[field];
      if (value === undefined || value === null || value === '') return;
      if (typeof value !== 'string') throw new Error(`INVALID_FIELD:${field}`);
      const bytes = encoder.encode(value);
      if (bytes.length > max) throw new Error(`FIELD_TOO_LONG:${field}`);
      parts.push(new Uint8Array([index + 1, bytes.length]), bytes);
      total += 2 + bytes.length;
    });
    if (total > PROFILE_MAX) throw new Error('PROFILE_TOO_LARGE');
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }

  function decodeProfile(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('INVALID_PROFILE');
    if (bytes.length > PROFILE_MAX) throw new Error('PROFILE_TOO_LARGE');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const profile = {};
    for (let offset = 0; offset < bytes.length;) {
      if (offset + 2 > bytes.length) throw new Error('INVALID_PROFILE_TLV');
      const tag = bytes[offset++];
      const length = bytes[offset++];
      if (offset + length > bytes.length) throw new Error('INVALID_PROFILE_TLV');
      const field = FIELDS[tag - 1];
      if (field) {
        if (length > field[1]) throw new Error(`FIELD_TOO_LONG:${field[0]}`);
        profile[field[0]] = decoder.decode(bytes.subarray(offset, offset + length));
      }
      offset += length;
    }
    return profile;
  }

  function isPinFormat(pin) { return typeof pin === 'string' && /^[0-9]{6}$/.test(pin); }

  function isWeakPin(pin, dob) {
    if (!isPinFormat(pin)) return false;
    if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return true;
    return typeof dob === 'string' && /^\d{8}$/.test(dob) && pin === dob.slice(6, 8) + dob.slice(4, 6) + dob.slice(2, 4);
  }

  return { CLA, AID_HEX, INS, STATE, TARGET, CHUNK, PROFILE_MAX, PHOTO_MAX, toHex, fromHex, apdu, swMessage, encodeProfile, decodeProfile, isPinFormat, isWeakPin };
}));
