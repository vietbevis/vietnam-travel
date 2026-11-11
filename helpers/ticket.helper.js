const Order=require('../models/order.model');
const Card=require('../models/card.model');
const A=require('./card-apdu.helper');
const cardLog=require('./card-log.helper');
const id=value=>typeof value==='string' && /^[a-fA-F0-9]{24}$/.test(value);
function ticketData(order,index) {
  const item=order.items?.[index];
  if(!item)
    throw new Error('INVALID_TICKET');
  const pax=['quantityAdult','quantityChildren','quantityBaby'].reduce((sum,k)=>sum+(item[k]??0),0);
  if(!Number.isSafeInteger(pax)||pax<1||pax>255)
    throw new Error('INVALID_PAX');
  return{
    orderCode:order.orderCode,
    tourId:String(item.tourId),
    departureDate:item.departureDate,
    pax
  };
}
// Cửa sổ check-in: [ngày khởi hành − 1 ngày, hết ngày khởi hành], giờ Asia/Ho_Chi_Minh (UTC+7, không có DST).
function isWithinCheckinWindow(departureDate,now=new Date()) {
  const departure=new Date(departureDate),current=new Date(now).getTime();
  if(!Number.isFinite(departure.getTime())||!Number.isFinite(current))
    return false;
  const day=new Date(departure.getTime()+420*60000).toISOString().slice(0,10);
  const start=Date.parse(day+'T00:00:00+07:00')-86400000,end=Date.parse(day+'T23:59:59.999+07:00');
  return current>=start&&current<=end;
}
// Huỷ đơn: written -> pending-delete (xoá khỏi thẻ ở lần đồng bộ sau), pending -> none.
// Ngoại lệ đối soát: pending nhưng đã từng được ký lệnh ghi (writeSignedAt) thì thẻ có thể đã nhận vé
// (mất confirm / đóng tab sau khi ghi), nên chuyển pending-delete để không bỏ sót vé trên thẻ.
function statusOnCancel(ticketStatus,item) {
  if(ticketStatus==='written')
    return'pending-delete';
  if(ticketStatus==='pending')
    return item?.writeSignedAt?'pending-delete':'none';
  return ticketStatus;
}
// Áp statusOnCancel cho mọi item bằng một update pipeline trên đúng một document (nguyên tử, không cần
// transaction và vẫn chạy được với đơn legacy). Idempotent: lần gọi lại không còn gì để đổi, không ghi log.
async function onOrderCancelled(order,actorId) {
  const orderId=order?._id??order?.id;
  if(!orderId)
    return;
  const before=await Order.findOneAndUpdate({_id:orderId,status:'cancel','items.ticketStatus':{$in:['written','pending']}},[{
    $set:{items:{$map:{input:'$items',as:'item',in:{$cond:[
      {$eq:['$$item.ticketStatus','written']},
      {$mergeObjects:['$$item',{ticketStatus:'pending-delete'}]},
      {$cond:[
        {$eq:['$$item.ticketStatus','pending']},
        {$mergeObjects:['$$item',{ticketStatus:{$cond:[{$ifNull:['$$item.writeSignedAt',false]},'pending-delete','none']}}]},
        '$$item'
      ]}
    ]}}}}
  }],{new:false}).lean();
  if(!before)
    return;
  const changes=before.items.map((item,itemIndex)=>({itemIndex,from:item.ticketStatus,to:statusOnCancel(item.ticketStatus,item)})).filter(c=>c.from!==c.to);
  if(!changes.length)
    return;
  const card=before.customerId?await Card.findOne({ownerId:before.customerId,cardType:'customer',isCurrent:true}).select('cardId').lean():null;
  await cardLog.write({action:'ticket-order-cancel',cardId:card?.cardId,actorType:'admin',actorId,result:'success',detail:{orderCode:before.orderCode,changes}});
}
async function loadItem(card,params,type,session) {
  if(!id(params.orderId)||!Number.isSafeInteger(params.itemIndex)||params.itemIndex<0)
    throw new Error('INVALID_TICKET');
  const order=await Order.findOne({_id:params.orderId,customerId:card.ownerId,deleted:false}).session(session||null).lean();
  const item=order?.items?.[params.itemIndex];
  const valid=type==='delete-ticket'?order?.status==='cancel'&&item?.ticketStatus==='pending-delete':order?.status!=='cancel'&&order?.paymentStatus==='paid'&&item?.ticketStatus===(type==='write-ticket'?'pending':'written');
  if(!valid)
    throw new Error('INVALID_TICKET_STATE');
  const data=validatedData(order,params.itemIndex,type);
  if(type==='use-ticket'&&!isWithinCheckinWindow(data.departureDate,new Date()))
    throw new Error('CHECKIN_WINDOW');
  return{order,item,data};
}
function validatedData(order,index,type) {
  const data=ticketData(order,index);
  type==='write-ticket'?A.encodeTicket(data):A.ticketKey(data);
  return data;
}
async function pendingItem(card,type) {
  const deleting=type==='delete-ticket';
  const orders=await Order.find({
    customerId:card.ownerId,
    deleted:false,
    status:deleting?'cancel':{$ne:'cancel'},
    ...(!deleting?{paymentStatus:'paid'}:{}),
    'items.ticketStatus':deleting?'pending-delete':'pending'
  }).sort({createdAt:1,_id:1}).lean();
  for(
  const order
  of orders) {
    for(let itemIndex=0;itemIndex<order.items.length;itemIndex++) {
      if(order.items[itemIndex].ticketStatus!==(deleting?'pending-delete':'pending'))
        continue;
      try {
        validatedData(order,itemIndex,type);
        return{orderId:String(order._id),itemIndex};
      }
      catch {
      }
    }
  }
  return null;
}
module.exports={loadItem,pendingItem,ticketData,isWithinCheckinWindow,statusOnCancel,onOrderCancelled};
