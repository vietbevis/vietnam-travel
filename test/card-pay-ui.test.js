// Task 13: luồng thanh toán ví thẻ và tự điền thông tin phía trình duyệt.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const UI=require('../public/assets/js/card-customer');
const id='A0'.repeat(16);
function fixture(extra={}) {
  const calls=[];
  const client={
    openSession:async options=>{calls.push(['open',options]);return{cardId:id,cardType:1,state:2,mustChangePin:false};},
    askPin:async()=>{calls.push(['askPin']);return '582046';},
    verifyPin:async()=>{calls.push(['verify']);},
    readBalance:async()=>{calls.push(['balance']);return{balance:2000000,counter:3};},
    readProfile:async()=>{calls.push(['profile']);return{fullName:'Nguyễn Văn Thẻ',phone:'0912 345-678',idNumber:'999'};},
    runSignedOp:async options=>{calls.push(['run',options]);return{ok:true};},
    ...extra
  };
  const fetched=[];
  const fetch=async(url,options)=>{
    fetched.push([url,JSON.parse(options.body)]);
    return{ok:true,json:async()=>({code:'success',opId:'0123456789abcdef01234567',amount:1900000})};
  };
  return{calls,client,fetched,fetch};
}
const base=f=>({client:f.client,cardId:id,orderId:'0123456789abcdef01234567',total:1900000,fetch:f.fetch});

// Catches paying before PIN/prepare ordering and any amount sent from the browser.
test('pay flow runs openSession PIN verify prepare then signed debit and sends only orderId',async()=> {
  const f=fixture();
  const result=await UI.payFlow(base(f));
  assert.equal(result.status,'paid');
  assert.deepEqual(f.calls.map(c=>c[0]),['open','askPin','verify','balance','run']);
  assert.equal(f.calls[0][1].expectedCardId,id);
  assert.notEqual(f.calls[0][1].sync,false,'phải đồng bộ để khôi phục biên nhận');
  assert.deepEqual(f.fetched,[['/card-api/pay/prepare',{orderId:'0123456789abcdef01234567'}]]);
  assert.deepEqual(f.calls.at(-1)[1],{opId:'0123456789abcdef01234567',signUrl:'/card-api/op/sign',confirmUrl:'/card-api/op/confirm'});
});
test('chip balance below the total stops before prepare so no unresolved debit is created',async()=> {
  const f=fixture({readBalance:async()=>({balance:1899999,counter:1})});
  await assert.rejects(UI.payFlow(base(f)),{code:'INSUFFICIENT_BALANCE'});
  assert.equal(f.fetched.length,0);
  assert.ok(!f.calls.some(c=>c[0]==='run'));
});
test('server amount different from the displayed total is never signed',async()=> {
  const f=fixture();
  f.fetch=async()=>({ok:true,json:async()=>({code:'success',opId:'0123456789abcdef01234567',amount:1})});
  await assert.rejects(UI.payFlow({...base(f),fetch:f.fetch}),{code:'AMOUNT_MISMATCH'});
  assert.ok(!f.calls.some(c=>c[0]==='run'));
});
test('wrong card locked revoked or staff card stop before PIN and prepare',async()=> {
  for(const info of [{cardId:'B0'.repeat(16),cardType:1,state:2},{cardId:id,cardType:1,state:3},{cardId:id,cardType:1,state:127},{cardId:id,cardType:2,state:2}]) {
    const f=fixture({openSession:async()=>info});
    await assert.rejects(UI.payFlow(base(f)));
    assert.ok(!f.calls.some(c=>['askPin','verify','run'].includes(c[0])));
    assert.equal(f.fetched.length,0);
  }
});
test('connection loss or invalid confirm after the debit becomes pending sync while card SW errors are surfaced',async()=> {
  let f=fixture({runSignedOp:async()=>{throw Object.assign(new Error('REQUEST_TIMEOUT'),{code:'REQUEST_TIMEOUT'});}});
  await assert.rejects(UI.payFlow(base(f)),{code:'PAY_PENDING_SYNC'});
  f=fixture({runSignedOp:async()=>({ok:false})});
  await assert.rejects(UI.payFlow(base(f)),{code:'PAY_PENDING_SYNC'});
  f=fixture({runSignedOp:async()=>{throw Object.assign(new Error('x'),{sw:'6F10',code:'6F10'});}});
  await assert.rejects(UI.payFlow(base(f)),{sw:'6F10'});
});
test('paid or changed order at prepare asks the page to refresh instead of signing',async()=> {
  const f=fixture();
  f.fetch=async()=>({ok:false,json:async()=>({code:'error',errorCode:'ORDER_STATE',message:'x'})});
  assert.deepEqual(await UI.payFlow({...base(f),fetch:f.fetch}),{status:'refresh'});
  assert.ok(!f.calls.some(c=>c[0]==='run'));
});
test('messages show required Vietnamese states and SW texts',()=> {
  assert.equal(UI.message({sw:'6F10'}),'Số dư không đủ');
  assert.equal(UI.message({sw:'6982'}),'Chưa xác thực PIN');
  assert.equal(UI.message({code:'INSUFFICIENT_BALANCE'}),'Số dư ví không đủ');
  assert.match(UI.message({code:'PAY_PENDING_SYNC'}),/^Chờ đồng bộ/);
  assert.equal(UI.message({code:'UNRESOLVED_TX'}),'Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ');
});
// Catches autofill leaking chip data to the server or writing beyond the two contact fields.
test('autofill reads only name and phone after PIN without any server request or sync',async()=> {
  const f=fixture();
  const result=await UI.autofillFlow({client:f.client,cardId:id});
  assert.deepEqual(result,{fullName:'Nguyễn Văn Thẻ',phone:'0912345678'});
  assert.deepEqual(f.calls.map(c=>c[0]),['open','askPin','verify','profile']);
  assert.equal(f.calls[0][1].sync,false);
  assert.equal(f.fetched.length,0);
});
test('autofill rejects missing agent locked card and wrong card before reading the profile',async()=> {
  for(const client of [fixture({openSession:async()=>{throw new TypeError('fetch failed');}}).client,fixture({openSession:async()=>({cardId:id,cardType:1,state:3})}).client,fixture({openSession:async()=>({cardId:'B0'.repeat(16),cardType:1,state:2})}).client]) {
    let read=false;
    client.readProfile=async()=>{read=true;return{};};
    await assert.rejects(UI.autofillFlow({client,cardId:id}));
    assert.equal(read,false);
  }
  assert.match(UI.message(new TypeError('fetch failed')),/Card Agent/);
});
test('autofill ignores non-string chip fields and truncates oversized values',async()=> {
  const f=fixture({readProfile:async()=>({fullName:'A'.repeat(80),phone:{evil:true}})});
  const result=await UI.autofillFlow({client:f.client,cardId:id});
  assert.equal(result.fullName.length,50);
  assert.equal(result.phone,'');
});
function pageFixture(client,fetch) {
  const listeners={},nodes={};
  const node=(selector,extra={})=>nodes[selector]={textContent:'',disabled:false,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},...extra};
  const pay=node('[data-card-pay]',{dataset:{cardId:id,orderId:'0123456789abcdef01234567',total:'1900000',serverBalance:'2000000',successUrl:'/order/success?orderId=1&phone=2',unresolved:'0'}});
  const button=node('[data-card-pay-button]'),sync=node('[data-card-pay-sync]'),status=node('[data-card-pay-status]');
  const window={document:{body:{},querySelector:s=>nodes[s]||null,querySelectorAll:()=>[]},CardShared:require('../public/assets/js/card/card-shared'),cardClient:client,fetch,location:{href:'http://x/order/payment-card?orderId=1',assign(url){window.assigned=url;},reload(){window.reloaded=true;},replace(){}},addEventListener:(name,fn)=>{listeners[name]=fn;}};
  vm.runInNewContext(fs.readFileSync('public/assets/js/card-customer.js','utf8'),{window,AbortController,setTimeout,clearTimeout,TypeError,URL,console});
  return{window,pay,button,sync,status};
}
// Catches double click or second pending click creating two debits.
test('mounted pay button ignores repeated clicks while processing and redirects on success',async()=> {
  const f=fixture();
  let release;
  f.client.verifyPin=()=>new Promise(resolve=>{release=resolve;});
  const page=pageFixture(f.client,f.fetch);
  const first=page.button.handlers.click();
  const second=page.button.handlers.click();
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(page.status.textContent,'Đang xử lý…');
  assert.equal(page.button.disabled,true);
  release();
  await Promise.all([first,second]);
  assert.equal(f.fetched.length,1);
  assert.equal(f.calls.filter(c=>c[0]==='run').length,1);
  assert.equal(page.status.textContent,'Thành công');
  assert.equal(page.window.assigned,'/order/success?orderId=1&phone=2');
});
test('mounted pay page shows insufficient balance and pending sync states',async()=> {
  let f=fixture({readBalance:async()=>({balance:1,counter:1})});
  let page=pageFixture(f.client,f.fetch);
  await page.button.handlers.click();
  assert.equal(page.status.textContent,'Số dư ví không đủ');
  assert.equal(page.window.assigned,undefined);
  f=fixture({runSignedOp:async()=>{throw new Error('network');}});
  page=pageFixture(f.client,f.fetch);
  page.window.fetch=async(url,options)=>String(url).includes('/card-api/')?f.fetch(url,options):{redirected:false,url:'http://x/order/payment-card?orderId=1'};
  await page.button.handlers.click();
  assert.match(page.status.textContent,/^Chờ đồng bộ/);
  assert.equal(page.window.assigned,undefined);
});
test('pending sync recovered by receipt redirects to the success page',async()=> {
  const f=fixture({runSignedOp:async()=>{throw new Error('network');}});
  const page=pageFixture(f.client,f.fetch);
  page.window.fetch=async(url,options)=>String(url).includes('/card-api/')?f.fetch(url,options):{redirected:true,url:'http://x/order/success?orderId=1&phone=2'};
  await page.button.handlers.click();
  assert.equal(page.window.assigned,'/order/success?orderId=1&phone=2');
});
test('order form wires the card method redirect and the autofill button only touches contact inputs',()=> {
  const script=fs.readFileSync('public/assets/js/script.js','utf8');
  assert.match(script,/case "card":[\s\S]*\/order\/payment-card\?orderId=/);
  const block=script.slice(script.indexOf('data-card-autofill'),script.indexOf('// End Điền từ thẻ'));
  assert.ok(block.includes('autofillFlow'));
  assert.ok(!/fetch\(/.test(block));
  assert.ok(!/method|paymentMethod|total|price/i.test(block.replace(/Phương thức|giá, tổng tiền, phương thức thanh toán/g,'')));
});
