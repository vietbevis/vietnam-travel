const test = require('node:test');
const assert = require('node:assert/strict');
const Customer = require('../models/customer.model');
const Card = require('../models/card.model');
const Transaction = require('../models/card-transaction.model');
const Nonce = require('../models/card-nonce.model');
const Operation = require('../models/card-operation.model');
const CardLog = require('../models/card-log.model');
const Account = require('../models/account-admin.model');
const Order = require('../models/order.model');
const cardId = 'ab'.repeat(16), modulus = 'cd'.repeat(128);
const card = extra => new Card({cardId,cardType:'customer',ownerId:'customer-1',...extra});
const tx = extra => new Transaction({txRef:'ab'.repeat(8),cardId,type:'credit',source:'cash',amount:10_000,...extra});

test('thẻ mặc định issuing, số dư/counter bằng không và key chờ INIT', () => {
  const doc=card(); assert.equal(doc.validateSync(),undefined);
  assert.equal(doc.status,'issuing'); assert.equal(doc.isCurrent,true); assert.equal(doc.balance,0); assert.equal(doc.txCounter,0); assert.equal(doc.publicKeyModulus,undefined);
});
test('isCurrent mặc định theo trạng thái và từ chối trạng thái mâu thuẫn', () => {
  for (const status of ['issuing','active','locked','revoked','failed']) {
    const expected=['issuing','active','locked'].includes(status);
    assert.equal(card({status,publicKeyModulus:modulus}).isCurrent,expected);
    assert.ok(card({status,isCurrent:!expected,publicKeyModulus:modulus}).validateSync());
  }
});
test('model thẻ chặn hex, enum, tiền và counter sai', () => {
  for (const extra of [{cardId:'x'.repeat(32)},{cardId:'ab'},{cardType:'unknown'},{status:'unknown'},{publicKeyModulus:'abc'},{balance:-1},{balance:50_000_001},{balance:1.5},{balance:NaN},{txCounter:-1},{txCounter:1.1},{txCounter:0x100000000}]) assert.ok(card(extra).validateSync());
  assert.equal(card({balance:50_000_000,txCounter:0xffffffff,publicKeyModulus:modulus}).validateSync(),undefined);
});
test('giao dịch chặn tiền/hex/enum sai và chấp nhận các trạng thái đặc tả', () => {
  for (const extra of [{txRef:'0'},{cardId:'0'},{amount:0},{amount:-1},{amount:1.1},{amount:NaN},{amount:50_000_001},{type:'other'},{source:'other'},{status:'other'},{balanceAfter:-1},{balanceAfter:50_000_001},{txCounter:1.5},{receiptHex:'00'}]) assert.ok(tx(extra).validateSync());
  for (const status of ['awaiting-payment','pending-card','sent','done','failed']) assert.equal(tx({status}).validateSync(),undefined);
});
test('khách cần email, tiền tổng chi tiêu nguyên không âm và default không sửa dữ liệu legacy', () => {
  assert.ok(new Customer({}).validateSync());
  const doc = new Customer({email:'test@example.invalid'});
  assert.equal(doc.totalSpent,0); assert.equal(doc.status,'active'); assert.equal(doc.deleted,false);
  for (const extra of [{gender:'unknown'},{totalSpent:-1},{totalSpent:1.5}]) assert.ok(new Customer({email:'test@example.invalid',...extra}).validateSync());
  assert.equal(new Account({}).cardRequired,false);
});
test('nonce/op có TTL đúng và chặn enum/hex sai', () => {
  const now=Date.now();
  const nonce=new Nonce({nonce:'ab'.repeat(16),purpose:'login-customer'});
  const op=new Operation({cardId,type:'credit',actorType:'admin',actorId:'admin-1'});
  assert.equal(nonce.used,false); assert.ok(nonce.expireAt-now>=59_000 && nonce.expireAt-now<=61_000);
  assert.equal(op.status,'draft'); assert.ok(op.expireAt-now>=299_000 && op.expireAt-now<=301_000);
  assert.ok(new Nonce({nonce:'xx',purpose:'other'}).validateSync());
  assert.ok(new Operation({cardId,type:'other',status:'confirming',actorType:'other'}).validateSync());
  for (const Model of [Nonce,Operation]) assert.ok(Model.schema.indexes().some(([key,opts]) => key.expireAt===1 && opts.expireAfterSeconds===0));
  assert.ok(new CardLog({action:'test',actorType:'other',result:'other'}).validateSync());
});
test('Order giữ trường item cũ và bổ sung trường vé được validate', () => {
  const order=new Order({customerId:'customer-1',cardTxRef:'ab'.repeat(8),items:[{tourId:'legacy',quantityAdult:2,quantityChildren:1,priceAdult:1234,priceChildren:500,departureDate:'2026-11-10',custom:{nested:true},ticketStatus:'written'}]});
  const item=order.toObject().items[0];
  assert.equal(item.quantityAdult,2); assert.deepEqual(item.custom,{nested:true}); assert.equal(item._id,undefined); assert.equal(item.ticketStatus,'written');
  assert.equal(new Order({items:[{priceAdult:50}]}).items[0].ticketStatus,'none');
  assert.ok(new Order({items:[{ticketStatus:'bad'}]}).validateSync());
});
test('cấu hình quyền có đủ chín quyền thẻ không trùng và nhãn tiếng Việt', () => {
  const list=require('../config/permission').permissionList;
  for (const name of ['view','issue','edit','lock','revoke','reset-pin','topup','checkin','log-view']) {
    const found=list.filter(p => p.value==='card-'+name); assert.equal(found.length,1); assert.match(found[0].label,/[À-ỹ]/u);
  }
});

test('không cho null vô hiệu hóa trạng thái, nonce.used hoặc hạn TTL', () => {
  for(const doc of [card({status:null}),tx({status:null}),new Customer({email:'test@example.invalid',status:null}),new Operation({cardId,type:'credit',actorType:'system',status:null}),new Operation({cardId,type:'credit',actorType:'system',expireAt:null}),new Nonce({nonce:'ab'.repeat(16),purpose:'login-customer',expireAt:null}),new Nonce({nonce:'ab'.repeat(16),purpose:'login-customer',used:null})]) assert.ok(doc.validateSync());
});

test('hex lưu thống nhất chữ hoa với helper giao thức Task1', () => {
  assert.equal(card().cardId,'AB'.repeat(16));
  assert.equal(card({publicKeyModulus:modulus,replaceOf:cardId}).publicKeyModulus,'CD'.repeat(128));
  assert.equal(card({replaceOf:cardId}).replaceOf,'AB'.repeat(16));
  assert.equal(tx().txRef,'AB'.repeat(8));
  assert.equal(tx().cardId,'AB'.repeat(16));
  assert.equal(new Nonce({nonce:cardId,purpose:'step-up'}).nonce,'AB'.repeat(16));
  assert.equal(new Operation({cardId,type:'credit',actorType:'system',challenge:cardId}).challenge,'AB'.repeat(16));
  assert.equal(new Order({cardTxRef:'ab'.repeat(8)}).cardTxRef,'AB'.repeat(8));
});
