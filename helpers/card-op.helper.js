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
// Nhật ký thao tác thẻ chỉ ghi loại op và tham số an toàn; không bao giờ ghi newPin/encryptedPin, dataHex hay customerUpdate.
const SAFE_PARAMS=['txRef','orderId','itemIndex','state','target'];
function opLogDetail(op,tx) {
  const detail={};
  if(typeof op?.type==='string')
    detail.type=op.type;
  for(const key of SAFE_PARAMS)
    if(op?.params?.[key]!==undefined)
      detail[key]=op.params[key];
  if(tx) {
    detail.txRef=tx.txRef;
    detail.amount=tx.amount;
    if(tx.orderId)
      detail.orderId=tx.orderId;
  }
  return detail;
}
const errorCodeOf=error=>error instanceof CardOpError?error.code:'INTERNAL';
// Lỗi ném ra giữa sign/confirm cũng phải có dấu vết; đánh dấu để handler API không ghi trùng.
async function auditFailure(action,args,audit,error) {
  await log.write({
    action,
    cardId:audit.cardId,
    actorType:args.actorType||'system',
    actorId:args.actorId,
    result:'fail',
    detail:{opId:String(args.opId),...(typeof args.sw==='string'?{sw:args.sw.slice(0,4)}:{}),...opLogDetail(audit.op,audit.tx),errorCode:errorCodeOf(error)},
    req:args.req
  });
  if(error&&typeof error==='object')
    error.logged=true;
}
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
    // card-checkin chỉ thay được card-edit cho write-ticket (ghi vé trong lúc đồng bộ khi check-in).
    const permission=op.type==='credit'?['card-topup']:op.type==='write-ticket'?['card-edit','card-checkin']:['card-edit'];
    if(!admin||!objectId(admin.role)||!await Role.exists({_id:admin.role,deleted:false,permissions:{$in:permission}}).session(session))
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
async function loadOp(opId,actor,session,status,audit={}) {
  if(!objectId(String(opId)))
    fail('OP_NOT_FOUND');
  const op=await Op.findById(opId).session(session).lean();
  if(!op)
    fail('OP_NOT_FOUND');
  audit.op=op;
  audit.cardId=op.cardId;
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
    const latest=card.writeOpIds?.[p.target===1?'profile':'photo'];
    if(!issuing&&!creating&&latest&&latest!==String(op._id))fail('OP_STATE');
    if(![1,2].includes(p.target)||typeof p.dataHex!=='string'||!/^([a-fA-F0-9]{2})+$/.test(p.dataHex)||p.dataHex.length/2>(p.target===1?448:10080))
      fail('OP_STATE');
    if(op.actorType==='customer'&&p.target!==1)
      fail('OP_FORBIDDEN');
    const update=p.customerUpdate;
    if(update) {
      const photo=p.target===2&&op.actorType==='admin'&&Object.keys(update).length===1&&typeof update.avatar==='string'&&/^https:\/\/[^\s]+$/.test(update.avatar);
      if(card.cardType!=='customer'||typeof update!=='object'||Array.isArray(update)||!photo&&(p.target!==1||Object.keys(update).some(k=>!profileFields.includes(k)||op.actorType==='customer'&&!['phone','emergencyName','emergencyPhone'].includes(k))))
        fail('OP_FORBIDDEN');
    }
    if(update||op.actorType==='customer') {
      const customer=await Customer.findOne({_id:card.ownerId,deleted:false,status:'active'}).session(session).lean();
      if(!customer)
        fail('OP_STATE');
      if(p.target===2)return{};
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
    if(type==='commit-write'&&card.status==='active')await Card.updateOne({_id:card._id},{$set:{['writeOpIds.'+(params.target===1?'profile':'photo')]:op.id},$inc:{__v:1}},{session});
    return op;
  });
}
async function signOp(args) {
  const audit={};
  try {
    return await signOpCore(args,audit);
  }
  catch(error) {
    await auditFailure('card-op-sign',args,audit,error);
    throw error;
  }
}
async function signOpCore({opId,challengeHex,actorType,actorId},audit) {
  if(!hex(challengeHex,32))
    fail('OP_STATE');
  if(objectId(String(opId)))
    await Op.updateOne({_id:opId,expireAt:{$lte:new Date()}},{$unset:{'params.encryptedPin':1,'params.newPin':1}});
  return transaction(async session=> {
    const op=await loadOp(String(opId),{actorType,actorId},session,'draft',audit);
    const card=await Card.findOne({cardId:op.cardId}).session(session).lean();
    const context=await policy(card,op,session);
    audit.tx=context.tx;
    if(context.tx) {
      if(context.tx.status!=='pending-card'||context.tx.signedOpId)
        fail('OP_STATE');
      const unresolved=await Tx.exists({cardId:card.cardId,status:{$ne:'done'},$or:[{signedOpId:{$exists:true}},{status:'sent'}]}).session(session);
      if(unresolved)
        fail('OP_STATE');
      const update=await Tx.updateOne({_id:context.tx._id,status:'pending-card',signedOpId:{$exists:false}},{$set:{status:'sent',signedOpId:String(op._id),signedAt:new Date()}},{session});
      if(update.modifiedCount!==1)
        fail('OP_STATE');
      // Ghi vào đơn trong cùng transaction: admin sửa/huỷ đơn đồng thời sẽ xung đột thay vì lọt qua kiểm tra debit đang ký.
      if(context.tx.type==='debit')
        await Order.updateOne({_id:context.tx.orderId},{$inc:{__v:1}},{session});
    }
    // Đánh dấu vé đã được ký lệnh ghi: từ đây thẻ có thể giữ vé dù confirm bị mất; huỷ đơn sẽ phải xoá vé khỏi thẻ.
    if(op.type==='write-ticket')
      await Order.updateOne({_id:context.order._id},{$set:{[`items.${op.params.itemIndex}.writeSignedAt`]:new Date()}},{session});
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
async function confirmOp(args) {
  const audit={};
  try {
    return await confirmOpCore(args,audit);
  }
  catch(error) {
    await auditFailure('card-op-confirm',args,audit,error);
    throw error;
  }
}
async function confirmOpCore({opId,responseHex='',sw,actorType,actorId,req},audit) {
  if(typeof sw!=='string'||!/^[0-9a-fA-F]{4}$/.test(sw)||typeof responseHex!=='string'||!/^([a-fA-F0-9]{2})*$/.test(responseHex)||responseHex.length>332)
    fail('OP_STATE');
  if(objectId(String(opId)))
    await Op.updateOne({_id:opId,expireAt:{$lte:new Date()}},{$unset:{'params.encryptedPin':1,'params.newPin':1}});
  let notification;
  const output=await transaction(async session=> {
    // Driver có thể chạy lại callback sau write conflict; chỉ lượt commit thắng được giữ PIN/mail.
    notification=undefined;
    audit.tx=undefined;
    let newPin;
    const found=await Op.findById(objectId(String(opId))?opId:null).session(session).lean();
    audit.op=found;
    audit.cardId=found?.cardId;
    if(found&&['done','failed'].includes(found.status)) {
      actorCheck(found,{actorType,actorId});
      // Mất HTTP confirm chỉ được đọc lại kết quả commit đã ghi nhận; không phát APDU mới.
      if(found.status==='done'&&found.type==='commit-write'&&sw.toUpperCase()==='9000'&&responseHex===''){
        const card=await Card.findOne({cardId:found.cardId}).session(session).lean();
        await policy(card,found,session);
        return{ok:true,message:'Thao tác đã được xác nhận.',result:{type:found.type}};
      }
      return{ok:false,message:'Thao tác đã kết thúc.',result:null};
    }
    const op=await loadOp(String(opId),{actorType,actorId},session,'prepared',audit);
    const card=await Card.findOne({cardId:op.cardId}).session(session).lean();
    await bindingPolicy(card,op,session);
    let context;
    // Receipt hợp lệ vẫn là sự thật tài chính sau thu hồi thẻ.
    if(['credit','debit'].includes(op.type))
      context={tx:await Tx.findOne({cardId:op.cardId,txRef:op.params.txRef?.toUpperCase()}).session(session).lean()};
    else
      context=await policy(card,op,session);
    audit.tx=context.tx;
    if(['credit','debit'].includes(op.type)&&!context.tx)
      fail('OP_STATE');
    // Xoá vé đã không còn trên thẻ (6A88) cũng là kết quả mong muốn: tránh vòng lặp đồng bộ xoá mãi.
    const deleteAlreadyGone=op.type==='delete-ticket'&&sw.toUpperCase()==='6A88';
    if(sw.toUpperCase()!=='9000'&&!deleteAlreadyGone) {
      await Op.updateOne({_id:op._id,status:'prepared'},{$set:{status:'failed'},$unset:{'params.encryptedPin':1,'params.newPin':1}},{session});
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
      const claimed=await Op.updateOne({_id:op._id,status:'prepared',expireAt:{$gt:new Date()}},{$set:{status:'done'},$unset:{'params.encryptedPin':1,'params.newPin':1}},{session});
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
        const decipher=crypto.createDecipheriv('aes-128-ecb',C.deriveEscrowKey(card.cardId),null);
        decipher.setAutoPadding(false);
        const clear=Buffer.concat([decipher.update(Buffer.from(op.params.encryptedPin,'hex')),decipher.final()]);
        try{newPin=clear.subarray(0,6).toString('ascii');if(owner?.email)notification={email:owner.email,pin:newPin};}finally{clear.fill(0);}
      }
    }
    return{ok:true,message:'Đã tiếp nhận xác nhận.',result:{type:op.type,...(newPin?{newPin}:{} )}};
  });
  await log.write({
    action:'card-op-confirm',
    cardId:audit.cardId,
    actorType:actorType||'system',
    actorId,
    result:output.ok?'success':'fail',
    detail:{opId:String(opId),sw,...opLogDetail(audit.op,audit.tx)},
    req
  });
  if(output.ok&&output.result?.type==='reset-pin'){
    let emailStatus='not-applicable';
    if(notification){
      try{emailStatus=(await mail.sendMail(notification.email,'Reset PIN thẻ thành viên',`PIN mới: ${notification.pin}`))?.sent===true?'sent':'failed';}catch{emailStatus='failed';}
      finally{notification.pin='';notification=undefined;}
    }
    output.result.emailStatus=emailStatus;
    await Op.updateOne({_id:opId,status:'done'},{$set:{emailStatus}});
  }
  return output;
}
// Giao dịch đã ký (signedOpId) hoặc đã gửi xuống thẻ mà chưa done: chỉ biên nhận của thẻ mới kết thúc được, không bao giờ huỷ hay ký lại.
const unresolvedFilter=extra=>({...extra,status:{$ne:'done'},$or:[{status:'sent'},{signedOpId:{$exists:true}}]});
// Debit chưa từng ký (không có signedOpId) chắc chắn chưa tới chip: đóng (failed 'voided') bằng CAS để không còn là nghĩa vụ của thẻ.
// CAS cùng điều kiện với signOp nên một debit không thể vừa được ký vừa bị huỷ.
async function voidUnsignedDebits(filter,session) {
  const rows=await Tx.find({...filter,type:'debit',status:'pending-card',signedOpId:{$exists:false}}).select('txRef cardId orderId amount').session(session||null).lean();
  const voided=[];
  for(const row of rows) {
    const result=await Tx.updateOne({_id:row._id,status:'pending-card',signedOpId:{$exists:false}},{$set:{status:'failed',failReason:'voided'}},session?{session}:{});
    if(result.modifiedCount===1)
      voided.push({txRef:row.txRef,cardId:row.cardId,orderId:row.orderId,amount:row.amount});
  }
  return voided;
}
// Hạn cổng 15 phút + 5 phút châu chấu: quá mức này khoản chờ thanh toán không còn là nghĩa vụ.
const TOPUP_EXPIRE_MINUTES=15;
const TOPUP_STALE_MS=(TOPUP_EXPIRE_MINUTES+5)*60000;
// Chuyển khoản nạp online đã thanh toán sang chờ ghi thẻ. CAS nguyên tử: chỉ lần chuyển đầu tiên trả true.
// Khoản đã hết hạn (failed/expired) vẫn nhận tiền muộn, nhưng chỉ khi thẻ còn active và là thẻ hiện hành.
async function markTopupPaid(txId,source) {
  if(!mongoose.isValidObjectId(txId)||!['zalopay','vnpay'].includes(source))
    return false;
  const base={_id:txId,type:'credit',source};
  const result=await Tx.updateOne({...base,status:'awaiting-payment'},{$set:{status:'pending-card'}});
  if(result.modifiedCount===1)
    return true;
  const late=await Tx.findOne({...base,status:'failed',failReason:'expired',signedOpId:{$exists:false}}).lean();
  if(!late||!await Card.exists({cardId:late.cardId,cardType:'customer',status:'active',isCurrent:true}))
    return false;
  const claim=await Tx.updateOne({...base,status:'failed',failReason:'expired',signedOpId:{$exists:false}},{$set:{status:'pending-card'},$unset:{failReason:1}});
  return claim.modifiedCount===1;
}
// Cổng báo thất bại (đã xác minh chữ ký): đóng khoản chờ thanh toán. Không bao giờ nạp lại khoản này.
async function markTopupFailed(txId,source) {
  if(!mongoose.isValidObjectId(txId)||!['zalopay','vnpay'].includes(source))
    return false;
  const result=await Tx.updateOne({_id:txId,type:'credit',source,status:'awaiting-payment'},{$set:{status:'failed',failReason:'gateway'}});
  return result.modifiedCount===1;
}
// Đóng các khoản nạp online bỏ dở (quá hạn cổng + châu chấu) trước khi kiểm tra nghĩa vụ thẻ.
async function expireStaleTopups(cardId,session) {
  const result=await Tx.updateMany({cardId,type:'credit',source:{$in:['zalopay','vnpay']},status:'awaiting-payment',createdAt:{$lte:new Date(Date.now()-TOPUP_STALE_MS)}},{$set:{status:'failed',failReason:'expired'}},session?{session}:{});
  return result.modifiedCount;
}
module.exports={
  cardStatus:{nextStatus(current,action){
    if(action==='lock'&&current==='active')return 'locked';
    if(action==='unlock'&&current==='locked')return 'active';
    if(action==='revoke'&&['active','locked','issuing'].includes(current))return 'revoked';
    return null;
  }},
  CardOpError,
  opLogDetail,
  createOp,
  signOp,
  confirmOp,
  applyReceipt,
  markTopupPaid,
  markTopupFailed,
  expireStaleTopups,
  voidUnsignedDebits,
  unresolvedFilter,
  TOPUP_EXPIRE_MINUTES,
  TOPUP_STALE_MS
};
