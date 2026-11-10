const {test}=require('node:test');
const assert=require('node:assert/strict');
const browser=require('../public/admin/assets/js/card-admin');
const cardId='11'.repeat(16),requestId='AA'.repeat(16);
const ok=value=>({ok:true,status:200,json:async()=>({code:'success',...value})});

// Bắt tạo op trước khi đối chiếu thẻ đang cắm, hoặc lộ PIN từ create thay vì confirm.
test('reset flow guards target before create and returns only first confirm PIN without retrying reset APDU',async()=>{
  const events=[],client={openSession:async settings=>{assert.deepEqual(settings,{expectedCardId:cardId,sync:false});events.push('guard');return {cardId,state:2};},runSignedOp:async settings=>{events.push('reset');assert.equal(settings.opId,'22'.repeat(12));return {ok:true,result:{newPin:'827491',emailStatus:'sent'}};}};
  const fetch=async(url,options)=>{assert.equal(url,'/admin/card/reset-pin');assert.deepEqual(JSON.parse(options.body),{cardId});events.push('create');return ok({opId:'22'.repeat(12)});};
  const result=await browser.resetPinFlow({cardId},{client,fetch});assert.equal(result.newPin,'827491');assert.deepEqual(events,['guard','create','reset']);
  events.length=0;client.openSession=async()=>{throw new Error('Thẻ khác');};await assert.rejects(browser.resetPinFlow({cardId},{client,fetch}),/Thẻ khác/);assert.deepEqual(events,[]);
});
test('reset flow does not issue another reset after ambiguous signed operation response',async()=>{
  let creates=0,runs=0;await assert.rejects(browser.resetPinFlow({cardId},{client:{openSession:async()=>({state:2,cardId}),runSignedOp:async()=>{runs++;throw new Error('Mất phản hồi');}},fetch:async()=>{creates++;return ok({opId:'22'.repeat(12)});}}),/Mất phản hồi/);assert.equal(creates,1);assert.equal(runs,1);
});
test('cash lost create reply reuses immutable body and key then syncs and reads original done transaction',async()=>{
  const intent={cardId,amount:500000,requestId},requests=[],events=[];
  const result=await browser.cashTopupFlow(intent,{client:{openSession:async settings=>{assert.equal(settings.expectedCardId,cardId);events.push('sync');return {state:2,cardId};}},fetch:async(url,options)=>{
    assert.equal(url,'/admin/card/topup-cash');requests.push({body:JSON.parse(options.body),key:options.headers['Idempotency-Key']});events.push('post');
    if(requests.length===1){intent.amount=900000;throw new Error('Mất phản hồi');}return ok({txRef:'33'.repeat(8),status:requests.length===2?'pending-card':'done'});
  }});
  assert.equal(result.status,'done');assert.equal(result.txRef,'33'.repeat(8));assert.deepEqual(requests,Array.from({length:3},()=>({body:{cardId,amount:500000},key:requestId})));assert.deepEqual(events,['sync','post','post','sync','post']);
});
test('cash ambiguous APDU outcome retains existing identity and next recovery never creates new key',async()=>{
  const intent={cardId,amount:500000,requestId},keys=[];let sync=0;
  const options={client:{openSession:async()=>{sync++;if(sync===2)throw new Error('Mất phản hồi CREDIT');return {state:2,cardId};}},fetch:async(url,options)=>{keys.push(options.headers['Idempotency-Key']);return ok({txRef:'33'.repeat(8),status:sync<3?'sent':'done'});}};
  await assert.rejects(browser.cashTopupFlow(intent,options),error=>error.txRef==='33'.repeat(8)&&/Mất phản hồi CREDIT/.test(error.message));
  assert.equal((await browser.cashTopupFlow(intent,options)).status,'done');assert.ok(keys.every(value=>value===requestId));
});
test('cash stale stepup authenticates staff once and asks switch target before resubmitting same intent',async()=>{
  let posts=0,opens=0,authenticated=0;
  const result=browser.cashTopupFlow({cardId,amount:500000,requestId},{client:{openSession:async options=>{opens++;return options?{state:2,cardId}:{state:2,cardType:2};},askPin:async()=>'827491',verifyPin:async()=>{},authenticate:async()=>{authenticated++;return {code:'success'};}},fetch:async()=>{posts++;return {ok:false,status:403,json:async()=>({code:'step-up-required'})};}});
  await assert.rejects(result,error=>error.code==='SWITCH_TARGET_CARD'&&/cắm lại/.test(error.message));assert.equal(posts,1);assert.equal(opens,2);assert.equal(authenticated,1);
});
test('cash wrong card guard stops before accepting money and failed pending status remains explicit',async()=>{
  let posts=0;await assert.rejects(browser.cashTopupFlow({cardId,amount:500000,requestId},{client:{openSession:async()=>{throw new Error('Thẻ khác');}},fetch:async()=>{posts++;}}),/Thẻ khác/);assert.equal(posts,0);
  const r=await browser.cashTopupFlow({cardId,amount:500000,requestId},{client:{openSession:async()=>({state:2,cardId})},fetch:async()=>ok({txRef:'33'.repeat(8),status:'failed'})});assert.equal(r.status,'failed');
});
test('stepup waits for staff card readiness and cancellation performs no authentication or second POST',async()=>{
  let ready,opens=0,posts=0,auth=0;const barrier=new Promise(resolve=>{ready=resolve;});
  const options={onStepUp:()=>barrier,client:{openSession:async settings=>{opens++;return settings?{state:2,cardId}:{state:2,cardType:2};},askPin:async()=>'827491',verifyPin:async()=>{},authenticate:async()=>{auth++;return {code:'success'};}},fetch:async()=>{posts++;return {ok:false,status:403,json:async()=>({code:'step-up-required'})};}};
  const flow=browser.cashTopupFlow({cardId,amount:500000,requestId},options),rejected=assert.rejects(flow,{code:'SWITCH_TARGET_CARD'});await new Promise(resolve=>setImmediate(resolve));assert.equal(opens,1);assert.equal(auth,0);ready();await rejected;assert.equal(auth,1);assert.equal(posts,1);
  opens=0;auth=0;posts=0;options.onStepUp=()=>{throw new Error('Đã hủy đổi thẻ');};await assert.rejects(browser.cashTopupFlow({cardId,amount:500000,requestId},options),/Đã hủy/);assert.equal(opens,1);assert.equal(auth,0);assert.equal(posts,1);
});
test('blank terminated or different target identity never creates reset or cash intent',async()=>{
  for(const info of [{state:0,cardId:'00'.repeat(16)},{state:127,cardId:'00'.repeat(16)},{state:2,cardId:'22'.repeat(16)}])for(const flow of [browser.resetPinFlow,browser.cashTopupFlow]){
    let posts=0;await assert.rejects(flow({cardId,amount:500000,requestId},{client:{openSession:async()=>info,runSignedOp:async()=>({ok:true,result:{newPin:'827491'}})},fetch:async()=>{posts++;return ok({opId:'22'.repeat(12),status:'done',txRef:'33'.repeat(8)});}}),/đúng thẻ/);assert.equal(posts,0);
  }
});
test('initial target guard reads identity without syncing preexisting cash before freshness or reset permission checks',async()=>{
  const C=require('../public/assets/js/card/card-client');let backend=0,agent=0;
  const client=C.create({origin:'https://travel.test',fetch:async(url,options)=>{
    if(!url.endsWith('/v1/transmit')){backend++;return {ok:false,json:async()=>({code:'error',errorCode:'OP_FORBIDDEN'})};}
    agent++;const ins=JSON.parse(options.body).apdus[0].slice(2,4);return {ok:true,json:async()=>({responses:[{sw:'9000',data:ins==='10'?cardId+'0102000501':ins==='30'?'AB'.repeat(16):''}]})};
  }});
  try{
    const info=await client.openSession({expectedCardId:cardId,sync:false});assert.equal(info.cardId,cardId);assert.equal(backend,0);assert.equal(agent,2);
    await assert.rejects(client.openSession({expectedCardId:'22'.repeat(16),sync:false}),/khác/);assert.equal(backend,0);
    // Cùng transport đã có pending cash không cho phép sync vì Step-up cũ; guard mới vẫn tới endpoint riêng.
    const posts=[];let guardOptions;const guarded={openSession:async settings=>{guardOptions=settings;return client.openSession(settings);},runSignedOp:async()=>({ok:true,result:{newPin:'827491',emailStatus:'failed'}})};
    assert.equal((await browser.cashTopupFlow({cardId,amount:500000,requestId},{client:guarded,fetch:async()=>{posts.push('cash');return ok({txRef:'33'.repeat(8),status:'done'});}})).status,'done');assert.deepEqual(guardOptions,{expectedCardId:cardId,sync:false});
    assert.equal((await browser.resetPinFlow({cardId},{client:guarded,fetch:async()=>{posts.push('reset');return ok({opId:'22'.repeat(12)});}})).newPin,'827491');assert.deepEqual(posts,['cash','reset']);assert.equal(backend,0);
    await assert.rejects(client.openSession({expectedCardId:cardId}),{code:'OP_FORBIDDEN'});assert.equal(backend,1);
  }finally{client.dispose();}
});
