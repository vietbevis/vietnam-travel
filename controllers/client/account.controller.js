const crypto=require('node:crypto');
const mongoose=require('mongoose');
const Customer=require('../../models/customer.model');
const Card=require('../../models/card.model');
const Tx=require('../../models/card-transaction.model');
const Order=require('../../models/order.model');
const {ticketData}=require('../../helpers/ticket.helper');
const Forgot=require('../../models/forgot-password.model');
const log=require('../../helpers/card-log.helper');
const mail=require('../../helpers/mail.helper');
const V=require('../../validates/client/card.validate');
const {tierOf}=require('../../helpers/tier.helper');
const Joi=require('joi');
const {imageMatchesType,storeFormImage,discardNewFormImages,writeWithFormImages}=require('../../middlewares/admin/image-upload.middleware');
const {contactRevision}=require('../../helpers/customer-profile.helper');
const PURPOSE='customer-card-lock';
const WINDOW=15*60*1000,RETENTION=24*60*60*1000;
const generic='Nếu email hợp lệ, mã OTP đã được gửi';
const digest=(...values)=>crypto.createHmac('sha256',process.env.JWT_SECRET).update(JSON.stringify([PURPOSE,...values])).digest('hex');
let outbound=0;
// Không xếp hàng chứa OTP; tối đa bốn SMTP promise cùng tồn tại, kể cả SMTP bị treo.
function send(email,subject,content,onResult){
  if(outbound>=4){void onResult('busy').catch(()=>{});return;}
  outbound++;
  Promise.resolve().then(()=>mail.sendMail(email,subject,content)).then(result=>onResult(result?.sent===true?'sent':'failed'),()=>onResult('failed')).catch(()=>{}).finally(()=>{outbound--;});
}
async function transaction(fn){const session=await mongoose.startSession();try{let result;await session.withTransaction(async()=>{result=await fn(session);});return result;}finally{await session.endSession();}}
async function bucket(key,limit,session,now){
  let row=await Forgot.findOne({key}).session(session).lean();
  if(!row){const [created]=await Forgot.create([{key,purpose:'customer-card-lock-limit',windowStart:now,count:0,expireAt:new Date(+now+RETENTION)}],{session});row=created.toObject();}
  const reset=+now-+row.windowStart>=WINDOW;
  if(!reset&&row.count>=limit)return false;
  await Forgot.updateOne({_id:row._id},{$set:{windowStart:reset?now:row.windowStart,count:reset?1:row.count+1,expireAt:new Date(+now+RETENTION)}},{session});
  return true;
}
async function limits(email,ip,kind,session,now){
  const ipAllowed=await bucket(digest('limit',kind,'ip',ip||''),kind==='send'?30:100,session,now);
  if(!ipAllowed)return false;
  return bucket(digest('limit',kind,'email',email),kind==='send'?5:20,session,now);
}
function normalized(value){return value.trim().toLowerCase();}
async function uniqueCustomer(email,session){
  const escaped=email.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rows=await Customer.find({email:{$regex:'^'+escaped+'$',$options:'i'},status:'active',deleted:false}).limit(2).session(session).lean();
  return rows.length===1?rows[0]:null;
}
function input(req,schema){
  if(!req.is('application/json'))return null;
  if(req.headers.origin&&req.headers.origin!==req.protocol+'://'+req.get('host'))return null;
  const {error,value}=schema.validate(req.body,{convert:false});return error?null:value;
}
const failure=res=>res.status(400).json({code:'error',message:'Mã OTP không hợp lệ, đã hết hạn hoặc vượt giới hạn. Vui lòng thử lại sau.'});
const topupDestination='/account/card?from=topup';
const orderId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
const viaTopup=req=>req.query.from==='topup'||['1','fail','reconciliation'].includes(req.query.topup);
module.exports.login=(req,res)=>{
  res.set('Cache-Control','no-store');
  const route=req.query.destination==='processing'?'processing':'success';
  const loginTarget=req.query.from==='topup'?topupDestination:orderId(req.query.orderId)?`/order/${route}?orderId=${req.query.orderId}`:'/account/card';
  res.render('client/pages/account-login',{pageTitle:'Đăng nhập bằng thẻ',loginTarget});
};
module.exports.topupReturn=(req,res)=>{
  res.set('Cache-Control','no-store');
  res.render('client/pages/order-payment-processing',{pageTitle:'Quay lại từ cổng thanh toán',returnOnly:true,continueUrl:topupDestination,returnKind:'topup'});
};
module.exports.cardAccess=(req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(req.customer&&req.card)return next();
  if(req.query.from==='topup')return res.redirect('/account/login?from=topup');
  if(viaTopup(req))return res.redirect('/account/card/return');
  return res.redirect('/account/login');
};

async function customerTickets(customerId){
  const visible=['pending','written','used','pending-delete','deleted'];
  const orders=await Order.find({customerId,deleted:false,paymentStatus:'paid','items.ticketStatus':{$in:visible}}).select('orderCode items status').sort({createdAt:-1,_id:-1}).lean();
  const rows=[];
  for(const order of orders){
    for(const [index,item] of order.items.entries()){
      if(!visible.includes(item.ticketStatus))continue;
      const cancelled=['cancel','cancelled'].includes(order.status);
      if(cancelled!==['pending-delete','deleted'].includes(item.ticketStatus))continue;
      const departureDate=new Date(item.departureDate);
      let pax;
      try{pax=ticketData(order,index).pax;}catch{pax=null;}
      rows.push({orderCode:order.orderCode,tourId:String(item.tourId||''),tourName:item.name,departureDate:Number.isFinite(+departureDate)&&item.departureDate?departureDate:null,pax,status:item.ticketStatus,checkedInAt:item.checkedInAt});
    }
  }
  return rows;
}
async function snapshot(req){
  const customerId=String(req.customer._id);
  const card=await Card.findOne({cardId:req.card.cardId,ownerId:customerId,cardType:'customer',status:'active',isCurrent:true}).lean();
  if(!card)return null;
  const [transactions,tickets]=await Promise.all([Tx.find({cardId:card.cardId}).sort({createdAt:-1,_id:-1}).lean(),customerTickets(customerId)]);
  const pending={credit:0,refund:0,transfer:0,reconciliation:0,writeTickets:0,deleteTickets:0};
  for(const tx of transactions){
    if(tx.type==='credit'&&['pending-card','sent'].includes(tx.status)){
      const type=['refund','transfer'].includes(tx.source)?tx.source:'credit';
      pending[type]+=tx.amount;
    }
    if(tx.status==='reconciliation'||tx.status!=='done'&&(tx.status==='sent'||tx.signedOpId||tx.capHeldAt))pending.reconciliation++;
  }
  for(const ticket of tickets){
    if(ticket.status==='pending')pending.writeTickets++;
    if(ticket.status==='pending-delete')pending.deleteTickets++;
  }
  return{card,transactions,tickets,pending,pendingCredit:pending.credit+pending.refund+pending.transfer};
}
module.exports.card=async(req,res,next)=>{
  try{
    const state=await snapshot(req);
    if(!state)return res.redirect(viaTopup(req)?'/account/login?from=topup':'/account/login');
    const latestTopup=viaTopup(req)?state.transactions.find(tx=>tx.type==='credit'&&['zalopay','vnpay'].includes(tx.source)):null;
    res.render('client/pages/account-card',{pageTitle:'Thẻ của tôi',...state,fromTopup:viaTopup(req),latestTopup,tier:tierOf(req.customer.totalSpent||0),accountCustomer:req.customer});
  }catch(error){next(error);}
};
module.exports.snapshot=async(req,res,next)=>{
  try{
    const state=await snapshot(req);
    if(!state)return res.status(401).json({code:'error',message:'Vui lòng đăng nhập lại.'});
    res.json({code:'success',balance:state.card.balance,txCounter:state.card.txCounter,pendingCredit:state.pendingCredit,pending:state.pending});
  }catch(error){next(error);}
};
const revisionOf=customer=>crypto.createHash('sha256')
  .update(JSON.stringify([customer.address || '',customer.webAvatar || ''])).digest('hex');

module.exports.profile=(req,res)=>res.render('client/pages/account-profile',{
  pageTitle:'Thông tin cá nhân',accountCustomer:req.customer,card:req.card,
  webRevision:revisionOf(req.customer),chipRevision:contactRevision(req.customer)
});

module.exports.requireProfileOrigin=(req,res,next)=>{
  if (!req.is('multipart/form-data') || req.get('origin') !== req.protocol+'://'+req.get('host')) {
    return res.status(403).json({code:'error',message:'Yêu cầu hồ sơ không hợp lệ.'});
  }
  return next();
};

const webProfileFields=Joi.object({
  address:Joi.string().trim().max(300).allow('').required(),
  revision:Joi.string().hex().length(64).required(),
  clearAvatar:Joi.valid('true')
}).required().unknown(false);

module.exports.profileWebPatch=async(req,res)=>{
  const {error,value}=webProfileFields.validate(req.body);
  if (error || req.file && (!imageMatchesType(req.file) || value.clearAvatar)) {
    return res.status(400).json({code:'error',message:'Kiểm tra thông tin và tệp JPEG, PNG, GIF hoặc WebP tối đa 5 MB.'});
  }
  const ownerId=String(req.customer._id), cardId=req.card.cardId;
  const conflict=()=>res.status(409).json({code:'error',message:'Hồ sơ hoặc thẻ đã thay đổi. Vui lòng tải lại.'});
  if (value.revision!==revisionOf(req.customer)) return conflict();
  const update={address:value.address};
  if (value.clearAvatar) update.webAvatar='';
  if (req.file) {
    try { update.webAvatar=await storeFormImage(req.file); }
    catch { return res.status(502).json({code:'error',message:'Không tải được ảnh đại diện. Hồ sơ chưa thay đổi.'}); }
  }
  const saved=await writeWithFormImages(req,()=>transaction(async session=>{
    const card=await Card.findOneAndUpdate(
      {cardId,ownerId,cardType:'customer',status:'active',isCurrent:true},{$inc:{__v:1}},{session}
    );
    if (!card) return false;
    const result=await Customer.updateOne(
      {_id:ownerId,status:'active',deleted:false,address:req.customer.address || {$in:['',null]},
        webAvatar:req.customer.webAvatar || {$in:['',null]}},
      {$set:update},{session,runValidators:true}
    );
    if (!result.matchedCount) return false;
    await log.write({action:'customer-web-profile',cardId,actorType:'customer',actorId:ownerId,result:'success',detail:{fields:Object.keys(update)},req},{session});
    return true;
  }));
  if (!saved) {
    await discardNewFormImages(req);
    return conflict();
  }
  return res.json({code:'success',message:'Đã lưu hồ sơ web.'});
};
module.exports.lock=(req,res)=>{res.set('Cache-Control','no-store');res.render('client/pages/account-card-lock',{pageTitle:'Khóa thẻ bị mất'});};
module.exports.sendOtp=async(req,res)=>{
  res.set('Cache-Control','no-store');
  const started=Date.now(),body=input(req,V.email);
  let notification;
  try{
    if(body){
      const email=normalized(body.email),key=digest('otp',email);
      // Cùng quy trình cấp quota, tìm owner/card và HMAC cho cả địa chỉ không tồn tại.
      const code=String(crypto.randomInt(0,1000000)).padStart(6,'0'),salt=crypto.randomBytes(16).toString('hex');
      await transaction(async session=>{
        notification=undefined;
        const now=new Date();
        const allowed=await limits(email,req.ip,'send',session,now);
        const customer=await uniqueCustomer(email,session);
        const card=await Card.findOne({ownerId:customer?String(customer._id):'000000000000000000000000',cardType:'customer',status:'active',isCurrent:true}).session(session).lean();
        const hash=digest('code',email,card?.cardId||'',salt,code);
        const previous=await Forgot.findOne({key}).session(session).lean();
        const cooldown=previous?.nextSendAt>now;
        if(allowed&&!cooldown){
          const update={purpose:PURPOSE,email,cardId:card?.cardId||'',customerId:customer?String(customer._id):'',otpHash:hash,salt,attempts:0,expireAt:new Date(+now+300000),nextSendAt:new Date(+now+60000),emailStatus:card?'pending':'not-applicable'};
          await Forgot.updateOne({key},{$set:update,$unset:{consumedAt:1,otp:1}},{upsert:true,session});
          if(card)notification={email,code,key,hash,cardId:card.cardId,customerId:String(customer._id)};
        }
        await log.write({action:'customer-card-lock-otp',cardId:card?.cardId,actorType:'customer',actorId:customer?String(customer._id):undefined,result:allowed&&!cooldown?'success':'fail',detail:{status:allowed&&!cooldown?'accepted':'limited'},req},{session});
      });
    }else await log.write({action:'customer-card-lock-otp',actorType:'customer',result:'fail',detail:{errorCode:'INVALID_INPUT'},req});
  }catch{notification=undefined;await log.write({action:'customer-card-lock-otp',actorType:'customer',result:'fail',detail:{errorCode:'UNAVAILABLE'},req});}
  if(notification){
    const job=notification;
    send(job.email,'Mã OTP khóa thẻ thành viên',`Mã OTP khóa thẻ: <b>${job.code}</b>. Mã có hiệu lực 5 phút. Không cung cấp mã cho người khác.`,async status=>{
      await Forgot.updateOne({key:job.key,otpHash:job.hash},{$set:{emailStatus:status}});
      await log.write({action:'customer-card-lock-mail',cardId:job.cardId,actorType:'customer',actorId:job.customerId,result:status==='sent'?'success':'fail',detail:{status}});
    });
    notification=undefined;
  }
  // Không chờ SMTP: cả địa chỉ tồn tại, bị giới hạn, không tồn tại và mail lỗi có cùng response floor.
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,120-(Date.now()-started))));
  return res.json({code:'success',message:generic});
};
module.exports.confirmLock=async(req,res)=>{
  res.set('Cache-Control','no-store');
  const body=input(req,V.otp);
  if(!body){await log.write({action:'customer-card-lock',actorType:'customer',result:'fail',detail:{errorCode:'INVALID_INPUT'},req});return failure(res);}
  const email=normalized(body.email);
  let locked;
  try{
    const ok=await transaction(async session=>{
      locked=undefined;
      const now=new Date();
      const allowed=await limits(email,req.ip,'verify',session,now);
      const row=await Forgot.findOne({key:digest('otp',email),purpose:PURPOSE,email}).session(session).lean();
      const expected=digest('code',email,row?.cardId||'',row?.salt||'',body.otp);
      const validHash=typeof row?.otpHash==='string'&&/^[a-f0-9]{64}$/.test(row.otpHash)&&crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(row.otpHash,'hex'));
      const eligible=allowed&&row&&!row.consumedAt&&row.expireAt>now&&row.attempts<5;
      if(eligible)await Forgot.updateOne({_id:row._id,attempts:row.attempts,consumedAt:{$exists:false}},{$inc:{attempts:1}},{session});
      const customer=eligible&&validHash?await uniqueCustomer(email,session):null;
      if(customer&&String(customer._id)===row.customerId){
        const card=await Card.findOneAndUpdate({cardId:row.cardId,ownerId:String(customer._id),cardType:'customer',status:'active',isCurrent:true},{$set:{status:'locked',lockedReason:'customer-reported-lost'},$inc:{__v:1}},{new:true,session});
        if(card){
          const consumeNow=new Date();
          const consumed=await Forgot.updateOne({_id:row._id,consumedAt:{$exists:false},expireAt:{$gt:consumeNow}},{$set:{consumedAt:consumeNow,expireAt:new Date(+consumeNow+RETENTION)},$unset:{otpHash:1,salt:1}},{session});
          if(consumed.modifiedCount!==1)throw new Error('CONSUME_CONFLICT');
          await log.write({action:'customer-card-lock',cardId:card.cardId,actorType:'customer',actorId:String(customer._id),result:'success',detail:{reason:'customer-reported-lost'},req},{session});
          locked={email,cardId:card.cardId,customerId:String(customer._id)};return true;
        }
      }
      await log.write({action:'customer-card-lock',actorType:'customer',result:'fail',detail:{errorCode:'OTP_INVALID'},req},{session});
      return false;
    });
    if(!ok)return failure(res);
  }catch{await log.write({action:'customer-card-lock',actorType:'customer',result:'fail',detail:{errorCode:'UNAVAILABLE'},req});return failure(res);}
  const job=locked;
  send(job.email,'Thông báo khóa thẻ thành viên','Thẻ thành viên đã được khóa theo yêu cầu báo mất. Vui lòng liên hệ nhân viên để được hỗ trợ.',status=>log.write({action:'customer-card-lock-notice',cardId:job.cardId,actorType:'customer',actorId:job.customerId,result:status==='sent'?'success':'fail',detail:{status}}));
  require('../../middlewares/client/customer-auth.middleware').clear(res);
  res.json({code:'success',message:'Đã khóa thẻ. Vui lòng liên hệ nhân viên để được hỗ trợ.'});
};
