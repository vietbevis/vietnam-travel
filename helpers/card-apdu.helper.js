const moment = require('moment');
const S = require('../public/assets/js/card/card-shared');
const C = require('./card-crypto.helper');

function fixedHex(hex, length) {
  const bytes = Buffer.from(S.fromHex(hex));
  if (bytes.length !== length) throw new Error('INVALID_HEX_LENGTH');
  return bytes;
}

function byte(value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('INVALID_BYTE');
  return value;
}

function uint32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) throw new Error('INVALID_UINT32');
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function buildCmdMessage({ challengeHex, cardIdHex, ins, p1, p2, payload = Buffer.alloc(0) }) {
  if (!(payload instanceof Uint8Array)) throw new Error('INVALID_PAYLOAD');
  return Buffer.concat([
    Buffer.from([0x43]), fixedHex(challengeHex, 16), fixedHex(cardIdHex, 16),
    Buffer.from([byte(ins), byte(p1), byte(p2)]), payload
  ]);
}

function signedApdu(args) {
  const message = buildCmdMessage(args);
  const payload = args.payload === undefined ? Buffer.alloc(0) : args.payload;
  if (payload.length + 128 > 255) throw new Error('INVALID_APDU_DATA');
  return S.apdu(args.ins, args.p1, args.p2, Buffer.concat([payload, C.signServer(message)]));
}

function buildInitData({ cardIdHex, cardType, pin, kEscrow }) {
  if (cardType !== 1 && cardType !== 2) throw new Error('INVALID_CARD_TYPE');
  if (!S.isPinFormat(pin)) throw new Error('INVALID_PIN');
  if (!(kEscrow instanceof Uint8Array) || kEscrow.length !== 16) throw new Error('INVALID_ESCROW_KEY');
  return Buffer.concat([fixedHex(cardIdHex, 16), Buffer.from([cardType]), fixedHex(C.getServerModulusHex(), 128), Buffer.from(pin, 'ascii'), kEscrow]);
}

function parsePublicInfo(hex) {
  const bytes = fixedHex(hex, 21);
  return {
    cardId: S.toHex(bytes.subarray(0, 16)), cardType: bytes[16], state: bytes[17],
    mustChangePin: bytes[18] === 1, triesRemaining: bytes[19], version: bytes[20]
  };
}

function buildAuthMessage({ nonceHex, cardIdHex, counter }) {
  return Buffer.concat([Buffer.from([0x41]), fixedHex(nonceHex, 16), fixedHex(cardIdHex, 16), uint32(counter)]);
}

function parseReceipt(hex) {
  let bytes;
  try { bytes = fixedHex(hex, 166); } catch { return null; }
  if (bytes[0] !== 0x52 || (bytes[17] !== 1 && bytes[17] !== 2)) return null;
  // Chỉ phân tích cấu trúc; caller phải xác minh chữ ký và đối chiếu giao dịch theo spec 6.3.
  return {
    message: bytes.subarray(0, 38), signature: bytes.subarray(38),
    cardId: S.toHex(bytes.subarray(1, 17)), type: bytes[17] === 1 ? 'credit' : 'debit',
    txRef: S.toHex(bytes.subarray(18, 26)), amount: bytes.readUInt32BE(26),
    balanceAfter: bytes.readUInt32BE(30), txCounter: bytes.readUInt32BE(34)
  };
}

function walletPayload(txRefHex, amount) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 50000000) throw new Error('INVALID_AMOUNT');
  return Buffer.concat([fixedHex(txRefHex, 8), uint32(amount)]);
}

function ticketKey({ orderCode, tourId }) {
  if (typeof orderCode !== 'string' || !/^[\x00-\x7F]{12}$/.test(orderCode)) throw new Error('INVALID_ORDER_CODE');
  return Buffer.concat([Buffer.from(orderCode, 'ascii'), fixedHex(tourId, 12)]);
}

function encodeTicket({ orderCode, tourId, departureDate, pax }) {
  if (departureDate === undefined || departureDate === null) throw new Error('INVALID_DEPARTURE_DATE');
  const date = moment(departureDate).utcOffset(420);
  if (!date.isValid()) throw new Error('INVALID_DEPARTURE_DATE');
  const dateText = date.format('YYYYMMDD');
  if (!/^[0-9]{8}$/.test(dateText)) throw new Error('INVALID_DEPARTURE_DATE');
  return Buffer.concat([ticketKey({ orderCode, tourId }), Buffer.from(dateText, 'ascii'), Buffer.from([byte(pax)])]);
}

module.exports = { buildCmdMessage, signedApdu, buildInitData, parsePublicInfo, buildAuthMessage, parseReceipt, walletPayload, encodeTicket, ticketKey };
