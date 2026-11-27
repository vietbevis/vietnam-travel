const Card=require('../../models/card.model');
const Customer=require('../../models/customer.model');
const Order=require('../../models/order.model');
const E=require('../../helpers/card-op.helper');
const ticket=require('../../helpers/ticket.helper');
const cardLog=require('../../helpers/card-log.helper');
const V=require('../../validates/admin/card.validate');
const { ticketStatusLabel } = require('../../helpers/card-presentation.helper');
const MSG={
  forbidden:'Bạn không có quyền sử dụng tính năng này!',
  input:'Dữ liệu check-in không hợp lệ.',
  card:'Thẻ không hoạt động hoặc không phải thẻ khách hàng.',
  window:'Chưa tới hoặc đã qua ngày check-in',
  used:'Vé đã sử dụng',
  notWritten:'Vé chưa được ghi lên thẻ, hãy đồng bộ trước',
  gone:'Vé không còn hiệu lực trên thẻ.',
  order:'Đơn hàng chưa thanh toán, đã huỷ hoặc không thuộc chủ thẻ.',
  item:'Không tìm thấy vé trong đơn hàng.'
};
function fail(status,message,errorCode='CHECKIN') {
  throw Object.assign(new Error(message),{status,errorCode});
}
function reply(res,error) {
  const known=error.status&&error.errorCode;
  // CardOpError từ engine mang code OP_*; không lộ chi tiết nội bộ.
  res.status(known?error.status:error.code?.startsWith?.('OP_')?409:500).json({code:'error',message:known?error.message:'Không thể xử lý check-in.'});
}
function requireCheckin(req) {
  if(!req.cardActor?.permissions.includes('card-checkin'))
    fail(403,MSG.forbidden,'FORBIDDEN');
}
const pax=item=>['quantityAdult','quantityChildren','quantityBaby'].reduce((sum,k)=>sum+(Number(item[k])||0),0);
const ticketDay = date => new Date(new Date(date).getTime() + 7 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
async function activeCustomerCard(cardId) {
  const card=await Card.findOne({cardId:cardId.toUpperCase(),cardType:'customer',status:'active',isCurrent:true}).lean();
  if(!card)
    fail(409,MSG.card,'CARD_STATE');
  return card;
}
async function audit(action,req,cardId,result,detail) {
  await cardLog.write({action,cardId,actorType:'admin',actorId:req.cardActor?.id,result,detail,req});
}
// Trang check-in: chọn tour có ngày khởi hành trong cửa sổ, xem danh sách khách đã đặt.
module.exports.page=async(req,res)=>{
  try{
    requireCheckin(req);
    const now=new Date();
    const orders=await Order.find({
      deleted:false,
      paymentStatus:'paid',
      status:{$ne:'cancel'},
      'items.departureDate':{$gte:new Date(now.getTime()-3*86400000),$lte:new Date(now.getTime()+4*86400000)}
    }).sort({createdAt:1,_id:1}).lean();
    const tours=new Map(),bookings=[];
    const selected=typeof req.query.tourId==='string'&&/^[a-fA-F0-9]{24}$/.test(req.query.tourId)?req.query.tourId:'';
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim().slice(0, 120) : '';
    for(const order of orders) {
      for(const item of order.items) {
        if(!ticket.isWithinCheckinWindow(item.departureDate,now))
          continue;
        const tourId=String(item.tourId);
        if(!tours.has(tourId))
          tours.set(tourId,{tourId,name:item.name||tourId,departureDate:item.departureDate});
        if(tourId===selected)
          bookings.push({orderCode:order.orderCode,fullName:order.fullName,phone:order.phone,pax:pax(item),ticketStatus:item.ticketStatus||'none',checkedInAt:item.checkedInAt,departureDate:item.departureDate,checkinPending:Boolean(item.checkinOpId)});
      }
    }
    const checkedIn = bookings.filter(booking => booking.ticketStatus === 'used').length;
    const summary = { tickets: bookings.length, passengers: bookings.reduce((total, booking) => total + booking.pax, 0), checkedIn };
    const search = keyword.toLocaleLowerCase('vi-VN');
    const visibleBookings = bookings.filter(booking => [booking.orderCode, booking.fullName, booking.phone]
      .some(value => (value || '').toLocaleLowerCase('vi-VN').includes(search)));
    res.render('admin/pages/card-checkin',{pageTitle:'Check-in tour',tours:[...tours.values()],selected,bookings:visibleBookings,summary,keyword,ticketStatusLabel});
  }catch(error){
    // Trang GET thiếu quyền hiển thị trong layout quản trị, không trả JSON thô.
    if(error.errorCode==='FORBIDDEN' && req.accepts(['html','json']) === 'html')return res.status(403).render('admin/pages/no-permission',{pageTitle:'Không có quyền truy cập',message:MSG.forbidden});
    reply(res,error);
  }
};
module.exports.lookupPost=async(req,res)=>{
  let cardId;
  try{
    requireCheckin(req);
    const {error,value:body}=V.schemas.checkinLookup.validate(req.body,{convert:false});
    if(error)fail(400,MSG.input,'INVALID_INPUT');
    cardId=body.cardId.toUpperCase();
    const card=await activeCustomerCard(body.cardId);
    const customer=await Customer.findOne({_id:card.ownerId,deleted:false}).lean();
    if(!customer)fail(409,MSG.card,'OWNER_STATE');
    const orders=await Order.find({customerId:card.ownerId,deleted:false,paymentStatus:'paid',status:{$ne:'cancel'},'items.tourId':body.tourId}).sort({createdAt:1,_id:1}).lean();
    const found=[];
    orders.forEach(order=>order.items.forEach((item,itemIndex)=>{
      if(String(item.tourId)===body.tourId)found.push({order,item,itemIndex});
    }));
    const inWindow=found.filter(entry=>ticket.isWithinCheckinWindow(entry.item.departureDate,new Date()));
    if(found.length&&!inWindow.length)fail(409,MSG.window,'CHECKIN_WINDOW');
    const counts = new Map();
    for (const {order} of found) counts.set(order.orderCode, (counts.get(order.orderCode) || 0) + 1);
    const items=inWindow.map(({order,item,itemIndex})=>({orderId:String(order._id),itemIndex,orderCode:order.orderCode,pax:pax(item),ticketStatus:item.ticketStatus||'none',departure:ticketDay(item.departureDate),ambiguous:counts.get(order.orderCode)>1,checkinPending:Boolean(item.checkinOpId)}));
    await audit('checkin-lookup',req,cardId,'success',{tourId:body.tourId,items:items.length});
    res.json({code:'success',customer:{fullName:customer.fullName,phone:customer.phone,bloodType:customer.bloodType,allergies:customer.allergies},items});
  }catch(error){
    await audit('checkin-lookup',req,cardId,'fail',{errorCode:error.errorCode||'INTERNAL'});
    reply(res,error);
  }
};
module.exports.usePost=async(req,res)=>{
  let cardId;
  try{
    requireCheckin(req);
    const {error,value:body}=V.schemas.checkinUse.validate(req.body,{convert:false});
    if(error)fail(400,MSG.input,'INVALID_INPUT');
    cardId=body.cardId.toUpperCase();
    const card=await activeCustomerCard(body.cardId);
    const order=await Order.findOne({_id:body.orderId,customerId:card.ownerId,deleted:false}).lean();
    if(!order||order.paymentStatus!=='paid'||order.status==='cancel')fail(409,MSG.order,'ORDER_STATE');
    const item=order.items[body.itemIndex];
    if(!item)fail(404,MSG.item,'ITEM_NOT_FOUND');
    if (item.checkinOpId) fail(409, 'Vé đang chờ đối soát kết quả check-in.', 'CHECKIN_PENDING');
    if (order.items.filter(candidate => String(candidate.tourId) === String(item.tourId)).length > 1) {
      fail(409, 'Có nhiều mục cùng mã vé trên một đơn. Nhân viên cần đối soát trước khi check-in.', 'AMBIGUOUS_TICKET');
    }
    if(item.ticketStatus==='used')fail(409,MSG.used,'TICKET_USED');
    if(['none','pending'].includes(item.ticketStatus||'none'))fail(409,MSG.notWritten,'TICKET_NOT_WRITTEN');
    if(item.ticketStatus!=='written')fail(409,MSG.gone,'TICKET_GONE');
    if(!ticket.isWithinCheckinWindow(item.departureDate,new Date()))fail(409,MSG.window,'CHECKIN_WINDOW');
    const op=await E.createOp({cardId:card.cardId,type:'use-ticket',params:{orderId:body.orderId,itemIndex:body.itemIndex},actorType:'admin',actorId:req.cardActor.id});
    await audit('checkin-use',req,card.cardId,'success',{opId:String(op.id),orderCode:order.orderCode,itemIndex:body.itemIndex});
    res.json({code:'success',opId:String(op.id)});
  }catch(error){
    await audit('checkin-use',req,cardId,'fail',{errorCode:error.errorCode||error.code||'INTERNAL'});
    reply(res,error);
  }
};
