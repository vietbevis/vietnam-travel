const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');
const db=require('../helpers/db');
const Card=require('../../models/card.model');
const Tx=require('../../models/card-transaction.model');
const Op=require('../../models/card-operation.model');
const Order=require('../../models/order.model');
const Customer=require('../../models/customer.model');
const CardLog=require('../../models/card-log.model');
const Account=require('../../models/account-admin.model');
const Role=require('../../models/role.model');
const express=require('express');
const jwt=require('jsonwebtoken');
let E;
try {
  E=require('../../helpers/card-op.helper');
}
catch {
}
const key=crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const otherKey=crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const cardId='11'.repeat(16).toUpperCase(),txRef='AB'.repeat(8),challengeHex='CD'.repeat(16);
const ownerId='0123456789abcdef01234567',actor={actorType:'customer',actorId:ownerId};
const it=(name,fn)=>test(name,{skip:!db.enabled},fn);
before(async()=> {
  process.env.CARD_SERVER_KEY_PATH=path.resolve('smartcard/test-vectors/server-test-key.pem');
  process.env.CARD_ESCROW_MASTER='11'.repeat(32);
  if(db.enabled) {
    await db.connect();
    await Promise.all([Card,Tx,Op,Order,Customer].map(m=>m.init()));
  }
});
beforeEach(async()=> {
  if(db.enabled)
    await db.reset();
});
after(async()=> {
  if(db.enabled)
    await db.close();
});
async function fixture(type='credit',extra={}) {
  await Customer.create({_id:ownerId,email:'fixture@example.invalid'});
  const card=await Card.create({
    cardId,
    cardType:'customer',
    ownerId,
    status:'active',
    publicKeyModulus:Buffer.from(key.publicKey.export({format:'jwk'}).n,'base64url').toString('hex'),
    balance:type==='debit'?900000:0
  });
  let order;
  if(type==='debit')
    order=await Order.create({
      orderCode:'OD1234567890',
      customerId:ownerId,
      total:500000,
      paymentMethod:'card',
      paymentStatus:'unpaid',
      status:'initial',
      items:[{
        tourId:'123456789012345678901234',
        ticketStatus:'none',
        quantityAdult:1,
        departureDate:'2026-11-10'
      }]
    });
  if(order)
    await Order.updateOne({_id:order.id},{$set:{cardTxRef:txRef}});
  const tx=await Tx.create({
    cardId,
    txRef,
    type,
    source:type==='debit'?'order':'cash',
    amount:500000,
    orderId:order?.id,
    ...extra
  });
  return{card,tx,order};
}
function receipt({type='credit',counter=1,balance=500000,amount=500000,id=cardId,ref=txRef,privateKey=key.privateKey}={}) {
  const m=Buffer.alloc(38);
  m[0]=0x52;
  Buffer.from(id,'hex').copy(m,1);
  m[17]=type==='credit'?1:2;
  Buffer.from(ref,'hex').copy(m,18);
  m.writeUInt32BE(amount,26);
  m.writeUInt32BE(balance,30);
  m.writeUInt32BE(counter,34);
  return Buffer.concat([m,crypto.sign('sha256',m,privateKey)]).toString('hex');
}
async function signed(type='credit') {
  const f=await fixture(type);
  assert.ok(E,'engine chưa triển khai');
  const op=await E.createOp({
    cardId,
    type,
    params:{txRef},
    ...actor
  });
  const result=await E.signOp({opId:op.id,challengeHex,...actor});
  return{...f,op,apdu:result.apdu};
}
it('credit confirm updates ledger',async()=> {
  const{op,apdu}=await signed();
  assert.equal(apdu.slice(2,4),'51');
  assert.equal(apdu.slice(10,34).toUpperCase(),txRef+'0007A120');
  assert.equal((await Tx.findOne()).status,'sent');
  assert.equal((await E.confirmOp({
    opId:op.id,
    responseHex:receipt(),
    sw:'9000',
    ...actor
  })).ok,true);
  assert.equal((await Card.findOne()).balance,500000);
  assert.equal((await Card.findOne()).txCounter,1);
  assert.equal((await Tx.findOne()).status,'done');
});
it('doubleConfirmAppliesOnce',async()=> {
  const{op}=await signed();
  const results=await Promise.all([1,2].map(()=>E.confirmOp({
      opId:op.id,
      responseHex:receipt(),
      sw:'9000',
      ...actor
    })));
  assert.equal(results.filter(x=>x.ok).length,1);
  assert.equal((await Card.findOne()).balance,500000);
});
for(
const [name,args]
of [['wrongCounterRejected',{counter:2}],['forgedReceiptRejected',{privateKey:otherKey.privateKey}],['wrongTypeRejected',{type:'debit'}],['wrongAmountRejected',{amount:1}],['wrongBalanceRejected',{balance:1}],['wrongCardRejected',{id:'22'.repeat(16)}],['wrongTxRejected',{ref:'EF'.repeat(8)}]])
  it(name,async()=> {
    const{op}=await signed();
    assert.equal((await E.confirmOp({
      opId:op.id,
      responseHex:receipt(args),
      sw:'9000',
      ...actor
    })).ok,false);
    assert.equal((await Card.findOne()).balance,0);
    assert.equal((await Tx.findOne()).status,'sent');
  });
it('otherActorCannotSign',async()=> {
  await fixture();
  assert.ok(E);
  const op=await E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    ...actor
  });
  await assert.rejects(E.signOp({
    opId:op.id,
    challengeHex,
    actorType:'customer',
    actorId:'other'
  }),{code:'OP_FORBIDDEN'});
});
it('receiptRecoveryAppliesOnce debit settlement',async()=> {
  const{card,tx,order}=await signed('debit');
  const responseHex=receipt({type:'debit',balance:400000});
  assert.equal(await E.applyReceipt({card,tx,responseHex}),true);
  assert.equal(await E.applyReceipt({card,tx,responseHex}),false);
  assert.equal((await Order.findById(order.id)).paymentStatus,'paid');
  assert.equal((await Customer.findById(ownerId)).totalSpent,500000);
  assert.equal((await Card.findOne()).balance,400000);
});
it('SW failure cannot authorize a second credit after op TTL deletion',async()=> {
  const{op}=await signed();
  assert.equal((await E.confirmOp({
    opId:op.id,
    sw:'6F20',
    responseHex:'',
    ...actor
  })).ok,false);
  assert.equal((await Op.findById(op.id)).status,'failed');
  assert.equal((await Tx.findOne()).status,'pending-card');
  await Op.deleteMany({});
  await assert.rejects(async()=> {
    const retry=await E.createOp({
      cardId,
      type:'credit',
      params:{txRef},
      ...actor
    });
    await E.signOp({opId:retry.id,challengeHex,...actor});
  });
  assert.equal(await E.applyReceipt({card:await Card.findOne(),tx:await Tx.findOne(),responseHex:receipt()}),true);
});
it('expiry rejects signing and confirming without trusting TTL',async()=> {
  const{op}=await signed();
  await Op.updateOne({_id:op.id},{$set:{expireAt:new Date(Date.now()-1000)}});
  await assert.rejects(E.confirmOp({
    opId:op.id,
    responseHex:receipt(),
    sw:'9000',
    ...actor
  }),{code:'OP_STATE'});
  assert.equal((await Card.findOne()).balance,0);
});
it('customer profile cannot arbitrarily change totalSpent',async()=> {
  await fixture();
  assert.ok(E);
  await assert.rejects(E.createOp({
    cardId,
    type:'commit-write',
    params:{target:1,dataHex:'010141',customerUpdate:{totalSpent:1e9}},
    ...actor
  }));
  assert.equal((await Customer.findOne()).totalSpent,0);
});
it('system cannot bypass sensitive operations',async()=> {
  await fixture();
  assert.ok(E);
  for(
  const type
  of ['debit','reset-pin','use-ticket','commit-write'])
    await assert.rejects(E.createOp({
      cardId,
      type,
      params:{txRef},
      actorType:'system'
    }),{code:'OP_FORBIDDEN'});
});
it('different wallet transactions cannot concurrently obtain authorization',async()=> {
  await fixture();
  const secondRef='EF'.repeat(8);
  await Tx.create({
    cardId,
    txRef:secondRef,
    type:'credit',
    source:'cash',
    amount:10000
  });
  const ops=await Promise.all([txRef,secondRef].map(ref=>E.createOp({
      cardId,
      type:'credit',
      params:{txRef:ref},
      ...actor
    })));
  const outcomes=await Promise.allSettled(ops.map(op=>E.signOp({opId:op.id,challengeHex,...actor})));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await Tx.countDocuments({signedOpId:{$exists:true}}),1);
});
it('late receipt after failed recovery remains financial truth on revoked card',async()=> {
  const{card,tx}=await signed('debit');
  await Tx.updateOne({_id:tx._id},{$set:{status:'failed'}});
  await Card.updateOne({_id:card._id},{$set:{status:'revoked',isCurrent:false}});
  assert.equal(await E.applyReceipt({card,tx,responseHex:receipt({type:'debit',balance:400000})}),true);
  assert.equal((await Customer.findOne()).totalSpent,500000);
});
it('receipt rollback includes op card tx order and customer',async()=> {
  const{card,tx,order,op}=await signed('debit');
  const original=Customer.collection.updateOne;
  Customer.collection.updateOne=async()=> {
    throw new Error('fixture rollback');
  };
  try {
    await assert.rejects(E.confirmOp({
      opId:op.id,
      responseHex:receipt({type:'debit',balance:400000}),
      sw:'9000',
      ...actor
    }),/fixture rollback/);
  }
  finally {
    Customer.collection.updateOne=original;
  }
  assert.equal((await Card.findOne()).balance,900000);
  assert.equal((await Tx.findById(tx._id)).status,'sent');
  assert.equal((await Op.findById(op.id)).status,'prepared');
  assert.equal((await Order.findById(order.id)).paymentStatus,'unpaid');
  assert.equal((await Customer.findOne()).totalSpent,0);
});
it('system policy revalidates changed card and cancelled ticket order',async()=> {
  await fixture();
  const op=await E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    actorType:'system',
    actorId:'customer:'+ownerId
  });
  await Card.updateOne({cardId},{$set:{status:'locked'}});
  await assert.rejects(E.signOp({opId:op.id,challengeHex,...actor}),{code:'CARD_STATE'});
  await Card.updateOne({cardId},{$set:{status:'active'}});
  const order=await Order.create({
    orderCode:'OD1234567890',
    customerId:ownerId,
    total:500000,
    paymentStatus:'paid',
    status:'initial',
    items:[{
      tourId:'123456789012345678901234',
      departureDate:'2026-11-10',
      quantityAdult:1,
      ticketStatus:'pending'
    }]
  });
  const ticket=await E.createOp({
    cardId,
    type:'write-ticket',
    params:{orderId:order.id,itemIndex:0},
    actorType:'system',
    actorId:'customer:'+ownerId
  });
  await Order.updateOne({_id:order.id},{$set:{status:'cancel'}});
  await assert.rejects(E.signOp({opId:ticket.id,challengeHex,...actor}),{code:'OP_STATE'});
});
it('load context selects signed failed recovery before pending credit and owner-bound tickets',async()=> {
  const{tx}=await signed();
  await Tx.updateOne({_id:tx._id},{$set:{status:'failed'}});
  await Tx.create({
    cardId,
    txRef:'EF'.repeat(8),
    type:'credit',
    source:'cash',
    amount:10000
  });
  const P=require('../../helpers/card-sync.helper');
  const ctx=await P.loadSyncContext(await Card.findOne().lean());
  assert.equal(ctx.sentTx.txRef,txRef);
  assert.equal(ctx.pendingCredit,undefined);
});
it('reset PIN persists ciphertext only and removes it after confirmation',async()=> {
  await fixture();
  const adminId='123456789012345678901234';
  const op=await E.createOp({
    cardId,
    type:'reset-pin',
    params:{newPin:'827491'},
    actorType:'admin',
    actorId:adminId
  });
  assert.equal(JSON.stringify(await Op.findById(op.id).lean()).includes('827491'),false);
  const {apdu}=await E.signOp({
    opId:op.id,
    challengeHex,
    actorType:'admin',
    actorId:adminId
  });
  assert.equal(apdu.slice(2,4),'22');
  const mail=require('../../helpers/mail.helper'),saved=mail.sendMail;
  mail.sendMail=()=> {
  };
  try {
    assert.equal((await E.confirmOp({
      opId:op.id,
      sw:'9000',
      actorType:'admin',
      actorId:adminId
    })).ok,true);
  }
  finally {
    mail.sendMail=saved;
  }
  assert.equal((await Op.findById(op.id)).params.encryptedPin,undefined);
});
it('ticket payload and reported effects use persisted owner order item',async()=> {
  await fixture();
  const order=await Order.create({
    orderCode:'OD1234567890',
    customerId:ownerId,
    paymentStatus:'paid',
    status:'initial',
    items:[{
      tourId:'123456789012345678901234',
      departureDate:'2026-11-10',
      quantityAdult:2,
      quantityChildren:1,
      ticketStatus:'pending'
    }]
  });
  let op=await E.createOp({
    cardId,
    type:'write-ticket',
    params:{orderId:order.id,itemIndex:0},
    actorType:'system',
    actorId:'customer:'+ownerId
  });
  const {apdu}=await E.signOp({opId:op.id,challengeHex,...actor});
  assert.equal(apdu.slice(2,4),'60');
  assert.equal(Buffer.from(apdu.slice(10,34),'hex').toString(),'OD1234567890');
  assert.equal(apdu.slice(74,76),'03');
  await E.confirmOp({opId:op.id,sw:'9000',...actor});
  assert.equal((await Order.findById(order.id)).items[0].ticketStatus,'written');
  await Order.updateOne({_id:order.id},{$set:{status:'cancel','items.0.ticketStatus':'pending-delete'}});
  op=await E.createOp({
    cardId,
    type:'delete-ticket',
    params:{orderId:order.id,itemIndex:0},
    actorType:'system',
    actorId:'customer:'+ownerId
  });
  assert.equal((await E.signOp({opId:op.id,challengeHex,...actor})).apdu.slice(2,4),'63');
  await E.confirmOp({opId:op.id,sw:'9000',...actor});
  assert.equal((await Order.findById(order.id)).items[0].ticketStatus,'deleted');
});
it('commit write hashes bytes and protects issuance actor',async()=> {
  const{card}=await fixture();
  await Card.updateOne({_id:card._id},{$set:{status:'issuing',issuedBy:'123456789012345678901234',issuance:{expireAt:new Date(Date.now()+300000)}}});
  await assert.rejects(E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    ...actor
  }),{code:'CARD_STATE'});
  const admin={actorType:'admin',actorId:'123456789012345678901234'};
  const op=await E.createOp({
    cardId,
    type:'commit-write',
    params:{target:1,dataHex:'010141'},
    ...admin
  });
  await Card.updateOne({_id:card._id},{$set:{'issuance.profileOpId':op.id}});
  const {apdu}=await E.signOp({opId:op.id,challengeHex,...admin});
  assert.equal(apdu.slice(2,8),'430100');
  assert.equal(apdu.slice(74,78),'0003');
});
async function http(fn) {
  let route;
  try {
    route=require('../../routes/client/card-api.route');
  }
  catch {
  }
  assert.ok(route,'card-api route chưa triển khai');
  const app=express();
  app.use(require('cookie-parser')());
  app.use(express.json());
  app.use('/card-api',route);
  app.use('/card-api',require('../../controllers/client/card-api.controller').errorHandler);
  const server=await new Promise(resolve=> {
    const s=app.listen(0,'127.0.0.1',()=>resolve(s));
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    await fn(async(url,body,headers={})=> {
      const res=await fetch(base+'/card-api'+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
      return{status:res.status,body:await res.json()};
    });
  }
  finally {
    await new Promise(resolve=>server.close(resolve));
  }
}
it('API strict input and missing auth return JSON without leaking internal errors',async()=> {
  await fixture();
  await http(async post=> {
    for(
    const [url,body]
    of [['/sync/next',{
      cardId,
      cardState:2,
      challenge:challengeHex,
      actorType:'admin'
    }],['/sync/next',{cardId:'bad',cardState:2,challenge:challengeHex}],['/sync/receipt',{
      cardId,
      txRef,
      response:'zz',
      sw:'9000'
    }]])
      assert.equal((await post(url,body)).status,400);
    assert.equal((await post('/op/sign',{opId:'123456789012345678901234',challenge:challengeHex})).status,401);
    assert.equal((await post('/sync/next','{')).status,400);
    assert.equal((await post('/unknown',{})).status,404);
  });
});
it('API public sync rejects generic sensitive operation and untrusted receipt absence retains late recovery',async()=> {
  const{op}=await signed('debit');
  await http(async post=> {
    assert.equal((await post('/sync/confirm',{opId:op.id,response:receipt({type:'debit',balance:400000}),sw:'9000'})).status,403);
    let out=await post('/sync/receipt',{
      cardId,
      txRef,
      response:'',
      sw:'6A88'
    });
    assert.equal(out.status,200);
    assert.equal((await Tx.findOne()).status,'failed');
    assert.equal((await Order.findOne()).paymentStatus,'unpaid');
    out=await post('/sync/receipt',{
      cardId,
      txRef,
      response:receipt({type:'debit',balance:400000}),
      sw:'9000'
    });
    assert.equal(out.body.ok,true);
    assert.equal((await Customer.findOne()).totalSpent,500000);
  });
});
it('API JWT actor and fresh DB permissions control generic operations',async()=> {
  await fixture();
  process.env.JWT_SECRET='fixture-task5-secret';
  const op=await E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    ...actor
  });
  const token=jwt.sign({customerId:ownerId,cardId},process.env.JWT_SECRET,{expiresIn:'1d'});
  await http(async post=> {
    assert.equal((await post('/op/sign',{opId:op.id,challenge:challengeHex},{Cookie:'customerToken='+token,Origin:'https://evil.invalid'})).status,403);
    assert.equal((await post('/op/sign',{opId:op.id,challenge:challengeHex},{Cookie:'customerToken='+token})).status,200);
    await Card.updateOne({cardId},{$set:{status:'locked'}});
    assert.equal((await post('/op/confirm',{opId:op.id,response:receipt(),sw:'9000'},{Cookie:'customerToken='+token})).status,403);
  });
});
it('debit requires exact persisted order tx binding and owner',async()=> {
  const{order}=await fixture('debit');
  await Order.updateOne({_id:order.id},{$unset:{cardTxRef:1}});
  await assert.rejects(E.createOp({
    cardId,
    type:'debit',
    params:{txRef},
    ...actor
  }),{code:'OP_STATE'});
});
it('signed expired operation never enables wallet re-sign',async()=> {
  const{op}=await signed();
  await Op.updateOne({_id:op.id},{$set:{expireAt:new Date(Date.now()-1000)}});
  const next=await E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    ...actor
  });
  await assert.rejects(E.signOp({opId:next.id,challengeHex,...actor}),{code:'OP_STATE'});
});
for(
const [sw,status]
of [['6F10','failed'],['6F20','failed'],['6F21','failed'],['6982','failed'],['6985','sent'],['6F11','sent']])
  it('debit SW '+sw+' keeps recoverable authorization',async()=> {
    const{op}=await signed('debit');
    await E.confirmOp({opId:op.id,sw,...actor});
    const tx=await Tx.findOne();
    assert.equal(tx.status,status);
    assert.equal(tx.signedOpId,op.id);
    assert.equal((await Customer.findOne()).totalSpent,0);
    assert.equal((await Order.findOne()).paymentStatus,'unpaid');
  });
it('use ticket records checkin and rejects wrong owner',async()=> {
  await fixture();
  const now=new Date();
  const order=await Order.create({
    orderCode:'OD1234567890',
    customerId:ownerId,
    paymentStatus:'paid',
    status:'initial',
    items:[{
      tourId:'123456789012345678901234',
      departureDate:now,
      quantityAdult:1,
      ticketStatus:'written'
    }]
  });
  const admin={actorType:'admin',actorId:'123456789012345678901234'};
  const op=await E.createOp({
    cardId,
    type:'use-ticket',
    params:{orderId:order.id,itemIndex:0},
    ...admin
  });
  assert.equal((await E.signOp({opId:op.id,challengeHex,...admin})).apdu.slice(2,4),'62');
  await E.confirmOp({opId:op.id,sw:'9000',...admin});
  const item=(await Order.findById(order.id)).items[0];
  assert.equal(item.ticketStatus,'used');
  assert.equal(item.checkedInBy,admin.actorId);
  assert.ok(item.checkedInAt);
});
it('profile commit applies allowed customer update only after reported success',async()=> {
  await fixture();
  const S=require('../../public/assets/js/card/card-shared');
  const dataHex=Buffer.from(S.encodeProfile({phone:'0900000000'})).toString('hex');
  const op=await E.createOp({
    cardId,
    type:'commit-write',
    params:{target:1,dataHex,customerUpdate:{phone:'0900000000'}},
    ...actor
  });
  const {apdu}=await E.signOp({opId:op.id,challengeHex,...actor});
  assert.equal(apdu.slice(2,4),'43');
  assert.equal((await Customer.findOne()).phone,undefined);
  await E.confirmOp({opId:op.id,sw:'9000',...actor});
  assert.equal((await Customer.findOne()).phone,'0900000000');
  assert.equal((await Customer.findOne()).totalSpent,0);
});
it('API admin revalidates permissions stepup and mandatory staff card',async()=> {
  await fixture();
  process.env.JWT_SECRET='fixture-task5-secret';
  const role=await Role.create({permissions:[]});
  const admin=await Account.create({
    email:'admin@example.invalid',
    role:role.id,
    status:'active',
    cardRequired:true
  });
  const a={actorType:'admin',actorId:admin.id};
  const op=await E.createOp({
    cardId,
    type:'reset-pin',
    params:{newPin:'827491'},
    ...a
  });
  const headers=claims=>({Cookie:'token='+jwt.sign({id:admin.id,email:admin.email,...claims},process.env.JWT_SECRET)});
  await http(async post=> {
    let out=await post('/op/sign',{opId:op.id,challenge:challengeHex},headers({stepUpAt:Date.now()}));
    assert.equal(out.status,403);
    await Role.updateOne({_id:role.id},{$set:{permissions:['card-reset-pin']}});
    out=await post('/op/sign',{opId:op.id,challenge:challengeHex},headers({stepUpAt:Date.now()}));
    assert.equal(out.status,403);
    const staffId='22'.repeat(16);
    await Card.create({
      cardId:staffId,
      cardType:'staff',
      ownerId:admin.id,
      status:'active',
      publicKeyModulus:(await Card.findOne({cardId})).publicKeyModulus
    });
    out=await post('/op/sign',{opId:op.id,challenge:challengeHex},headers({cardId:staffId,stepUpAt:Date.now()-301000}));
    assert.equal(out.status,403);
    out=await post('/op/sign',{opId:op.id,challenge:challengeHex},headers({cardId:staffId,stepUpAt:Date.now()}));
    assert.equal(out.status,200);
    await Role.updateOne({_id:role.id},{$set:{permissions:[]}});
    out=await post('/op/confirm',{opId:op.id,response:'',sw:'9000'},headers({cardId:staffId,stepUpAt:Date.now()}));
    assert.equal(out.status,403);
  });
});
it('two operations for one wallet transaction race to one signed authorization',async()=> {
  await fixture();
  const ops=await Promise.all([1,2].map(()=>E.createOp({
      cardId,
      type:'credit',
      params:{txRef},
      ...actor
    })));
  const outcomes=await Promise.allSettled(ops.map(op=>E.signOp({opId:op.id,challengeHex,...actor})));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await Op.countDocuments({status:'prepared'}),1);
});
it('signature failure rolls back durable authorization and operation state',async()=> {
  await fixture();
  const op=await E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    ...actor
  });
  const C=require('../../helpers/card-crypto.helper'),original=C.signServer;
  C.signServer=()=> {
    throw new Error('fixture signer unavailable');
  };
  try {
    await assert.rejects(E.signOp({opId:op.id,challengeHex,...actor}),/fixture signer unavailable/);
  }
  finally {
    C.signServer=original;
  }
  const tx=await Tx.findOne();
  assert.equal(tx.status,'pending-card');
  assert.equal(tx.signedOpId,undefined);
  assert.equal((await Op.findById(op.id)).status,'draft');
});
it('customer and staff type mismatches cannot sign wallet or access foreign tickets',async()=> {
  const{card}=await fixture();
  await Card.updateOne({_id:card._id},{$set:{cardType:'staff'}});
  await assert.rejects(E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    actorType:'system',
    actorId:'customer:'+ownerId
  }),{code:'OP_FORBIDDEN'});
  await Card.updateOne({_id:card._id},{$set:{cardType:'customer'}});
  const order=await Order.create({
    orderCode:'OD1234567890',
    customerId:'987654321098765432109876',
    paymentStatus:'paid',
    status:'initial',
    items:[{
      tourId:'123456789012345678901234',
      departureDate:new Date(),
      quantityAdult:1,
      ticketStatus:'pending'
    }]
  });
  await assert.rejects(E.createOp({
    cardId,
    type:'write-ticket',
    params:{orderId:order.id,itemIndex:0},
    actorType:'system',
    actorId:'customer:'+ownerId
  }),{code:'OP_STATE'});
});
it('unsigned success and altered transaction source never apply money',async()=> {
  const{op,card,tx}=await signed();
  assert.equal((await E.confirmOp({
    opId:op.id,
    responseHex:'',
    sw:'9000',
    ...actor
  })).ok,false);
  await Tx.updateOne({_id:tx._id},{$set:{source:'refund'}});
  assert.equal(await E.applyReceipt({card,tx,responseHex:receipt()}),false);
  assert.equal((await Card.findOne()).balance,0);
});
it('sync next issues only server-directed state and no work for unknown or issuing card',async()=> {
  await fixture();
  await Card.updateOne({cardId},{$set:{status:'locked'}});
  await http(async post=> {
    let out=await post('/sync/next',{cardId,cardState:2,challenge:challengeHex});
    assert.equal(out.status,200);
    assert.equal(out.body.step.apdu.slice(2,6),'7003');
    await Card.updateOne({cardId},{$set:{status:'issuing'}});
    out=await post('/sync/next',{cardId,cardState:2,challenge:challengeHex});
    assert.equal(out.body.step,null);
    out=await post('/sync/next',{cardId:'99'.repeat(16),cardState:2,challenge:challengeHex});
    assert.equal(out.body.step,null);
  });
});
it('load context selects pending deletes and writes for current owner paid orders',async()=> {
  const{card}=await fixture();
  await Tx.deleteMany({});
  const P=require('../../helpers/card-sync.helper');
  const item={tourId:'123456789012345678901234',departureDate:new Date(),quantityAdult:1};
  const deletion=await Order.create({
    orderCode:'OD1234567890',
    customerId:ownerId,
    status:'cancel',
    items:[{...item,ticketStatus:'pending-delete'}]
  });
  const write=await Order.create({
    orderCode:'OD1234567891',
    customerId:ownerId,
    paymentStatus:'paid',
    status:'initial',
    items:[{...item,ticketStatus:'pending'}]
  });
  await Order.create({
    orderCode:'OD1234567892',
    customerId:ownerId,
    paymentStatus:'unpaid',
    status:'initial',
    items:[{...item,ticketStatus:'pending'}]
  });
  const ctx=await P.loadSyncContext(card);
  assert.equal(ctx.pendingDeleteItem.orderId,deletion.id);
  assert.equal(ctx.pendingWriteItem.orderId,write.id);
});
it('API oversized JSON returns generic JSON without exposing parser stack',async()=> {
  await fixture();
  await http(async post=> {
    const out=await post('/sync/next',JSON.stringify({
      cardId,
      cardState:2,
      challenge:challengeHex,
      padding:'X'.repeat(110000)
    }));
    assert.equal(out.status,400);
    assert.equal(out.body.errorCode,'INVALID_INPUT');
    assert.equal(JSON.stringify(out.body).includes('stack'),false);
  });
});
it('API response envelope preserves success and error contract for sign confirm receipt and validation',async()=> {
  await fixture();
  process.env.JWT_SECRET='fixture-task5-secret';
  const op=await E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    ...actor
  });
  const cookie={Cookie:'customerToken='+jwt.sign({customerId:ownerId,cardId},process.env.JWT_SECRET,{expiresIn:'1d'})};
  await http(async post=> {
    let out=await post('/op/sign',{opId:op.id,challenge:challengeHex},cookie);
    assert.equal(out.body.code,'success');
    assert.equal(typeof out.body.message,'string');
    assert.equal(typeof out.body.apdu,'string');
    out=await post('/op/confirm',{opId:op.id,response:receipt(),sw:'9000'},cookie);
    assert.equal(out.body.code,'success');
    assert.equal(out.body.ok,true);
    out=await post('/sync/receipt',{
      cardId,
      txRef,
      response:receipt(),
      sw:'9000'
    });
    assert.equal(out.body.code,'error');
    assert.equal(out.body.ok,false);
    out=await post('/sync/next',{});
    assert.equal(out.body.code,'error');
    assert.equal(out.body.errorCode,'INVALID_INPUT');
    out=await post('/unknown',{});
    assert.equal(out.body.code,'error');
    assert.equal(out.body.errorCode,'NOT_FOUND');
    out=await post('/sync/next',{cardId:'99'.repeat(16),cardState:2,challenge:challengeHex});
    assert.equal(out.body.code,'success');
    assert.equal(typeof out.body.message,'string');
  });
});
it('anonymous fake challenge cannot consume wallet authorization or create operation',async()=> {
  await fixture();
  await http(async post=> {
    const out=await post('/sync/next',{cardId,cardState:2,challenge:challengeHex});
    assert.equal(out.status,200);
    assert.equal(out.body.step,null);
    assert.equal(out.body.requiresAuth,true);
    assert.equal(await Op.countDocuments(),0);
    const tx=await Tx.findOne();
    assert.equal(tx.status,'pending-card');
    assert.equal(tx.signedOpId,undefined);
  });
});
it('privileged sync binds current owner and rejects another actor confirmation',async()=> {
  await fixture();
  process.env.JWT_SECRET='fixture-task5-secret';
  const cookie=id=>({Cookie:'customerToken='+jwt.sign({customerId:id,cardId},process.env.JWT_SECRET,{expiresIn:'1d'})});
  await http(async post=> {
    let out=await post('/sync/next',{cardId,cardState:2,challenge:challengeHex},cookie('987654321098765432109876'));
    assert.equal(out.status,403);
    assert.equal(await Op.countDocuments(),0);
    out=await post('/sync/next',{cardId,cardState:2,challenge:challengeHex},cookie(ownerId));
    assert.equal(out.status,200);
    assert.equal(out.body.step.kind,'op');
    const opId=out.body.step.opId;
    const op=await Op.findById(opId);
    assert.equal(op.actorType,'system');
    assert.equal(op.actorId,'customer:'+ownerId);
    out=await post('/sync/confirm',{opId,response:receipt(),sw:'9000'},cookie('987654321098765432109876'));
    assert.equal(out.status,403);
    assert.equal((await Card.findOne()).balance,0);
    out=await post('/sync/confirm',{opId,response:receipt(),sw:'9000'},cookie(ownerId));
    assert.equal(out.body.ok,true);
    assert.equal((await Card.findOne()).balance,500000);
  });
});
it('customer cannot forge profile identity by omitting customerUpdate or signing photo',async()=> {
  await fixture();
  const S=require('../../public/assets/js/card/card-shared');
  const dataHex=Buffer.from(S.encodeProfile({fullName:'Forged identity'})).toString('hex');
  await assert.rejects(E.createOp({
    cardId,
    type:'commit-write',
    params:{target:1,dataHex},
    ...actor
  }),{code:'OP_STATE'});
  await assert.rejects(E.createOp({
    cardId,
    type:'commit-write',
    params:{target:2,dataHex:'AABB'},
    ...actor
  }),{code:'OP_FORBIDDEN'});
});
it('pending ticket search skips malformed first sibling and malformed key/date',async()=> {
  const{card}=await fixture();
  await Tx.deleteMany({});
  const order=await Order.create({
    orderCode:'OD1234567890',
    customerId:ownerId,
    paymentStatus:'paid',
    status:'initial',
    items:[{
      tourId:'123456789012345678901234',
      departureDate:new Date(),
      quantityAdult:0,
      ticketStatus:'pending'
    },{
      tourId:'bad',
      departureDate:new Date(),
      quantityAdult:1,
      ticketStatus:'pending'
    },{
      tourId:'123456789012345678901234',
      departureDate:'bad-date',
      quantityAdult:1,
      ticketStatus:'pending'
    },{
      tourId:'123456789012345678901234',
      departureDate:new Date(),
      quantityAdult:1,
      ticketStatus:'pending'
    }]
  });
  const ctx=await require('../../helpers/card-sync.helper').loadSyncContext(card);
  assert.deepEqual(ctx.pendingWriteItem,{orderId:order.id,itemIndex:3});
});
it('confirm and recovery audit include card identity and only one success per receipt',async()=> {
  const{op,card,tx}=await signed();
  await E.confirmOp({
    opId:op.id,
    sw:'9000',
    responseHex:'',
    ...actor
  });
  const failure=await CardLog.findOne({action:'card-op-confirm'}).lean();
  assert.equal(failure.cardId,cardId);
  assert.equal(failure.result,'fail');
  assert.equal(await E.applyReceipt({card,tx,responseHex:receipt()}),true);
  assert.equal(await E.applyReceipt({card,tx,responseHex:receipt()}),false);
  const logs=await CardLog.find({action:'card-receipt-recovery'}).lean();
  assert.equal(logs.length,2);
  assert.equal(logs.filter(x=>x.result==='success').length,1);
  assert.ok(logs.every(x=>x.cardId===cardId));
  assert.equal(JSON.stringify(logs).includes('827491'),false);
});
it('issuing issuer with only card-issue can sign and confirm both commits',async()=> {
  const{card}=await fixture();
  process.env.JWT_SECRET='fixture-task5-secret';
  const role=await Role.create({permissions:['card-issue']});
  const admin=await Account.create({email:'issuer@example.invalid',role:role.id,status:'active'});
  const issuer={actorType:'admin',actorId:admin.id};
  await Card.updateOne({_id:card._id},{$set:{status:'issuing',issuedBy:admin.id,issuance:{expireAt:new Date(Date.now()+300000)}}});
  const headers={Cookie:'token='+jwt.sign({id:admin.id,email:admin.email},process.env.JWT_SECRET)};
  await http(async post=> {
    for(
    const target
    of [1,2]) {
      const op=await E.createOp({
        cardId,
        type:'commit-write',
        params:{target,dataHex:'010141'},
        ...issuer
      });
      await Card.updateOne({_id:card._id},{$set:{[target===1?'issuance.profileOpId':'issuance.photoOpId']:op.id}});
      assert.equal((await post('/op/sign',{opId:op.id,challenge:challengeHex},headers)).status,200);
      assert.equal((await post('/op/confirm',{opId:op.id,response:'',sw:'9000'},headers)).body.ok,true);
    }
    const op=await E.createOp({
      cardId,
      type:'commit-write',
      params:{target:1,dataHex:'010141'},
      ...issuer
    });
    await Card.updateOne({_id:card._id},{$set:{issuedBy:'987654321098765432109876'}});
    assert.equal((await post('/op/sign',{opId:op.id,challenge:challengeHex},headers)).status,403);
  });
});
it('customer profile keeps persisted identity and encodes stored date of birth',async()=> {
  await fixture();
  await Customer.updateOne({_id:ownerId},{$set:{fullName:'Khách hợp lệ',dob:new Date('1998-03-14T00:00:00.000Z')}});
  const S=require('../../public/assets/js/card/card-shared');
  const dataHex=Buffer.from(S.encodeProfile({fullName:'Khách hợp lệ',dob:'19980314',phone:'0900000000'})).toString('hex');
  const op=await E.createOp({
    cardId,
    type:'commit-write',
    params:{target:1,dataHex,customerUpdate:{phone:'0900000000'}},
    ...actor
  });
  assert.equal((await E.signOp({opId:op.id,challengeHex,...actor})).apdu.slice(2,4),'43');
  await E.confirmOp({opId:op.id,sw:'9000',...actor});
  assert.equal((await Customer.findOne()).fullName,'Khách hợp lệ');
});
it('anonymous ticket sync requires auth before creating any signed operation',async()=> {
  await fixture();
  await Tx.deleteMany({});
  const order=await Order.create({
    orderCode:'OD1234567890',
    customerId:ownerId,
    paymentStatus:'paid',
    status:'initial',
    items:[{
      tourId:'123456789012345678901234',
      departureDate:new Date(),
      quantityAdult:1,
      ticketStatus:'pending'
    }]
  });
  await http(async post=> {
    for(
    const deleting
    of [false,true]) {
      if(deleting)
        await Order.updateOne({_id:order.id},{$set:{status:'cancel','items.0.ticketStatus':'pending-delete'}});
      const out=await post('/sync/next',{cardId,cardState:2,challenge:challengeHex});
      assert.equal(out.body.requiresAuth,true);
      assert.equal(out.body.step,null);
      assert.equal(await Op.countDocuments(),0);
      assert.equal((await Order.findById(order.id)).items[0].ticketStatus,deleting?'pending-delete':'pending');
    }
  });
});
it('admin privileged sync rechecks cash step-up and role permissions before confirmation',async()=> {
  await fixture();
  process.env.JWT_SECRET='fixture-task5-secret';
  const role=await Role.create({permissions:['card-topup']});
  const admin=await Account.create({email:'sync-admin@example.invalid',role:role.id,status:'active'});
  const staffCardId='AA'.repeat(16);
  await Card.create({cardId:staffCardId,ownerId:admin.id,cardType:'staff',status:'active'});
  const headers=claims=>({Cookie:'token='+jwt.sign({id:admin.id,email:admin.email,cardId:staffCardId,...claims},process.env.JWT_SECRET)});
  await http(async post=> {
    let out=await post('/sync/next',{cardId,cardState:2,challenge:challengeHex},headers({}));
    assert.equal(out.status,403);
    assert.equal(await Op.countDocuments(),0);
    out=await post('/sync/next',{cardId,cardState:2,challenge:challengeHex},headers({stepUpAt:Date.now()}));
    assert.equal(out.status,200);
    const opId=out.body.step.opId;
    assert.equal((await Op.findById(opId)).actorId,'admin:'+admin.id);
    await Role.updateOne({_id:role.id},{$set:{permissions:[]}});
    out=await post('/sync/confirm',{opId,response:receipt(),sw:'9000'},headers({stepUpAt:Date.now()}));
    assert.equal(out.status,403);
    assert.equal((await Card.findOne({cardId})).balance,0);
  });
});
it('bound system engine rejects unbound creation and different signer',async()=> {
  await fixture();
  await assert.rejects(E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    actorType:'system'
  }),{code:'OP_FORBIDDEN'});
  const op=await E.createOp({
    cardId,
    type:'credit',
    params:{txRef},
    actorType:'system',
    actorId:'customer:'+ownerId
  });
  await assert.rejects(E.signOp({opId:op.id,challengeHex,actorType:'system'}),{code:'OP_FORBIDDEN'});
  await assert.rejects(E.signOp({
    opId:op.id,
    challengeHex,
    actorType:'customer',
    actorId:'987654321098765432109876'
  }),{code:'OP_FORBIDDEN'});
  assert.equal((await Tx.findOne()).signedOpId,undefined);
});
it('confirm audit records op type card and safe params but never PIN or key material',async()=> {
  const{op,order}=await signed('debit');
  assert.equal((await E.confirmOp({opId:op.id,responseHex:receipt({type:'debit',balance:400000}),sw:'9000',...actor})).ok,true);
  const entry=await CardLog.findOne({action:'card-op-confirm',result:'success'}).lean();
  assert.equal(entry.cardId,cardId);
  assert.deepEqual(entry.detail,{opId:op.id,sw:'9000',type:'debit',txRef,amount:500000,orderId:order.id});
  const adminId='123456789012345678901234';
  const reset=await E.createOp({cardId,type:'reset-pin',params:{newPin:'827491'},actorType:'admin',actorId:adminId});
  await E.signOp({opId:reset.id,challengeHex,actorType:'admin',actorId:adminId});
  const mail=require('../../helpers/mail.helper'),saved=mail.sendMail;
  mail.sendMail=()=>({sent:true});
  try {
    assert.equal((await E.confirmOp({opId:reset.id,sw:'9000',actorType:'admin',actorId:adminId})).ok,true);
  }
  finally {
    mail.sendMail=saved;
  }
  const resetLog=await CardLog.findOne({action:'card-op-confirm','detail.opId':reset.id}).lean();
  assert.equal(resetLog.detail.type,'reset-pin');assert.equal(resetLog.cardId,cardId);
  const raw=JSON.stringify(await CardLog.find().lean());
  for(const secret of ['827491','newPin','encryptedPin','dataHex'])assert.ok(!raw.includes(secret),secret);
});
it('failures thrown inside sign and confirm write a fail audit with the error code',async()=> {
  const{op}=await signed();
  const stranger={actorType:'customer',actorId:'987654321098765432109876'};
  await assert.rejects(E.confirmOp({opId:op.id,responseHex:receipt(),sw:'9000',...stranger}),/OP_FORBIDDEN/);
  const forbidden=await CardLog.findOne({action:'card-op-confirm',result:'fail'}).lean();
  assert.equal(forbidden.cardId,cardId);assert.equal(forbidden.detail.errorCode,'OP_FORBIDDEN');assert.equal(forbidden.detail.opId,op.id);assert.equal(forbidden.detail.type,'credit');
  await assert.rejects(E.signOp({opId:op.id,challengeHex,...actor}),/OP_STATE/);
  const resign=await CardLog.findOne({action:'card-op-sign',result:'fail'}).lean();
  assert.equal(resign.cardId,cardId);assert.equal(resign.detail.errorCode,'OP_STATE');assert.equal(resign.detail.type,'credit');assert.equal(resign.detail.txRef,txRef);
  await assert.rejects(E.confirmOp({opId:'0123456789abcdef0123abcd',sw:'9000',...actor}),/OP_NOT_FOUND/);
  assert.ok(await CardLog.findOne({action:'card-op-confirm',result:'fail','detail.errorCode':'OP_NOT_FOUND'}));
  // Op hợp lệ vẫn xác nhận được sau các lần từ chối.
  assert.equal((await E.confirmOp({opId:op.id,responseHex:receipt(),sw:'9000',...actor})).ok,true);
});
it('API audits sync step creation and refusals thrown before the engine runs',async()=> {
  await fixture();
  process.env.JWT_SECRET='fixture-task5-secret';
  const cookie=id=>({Cookie:'customerToken='+jwt.sign({customerId:id,cardId},process.env.JWT_SECRET,{expiresIn:'1d'})});
  await http(async post=> {
    const out=await post('/sync/next',{cardId,cardState:2,challenge:challengeHex},cookie(ownerId));
    assert.equal(out.status,200);
    const created=await CardLog.findOne({action:'card-sync-op',result:'success'}).lean();
    assert.equal(created.cardId,cardId);assert.equal(created.actorType,'customer');assert.equal(created.actorId,ownerId);
    assert.deepEqual(created.detail,{opId:out.body.step.opId,type:'credit',txRef});
    const refused=await post('/op/sign',{opId:out.body.step.opId,challenge:challengeHex},cookie('987654321098765432109876'));
    assert.equal(refused.status,403);
    const entry=await CardLog.findOne({action:'card-op-sign',result:'fail'}).lean();
    assert.equal(entry.detail.errorCode,'OP_FORBIDDEN');assert.equal(entry.detail.opId,out.body.step.opId);
    const stranger=await post('/sync/confirm',{opId:out.body.step.opId,response:receipt(),sw:'9000'},cookie('987654321098765432109876'));
    assert.equal(stranger.status,403);
    assert.equal(await CardLog.countDocuments({action:'card-op-confirm',result:'fail','detail.errorCode':'OP_FORBIDDEN'}),1);
    // Lỗi đã được engine ghi (op nháp chưa ký) thì handler không ghi trùng.
    const draft=await E.createOp({cardId,type:'credit',params:{txRef},...actor});
    const early=await post('/op/confirm',{opId:draft.id,response:receipt(),sw:'9000'},cookie(ownerId));
    assert.equal(early.status,409);
    assert.equal(await CardLog.countDocuments({action:'card-op-confirm',result:'fail','detail.opId':draft.id}),1);
  });
});
