const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mongoose=require('mongoose');
const axios=require('axios').default;
const originalPost=axios.post;
const db=require('../helpers/db');
const Order=require('../../models/order.model');
const Customer=require('../../models/customer.model');
const controller=require('../../controllers/client/order.controller');
const integration=(name,fn)=>test(name,{skip:!db.enabled},fn);
let replica; const savedEnv={...process.env};
before(async()=> {
  if(!db.enabled) return;
  await db.connect(); await Promise.all([Order.init(),Customer.init()]);
  const hello=await mongoose.connection.db.admin().command({hello:1}); replica=!!hello.setName;
  Object.assign(process.env,{ZALOPAY_APPID:'1234',ZALOPAY_KEY1:'fixture-request',ZALOPAY_KEY2:'fixture-callback',ZALOPAY_DOMAIN:'https://zalo.example.invalid',VNPAY_CODE:'FIXTURE01',VNPAY_SECRET:'fixture-vnp-secret',VNPAY_URL:'https://vnp.example.invalid/pay',DOMAIN_WEBSITE:'https://shop.example.invalid'});
  // Chỉ thay HTTP transport ra ngoài; controller, chữ ký, helper và Mongo đều thật.
  axios.post=async()=>({data:{return_code:1,order_url:'https://zalo.example.invalid/checkout'}});
});
beforeEach(async()=>{if(db.enabled) await db.reset();});
after(async()=>{axios.post=originalPost;if(db.enabled) await db.close(); for(const key of Object.keys(process.env)) if(!(key in savedEnv)) delete process.env[key]; Object.assign(process.env,savedEnv);});
const payment=()=>require('../../helpers/order-payment.helper');
async function makeOrder(extra={}) {return Order.create({orderCode:'FIXTURE',phone:'0901234567',total:100000,paymentMethod:'zalopay',paymentStatus:'unpaid',status:'initial',deleted:false,items:[{name:'Tour thử',ticketStatus:'none'},{ticketStatus:'written'},{ticketStatus:'used'}],...extra});}
async function customer(extra={}) {return Customer.create({email:'fixture@example.invalid',totalSpent:200000,...extra});}
function response() {return {redirects:[],jsons:[],redirect(url){this.redirects.push(url);},json(data){this.jsons.push(data);},render(){assert.fail('Không được render view success không tồn tại');}};}
function zaloBody(order,extra={}) {const data=JSON.stringify({app_id:1234,app_trans_id:'261110_123456',app_user:`${order.phone}-${order.id}`,amount:order.total,...extra});return {type:1,data,mac:crypto.createHmac('sha256',process.env.ZALOPAY_KEY2).update(data).digest('hex')};}
function vnpQuery(order,extra={}) {
  const query={vnp_TmnCode:'FIXTURE01',vnp_TxnRef:`${order.id}-1794272400000`,vnp_Amount:String(order.total*100),vnp_ResponseCode:'00',vnp_TransactionStatus:'00',...extra};
  const raw=Object.keys(query).sort().map(key=>`${encodeURIComponent(key)}=${encodeURIComponent(query[key]).replace(/%20/g,'+')}`).join('&');
  return {...query,vnp_SecureHash:crypto.createHmac('sha512',process.env.VNPAY_SECRET).update(raw).digest('hex')};
}
async function assertUnpaid(order) {assert.equal((await Order.findById(order.id).lean()).paymentStatus,'unpaid');}

integration('legacy CAS đồng thời chỉ thắng một lần, giữ item và không cần replica set',async()=> {
  for(let repeat=0;repeat<3;repeat++) {
    const order=await makeOrder();
    await Order.collection.updateOne({_id:order._id},{$push:{items:{name:'Legacy thiếu ticketStatus',custom:42}}});
    const results=await Promise.all(Array.from({length:8},()=>payment().markOrderPaid({_id:order.id,phone:order.phone,deleted:false,total:order.total},'zalopay')));
    assert.equal(results.filter(Boolean).length,1);
    const stored=await Order.findById(order.id).lean(); assert.equal(stored.paymentStatus,'paid');
    assert.deepEqual(stored.items.map(i=>i.ticketStatus),['none','written','used',undefined]); assert.equal(stored.items[3].custom,42);
  }
});
integration('linked settlement tăng spend và tickets nguyên tử trên RS; standalone fail closed rõ ràng',async()=> {
  const owner=await customer(); const order=await makeOrder({customerId:owner.id});
  await Order.collection.updateOne({_id:order._id},{$push:{items:{name:'Vé cũ thiếu trạng thái',custom:42}}});
  if(!replica) {
    await assert.rejects(payment().markOrderPaid({_id:order.id},'zalopay'),/replica|transaction/i);
    await assertUnpaid(order); assert.equal((await Customer.findById(owner.id)).totalSpent,200000);
    assert.equal((await Order.findById(order.id)).items[0].ticketStatus,'none'); return;
  }
  for(let repeat=0;repeat<3;repeat++) {
    const target=repeat===0?order:await makeOrder({customerId:owner.id});
    const results=await Promise.all(Array.from({length:8},()=>payment().markOrderPaid({_id:target.id,phone:target.phone,total:target.total},'zalopay')));
    assert.equal(results.filter(Boolean).length,1); assert.equal(await payment().markOrderPaid({_id:target.id},'zalopay'),false);
    assert.equal((await Order.findById(target.id)).items[0].ticketStatus,'pending');
  }
  const stored=await Order.findById(order.id).lean();
  assert.deepEqual(stored.items.map(item=>item.ticketStatus),['pending','written','used','pending']); assert.equal(stored.items[3].custom,42);
  assert.equal((await Customer.findById(owner.id)).totalSpent,500000);
});
integration('CAS không trả paid cho sai phone, amount, method, deleted hoặc cancel',async()=> {
  for(const extra of [{},{deleted:true},{status:'cancel'},{paymentMethod:'vnpay'}]) {
    const order=await makeOrder(extra);
    if(!Object.keys(extra).length) {
      assert.equal(await payment().markOrderPaid({_id:order.id,phone:'0999999999'},'zalopay'),false);
      assert.equal(await payment().markOrderPaid({_id:order.id,total:100001},'zalopay'),false);
    } else assert.equal(await payment().markOrderPaid({_id:order.id},'zalopay'),false);
    await assertUnpaid(order);
  }
  const card=await makeOrder({paymentMethod:'card'}); assert.equal(await payment().markOrderPaid({_id:card.id},'card'),true);
});
integration('linked thiếu customer, deleted customer hoặc overflow không lưu một phần',async()=> {
  const absent=new mongoose.Types.ObjectId().toString();
  const removed=await customer({deleted:true}); const overflow=await customer({totalSpent:Number.MAX_SAFE_INTEGER});
  for(const customerId of [absent,removed.id,overflow.id]) {
    const order=await makeOrder({customerId});
    await assert.rejects(payment().markOrderPaid({_id:order.id},'zalopay'));
    await assertUnpaid(order); assert.equal((await Order.findById(order.id)).items[0].ticketStatus,'none');
  }
  assert.equal((await Customer.findById(overflow.id)).totalSpent,Number.MAX_SAFE_INTEGER);
});
integration('amount hoặc totalSpent không nguyên hữu hạn bị từ chối không ghi',async()=> {
  for(const total of [0,-1,0.5,Number.MAX_SAFE_INTEGER+1]) {
    const order=await makeOrder({total}); assert.equal(await payment().markOrderPaid({_id:order.id},'zalopay'),false); await assertUnpaid(order);
  }
  const owner=await customer(); await Customer.collection.updateOne({_id:owner._id},{$set:{totalSpent:1.5}});
  const order=await makeOrder({customerId:owner.id}); await assert.rejects(payment().markOrderPaid({_id:order.id},'zalopay')); await assertUnpaid(order);
});
integration('transaction rollback cả Order/tickets khi Customer update thất bại sau CAS',async t=> {
  const owner=await customer(); const order=await makeOrder({customerId:owner.id});
  if(replica) {
    // Tiêm lỗi ghi collection thứ hai để kiểm rollback Mongo thật sau CAS Order.
    t.mock.method(Customer,'updateOne',async()=>{throw new Error('Lỗi ghi fixture');});
  }
  await assert.rejects(payment().markOrderPaid({_id:order.id},'zalopay'));
  const stored=await Order.findById(order.id).lean(); assert.equal(stored.paymentStatus,'unpaid'); assert.equal(stored.items[0].ticketStatus,'none');
  assert.equal((await Customer.findById(owner.id)).totalSpent,200000);
});
integration('hai đơn cùng khách cạnh tranh không mất spend hoặc vượt safe integer',async()=> {
  const owner=await customer({totalSpent:Number.MAX_SAFE_INTEGER-150000});
  const orders=await Promise.all([makeOrder({customerId:owner.id}),makeOrder({customerId:owner.id})]);
  const results=await Promise.allSettled(orders.map(order=>payment().markOrderPaid({_id:order.id},'zalopay')));
  if(replica) {
    assert.equal(results.filter(result=>result.status==='fulfilled' && result.value===true).length,1);
    assert.equal(results.filter(result=>result.status==='rejected').length,1);
    assert.equal(await Order.countDocuments({paymentStatus:'paid'}),1);
    assert.equal((await Customer.findById(owner.id)).totalSpent,Number.MAX_SAFE_INTEGER-50000);
  } else {
    assert.ok(results.every(result=>result.status==='rejected'));
    assert.equal(await Order.countDocuments({paymentStatus:'paid'}),0);
    assert.equal((await Customer.findById(owner.id)).totalSpent,Number.MAX_SAFE_INTEGER-150000);
  }
});
integration('Zalo callback signed success legacy và duplicate không tăng spend lần nữa',async()=> {
  const owner=replica?await customer():null; const order=await makeOrder(owner?{customerId:owner.id}:{});
  for(let i=0;i<2;i++) {const res=response(); await controller.paymentZaloPayResultPost({body:zaloBody(order)},res); assert.equal(res.jsons[0].return_code,1);}
  assert.equal((await Order.findById(order.id)).paymentStatus,'paid'); if(owner) assert.equal((await Customer.findById(owner.id)).totalSpent,300000);
});
integration('Zalo callback kiểm amount/phone/ref/app/method và trạng thái trước paid',async()=> {
  const order=await makeOrder();
  for(const extra of [{amount:100001},{app_user:`0999999999-${order.id}`},{app_user:`${order.phone}-${order.id}-extra`},{app_user:`topup-${order.id}`},{app_trans_id:'bad'},{app_id:9999},{return_code:-1}]) {const res=response(); await controller.paymentZaloPayResultPost({body:zaloBody(order,extra)},res); assert.notEqual(res.jsons[0].return_code,1); await assertUnpaid(order);}
  const malformed=zaloBody(order); malformed.mac='g'.repeat(64); const res=response(); await controller.paymentZaloPayResultPost({body:malformed},res); assert.notEqual(res.jsons[0].return_code,1); await assertUnpaid(order);
  for(const extra of [{deleted:true},{status:'cancel'},{paymentMethod:'vnpay'}]) {const target=await makeOrder(extra); const output=response();await controller.paymentZaloPayResultPost({body:zaloBody(target)},output);assert.notEqual(output.jsons[0].return_code,1);await assertUnpaid(target);}
});
integration('VNPay signed return và duplicate giữ success URL legacy cùng một spend',async()=> {
  const owner=replica?await customer():null; const order=await makeOrder({paymentMethod:'vnpay',...(owner?{customerId:owner.id}:{})});
  for(let i=0;i<2;i++) {const res=response(); await controller.paymentVNPayResult({query:vnpQuery(order)},res); assert.deepEqual(res.redirects,[`https://shop.example.invalid/order/success?orderId=${order.id}&phone=${order.phone}`]);}
  assert.equal((await Order.findById(order.id)).paymentStatus,'paid'); if(owner) assert.equal((await Customer.findById(owner.id)).totalSpent,300000);
});
integration('VNPay reject signed wrong amount/TmnCode/ref/status và query orderId không chọn target',async()=> {
  const order=await makeOrder({paymentMethod:'vnpay'}); const other=await makeOrder({paymentMethod:'vnpay'});
  for(const extra of [{vnp_Amount:'10000001'},{vnp_Amount:'20000000'},{vnp_TmnCode:'WRONG'},{vnp_TxnRef:`${order.id}-bad`},{vnp_ResponseCode:'01'},{vnp_TransactionStatus:'01'},{vnp_TxnRef:'bad'},{orderId:other.id,vnp_Amount:'1'}]) {const res=response(); await controller.paymentVNPayResult({query:vnpQuery(order,extra)},res); assert.deepEqual(res.redirects,['/']); await assertUnpaid(order); await assertUnpaid(other);}
  const tampered=vnpQuery(order); tampered.vnp_Amount='1'; const res=response(); await controller.paymentVNPayResult({query:tampered},res); assert.deepEqual(res.redirects,['/']); await assertUnpaid(order);
});
integration('VNPay reject cancel/deleted/wrong method và signed duplicate wrong amount',async()=> {
  for(const extra of [{deleted:true},{status:'cancel'},{paymentMethod:'zalopay'}]) {const order=await makeOrder({paymentMethod:'vnpay',...extra}); const res=response();await controller.paymentVNPayResult({query:vnpQuery(order)},res);assert.deepEqual(res.redirects,['/']); await assertUnpaid(order);}
  const order=await makeOrder({paymentMethod:'vnpay'}); await controller.paymentVNPayResult({query:vnpQuery(order)},response());
  const res=response(); await controller.paymentVNPayResult({query:vnpQuery(order,{vnp_Amount:'20000000'})},res); assert.deepEqual(res.redirects,['/']);
});
integration('callback transaction lỗi trả generic failure và không ghi một phần',async()=> {
  const missingCustomer=new mongoose.Types.ObjectId().toString();
  const zalo=await makeOrder({customerId:missingCustomer}); const vnp=await makeOrder({customerId:missingCustomer,paymentMethod:'vnpay'});
  const zaloRes=response(); await controller.paymentZaloPayResultPost({body:zaloBody(zalo)},zaloRes); assert.deepEqual(zaloRes.jsons,[{return_code:0,return_message:'processing failed'}]); await assertUnpaid(zalo);
  const vnpRes=response(); await controller.paymentVNPayResult({query:vnpQuery(vnp)},vnpRes); assert.deepEqual(vnpRes.redirects,['/']); await assertUnpaid(vnp);
});
integration('entrypoint hợp lệ giữ Zalo URL và signed VNPay redirect, không đánh paid',async()=> {
  const zalo=await makeOrder(); const zaloRes=response(); await controller.paymentZaloPay({query:{orderId:zalo.id}},zaloRes); assert.deepEqual(zaloRes.redirects,['https://zalo.example.invalid/checkout']); await assertUnpaid(zalo);
  const vnp=await makeOrder({paymentMethod:'vnpay'}); const vnpRes=response(); await controller.paymentVNPay({query:{orderId:vnp.id},headers:{},socket:{remoteAddress:'127.0.0.1'}},vnpRes);
  const url=new URL(vnpRes.redirects[0]); assert.equal(url.origin,'https://vnp.example.invalid'); assert.equal(url.searchParams.get('vnp_Amount'),'10000000'); assert.match(url.searchParams.get('vnp_TxnRef'),new RegExp(`^${vnp.id}-[0-9]{13}$`)); await assertUnpaid(vnp);
});
integration('hai entrypoint chỉ khởi tạo payment đúng method, không cancel/deleted',async()=> {
  for(const [method,handler] of [['zalopay',controller.paymentZaloPay],['vnpay',controller.paymentVNPay]]) {
    for(const extra of [{paymentMethod:method==='zalopay'?'vnpay':'zalopay'},{status:'cancel'},{deleted:true}]) {
      const order=await makeOrder({paymentMethod:method,...extra}); const res=response(); await handler({query:{orderId:order.id},headers:{},socket:{remoteAddress:'127.0.0.1'}},res); assert.deepEqual(res.redirects,['/']); await assertUnpaid(order);
    }
  }
});
