const Tx=require('../models/card-transaction.model');
const tickets=require('./ticket.helper');
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
  const pendingCredit=await Tx.findOne({
    cardId:card.cardId,
    type:'credit',
    status:'pending-card',
    signedOpId:{$exists:false}
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
