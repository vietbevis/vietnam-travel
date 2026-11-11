const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const UI=require('../public/assets/js/card-customer');
const id='A0'.repeat(16);
function client(calls,extra={}) {
  return{
    openSession:async opts=>{calls.push(['open',opts]);return{cardId:id,cardType:1,state:2,mustChangePin:false};},
    askPin:async()=>'582046',
    verifyPin:async()=>calls.push(['verify']),
    readProfile:async()=>{calls.push(['profile']);return{fullName:'Khách A',phone:'0901111111',idNumber:'123',dob:'19900102'};},
    runSignedOp:async opts=>{calls.push(['signed',opts]);return{ok:true};},
    ...extra
  };
}
const okFetch=calls=>async(url,options)=>{calls.push(['fetch',url,JSON.parse(options.body)]);return{ok:true,json:async()=>({code:'success',opId:'a'.repeat(24),amount:1500000})};};
test('payFlow syncs first then PIN then prepares then signs and confirms through server routes',async()=> {
  const calls=[];
  await UI.payFlow({client:client(calls),cardId:id,orderId:'b'.repeat(24),fetch:okFetch(calls)});
  assert.deepEqual(calls.map(c=>c[0]),['open','verify','fetch','signed']);
  assert.equal(calls[0][1].sync,undefined);
  assert.equal(calls[0][1].expectedCardId,id);
  assert.deepEqual(calls[2].slice(1),['/card-api/pay/prepare',{orderId:'b'.repeat(24)}]);
  assert.deepEqual(calls[3][1],{opId:'a'.repeat(24),signUrl:'/card-api/op/sign',confirmUrl:'/card-api/op/confirm'});
});
test('payFlow stops before any server call on wrong card and shows server refusal without signing',async()=> {
  const calls=[];
  await assert.rejects(UI.payFlow({client:client(calls,{openSession:async()=>({cardId:'B0'.repeat(16),cardType:1,state:2})}),cardId:id,orderId:'b'.repeat(24),fetch:okFetch(calls)}),/thẻ khác/);
  assert.equal(calls.length,0);
  const refused=async()=>({ok:false,json:async()=>({code:'error',message:'Số dư ví không đủ'})});
  await assert.rejects(UI.payFlow({client:client(calls),cardId:id,orderId:'b'.repeat(24),fetch:refused}),/Số dư ví không đủ/);
  assert.equal(calls.some(c=>c[0]==='signed'),false);
});
test('payFlow reports unconfirmed debit instead of success',async()=> {
  const calls=[];
  await assert.rejects(UI.payFlow({client:client(calls,{runSignedOp:async()=>({ok:false})}),cardId:id,orderId:'b'.repeat(24),fetch:okFetch(calls)}),/đối soát/);
});
test('autofillFlow reads only name and phone locally without syncing money',async()=> {
  const calls=[];
  const result=await UI.autofillFlow({client:client(calls)});
  assert.deepEqual(result,{fullName:'Khách A',phone:'0901111111'});
  assert.equal(calls[0][1].sync,false);
  assert.equal(calls.some(c=>c[0]==='fetch'),false);
});
test('mounted pay and autofill buttons drive the flows and redirect only after confirmed payment',async()=> {
  const calls=[],nodes={},listeners={};
  const node=(selector,extra={})=>nodes[selector]={textContent:'',value:'',disabled:false,dataset:{},handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},...extra};
  const status=node('[data-customer-status]');
  node('[data-card-pay]',{dataset:{cardId:id,orderId:'b'.repeat(24),phone:'0901111111'}});
  const pay=node('[data-card-pay-button]'),fill=node('[data-card-autofill]',{dataset:{cardId:''}});
  const name=node('#full-name-input'),phone=node('#phone-input');
  const window={document:{body:{},querySelector:s=>nodes[s]||null,querySelectorAll:()=>[]},CardShared:require('../public/assets/js/card/card-shared'),cardClient:client(calls),addEventListener:(n,fn)=>{listeners[n]=fn;},location:{assign(url){window.redirect=url;}},fetch:okFetch(calls)};
  vm.runInNewContext(fs.readFileSync('public/assets/js/card-customer.js','utf8'),{window,AbortController,setTimeout,clearTimeout,TypeError,console});
  await fill.handlers.click();
  assert.equal(name.value,'Khách A');
  assert.equal(phone.value,'0901111111');
  assert.equal(window.redirect,undefined);
  await pay.handlers.click();
  assert.equal(window.redirect,`/order/success?orderId=${'b'.repeat(24)}&phone=0901111111`);
  window.redirect=undefined;
  window.cardClient.runSignedOp=async()=>{throw Object.assign(new Error('x'),{sw:'6F10'});};
  await pay.handlers.click();
  assert.equal(window.redirect,undefined);
  assert.notEqual(status.textContent,'');
  assert.notEqual(status.textContent,'Đang xử lý…');
});
