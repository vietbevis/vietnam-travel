const {test,afterEach} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const axios = require('axios').default;
const originalPost = axios.post;
const savedEnv = {...process.env};
const id = '507f1f77bcf86cd799439011';
const phone = '0901234567';
const hmac = (text,key,algorithm='sha256') => crypto.createHmac(algorithm,key).update(text).digest('hex');
function configure() {
  Object.assign(process.env,{ZALOPAY_APPID:'1234',ZALOPAY_KEY1:'fixture-request',ZALOPAY_KEY2:'fixture-callback',ZALOPAY_DOMAIN:'https://zalo.example.invalid',DOMAIN_WEBSITE:'https://shop.example.invalid',VNPAY_CODE:'FIXTURE01',VNPAY_SECRET:'fixture-vnp-secret',VNPAY_URL:'https://vnp.example.invalid/pay'});
}
// Bộ ký fixture độc lập, không gọi sort/helper đang được kiểm thử.
function signVnp(query) {
  const raw = Object.keys(query).filter(key=>!['vnp_SecureHash','vnp_SecureHashType'].includes(key)).sort().map(key=>`${encodeURIComponent(key)}=${encodeURIComponent(query[key]).replace(/%20/g,'+')}`).join('&');
  return {...query,vnp_SecureHash:hmac(raw,process.env.VNPAY_SECRET,'sha512')};
}
function callback(extra={}) {
  const data=JSON.stringify({app_id:1234,app_trans_id:'261110_123456',app_user:`${phone}-${id}`,amount:100000,type:undefined,...extra});
  return {data,mac:hmac(data,process.env.ZALOPAY_KEY2),type:1};
}
afterEach(()=> { axios.post=originalPost; for(const key of Object.keys(process.env)) if(!(key in savedEnv)) delete process.env[key]; Object.assign(process.env,savedEnv); });

test('Zalo tạo request giữ transport params, pipe ký key1 và identity legacy',async()=> {
  configure(); let request;
  axios.post=async (...args)=> { request=args; return {data:{return_code:1,order_url:'https://zalo.example.invalid/checkout'}}; };
  const url=await require('../helpers/zalopay.helper').createOrder({appUser:`${phone}-${id}`,amount:100000,description:'Thanh toán đơn hàng OD1',redirectUrl:'https://shop.example.invalid/order/success?orderId=x&phone=y',callbackPath:'/order/payment-zalopay-result'});
  assert.equal(url,'https://zalo.example.invalid/checkout');
  assert.equal(request[0],'https://zalo.example.invalid/v2/create'); assert.equal(request[1],null);
  const order=request[2].params;
  assert.match(order.app_trans_id,/^\d{6}_\d{1,6}$/); assert.equal(order.app_user,`${phone}-${id}`); assert.equal(order.amount,100000);
  assert.equal(order.item,'[{}]'); assert.equal(order.bank_code,'');
  assert.equal(order.callback_url,'https://shop.example.invalid/order/payment-zalopay-result');
  assert.equal(JSON.parse(order.embed_data).redirecturl,'https://shop.example.invalid/order/success?orderId=x&phone=y');
  const expected=[1234,order.app_trans_id,`${phone}-${id}`,100000,order.app_time,order.embed_data,'[{}]'].join('|');
  assert.equal(order.mac,hmac(expected,'fixture-request'));
});
test('Zalo tạo order từ chối config/amount lỗi trước transport, thất bại provider trả null',async()=> {
  configure(); let calls=0; axios.post=async()=> {calls++; return {data:{return_code:-1}};};
  const helper=require('../helpers/zalopay.helper');
  const args={appUser:`${phone}-${id}`,amount:100000,description:'Fixture',redirectUrl:'https://shop.example.invalid/success',callbackPath:'/callback'};
  delete process.env.ZALOPAY_KEY1; assert.equal(await helper.createOrder(args),null); assert.equal(calls,0);
  configure(); for(const amount of [0,-1,1.1,Number.MAX_SAFE_INTEGER+1]) assert.equal(await helper.createOrder({...args,amount}),null);
  assert.equal(calls,0); assert.equal(await helper.createOrder(args),null); assert.equal(calls,1);
  axios.post=async()=>{throw new Error('provider unreachable');}; assert.equal(await helper.createOrder(args),null);
});
test('Zalo helper giữ appUser generic cho consumer topup trong interface',async()=> {
  configure(); let appUser;
  axios.post=async(url,body,options)=>{appUser=options.params.app_user;return {data:{return_code:1,order_url:'https://zalo.example.invalid/checkout'}};};
  const helper=require('../helpers/zalopay.helper');
  const url=await helper.createOrder({appUser:`topup-${id}`,amount:10000,description:'Fixture interface',redirectUrl:'/account/card?topup=1',callbackPath:'/callback-fixture'});
  assert.equal(url,'https://zalo.example.invalid/checkout'); assert.equal(appUser,`topup-${id}`);
  assert.equal(helper.verifyCallback(callback({app_user:`topup-${id}`})).valid,true);
});
test('Zalo controller giữ nguyên mô tả tiếng Việt khi tạo payment',async t=> {
  configure(); let description; const redirects=[];
  const Order=require('../models/order.model');
  // Unit chỉ thay DB read và HTTP ra ngoài, giữ controller cùng helper ký thật.
  t.mock.method(Order,'findOne',async()=>({id,phone,total:100000,orderCode:'OD1'}));
  axios.post=async(url,body,options)=>{description=options.params.description;return {data:{return_code:1,order_url:'https://zalo.example.invalid/checkout'}};};
  await require('../controllers/client/order.controller').paymentZaloPay({query:{orderId:id}},{redirect:url=>redirects.push(url)});
  assert.deepEqual(redirects,['https://zalo.example.invalid/checkout']);
  assert.equal(description,'Thanh toán đơn hàng OD1');
});
test('Zalo callback kiểm MAC trên raw data trước parse và không đòi status không tồn tại',()=> {
  configure(); const helper=require('../helpers/zalopay.helper'); const body=callback();
  assert.equal(helper.verifyCallback(body).valid,true); assert.equal(helper.verifyCallback(body).data.amount,100000);
  const spaced={...body,data:body.data.replace('{','{ ')}; assert.equal(helper.verifyCallback(spaced).valid,false);
  spaced.mac=hmac(spaced.data,process.env.ZALOPAY_KEY2); assert.equal(helper.verifyCallback(spaced).valid,true);
});
test('Zalo callback từ chối hash/config sai, malformed và duplicate-param object/array',()=> {
  configure(); const helper=require('../helpers/zalopay.helper'); const body=callback();
  for(const bad of [null,[],{...body,data:[body.data]},{...body,mac:[body.mac]},{...body,mac:{}},{...body,mac:''},{...body,mac:'g'.repeat(64)},{...body,mac:'ab'},{...body,mac:'0'.repeat(64)},{data:'{',mac:hmac('{',process.env.ZALOPAY_KEY2)}]) assert.equal(helper.verifyCallback(bad).valid,false);
  delete process.env.ZALOPAY_KEY2; assert.equal(helper.verifyCallback(body).valid,false);
});
test('Zalo callback ràng buộc app, amount, reference, phone và explicit failure',()=> {
  configure(); const helper=require('../helpers/zalopay.helper');
  for(const extra of [{app_id:9999},{amount:0},{amount:'100000'},{app_user:''},{app_user:'bad|pipe'},{app_user:['duplicate']},{app_trans_id:'bad'},{status:'failed'},{return_code:-1}]) assert.equal(helper.verifyCallback(callback(extra)).valid,false,JSON.stringify(extra));
  const body=callback(); assert.equal(helper.verifyCallback({...body,type:2}).valid,false);
  assert.equal(helper.verifyCallback({...body,type:[1]}).valid,false);
});
test('VNPay URL giữ mã hóa tiếng Việt/space+, amount×100 và HMACSHA512 độc lập',()=> {
  configure(); const helper=require('../helpers/vnpay.helper');
  const built=helper.buildPaymentUrl({txnRef:`${id}-1794272400000`,amount:100000,orderInfo:'Thanh toán + đơn / 1',returnPath:'/order/payment-vnpay-result',ipAddr:'127.0.0.1'});
  assert.ok(built.includes('vnp_OrderInfo=Thanh+to%C3%A1n+%2B+%C4%91%C6%A1n+%2F+1'));
  const query=Object.fromEntries(new URL(built).searchParams);
  assert.equal(query.vnp_Amount,'10000000'); assert.equal(query.vnp_TmnCode,'FIXTURE01'); assert.equal(query.vnp_TxnRef,`${id}-1794272400000`);
  assert.equal(query.vnp_ReturnUrl,'https://shop.example.invalid/order/payment-vnpay-result');
  assert.equal(query.vnp_SecureHash,signVnp(query).vnp_SecureHash);
});
test('VNPay verify không sửa query, kiểm cả response và transaction status',()=> {
  configure(); const helper=require('../helpers/vnpay.helper');
  const base={vnp_TxnRef:`${id}-1794272400000`,vnp_Amount:'10000000',vnp_TmnCode:'FIXTURE01',vnp_ResponseCode:'00',vnp_TransactionStatus:'00',vnp_OrderInfo:'Đơn thử 1'};
  const query=signVnp(base); const copy={...query};
  assert.deepEqual(helper.verifyReturn(query),{valid:true,txnRef:base.vnp_TxnRef,success:true}); assert.deepEqual(query,copy);
  for(const field of ['vnp_ResponseCode','vnp_TransactionStatus']) { const result=helper.verifyReturn(signVnp({...base,[field]:'01'})); assert.equal(result.valid,true); assert.equal(result.success,false); }
  assert.equal(helper.verifyReturn({...query,vnp_Amount:'20000000'}).valid,false);
});
test('VNPay từ chối malformed/duplicate param, missing/hash không hex và lazy secret',()=> {
  configure(); const helper=require('../helpers/vnpay.helper'); const query=signVnp({vnp_TxnRef:`${id}-1`,vnp_ResponseCode:'00',vnp_TransactionStatus:'00'});
  for(const bad of [null,[],{...query,vnp_Amount:['1','2']},{...query,vnp_TxnRef:{}},{...query,vnp_SecureHash:undefined},{...query,vnp_SecureHash:'g'.repeat(128)},{...query,vnp_SecureHash:'aa'},{...query,vnp_SecureHash:[query.vnp_SecureHash]}]) assert.equal(helper.verifyReturn(bad).valid,false);
  delete process.env.VNPAY_SECRET; assert.equal(helper.verifyReturn(query).valid,false);
  configure(); assert.equal(helper.verifyReturn(query).valid,true);
});
test('VNPay builder từ chối cấu hình và amount lỗi, không tạo URL ký thiếu secret',()=> {
  configure(); const helper=require('../helpers/vnpay.helper'); const args={txnRef:`${id}-1`,amount:100000,orderInfo:'Fixture',returnPath:'/callback',ipAddr:'127.0.0.1'};
  delete process.env.VNPAY_SECRET; assert.throws(()=>helper.buildPaymentUrl(args)); configure();
  for(const amount of [0,-1,0.5,Number.MAX_SAFE_INTEGER]) assert.throws(()=>helper.buildPaymentUrl({...args,amount}));
});
test('markOrderPaid từ chối filter operator, method và dữ liệu scalar lỗi trước DB',async()=> {
  const helper=require('../helpers/order-payment.helper');
  for(const [filter,method] of [[{_id:{$ne:null}},'zalopay'],[{_id:id,paymentStatus:'unpaid'},'zalopay'],[{_id:id,deleted:true},'zalopay'],[{_id:id,phone:['a']},'zalopay'],[{_id:id,total:NaN},'zalopay'],[{_id:id},'unknown'],[null,'vnpay']]) assert.equal(await helper.markOrderPaid(filter,method),false);
});
