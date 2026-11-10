const Order=require('../models/order.model');
const A=require('./card-apdu.helper');
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
async function loadItem(card,params,type,session) {
  if(!id(params.orderId)||!Number.isSafeInteger(params.itemIndex)||params.itemIndex<0)
    throw new Error('INVALID_TICKET');
  const order=await Order.findOne({_id:params.orderId,customerId:card.ownerId,deleted:false}).session(session||null).lean();
  const item=order?.items?.[params.itemIndex];
  const valid=type==='delete-ticket'?order?.status==='cancel'&&item?.ticketStatus==='pending-delete':order?.status!=='cancel'&&order?.paymentStatus==='paid'&&item?.ticketStatus===(type==='write-ticket'?'pending':'written');
  if(!valid)
    throw new Error('INVALID_TICKET_STATE');
  const data=validatedData(order,params.itemIndex,type);
  if(type==='use-ticket') {
    const departure=new Date(data.departureDate);
    const day=new Date(departure.getTime()+420*60000).toISOString().slice(0,10);
    const start=Date.parse(day+'T00:00:00+07:00')-86400000,end=Date.parse(day+'T23:59:59.999+07:00');
    if(Date.now()<start||Date.now()>end)
      throw new Error('CHECKIN_WINDOW');
  }
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
module.exports={loadItem,pendingItem,ticketData};
