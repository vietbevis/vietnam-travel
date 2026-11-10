const mongoose = require('mongoose');
const Order = require('../models/order.model');
const Customer = require('../models/customer.model');
const validAmount = value => Number.isSafeInteger(value) && value > 0;
const objectId = value => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
function safeFilter(filter,method) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter) || ![Object.prototype,null].includes(Object.getPrototypeOf(filter)))
    return null;
  if (!['zalopay','vnpay','card'].includes(method))
    return null;
  if (Object.keys(filter).some(key=>!['_id','phone','deleted','total'].includes(key)))
    return null;
  const id = filter._id instanceof mongoose.Types.ObjectId ? filter._id.toString() : filter._id;
  if (!objectId(id))
    return null;
  if ('phone' in filter && (typeof filter.phone !== 'string' || !filter.phone))
    return null;
  if ('deleted' in filter && filter.deleted !== false)
    return null;
  if ('total' in filter && !validAmount(filter.total))
    return null;
  return {
    ...filter,
    _id:id,
    paymentMethod:method,
    deleted:false,
    status:{$ne:'cancel'},
    paymentStatus:'unpaid'
  };
}
function customerMatch(order) {
  return Object.hasOwn(order,'customerId') ? order.customerId : {$exists:false};
}
function paidUpdate(tickets) {
  if (!tickets)
    return {$set:{paymentStatus:'paid'}};
  // Pipeline sửa một document, giữ toàn bộ trường legacy và trạng thái vé đã xử lý.
  return [{
    $set: {
      paymentStatus: 'paid',
      items: {
        $map: {
          input: {$ifNull: ['$items', []]},
          as: 'item',
          in: {
            $cond: [
              {$or: [
                {$eq: ['$$item.ticketStatus', 'none']},
                {$eq: [{$type: '$$item.ticketStatus'}, 'missing']}
              ]},
              {$mergeObjects: ['$$item', {ticketStatus: 'pending'}]},
              '$$item'
            ]
          }
        }
      }
    }
  }];
}
async function markOrderPaidInSession(filter,method,session) {
  if (!session?.inTransaction())
    throw new Error('Settlement yêu cầu transaction của caller.');
  const base=safeFilter(filter,method);
  if (!base)
    return false;
  return settleLinked(base,session);
}
// Cả wrapper cũ và engine dùng một chính sách paid/vé/chi tiêu trong session.
async function settleLinked(compare,session) {
  const current=await Order.findOne(compare).session(session).lean();
  if (!current || !validAmount(current.total))
    return false;
  if (!objectId(current.customerId))
    throw new Error('Khách hàng thanh toán không hợp lệ.');
  const owner=await Customer.findOne({_id:current.customerId,deleted:false}).session(session).lean();
  if (!owner || !Number.isSafeInteger(owner.totalSpent) || owner.totalSpent<0 || !Number.isSafeInteger(owner.totalSpent+current.total))
    throw new Error('Không thể cập nhật chi tiêu khách hàng.');
  const paid=await Order.findOneAndUpdate({...compare,total:current.total,customerId:current.customerId},paidUpdate(true),{session,new:true});
  if (!paid)
    return false;
  const result=await Customer.updateOne({_id:owner._id,deleted:false,totalSpent:owner.totalSpent},{$inc:{totalSpent:current.total}},{session,runValidators:true});
  if(result.modifiedCount!==1)
    throw new Error('Không thể cập nhật chi tiêu khách hàng.');
  return true;
}
module.exports.markOrderPaidInSession=markOrderPaidInSession;
module.exports.markOrderPaid = async (filter,method) => {
  const base = safeFilter(filter,method);
  if (!base)
    return false;
  const order = await Order.findOne(base).lean();
  if (!order || !validAmount(order.total))
    return false;
  const compare = {...base,total:order.total,customerId:customerMatch(order)};
  if (!order.customerId) {
    return !!await Order.findOneAndUpdate(compare,paidUpdate(false),{new:true});
  }
  // Không hạ cấp sang hai update rời: standalone phải từ chối trước mọi ghi persisted.
  const hello = await Order.db.db.admin().command({hello:1});
  if (!hello.setName && hello.msg !== 'isdbgrid')
    throw new Error('Thanh toán liên kết khách hàng yêu cầu MongoDB replica set/transaction.');
  const session = await Order.db.startSession();
  let transitioned = false;
  try {
    await session.withTransaction(async()=> {
      transitioned = false;
      transitioned = await settleLinked(compare,session);
    });
    return transitioned;
  }
  finally {
    await session.endSession();
  }
};
