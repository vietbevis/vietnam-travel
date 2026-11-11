const Card=require('../models/card.model');
const Tx=require('../models/card-transaction.model');
const Order=require('../models/order.model');
const DAY=86400000,VN_OFFSET=420*60000;
// Đầu/cuối tháng hiện tại theo giờ Asia/Ho_Chi_Minh (UTC+7, không DST); trả về [start, end) dạng Date UTC.
function monthBoundsVN(now=new Date()) {
  const vn=new Date(new Date(now).getTime()+VN_OFFSET);
  const y=vn.getUTCFullYear(),m=vn.getUTCMonth();
  const pad=n=>String(n).padStart(2,'0');
  const next=m===11?[y+1,0]:[y,m+1];
  return{
    start:new Date(Date.parse(y+'-'+pad(m+1)+'-01T00:00:00+07:00')),
    end:new Date(Date.parse(next[0]+'-'+pad(next[1]+1)+'-01T00:00:00+07:00'))
  };
}
// Thống kê thẻ cho dashboard (A11).
// - byStatus: số thẻ active/locked/revoked.
// - walletRevenueMonth: tổng debit source 'order' status 'done' tạo trong tháng hiện tại (giờ VN).
// - checkinRate: mỗi (tour, ngày khởi hành VN) có item của đơn đã thanh toán, chưa huỷ, khởi hành trong [now-7d, now+7d].
//   total = số vé của đơn; written = vé đang ở trên thẻ (written hoặc used); used = vé đã check-in.
async function cardStats(now=new Date()) {
  const {start,end}=monthBoundsVN(now);
  const [statusRows,revenueRows,rateRows]=await Promise.all([
    Card.aggregate([{$match:{status:{$in:['active','locked','revoked']}}},{$group:{_id:'$status',count:{$sum:1}}}]),
    Tx.aggregate([{$match:{type:'debit',source:'order',status:'done',createdAt:{$gte:start,$lt:end}}},{$group:{_id:null,total:{$sum:'$amount'}}}]),
    Order.aggregate([
      {$match:{deleted:false,paymentStatus:'paid',status:{$ne:'cancel'}}},
      {$unwind:'$items'},
      {$match:{'items.departureDate':{$gte:new Date(now.getTime()-7*DAY),$lte:new Date(now.getTime()+7*DAY)}}},
      {$group:{
        _id:{tourId:'$items.tourId',day:{$dateToString:{format:'%Y-%m-%d',date:'$items.departureDate',timezone:'+07:00'}}},
        tourName:{$first:'$items.name'},
        departureDate:{$first:'$items.departureDate'},
        total:{$sum:1},
        written:{$sum:{$cond:[{$in:['$items.ticketStatus',['written','used']]},1,0]}},
        used:{$sum:{$cond:[{$eq:['$items.ticketStatus','used']},1,0]}}
      }},
      {$sort:{departureDate:-1,tourName:1}}
    ])
  ]);
  const byStatus={active:0,locked:0,revoked:0};
  for(const row of statusRows) byStatus[row._id]=row.count;
  return{
    byStatus,
    walletRevenueMonth:revenueRows[0]?.total??0,
    checkinRate:rateRows.map(r=>({tourName:r.tourName||String(r._id.tourId),departureDate:r.departureDate,total:r.total,written:r.written,used:r.used}))
  };
}
module.exports={monthBoundsVN,cardStats};
