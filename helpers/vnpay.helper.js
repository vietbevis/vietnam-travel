const crypto = require('node:crypto');
const moment = require('moment');
const qs = require('qs');
const sortHelper = require('./sort.helper');

const text = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const serialize = params => qs.stringify(sortHelper.sortObject(params),{encode:false});

module.exports.buildPaymentUrl = ({txnRef,amount,orderInfo,returnPath,ipAddr,expireMinutes} = {}) => {
  const {VNPAY_CODE:code,VNPAY_SECRET:secret,VNPAY_URL:url,DOMAIN_WEBSITE:website} = process.env;
  if (![code,secret,url,website,txnRef,orderInfo,returnPath,ipAddr].every(text) || !returnPath.startsWith('/') || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(amount*100) || (expireMinutes !== undefined && !(Number.isSafeInteger(expireMinutes) && expireMinutes > 0))) throw new Error('Cấu hình hoặc dữ liệu VNPay không hợp lệ.');
  // Có hạn thanh toán (nạp ví) thì tính cả ngày tạo lẫn hạn theo GMT+7; không có thì giữ hành vi cũ.
  const now = expireMinutes === undefined ? moment() : moment().utcOffset(7);
  const params = {
    vnp_Version:'2.1.0',vnp_Command:'pay',vnp_TmnCode:code,vnp_Locale:'vn',vnp_CurrCode:'VND',
    vnp_TxnRef:txnRef,vnp_OrderInfo:orderInfo,vnp_OrderType:'other',vnp_Amount:amount*100,
    vnp_ReturnUrl:`${website}${returnPath}`,vnp_IpAddr:ipAddr,vnp_CreateDate:now.format('YYYYMMDDHHmmss')
  };
  if (expireMinutes !== undefined) params.vnp_ExpireDate = now.clone().add(expireMinutes,'minutes').format('YYYYMMDDHHmmss');
  const signed = serialize(params);
  const hash = crypto.createHmac('sha512',secret).update(signed,'utf8').digest('hex');
  return `${url}?${signed}&vnp_SecureHash=${hash}`;
};

module.exports.verifyReturn = query => {
  const invalid = {valid:false,txnRef:null,success:false};
  const secret = process.env.VNPAY_SECRET;
  if (!text(secret) || !record(query) || typeof query.vnp_SecureHash !== 'string' || !/^[a-fA-F0-9]{128}$/.test(query.vnp_SecureHash)) return invalid;
  // Từ chối mảng/object do query trùng tham số; không stringify hoặc ép kiểu chúng.
  if (Object.entries(query).some(([key,value])=> !/^vnp_[A-Za-z0-9_]+$/.test(key) || typeof value !== 'string')) return invalid;
  const params = {...query};
  delete params.vnp_SecureHash;
  delete params.vnp_SecureHashType;
  try {
    const expected = crypto.createHmac('sha512',secret).update(serialize(params),'utf8').digest();
    if (!crypto.timingSafeEqual(Buffer.from(query.vnp_SecureHash,'hex'),expected) || !text(params.vnp_TxnRef)) return invalid;
    return {valid:true,txnRef:params.vnp_TxnRef,success:params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00'};
  } catch {
    return invalid;
  }
};
