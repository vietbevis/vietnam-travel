const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const db=require('../helpers/db');
const Card=require('../../models/card.model');
const Tx=require('../../models/card-transaction.model');
const Order=require('../../models/order.model');
const stats=require('../../helpers/card-stats.helper');
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
const DAY=86400000;
const tourA='0123456789abcdef01234567',tourB='76543210fedcba9876543210';
let seq=0;
before(async()=>{if(db.enabled){await db.connect();await Promise.all([Card,Tx,Order].map(m=>m.init()));}});
after(async()=>{if(db.enabled)await db.close();});
beforeEach(async()=>{if(db.enabled){await db.reset();seq=0;}});
const hex=(n,len)=>(n.toString(16).toUpperCase()).padStart(len,'0');
async function card(status){seq++;return Card.create({cardId:hex(seq,32),cardType:'customer',ownerId:'owner'+seq,status,publicKeyModulus:'AB'.repeat(128)});}
async function tx(over){seq++;const doc=await Tx.create({txRef:hex(seq,16),cardId:'A'.repeat(32),type:'debit',source:'order',amount:1000,status:'done',...over.fields});
  if(over.createdAt)await Tx.collection.updateOne({_id:doc._id},{$set:{createdAt:over.createdAt}});return doc;}
async function order(items,over={}){seq++;return Order.create({orderCode:'OD'+seq,deleted:false,paymentStatus:'paid',status:'initial',items,...over});}
const item=(tourId,name,departureDate,ticketStatus='none')=>({tourId,name,departureDate,ticketStatus,quantityAdult:1});

it('monthBoundsVN tính đúng đầu/cuối tháng giờ Việt Nam',()=>{
  // 2026-11-30T17:30Z = 2026-12-01 00:30 VN
  const b=stats.monthBoundsVN(new Date('2026-11-30T17:30:00Z'));
  assert.equal(b.start.toISOString(),'2026-11-30T17:00:00.000Z');
  assert.equal(b.end.toISOString(),'2026-12-31T17:00:00.000Z');
  const dec=stats.monthBoundsVN(new Date('2026-12-15T00:00:00Z'));
  assert.equal(dec.end.toISOString(),'2026-12-31T17:00:00.000Z');
});

it('byStatus đếm thẻ active/locked/revoked',async()=>{
  await card('active');await card('active');await card('locked');await card('revoked');await card('failed');
  const s=await stats.cardStats(new Date());
  assert.deepEqual(s.byStatus,{active:2,locked:1,revoked:1});
});

it('walletRevenueMonth chỉ tính debit/order/done trong tháng hiện tại giờ VN',async()=>{
  const now=new Date('2026-11-15T05:00:00Z');
  await tx({fields:{amount:100},createdAt:new Date('2026-11-30T16:59:00Z')}); // 30/11 23:59 VN: trong tháng
  await tx({fields:{amount:200},createdAt:new Date('2026-10-31T17:10:00Z')}); // 01/11 00:10 VN: trong tháng
  await tx({fields:{amount:400},createdAt:new Date('2026-10-31T16:30:00Z')}); // 31/10 23:30 VN: loại
  await tx({fields:{amount:800},createdAt:new Date('2026-11-30T17:10:00Z')}); // 01/12 00:10 VN: loại
  await tx({fields:{amount:1600,source:'cash',type:'credit'},createdAt:new Date('2026-11-10T00:00:00Z')});
  await tx({fields:{amount:3200,status:'failed'},createdAt:new Date('2026-11-10T00:00:00Z')});
  await tx({fields:{amount:6400,source:'refund'},createdAt:new Date('2026-11-10T00:00:00Z')});
  await tx({fields:{amount:12800,type:'credit'},createdAt:new Date('2026-11-10T00:00:00Z')});
  assert.equal((await stats.cardStats(now)).walletRevenueMonth,300);
  assert.equal((await stats.cardStats(new Date('2026-12-02T00:00:00Z'))).walletRevenueMonth,800);
});

it('walletRevenueMonth bằng 0 khi không có giao dịch',async()=>{assert.equal((await stats.cardStats(new Date())).walletRevenueMonth,0);});

it('checkinRate nhóm theo tour+ngày, chỉ đơn paid chưa huỷ, trong ±7 ngày',async()=>{
  const now=new Date('2026-11-15T05:00:00Z');
  const d1=new Date(now.getTime()+2*DAY),d2=new Date(now.getTime()-3*DAY);
  await order([item(tourA,'Tour A',d1,'written'),item(tourB,'Tour B',d2,'used')]);
  await order([item(tourA,'Tour A',d1,'used')]);
  await order([item(tourA,'Tour A',d1,'none')]);
  await order([item(tourA,'Tour A',d1,'pending')]);
  await order([item(tourA,'Tour A',d1,'written')],{paymentStatus:'unpaid'});
  await order([item(tourA,'Tour A',d1,'written')],{status:'cancel'});
  await order([item(tourA,'Tour A',d1,'written')],{deleted:true});
  await order([item(tourA,'Tour A',new Date(now.getTime()+8*DAY),'written')]);
  await order([item(tourA,'Tour A',new Date(now.getTime()-8*DAY),'written')]);
  const rows=(await stats.cardStats(now)).checkinRate;
  assert.equal(rows.length,2);
  // sắp xếp theo ngày khởi hành giảm dần: d1 trước d2
  assert.deepEqual(rows.map(r=>[r.tourName,r.written,r.used,r.total]),[['Tour A',2,1,4],['Tour B',1,1,1]]);
  assert.equal(new Date(rows[0].departureDate).getTime(),d1.getTime());
});

it('dashboard chỉ có cardStats khi có quyền card-view',async()=>{
  await card('active');
  const ctrl=require('../../controllers/admin/dashboard.controller');
  const run=async permissions=>{let out;await ctrl.dashboard({permissions},{render:(view,data)=>{out=data;}});return out;};
  const withView=await run(['dashboard-view','card-view']);
  assert.equal(withView.cardStats.byStatus.active,1);
  assert.equal(withView.overview.totalAdmin,0);
  const without=await run(['dashboard-view']);
  assert.equal('cardStats' in without,false);
  assert.ok(without.overview);
});
