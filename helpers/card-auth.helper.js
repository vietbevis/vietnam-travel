const Card=require('../models/card.model');
const Nonce=require('../models/card-nonce.model');
const Tx=require('../models/card-transaction.model');
const C=require('./card-crypto.helper');
const A=require('./card-apdu.helper');
const log=require('./card-log.helper');
const purposes=['login-customer','login-staff','step-up'];
const hex=(value,n)=>typeof value==='string'&&new RegExp('^[a-fA-F0-9]{'+n+'}$').test(value);
async function issueNonce({purpose,accountId}){
  if(!purposes.includes(purpose)||purpose!=='login-customer'&&!hex(accountId,24))throw new Error('INVALID_AUTH_PURPOSE');
  const nonce=C.randomHex(16);await Nonce.create({nonce,purpose,...(accountId?{accountId}:{}),expireAt:new Date(Date.now()+60000)});return nonce;
}
async function verify({purpose,cardId,nonce,counter,signature,accountId}){
  const denied=()=>({error:'CARD_AUTH_INVALID'});
  if(!purposes.includes(purpose)||!hex(cardId,32)||!hex(nonce,32)||!hex(signature,256)||!Number.isSafeInteger(counter)||counter<0||counter>0xffffffff||purpose!=='login-customer'&&!hex(accountId,24))return denied();
  const claim=await Nonce.findOneAndUpdate({nonce:nonce.toUpperCase(),purpose,accountId:accountId===undefined?{$exists:false}:accountId,used:false,expireAt:{$gt:new Date()}},{$set:{used:true}},{new:true});
  if(!claim)return denied();
  const card=await Card.findOne({cardId:cardId.toUpperCase(),cardType:purpose==='login-customer'?'customer':'staff',status:'active',isCurrent:true,...(accountId?{ownerId:accountId}:{})});
  if(!card||!C.verifyCardSignature(card.publicKeyModulus,A.buildAuthMessage({nonceHex:nonce,cardIdHex:card.cardId,counter}),Buffer.from(signature,'hex')))return denied();
  const actorType=card.cardType==='staff'?'admin':'customer',actorId=card.ownerId;
  if(counter>card.txCounter&&!await Tx.exists({cardId:card.cardId,status:'sent'}))await log.write({action:'counter-anomaly',cardId:card.cardId,actorType,actorId,result:'fail',detail:{counter,expected:card.txCounter}});
  await log.write({action:'auth',cardId:card.cardId,actorType,actorId,result:'success',detail:{purpose,counter}});
  return {card};
}
module.exports={issueNonce,verify};
