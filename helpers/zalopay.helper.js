const crypto = require('node:crypto');
const axios = require('axios').default;
const moment = require('moment');

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const text = value => typeof value === 'string' && value.trim().length > 0;
const amountValid = value => Number.isSafeInteger(value) && value > 0;
// Helper dùng chung cho order/topup; từng controller kiểm identity nghiệp vụ riêng.
const appUserValid = value => typeof value === 'string' && /^[A-Za-z0-9+_-]{1,50}$/.test(value);

module.exports.createOrder = async ({appUser,amount,description,redirectUrl,callbackPath} = {}) => {
  // Đọc cấu hình lúc gọi, không chụp secret khi require module.
  const {ZALOPAY_APPID:appId,ZALOPAY_KEY1:key,ZALOPAY_DOMAIN:domain,DOMAIN_WEBSITE:website} = process.env;
  if (![appId,key,domain,website,description,redirectUrl,callbackPath].every(text) || !/^\d+$/.test(appId) || !appUserValid(appUser) || !amountValid(amount) || !callbackPath.startsWith('/')) return null;
  try {
    const order = {
      app_id:appId,
      app_trans_id:`${moment().format('YYMMDD')}_${Math.floor(Math.random()*1000000)}`,
      app_user:appUser,
      app_time:Date.now(),
      item:JSON.stringify([{}]),
      embed_data:JSON.stringify({redirecturl:redirectUrl}),
      amount,
      description,
      bank_code:'',
      callback_url:`${website}${callbackPath}`
    };
    const data = [order.app_id,order.app_trans_id,order.app_user,order.amount,order.app_time,order.embed_data,order.item].join('|');
    order.mac = crypto.createHmac('sha256',key).update(data).digest('hex');
    const response = await axios.post(`${domain}/v2/create`,null,{params:order});
    return response.data?.return_code == 1 && text(response.data.order_url) ? response.data.order_url : null;
  } catch {
    return null;
  }
};

module.exports.verifyCallback = body => {
  const invalid = {valid:false,data:null};
  const key = process.env.ZALOPAY_KEY2;
  const appId = process.env.ZALOPAY_APPID;
  if (!text(key) || !text(appId) || !record(body) || typeof body.data !== 'string' || typeof body.mac !== 'string' || !/^[a-fA-F0-9]{64}$/.test(body.mac)) return invalid;
  try {
    const expected = crypto.createHmac('sha256',key).update(body.data).digest();
    if (!crypto.timingSafeEqual(Buffer.from(body.mac,'hex'),expected)) return invalid;
    // Chỉ giải mã JSON sau MAC; callback Order type 1 vốn chỉ báo thanh toán thành công.
    const data = JSON.parse(body.data);
    if (!record(data) || !['string','number'].includes(typeof data.app_id) || String(data.app_id) !== appId || !amountValid(data.amount) || !appUserValid(data.app_user) || typeof data.app_trans_id !== 'string' || !/^\d{6}_\d{1,6}$/.test(data.app_trans_id)) return invalid;
    if (body.type !== undefined && body.type !== 1 && body.type !== '1') return invalid;
    if (data.return_code !== undefined && data.return_code !== 1 && data.return_code !== '1') return invalid;
    if (data.status !== undefined && ![1,'1','00','success','paid'].includes(data.status)) return invalid;
    if (data.success !== undefined && data.success !== true) return invalid;
    return {valid:true,data};
  } catch {
    return invalid;
  }
};
