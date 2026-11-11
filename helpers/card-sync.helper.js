const Tx=require('../models/card-transaction.model');
const tickets=require('./ticket.helper');
const log=require('./card-log.helper');
const CHIP_MAX_BALANCE=50000000;
// Credit làm số dư chip vượt 50 000 000 sẽ bị applet từ chối (6F11) và kẹt thẻ ở bước khôi phục biên nhận:
// không bao giờ lập kế hoạch ký, để nguyên pending-card chờ đối soát thủ công và ghi nhật ký đúng một lần.
async function holdOverCapCredits(card,room) {
  const rows=await Tx.find({cardId:card.cardId,type:'credit',status:'pending-card',signedOpId:{$exists:false},amount:{$gt:room},capHeldAt:{$exists:false}}).select('txRef amount source').lean();
  for(const row of rows) {
    const marked=await Tx.updateOne({_id:row._id,status:'pending-card',signedOpId:{$exists:false},capHeldAt:{$exists:false}},{$set:{capHeldAt:new Date()}});
    if(marked.modifiedCount===1)
      await log.write({action:'card-sync-credit-held',cardId:card.cardId,actorType:'system',result:'fail',detail:{txRef:row.txRef,amount:row.amount,source:row.source,balance:card.balance,reason:'vượt hạn mức 50.000.000 trên thẻ, cần đối soát thủ công'}});
  }
}
function planNextSync({card,cardState,sentTx,pendingCredit,pendingDeleteItem,pendingWriteItem}) {
  if(!card||!['active','locked','revoked'].includes(card.status)||![2,3,127].includes(cardState)||cardState===127)
    return null;
  if(card.isCurrent!==undefined&&card.isCurrent!==(card.status!=='revoked'))
    return null;
  if(sentTx&&card.cardType==='customer')
    return{kind:'receipt',txRef:sentTx.txRef};
  const state=card.status==='revoked'?127:card.status==='locked'?3:2;
  if(state!==cardState)
    return{kind:'op',type:'set-state',params:{state}};
  if(card.cardType!=='customer'||card.status!=='active'||card.isCurrent===false)
    return null;
  if(pendingCredit)
    return{kind:'op',type:'credit',params:{txRef:pendingCredit.txRef}};
  if(pendingDeleteItem)
    return{kind:'op',type:'delete-ticket',params:pendingDeleteItem};
  if(pendingWriteItem)
    return{kind:'op',type:'write-ticket',params:pendingWriteItem};
  return null;
}
async function loadSyncContext(card) {
  if(!card||card.cardType!=='customer')
    return{};
  const sentTx=await Tx.findOne({cardId:card.cardId,status:{$ne:'done'},$or:[{status:'sent'},{signedOpId:{$exists:true}}]}).sort({signedAt:1,createdAt:1,_id:1}).lean();
  if(sentTx||card.cardType!=='customer'||card.status!=='active'||!card.isCurrent)
    return{sentTx};
  const room=CHIP_MAX_BALANCE-(Number.isSafeInteger(card.balance)?card.balance:CHIP_MAX_BALANCE);
  await holdOverCapCredits(card,room);
  const pendingCredit=await Tx.findOne({
    cardId:card.cardId,
    type:'credit',
    status:'pending-card',
    signedOpId:{$exists:false},
    amount:{$lte:room}
  }).sort({createdAt:1,_id:1}).lean();
  const pendingDeleteItem=await tickets.pendingItem(card,'delete-ticket');
  const pendingWriteItem=await tickets.pendingItem(card,'write-ticket');
  return{
    sentTx,
    pendingCredit,
    pendingDeleteItem,
    pendingWriteItem
  };
}
module.exports={planNextSync,loadSyncContext};
