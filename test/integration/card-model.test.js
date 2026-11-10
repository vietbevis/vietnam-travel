const {test,before,after,beforeEach} = require('node:test');
const assert = require('node:assert/strict');
const db = require('../helpers/db');
const Customer = require('../../models/customer.model');
const Card = require('../../models/card.model');
const Transaction = require('../../models/card-transaction.model');
const CardLog = require('../../models/card-log.model');
const Nonce = require('../../models/card-nonce.model');
const Operation = require('../../models/card-operation.model');
const Account = require('../../models/account-admin.model');
const Order = require('../../models/order.model');
const log = require('../../helpers/card-log.helper');
const models=[Customer,Card,Transaction,CardLog,Nonce,Operation,Account,Order];
const cardId='ab'.repeat(16);
const makeCard = extra => ({cardId,cardType:'customer',ownerId:'owner-1',...extra});
const makeTx = extra => ({txRef:'ab'.repeat(8),cardId,type:'credit',source:'cash',amount:10_000,...extra});
const integration = (name,fn,options={}) => test(name,{skip:!db.enabled,...options},fn);
before(async () => { if(db.enabled) { await db.connect(); await Promise.all(models.map(Model => Model.init())); } });
beforeEach(async () => { if(db.enabled) await db.reset(); });
after(async () => { if(db.enabled) await db.close(); });

integration('index duy nhất cardId, owner+type chỉ với isCurrent',async () => {
  await Card.create(makeCard());
  await assert.rejects(Card.create(makeCard({ownerId:'other'})),{code:11000});
  await assert.rejects(Card.create(makeCard({cardId:'cd'.repeat(16)})),{code:11000});
  await Card.create(makeCard({cardId:'ef'.repeat(16),cardType:'staff'}));
  await Card.create(makeCard({cardId:'12'.repeat(16),status:'revoked'}));
  await Card.create(makeCard({cardId:'34'.repeat(16),status:'failed'}));
  assert.equal(await Card.countDocuments(),4);
});
integration('txRef duy nhất và dữ liệu giao dịch roundtrip',async () => {
  await Transaction.create(makeTx({status:'pending-card'}));
  await assert.rejects(Transaction.create(makeTx({cardId:'cd'.repeat(16)})),{code:11000});
  const found=await Transaction.findOne().lean(); assert.equal(found.amount,10_000); assert.equal(found.status,'pending-card');
});
integration('default và trường mới Account/Order bảo toàn dữ liệu item legacy',async () => {
  const customer=await Customer.create({email:'test@example.invalid',fullName:'Khách thử'});
  assert.equal(customer.totalSpent,0); assert.equal(customer.status,'active');
  const account=await Account.create({fullName:'Admin thử',password:'fixture-hash',role:'legacy-role',status:'legacy-status'});
  assert.equal(account.cardRequired,false); assert.equal(account.role,'legacy-role');
  const legacy={_id:'legacy-item-id',tourId:'tour-old',locationFrom:'city-old',name:'Tour cũ',avatar:'/legacy.jpg',quantityAdult:2,quantityChildren:1,quantityBaby:1,priceNewAdult:1_000,priceNewChildren:500,priceNewBaby:100,departureDate:'2026-11-10',custom:{nested:[1,2]}};
  const inserted=await Order.collection.insertOne({orderCode:'LEGACY',items:[legacy],status:'legacy-status',paymentStatus:'legacy-payment',paymentMethod:'legacy-method',total:2500});
  const order=await Order.findById(inserted.insertedId); order.customerId=customer.id; order.cardTxRef='ab'.repeat(8); order.items[0].ticketStatus='used'; order.items[0].checkedInAt=new Date('2026-11-10T00:00:00Z'); order.items[0].checkedInBy=account.id; await order.save();
  const saved=await Order.findById(order.id).lean();
  for (const [key,value] of Object.entries(legacy)) assert.deepEqual(saved.items[0][key],value);
  assert.equal(saved.items[0].ticketStatus,'used'); assert.equal(saved.items[0].checkedInBy,account.id); assert.equal(saved.status,'legacy-status'); assert.equal(saved.paymentStatus,'legacy-payment'); assert.equal(saved.paymentMethod,'legacy-method'); assert.equal(saved.total,2500);
});
integration('ghi CardLog thành công lấy IP từ req và loại PIN/secret lồng nhau',async () => {
  assert.equal(await log.write({action:'issue',cardId,actorType:'admin',actorId:'admin-1',result:'success',detail:{reason:'kiểm thử',pin:'123456',nested:{newPin:'654321',privateKey:'fixture-secret',amount:10_000},text:'PIN=123456 token=fixture-token'},req:{ip:'127.0.0.9',headers:{'x-forwarded-for':'evil'}}}),undefined);
  const found=await CardLog.findOne().lean(); assert.equal(found.ip,'127.0.0.9'); assert.equal(found.action,'issue'); assert.equal(found.detail.reason,'kiểm thử'); assert.equal(found.detail.nested.amount,10_000);
  const serialized=JSON.stringify(found); for(const secret of ['123456','654321','fixture-secret','fixture-token']) assert.ok(!serialized.includes(secret));
});
integration('CardLog lỗi validation không thoát helper và không lưu log giả',async () => {
  assert.equal(await log.write({action:'invalid',actorType:'invalid',result:'fail',detail:{pin:'123456'}}),undefined);
  assert.equal(await CardLog.countDocuments(),0);
  assert.equal(await log.write(null),undefined);
});
integration('TTL index và Mongo thật xóa nonce/op quá hạn trong 90 giây',async () => {
  for (const Model of [Nonce,Operation]) {
    const indexes=await Model.collection.indexes(); assert.ok(indexes.some(i=>i.key.expireAt===1 && i.expireAfterSeconds===0));
  }
  const nonce=await Nonce.create({nonce:'ab'.repeat(16),purpose:'login-customer'});
  const operation=await Operation.create({cardId,type:'credit',actorType:'system'});
  assert.ok(nonce.expireAt.getTime()-Date.now()>58_000); assert.ok(operation.expireAt.getTime()-Date.now()>298_000);
  const expiredNonce=await Nonce.create({nonce:'cd'.repeat(16),purpose:'step-up',expireAt:new Date(Date.now()-60_000)});
  const expiredOp=await Operation.create({cardId,type:'set-state',actorType:'system',expireAt:new Date(Date.now()-60_000)});
  const deadline=Date.now()+90_000; let remaining;
  do {
    remaining=await Nonce.countDocuments({_id:expiredNonce._id})+await Operation.countDocuments({_id:expiredOp._id});
    if(!remaining) break;
    await new Promise(resolve=>setTimeout(resolve,500));
  } while(Date.now()<deadline);
  assert.equal(remaining,0,'Mongo TTL monitor chưa xóa hai bản ghi quá hạn trong 90 giây');
},{timeout:120_000});

integration('reset xóa cả collection native và từ chối env đổi trước xóa dữ liệu',async () => {
  const native=require('mongoose').connection.db.collection('native-reset-fixture');
  await native.insertOne({fixture:true});
  const old=process.env.TEST_DATABASE;
  try {
    process.env.TEST_DATABASE='mongodb://127.0.0.1:27017/vietnam-travel-smartcard-dev';
    await assert.rejects(db.reset(),/an toàn/);
    assert.equal(await native.countDocuments(),1);
  } finally { process.env.TEST_DATABASE=old; }
  await db.reset(); assert.equal(await native.countDocuments(),0);
});
integration('ghi model thật từ chối dữ liệu sai trước khi tạo bản ghi',async () => {
  await assert.rejects(Card.create(makeCard({balance:1.5})),{name:'ValidationError'});
  await assert.rejects(Transaction.create(makeTx({amount:50_000_001})),{name:'ValidationError'});
  await assert.rejects(Customer.create({email:'test@example.invalid',totalSpent:-1}),{name:'ValidationError'});
  await assert.rejects(Nonce.create({nonce:'abc',purpose:'other'}),{name:'ValidationError'});
  await assert.rejects(Operation.create({cardId,type:'credit',actorType:'system',status:'confirming'}),{name:'ValidationError'});
  assert.equal(await Card.countDocuments()+await Transaction.countDocuments()+await Customer.countDocuments()+await Nonce.countDocuments()+await Operation.countDocuments(),0);
});
