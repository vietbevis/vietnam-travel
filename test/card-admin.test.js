const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let admin;
try { admin=require('../public/admin/assets/js/card-admin'); } catch {}

test('crop photo preserves a centered 4:5 frame and compresses before accepting bytes',async()=>{
  assert.ok(admin,'card admin browser workflow must exist');
  const calls=[];
  const env={createImageBitmap:async()=>({width:1000,height:500,close(){}}),document:{createElement:()=>({getContext:()=>({drawImage:(...args)=>calls.push(args)}),toBlob:(cb,type,q)=>cb({arrayBuffer:async()=>new ArrayBuffer(q>0.4?11000:9000)})})}};
  const bytes=await admin.preparePhoto({},env);
  assert.equal(bytes.length,9000);
  assert.deepEqual(calls[0].slice(1),[300,0,400,500,0,0,160,200]);
});
test('photo compression refuses output exceeding card capacity at minimum quality',async()=>{
  assert.ok(admin,'card admin browser workflow must exist');
  await assert.rejects(admin.preparePhoto({},{createImageBitmap:async()=>({width:160,height:200,close(){}}),document:{createElement:()=>({getContext:()=>({drawImage(){}}),toBlob:cb=>cb({arrayBuffer:async()=>new ArrayBuffer(10081)})})}}),/Ảnh/);
});
test('workflow cancels a prepared issuance after ambiguous transport failure',async()=>{
  assert.ok(admin,'card admin browser workflow must exist');
  const calls=[];
  const fetch=async(url,options)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('prepare')?{code:'success',cardId:'11'.repeat(16),initApdu:'00010000',initialPin:'582046'}:{code:'success'}};};
  await assert.rejects(admin.issueFlow({photo:new Uint8Array([1])},{fetch,client:{openSession:async()=>({state:0}),transmit:async()=>{throw new Error('disconnect');}}}),/reset|cài lại/i);
  assert.deepEqual(calls,['/admin/card/issue/prepare','/admin/card/issue/cancel']);
});
test('workflow never cancels a card after finish response is lost without reporting ambiguity',async()=>{
  assert.ok(admin,'card admin browser workflow must exist');
  const calls=[];
  const fetch=async(url)=>{calls.push(url);if(url.endsWith('finish'))throw new Error('network');return {ok:true,json:async()=>url.endsWith('prepare')?{code:'success',cardId:'11'.repeat(16),initApdu:'00010000',initialPin:'582046',profileHex:'010141',profileOpId:'1',photoOpId:'2'}:{code:'success'}};};
  const client={openSession:async()=>({state:0}),transmit:async()=>[{data:'AA'.repeat(128),sw:'9000'}],verifyPin:async()=>{},writeTarget:async()=>{},runSignedOp:async()=>{}};
  await assert.rejects(admin.issueFlow({photo:new Uint8Array([1])},{fetch,client}),/kiểm tra|xác nhận/i);
});
test('sim reset targets the selected slot and requires Agent acknowledgement',async()=>{
  assert.equal(typeof admin.resetSim,'function');
  const result=await admin.resetSim({client:{status:async()=>({mode:'sim',slot:2})},fetch:async(url,request)=>{
    assert.equal(url,'http://127.0.0.1:31999/v1/sim/reset');
    assert.deepEqual(JSON.parse(request.body),{slot:2});
    return {ok:true,json:async()=>({slot:2})};
  }});
  assert.equal(result,true);
  await assert.rejects(admin.resetSim({client:{status:async()=>({mode:'pcsc',slot:null})}}),/thẻ ảo/);
});
test('prepare response loss retries the same client request identity before INIT',async()=>{
  const identities=[];
  let attempts=0;
  const fetch=async(url,options)=>{
    if(url.endsWith('prepare')){
      identities.push(JSON.parse(options.body).requestId);
      if(attempts++===0)throw new Error('response lost after commit');
      return {ok:true,json:async()=>({code:'success',cardId:'11'.repeat(16),initApdu:'00010000',initialPin:'582046'})};
    }
    return {ok:true,json:async()=>({code:'success'})};
  };
  await assert.rejects(admin.issueFlow({photo:new Uint8Array([1])},{fetch,client:{openSession:async()=>({state:0}),transmit:async()=>{throw new Error('Agent stopped');}}}));
  assert.equal(identities.length,2);
  assert.match(identities[0],/^[a-f0-9]{32}$/i);
  assert.equal(identities[0],identities[1]);
});
test('ambiguous prepare cancels by the identity known before receiving cardId',async()=>{
  const calls=[];
  await assert.rejects(admin.issueFlow({photo:new Uint8Array([1])},{client:{openSession:async()=>({state:0})},fetch:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});
    if(url.endsWith('prepare'))throw new Error('server response unavailable');
    return {ok:true,json:async()=>({code:'success',customerId:'0123456789abcdef01234567'})};
  }}));
  assert.equal(calls.at(-1).url,'/admin/card/issue/cancel');
  assert.deepEqual(calls.at(-1).body,{requestId:calls[0].body.requestId});
});
test('a definitive duplicate-owner prepare refusal keeps the actionable server message',async()=>{
  await assert.rejects(admin.issueFlow({photo:new Uint8Array([1])},{client:{openSession:async()=>({state:0})},fetch:async url=>url.endsWith('/prepare')?{ok:false,status:409,json:async()=>({code:'error',message:'Người này đã có thẻ đang hoạt động'})}:{ok:true,json:async()=>({code:'success'})}}),/đã có thẻ/);
});
