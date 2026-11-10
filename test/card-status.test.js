const {test}=require('node:test');
const assert=require('node:assert/strict');
const engine=require('../helpers/card-op.helper');
const browser=require('../public/admin/assets/js/card-admin');

test('admin JWT keeps exact 1 or 30 day lifetime across a second boundary and preserves explicit expiry',t=>{
  const tokenHelper=require('../helpers/admin-token.helper'),jwt=require('jsonwebtoken');
  const previousSecret=process.env.JWT_SECRET;process.env.JWT_SECRET='task9-expiry-regression-secret';
  const now=Date.UTC(2026,10,10,0,0,0)+999,issuedAt=Math.floor(now/1000);
  try{
    for(const [options,lifetime]of [[{remember:false},86400],[{remember:true},2592000],[{expiresAt:issuedAt+1800},1800]]){
      let reads=0,encoded;
      const clock=t.mock.method(Date,'now',()=>now+(reads++?2:0));
      try{
        tokenHelper.issue({cookie(name,value){assert.equal(name,'token');encoded=value;}},{account:{id:'11'.repeat(12),email:'clock@example.invalid'},...options});
        const payload=jwt.decode(encoded);assert.equal(payload.iat,issuedAt);assert.equal(payload.exp,issuedAt+lifetime);assert.equal(payload.exp-payload.iat,lifetime);
      }finally{clock.mock.restore();}
    }
  }finally{if(previousSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousSecret;}
});

// Bắt sai cạnh trạng thái hoặc cho phép hồi sinh thẻ đã kết thúc.
test('card status permits only lock unlock and terminal revoke edges',()=>{
  assert.equal(typeof engine.cardStatus?.nextStatus,'function');
  for(const [current,action,want] of [['active','lock','locked'],['locked','unlock','active'],['active','revoke','revoked'],['locked','revoke','revoked'],['issuing','revoke','revoked'],['revoked','unlock',null],['failed','revoke',null],['active','unlock',null],['issuing','lock',null],['active','__proto__',null]])assert.equal(engine.cardStatus.nextStatus(current,action),want);
});

// Bắt retry vô hạn hoặc gửi PIN lên server thay vì proof qua CardClient.
test('status flow authenticates staff card on expired step-up and retries the identical action once',async()=>{
  const body={cardId:'11'.repeat(16),action:'revoke',reason:'Mất thẻ',refunded:true},events=[],requests=[];
  const client={openSession:async()=>{events.push('open');return {state:2,cardType:2};},askPin:async()=>{events.push('pin');return '582046';},verifyPin:async pin=>{assert.equal(pin,'582046');events.push('verify-pin');},authenticate:async urls=>{assert.deepEqual(urls,{challengeUrl:'/admin/card/step-up/challenge',verifyUrl:'/admin/card/step-up/verify'});events.push('auth');return {code:'success'};}};
  const result=await browser.statusFlow(body,{client,fetch:async(url,options)=>{assert.equal(url,'/admin/card/status');requests.push(JSON.parse(options.body));events.push('post');return {ok:requests.length===2,json:async()=>requests.length===1?{code:'step-up-required'}:{code:'success',status:'revoked'}};}});
  assert.equal(result.status,'revoked');assert.deepEqual(requests,[body,body]);assert.deepEqual(events,['post','open','pin','verify-pin','auth','post']);
});
test('status flow stops after one renewed step-up and refuses a locked staff card',async()=>{
  let attempts=0;
  const options={fetch:async()=>{attempts++;return {ok:false,json:async()=>({code:'step-up-required',message:'Hết hạn'})};},client:{openSession:async()=>({state:2,cardType:2}),askPin:async()=>'582046',verifyPin:async()=>{},authenticate:async()=>({code:'success'})}};
  await assert.rejects(browser.statusFlow({action:'revoke'},options));assert.equal(attempts,2);
  options.client.openSession=async()=>({state:3,cardType:2});attempts=0;
  await assert.rejects(browser.statusFlow({action:'revoke'},options),/nhân viên/);assert.equal(attempts,1);
});
test('sync for a detail page refuses a different physical card before requesting any server mutation',async()=>{
  const C=require('../public/assets/js/card/card-client');let serverCalls=0;
  const client=C.create({origin:'https://travel.test',fetch:async(url,options)=>{
    if(!url.endsWith('/v1/transmit')){serverCalls++;return {ok:true,json:async()=>({step:null})};}
    const ins=JSON.parse(options.body).apdus[0].slice(2,4);
    return {ok:true,json:async()=>({responses:[{sw:'9000',data:ins==='10'?'11'.repeat(16)+'0102000501':ins==='30'?'AB'.repeat(16):''}]})};
  }});
  try{await assert.rejects(client.openSession({expectedCardId:'22'.repeat(16)}),/khác/);assert.equal(serverCalls,0);}finally{client.dispose();}
});
test('repeated sync recognizes a terminated card with erased identity without starting server work',async()=>{
  const C=require('../public/assets/js/card/card-client');let requests=0;
  const client=C.create({origin:'https://travel.test',fetch:async(url,options)=>{
    assert.ok(url.endsWith('/v1/transmit'));requests++;
    const ins=JSON.parse(options.body).apdus[0].slice(2,4);
    return {ok:true,json:async()=>({responses:[{sw:'9000',data:ins==='10'?'00'.repeat(16)+'007F000001':''}]})};
  }});
  try{assert.equal((await client.openSession({expectedCardId:'11'.repeat(16)})).state,127);assert.equal(requests,2);}finally{client.dispose();}
});
test('sync stops when the physical card changes between rounds instead of starting work for the new identity',async()=>{
  const C=require('../public/assets/js/card/card-client');let swapped=false,nextCalls=0;
  const client=C.create({origin:'https://travel.test',fetch:async(url,options)=>{
    if(url.endsWith('/v1/transmit')){const ins=JSON.parse(options.body).apdus[0].slice(2,4);return {ok:true,json:async()=>({responses:[{sw:'9000',data:ins==='10'?(swapped?'22':'11').repeat(16)+'0102000501':ins==='30'?'AB'.repeat(16):''}]})};}
    if(url.endsWith('/confirm')){swapped=true;return {ok:true,json:async()=>({ok:true})};}
    nextCalls++;return {ok:true,json:async()=>({step:nextCalls===1?{kind:'op',opId:'AA'.repeat(12),apdu:'8070030080'+'00'.repeat(128)+'00'}:null})};
  }});
  try{await assert.rejects(client.openSession({expectedCardId:'11'.repeat(16)}),/khác/);assert.equal(nextCalls,1);}finally{client.dispose();}
});
