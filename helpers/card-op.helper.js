const mongoose=require('mongoose');
const crypto=require('node:crypto');
const Card=require('../models/card.model');
const Tx=require('../models/card-transaction.model');
const Op=require('../models/card-operation.model');
const Customer=require('../models/customer.model');
const Order=require('../models/order.model');
const Account=require('../models/account-admin.model');
const Role=require('../models/role.model');
const A=require('./card-apdu.helper');
const C=require('./card-crypto.helper');
const tickets=require('./ticket.helper');
const settlement=require('./order-payment.helper');
const log=require('./card-log.helper');
const mail=require('./mail.helper');
const S=require('../public/assets/js/card/card-shared');
class CardOpError extends Error{
  constructor(code) {
    super(code);
    this.code=code;
  }
}
const fail=code=> {
  throw new CardOpError(code);
};
const objectId=x=>typeof x==='string'&&/^[a-fA-F0-9]{24}$/.test(x);
const hex=(x,n)=>typeof x==='string'&&new RegExp(`^[a-fA-F0-9]{${n}}$`).test(x);
const syncTypes=['set-state','credit','delete-ticket','write-ticket'];
const profileFields=['fullName','dob','gender','phone','idNumber','emergencyName','emergencyPhone','bloodType','allergies'];
function profileData(customer,update) {
  const profile={...customer,...update};
  if(profile.dob instanceof Date)profile.dob=profile.dob.toISOString().slice(0,10).replace(/-/g,'');
  return profile;
}
function boundActor(op) {
  if(op.actorType!=='system'||op.type==='set-state')
    return null;
  const binding=/^(customer|admin):([a-fA-F0-9]{24})$/.exec(op.actorId||'');
  if(!binding)
    fail('OP_FORBIDDEN');
  return{actorType:binding[1],actorId:binding[2]};
}
function actorCheck(op,actor) {
  if(op.actorType==='system') {
    if(!syncTypes.includes(op.type))
      fail('OP_FORBIDDEN');
    const binding=boundActor(op);
    if(binding&&(actor.actorType!==binding.actorType||actor.actorId!==binding.actorId))
      fail('OP_FORBIDDEN');
    return;
  }
  if(actor.actorType!==op.actorType||String(actor.actorId)!==op.actorId)
    fail('OP_FORBIDDEN');
}
async function bindingPolicy(card,op,session) {
  const binding=boundActor(op);
  if(!binding)
    return;
  if(binding.actorType==='customer') {
    if(card.cardType!=='customer'||card.ownerId!==binding.actorId||!await Customer.exists({_id:binding.actorId,deleted:false,status:'active'}).session(session))
      fail('OP_FORBIDDEN');
  }
  else {
    const admin=await Account.findOne({_id:binding.actorId,status:'active',deleted:false}).session(session).lean();
    const permission=op.type==='credit'?'card-topup':'card-edit';
    if(!admin||!objectId(admin.role)||!await Role.exists({_id:admin.role,deleted:false,permissions:permission}).session(session))
      fail('OP_FORBIDDEN');
  }
}
async function transaction(fn) {
  const session=await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async()=> {
      result=await fn(session);
    });
    return result;
  }
  finally {
    await session.endSession();
  }
}
async function loadOp(opId,actor,session,status) {
  if(!objectId(String(opId)))
    fail('OP_NOT_FOUND');
  const op=await Op.findById(opId).session(session).lean();
  if(!op)
    fail('OP_NOT_FOUND');
  actorCheck(op,actor);
  if(op.status!==status||op.expireAt<=new Date()) {
    if(op.expireAt<=new Date())
      await Op.updateOne({_id:op._id},{$unset:{'params.encryptedPin':1,'params.newPin':1}}).session(session);
    fail('OP_STATE');
  }
  return op;
}
async function policy(card,op,session,creating=false) {
  // Cho tạo op nháp trước INIT; bước ký và xác nhận vẫn bắt buộc modulus.
  const issuanceDraft=creating&&card?.status==='issuing'&&card.isCurrent&&op.type==='commit-write'&&op.actorType==='admin'&&op.actorId===card.issuedBy;
  if(!card||card.isCurrent!==['issuing','active','locked'].includes(card.status)||!card.publicKeyModulus&&!issuanceDraft)
    fail('CARD_STATE');
  if(op.actorType==='system'&&!syncTypes.includes(op.type))
    fail('OP_FORBIDDEN');
  await bindingPolicy(card,op,session);
  if(op.actorType==='customer'&&(card.cardType!=='customer'||card.ownerId!==op.actorId||!['credit','debit','commit-write'].includes(op.type)))
    fail('OP_FORBIDDEN');
  if(op.type==='set-state') {
    if(op.actorType==='customer'||op.params.state!==({active:2,locked:3,revoked:127})[card.status])
      fail('CARD_STATE');
    return{};
  }
  const issuing=card.status==='issuing'&&op.type==='commit-write'&&op.actorType==='admin'&&op.actorId===card.issuedBy;
  if(issuing){
    const stored=await Card.findById(card._id).select('+issuance').session(session).lean();
    if(!stored?.issuance||!(stored.issuance.expireAt>new Date())||!creating&&![stored.issuance.profileOpId,stored.issuance.photoOpId].includes(String(op._id)))fail('CARD_STATE');
  }
  if(!issuing&&(card.status!=='active'||!card.isCurrent))
    fail('CARD_STATE');
  if(op.type==='credit'||op.type==='debit') {
    if(card.cardType!=='customer'||!hex(op.params.txRef,16))
      fail('CARD_STATE');
    const tx=await Tx.findOne({txRef:op.params.txRef.toUpperCase(),cardId:card.cardId,type:op.type}).session(session).lean();
    if(!tx||!['pending-card','sent','failed'].includes(tx.status)||!Number.isSafeInteger(tx.amount)||tx.amount<1||tx.amount>50000000)
      fail('OP_STATE');
    if(tx.type==='debit') {
      if(tx.source!=='order'||!objectId(tx.orderId))
        fail('OP_STATE');
      const order=await Order.findOne({
        _id:tx.orderId,
        customerId:card.ownerId,
        paymentStatus:'unpaid',
        paymentMethod:'card',
        total:tx.amount,
        status:{$ne:'cancel'},
        deleted:false
      }).session(session).lean();
      if(!order||order.cardTxRef!==tx.txRef)
        fail('OP_STATE');
    }
    else
    if(!['cash','zalopay','vnpay','transfer'].includes(tx.source))
      fail('OP_STATE');
    return{tx};
  }
  if(op.type.endsWith('-ticket')) {
    if(card.cardType!=='customer'||op.actorType==='customer')
      fail('OP_FORBIDDEN');
    try {
      return await tickets.loadItem(card,op.params,op.type,session);
    }
    catch {
      fail('OP_STATE');
    }
  }
  if(op.type==='reset-pin') {
    if(op.actorType!=='admin'||!hex(op.params.encryptedPin,32))
      fail('OP_FORBIDDEN');
    return{};
  }
  if(op.type==='commit-write') {
    const p=op.params;
    if(![1,2].includes(p.target)||typeof p.dataHex!=='string'||!/^([a-fA-F0-9]{2})+$/.test(p.dataHex)||p.dataHex.length/2>(p.target===1?448:10080))
      fail('OP_STATE');
    if(op.actorType==='customer'&&p.target!==1)
      fail('OP_FORBIDDEN');
    const update=p.customerUpdate;
    if(update) {
      if(card.cardType!=='customer'||p.target!==1||typeof update!=='object'||Array.isArray(update)||Object.keys(update).some(k=>!profileFields.includes(k)||op.actorType==='customer'&&!['phone','emergencyName','emergencyPhone'].includes(k)))
        fail('OP_FORBIDDEN');
    }
    if(update||op.actorType==='customer') {
      const customer=await Customer.findOne({_id:card.ownerId,deleted:false}).session(session).lean();
      if(!customer)
        fail('OP_STATE');
      let encoded;
      try {
        encoded=Buffer.from(S.encodeProfile(profileData(customer,update)));
      }
      catch {
        fail('OP_STATE');
      }
      if(encoded.toString('hex').toUpperCase()!==p.dataHex.toUpperCase())
        fail('OP_STATE');
    }
    return{};
  }
  fail('OP_STATE');
}
function command(op,context) {
  const p=op.params;
  let ins,p1=0,payload=Buffer.alloc(0);
  switch(op.type){
    case'set-state':
    ins=S.INS.SET_STATE;
    p1=p.state;
    break;
    case'reset-pin':
    ins=S.INS.RESET_PIN;
    payload=Buffer.from(p.encryptedPin,'hex');
    break;
    case'credit':case'debit':
    ins=op.type==='credit'?S.INS.CREDIT:S.INS.DEBIT;
    payload=A.walletPayload(context.tx.txRef,context.tx.amount);
    break;
    case'write-ticket':case'use-ticket':case'delete-ticket':
    ins=({'write-ticket':S.INS.WRITE_TICKET,'use-ticket':S.INS.USE_TICKET,'delete-ticket':S.INS.DELETE_TICKET})[op.type];
    payload=op.type==='write-ticket'?A.encodeTicket(context.data):A.ticketKey(context.data);
    break;
    case'commit-write':
    ins=S.INS.COMMIT_WRITE;
    p1=p.target; {
      const data=Buffer.from(p.dataHex,'hex'),len=Buffer.alloc(2);
      len.writeUInt16BE(data.length);
      payload=Buffer.concat([crypto.createHash('sha256').update(data).digest(),len]);
    }
    break;
  }
  return{
    ins,
    p1,
    p2:0,
    payload
  };
}
async function createOp({cardId,type,params={},actorType,actorId}) {
  if(!hex(cardId,32)||!['admin','customer','system'].includes(actorType)||actorType!=='system'&&!objectId(actorId)||!params||typeof params!=='object'||Array.isArray(params))
    fail('OP_FORBIDDEN');
  if(actorType==='system'&&!syncTypes.includes(type))
    fail('OP_FORBIDDEN');
  const allowed=({
    'set-state':['state'],
    'reset-pin':['newPin'],
    credit:['txRef'],
    debit:['txRef'],
    'write-ticket':['orderId','itemIndex'],
    'use-ticket':['orderId','itemIndex'],
    'delete-ticket':['orderId','itemIndex'],
    'commit-write':['target','dataHex','customerUpdate']
  })[type];
  if(!allowed||Object.keys(params).some(k=>!allowed.includes(k)))
    fail('OP_STATE');
  params={...params};
  if(type==='reset-pin') {
    if(actorType!=='admin'||!S.isPinFormat(params.newPin)||S.isWeakPin(params.newPin))
      fail('OP_FORBIDDEN');
    params={encryptedPin:C.encryptResetPin(cardId,params.newPin).toString('hex')};
  }
  return transaction(async session=> {
    const card=await Card.findOne({cardId:cardId.toUpperCase()}).session(session).lean();
    const candidate={
      cardId:cardId.toUpperCase(),
      type,
      params,
      actorType,
      actorId
    };
    await policy(card,candidate,session,true);
    const [op]=await Op.create([candidate],{session});
    return op;
  });
}
async function signOp({opId,challengeHex,actorType,actorId}) {
  if(!hex(challengeHex,32))
    fail('OP_STATE');
  if(objectId(String(opId)))
    await Op.updateOne({_id:opId,expireAt:{$lte:new Date()}},{$unset:{'params.encryptedPin':1,'params.newPin':1}});
  return transaction(async session=> {
    const op=await loadOp(String(opId),{actorType,actorId},session,'draft');
    const card=await Card.findOne({cardId:op.cardId}).session(session).lean();
    const context=await policy(card,op,session);
    if(context.tx) {
      if(context.tx.status!=='pending-card'||context.tx.signedOpId)
        fail('OP_STATE');
      const unresolved=await Tx.exists({cardId:card.cardId,status:{$ne:'done'},$or:[{signedOpId:{$exists:true}},{status:'sent'}]}).session(session);
      if(unresolved)
        fail('OP_STATE');
      const update=await Tx.updateOne({_id:context.tx._id,status:'pending-card',signedOpId:{$exists:false}},{$set:{status:'sent',signedOpId:String(op._id),signedAt:new Date()}},{session});
      if(update.modifiedCount!==1)
        fail('OP_STATE');
    }
    const apdu=A.signedApdu({cardIdHex:card.cardId,challengeHex,...command(op,context)});
    // Cùng write-lock thẻ để ký hai giao dịch khác nhau không cùng thắng snapshot.
    await Card.updateOne({_id:card._id},{$inc:{__v:1},$set:{lastSeenAt:new Date()}},{session});
    const result=await Op.updateOne({_id:op._id,status:'draft',expireAt:{$gt:new Date()}},{$set:{status:'prepared',challenge:challengeHex}},{session});
    if(result.modifiedCount!==1)
      fail('OP_STATE');
    return{apdu};
  });
}
async function receiptInSession({card,tx,responseHex},session) {
  card=await Card.findOne({cardId:card.cardId}).session(session).lean();
  tx=await Tx.findOne({txRef:tx.txRef,cardId:card?.cardId}).session(session).lean();
  const r=A.parseReceipt(responseHex);
  if(!card||!tx||!tx.signedOpId||tx.status==='done'||!r||!C.verifyCardSignature(card.publicKeyModulus,r.message,r.signature)||r.cardId!==card.cardId||r.txRef!==tx.txRef||r.type!==tx.type||r.amount!==tx.amount||r.txCounter!==card.txCounter+1||r.balanceAfter!==card.balance+(tx.type==='credit'?tx.amount:-tx.amount)||r.balanceAfter<0||r.balanceAfter>50000000)
    return false;
  if(tx.type==='credit'&&!['cash','zalopay','vnpay','transfer'].includes(tx.source))
    return false;
  if(tx.type==='debit') {
    if(tx.source!=='order'||!objectId(tx.orderId))
      return false;
    const order=await Order.findOne({
      _id:tx.orderId,
      customerId:card.ownerId,
      total:tx.amount,
      paymentMethod:'card',
      paymentStatus:'unpaid',
      status:{$ne:'cancel'},
      deleted:false
    }).session(session).lean();
    if(!order||order.cardTxRef!==tx.txRef)
      return false;
    if(!await settlement.markOrderPaidInSession({_id:tx.orderId,total:tx.amount},'card',session))
      return false;
    await Order.updateOne({_id:tx.orderId},{$set:{cardTxRef:tx.txRef}},{session});
  }
  const c=await Card.updateOne({_id:card._id,txCounter:card.txCounter,balance:card.balance},{$set:{balance:r.balanceAfter,txCounter:r.txCounter}},{session,runValidators:true});
  if(c.modifiedCount!==1)
    fail('OP_STATE');
  const t=await Tx.updateOne({_id:tx._id,status:{$ne:'done'},signedOpId:tx.signedOpId},{$set:{
      status:'done',
      balanceAfter:r.balanceAfter,
      txCounter:r.txCounter,
      receiptHex:responseHex
    }},{session,runValidators:true});
  if(t.modifiedCount!==1)
    fail('OP_STATE');
  await Op.updateOne({_id:tx.signedOpId,status:{$in:['prepared','failed']}},{$set:{status:'done'},$unset:{'params.encryptedPin':1}},{session});
  return true;
}
async function applyReceipt(args) {
  const ok=await transaction(session=>receiptInSession(args,session));
  await log.write({
    action:'card-receipt-recovery',
    cardId:args.card.cardId,
    actorType:'system',
    result:ok?'success':'fail',
    detail:{txRef:args.tx.txRef,applied:ok},
    req:args.req
  });
  return ok;
}
async function confirmOp({opId,responseHex='',sw,actorType,actorId,req}) {
  if(!/^[0-9a-fA-F]{4}$/.test(sw)||typeof responseHex!=='string'||!/^([a-fA-F0-9]{2})*$/.test(responseHex)||responseHex.length>332)
    fail('OP_STATE');
  if(objectId(String(opId)))
    await Op.updateOne({_id:opId,expireAt:{$lte:new Date()}},{$unset:{'params.encryptedPin':1,'params.newPin':1}});
  let notification,logCardId;
  const output=await transaction(async session=> {
    const found=await Op.findById(objectId(String(opId))?opId:null).session(session).lean();
    logCardId=found?.cardId;
    if(found&&['done','failed'].includes(found.status)) {
      actorCheck(found,{actorType,actorId});
      return{ok:false,message:'Thao tác đã kết thúc.',result:null};
    }
    const op=await loadOp(String(opId),{actorType,actorId},session,'prepared');
    const card=await Card.findOne({cardId:op.cardId}).session(session).lean();
    await bindingPolicy(card,op,session);
    let context;
    // Receipt hợp lệ vẫn là sự thật tài chính sau thu hồi thẻ.
    if(['credit','debit'].includes(op.type))
      context={tx:await Tx.findOne({cardId:op.cardId,txRef:op.params.txRef?.toUpperCase()}).session(session).lean()};
    else
      context=await policy(card,op,session);
    if(['credit','debit'].includes(op.type)&&!context.tx)
      fail('OP_STATE');
    if(sw.toUpperCase()!=='9000') {
      await Op.updateOne({_id:op._id,status:'prepared'},{$set:{status:'failed'},$unset:{'params.encryptedPin':1}},{session});
      if(context.tx?.signedOpId===String(op._id)) {
        if(op.type==='credit')
          await Tx.updateOne({_id:context.tx._id,status:{$ne:'done'}},{$set:{status:'pending-card'}},{session});
        else
        if(['6F10','6F20','6F21','6982'].includes(sw.toUpperCase()))
          await Tx.updateOne({_id:context.tx._id,status:{$ne:'done'}},{$set:{status:'failed'}},{session});
      }
      return{ok:false,message:'Thẻ báo lỗi; cần kiểm tra biên nhận.',result:null};
    }
    if(context.tx) {
      if(context.tx.signedOpId!==String(op._id)||!await receiptInSession({card,tx:context.tx,responseHex},session))
        return{ok:false,message:'Biên nhận không hợp lệ.',result:null};
    }
    else {
      const claimed=await Op.updateOne({_id:op._id,status:'prepared',expireAt:{$gt:new Date()}},{$set:{status:'done'},$unset:{'params.encryptedPin':1}},{session});
      if(claimed.modifiedCount!==1)
        fail('OP_STATE');
      await Card.updateOne({_id:card._id},{$inc:{__v:1},$set:{lastSeenAt:new Date()}},{session});
      if(op.type.endsWith('-ticket')) {
        const field=`items.${op.params.itemIndex}`;
        const update={[`${field}.ticketStatus`]:({'write-ticket':'written','use-ticket':'used','delete-ticket':'deleted'})[op.type]};
        if(op.type==='use-ticket') {
          update[`${field}.checkedInAt`]=new Date();
          update[`${field}.checkedInBy`]=op.actorId;
        }
        await Order.updateOne({_id:context.order._id},{$set:update},{session});
      }
      if(op.type==='commit-write'&&op.params.customerUpdate)
        await Customer.updateOne({_id:card.ownerId,deleted:false},{$set:op.params.customerUpdate},{session,runValidators:true});
      if(op.type==='reset-pin') {
        const owner=card.cardType==='customer'?await Customer.findById(card.ownerId).session(session).lean():await Account.findById(card.ownerId).session(session).lean();
        if(owner?.email) {
          const decipher=crypto.createDecipheriv('aes-128-ecb',C.deriveEscrowKey(card.cardId),null);
          decipher.setAutoPadding(false);
          const clear=Buffer.concat([decipher.update(Buffer.from(op.params.encryptedPin,'hex')),decipher.final()]);
          notification={email:owner.email,pin:clear.subarray(0,6).toString('ascii')};
        }
      }
    }
    return{ok:true,message:'Đã tiếp nhận xác nhận.',result:{type:op.type}};
  });
  await log.write({
    action:'card-op-confirm',
    cardId:logCardId,
    actorType:actorType||'system',
    actorId,
    result:output.ok?'success':'fail',
    detail:{opId:String(opId),sw},
    req
  });
  if(notification)
    mail.sendMail(notification.email,'Reset PIN thẻ thành viên',`PIN mới: ${notification.pin}`);
  return output;
}
module.exports={
  cardStatus:{nextStatus(current,action){
    if(action==='lock'&&current==='active')return 'locked';
    if(action==='unlock'&&current==='locked')return 'active';
    if(action==='revoke'&&['active','locked','issuing'].includes(current))return 'revoked';
    return null;
  }},
  CardOpError,
  createOp,
  signOp,
  confirmOp,
  applyReceipt
};
