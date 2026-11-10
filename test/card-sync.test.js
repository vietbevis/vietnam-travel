const {test}=require('node:test');
const assert=require('node:assert/strict');
let P; try {P=require('../helpers/card-sync.helper');} catch {}
const card={cardId:'11'.repeat(16),status:'active',isCurrent:true,cardType:'customer'};
test('sentTxComesFirst',()=>assert.deepEqual(P?.planNextSync({card,cardState:2,sentTx:{txRef:'AB'.repeat(8)},pendingCredit:{txRef:'CD'.repeat(8)}}),{kind:'receipt',txRef:'AB'.repeat(8)}));
for(const [name,status,state,want] of [['revoked','revoked',2,127],['lock','locked',2,3],['unlock','active',3,2]]) test(name,()=>assert.deepEqual(P?.planNextSync({card:{...card,status,isCurrent:status!=='revoked'},cardState:state}),{kind:'op',type:'set-state',params:{state:want}}));
test('terminated card has no work',()=>assert.equal(P?.planNextSync({card,cardState:127}),null));
test('priority credit > delete > write',()=>{
 const ctx={card,cardState:2,pendingCredit:{txRef:'AB'.repeat(8)},pendingDeleteItem:{orderId:'a',itemIndex:0},pendingWriteItem:{orderId:'b',itemIndex:1}};
 assert.deepEqual(P?.planNextSync(ctx),{kind:'op',type:'credit',params:{txRef:'AB'.repeat(8)}});
 delete ctx.pendingCredit; assert.deepEqual(P.planNextSync(ctx),{kind:'op',type:'delete-ticket',params:{orderId:'a',itemIndex:0}});
 delete ctx.pendingDeleteItem; assert.deepEqual(P.planNextSync(ctx),{kind:'op',type:'write-ticket',params:{orderId:'b',itemIndex:1}});
});
test('staff skips wallet and tickets',()=>assert.equal(P?.planNextSync({card:{...card,cardType:'staff'},cardState:2,pendingCredit:{txRef:'x'}}),null));
test('locked card gets no credit',()=>assert.equal(P?.planNextSync({card:{...card,status:'locked'},cardState:3,pendingCredit:{txRef:'x'}}),null));
test('issuing failed and unknown card states fail closed',()=>{for(const status of ['issuing','failed'])assert.equal(P?.planNextSync({card:{...card,status},cardState:2}),null);assert.equal(P.planNextSync({card,cardState:99,pendingCredit:{txRef:'x'}}),null);});
test('staff never retrieves wallet receipt even with inconsistent context',()=>assert.equal(P.planNextSync({card:{...card,cardType:'staff'},cardState:2,sentTx:{txRef:'AB'.repeat(8)}}),null));
test('inconsistent current-card status produces no sync work',()=>assert.equal(P.planNextSync({card:{...card,isCurrent:false},cardState:3,sentTx:{txRef:'AB'.repeat(8)}}),null));
test('terminated physical card cannot retrieve receipt',()=>assert.equal(P.planNextSync({card,cardState:127,sentTx:{txRef:'AB'.repeat(8)}}),null));
