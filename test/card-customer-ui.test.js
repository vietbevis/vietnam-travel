const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const file='../public/assets/js/card-customer';
const UI=fs.existsSync(require('node:path').resolve('public/assets/js/card-customer.js'))?require(file):{};
const id='A0'.repeat(16);
const vm=require('node:vm');
function browserFixture(client){
  const listeners={},nodes={},body={cleared:false,replaceChildren(){this.cleared=true;}};
  function node(selector,extra={}){const item={textContent:'',disabled:false,hidden:false,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},...extra};nodes[selector]=item;return item;}
  const status=node('[data-customer-status]'),account=node('[data-card-account]',{dataset:{cardId:id,serverBalance:'700000'}}),balance=node('strong[data-server-balance]');
  nodes['[data-server-balance]']=account;
  node('[data-card-profile-read]');node('[data-card-balance]');node('[data-card-log]');node('[data-card-tickets]');node('[data-card-photo]',{removeAttribute(name){delete this[name];}});node('[data-card-mismatch]');
  const document={body,querySelector:selector=>nodes[selector]||null,querySelectorAll:selector=>selector==='[data-card-logout]'&&nodes[selector]?[nodes[selector]]:[]};
  const window={document,CardShared:require('../public/assets/js/card/card-shared'),cardClient:client,addEventListener:(name,fn)=>{listeners[name]=fn;},location:{replace(url){window.redirect=url;},reload(){window.reloaded=true;},assign(url){window.redirect=url;}},fetch:async()=>({ok:true,json:async()=>({code:'success'})})};
  return{window,document,status,account,balance,node,nodes,listeners,mount(){vm.runInNewContext(fs.readFileSync('public/assets/js/card-customer.js','utf8'),{window,AbortController,setTimeout,clearTimeout,TypeError,console});}};
}
function fixture(extra={}){const calls=[];return{calls,client:{openSession:async opts=>{calls.push(['open',opts]);return{cardId:id,cardType:1,state:2,mustChangePin:false};},askPin:async()=> '582046',verifyPin:async pin=>calls.push(['verify',pin]),authenticate:async args=>{calls.push(['auth',args]);return{code:'success'};},readProfile:async()=>({fullName:'Khách',dob:'19900102'}),readPhotoUrl:async()=> 'blob:fixture',readBalance:async()=>({balance:700000,counter:1}),readTxLog:async()=>[{type:1,amount:700000}],readTickets:async()=>[{orderCode:'ORDER'}],changePin:async(...args)=>calls.push(['change',...args]),...extra}};}
// Catches initial PIN bypass and authenticating before user confirms a strong new PIN.
test('first login requires old PIN strong matching new PIN then authenticates and synchronizes with cookie',async()=>{assert.equal(typeof UI.loginFlow,'function');const f=fixture({openSession:async opts=>{f.calls.push(['open',opts]);return{cardId:id,cardType:1,state:2,mustChangePin:true};}});const pins=['582046','790248','790248','790248'];f.client.askPin=async()=>pins.shift();await UI.loginFlow({client:f.client});assert.deepEqual(f.calls.filter(x=>x[0]==='change'),[['change','582046','790248','19900102']]);assert.ok(f.calls.findIndex(x=>x[0]==='change')<f.calls.findIndex(x=>x[0]==='auth'));assert.deepEqual(f.calls.at(-1),['open',{expectedCardId:id}]);});
test('weak mismatch wrong old PIN staff blank and locked card stop before authentication',async()=>{assert.equal(typeof UI.loginFlow,'function');for(const mode of ['weak','mismatch','wrong','staff','blank','locked']){const f=fixture({openSession:async()=>({cardId:id,cardType:mode==='staff'?2:mode==='blank'?0:1,state:mode==='locked'?3:mode==='blank'?0:2,mustChangePin:true})});let pins=mode==='weak'?['582046','123456','123456']:['582046','790248','790249'];f.client.askPin=async()=>pins.shift();if(mode==='wrong')f.client.verifyPin=async()=>{throw new Error('PIN sai');};await assert.rejects(UI.loginFlow({client:f.client}),mode);assert.equal(f.calls.some(x=>x[0]==='auth'),false,mode);}});
test('read flow verifies exact card and PIN again after mismatch sync before reading private chip data',async()=>{assert.equal(typeof UI.readFlow,'function');let count=0;const f=fixture({readBalance:async()=>({balance:++count===1?0:700000,counter:1})});const r=await UI.readFlow({client:f.client,cardId:id,serverBalance:700000,fetch:async()=>({ok:true,json:async()=>({code:'success',balance:700000,txCounter:1,pendingCredit:0})})});assert.equal(r.wallet.balance,700000);assert.equal(r.mismatch,false);assert.equal(f.calls.filter(x=>x[0]==='verify').length,2);assert.deepEqual(f.calls.filter(x=>x[0]==='open').map(x=>x[1]),[{expectedCardId:id,sync:false},{expectedCardId:id}]);assert.equal(r.transactions[0].amount,700000);assert.equal(r.tickets[0].orderCode,'ORDER');});
test('wrong card aborts read before PIN and profile flow sends only three fields then writes server TLV',async()=>{assert.equal(typeof UI.readFlow,'function');const wrong=fixture({openSession:async()=>({cardId:'B0'.repeat(16),cardType:1,state:2})});await assert.rejects(UI.readFlow({client:wrong.client,cardId:id,serverBalance:700000}));assert.equal(wrong.calls.length,0);const f=fixture();let posted;f.client.writeTarget=async(target,bytes)=>f.calls.push(['write',target,Array.from(bytes)]);f.client.runSignedOp=async()=>({ok:true});const result=await UI.profileFlow({client:f.client,cardId:id,fields:{phone:'1',emergencyName:'Mẹ',emergencyPhone:'2',email:'never-send'},fetch:async(url,options)=>{posted=JSON.parse(options.body);return{ok:true,json:async()=>({opId:'11'.repeat(12),profileHex:'010141'})};}});assert.deepEqual(posted,{phone:'1',emergencyName:'Mẹ',emergencyPhone:'2'});assert.deepEqual(f.calls.at(-1),['write',1,[1,1,65]]);assert.equal(result.ok,true);});
test('mounted card reader preserves account DOM and renders chip text with textContent instead of markup',async()=>{
  const f=fixture({readProfile:async()=>({fullName:'<img src=x onerror=alert(1)>'}),readTxLog:async()=>[{type:1,amount:700000,balanceAfter:700000,counter:1,txRef:'1234'}]});
  const browser=browserFixture(f.client),button=browser.node('[data-card-read]');browser.mount();await button.handlers.click();
  assert.equal(browser.account.textContent,'');assert.equal(browser.balance.textContent,'700.000 đ');assert.ok(browser.nodes['[data-card-profile-read]'].textContent.includes('<img src=x onerror=alert(1)>'));assert.equal(browser.status.textContent,'Đã đọc thẻ.');
});
test('header logout posts same-origin clears rendered sensitive state and pagehide prevents late repaint',async()=>{
  let disposed=false,posted;
  const browser=browserFixture({dispose(){disposed=true;}}),button=browser.node('[data-card-logout]');
  browser.window.fetch=async(url,options)=>{posted={url,options};return{ok:true,json:async()=>({code:'success'})};};browser.mount();await button.handlers.click();
  assert.equal(posted.url,'/card-api/logout');assert.equal(posted.options.credentials,'same-origin');assert.equal(posted.options.body,'{}');assert.equal(disposed,true);assert.equal(browser.document.body.cleared,true);assert.equal(browser.window.redirect,'/account/login');
  const f=fixture();let resume;f.client.readProfile=()=>new Promise(resolve=>{resume=resolve;});const hidden=browserFixture(f.client),read=hidden.node('[data-card-read]');hidden.mount();const pending=read.handlers.click();await new Promise(r=>setImmediate(r));hidden.listeners.pagehide();resume({fullName:'private'});await pending;assert.equal(hidden.nodes['[data-card-profile-read]'].textContent,'');
});
test('late logout body after pagehide cannot navigate or erase a newer page',async()=>{
  let finish;const browser=browserFixture({dispose(){}}),button=browser.node('[data-card-logout]');browser.window.fetch=async()=>({ok:true,json:()=>new Promise(resolve=>{finish=resolve;})});browser.mount();const pending=button.handlers.click();await new Promise(r=>setImmediate(r));browser.listeners.pagehide();finish({code:'success'});await pending;assert.equal(browser.window.redirect,undefined);assert.equal(browser.document.body.cleared,false);
});
test('initial birthday PIN revealed after forced change cannot authenticate and interrupted next login forces change again',async()=>{
  let mustChange=true,currentPin='582046',authenticated=0;
  const pins=['582046','140788','140788'];
  const f=fixture({openSession:async()=>({cardId:id,cardType:1,state:2,mustChangePin:mustChange}),askPin:async()=>{const value=pins.shift();if(value===undefined)throw Object.assign(new Error('cancel'),{code:'PIN_CANCELLED'});return value;},verifyPin:async value=>{assert.equal(value,currentPin);},readProfile:async()=>{if(mustChange)throw Object.assign(new Error('chưa đổi PIN'),{sw:'6985'});return{dob:'19880714'};},changePin:async(oldPin,newPin)=>{assert.equal(oldPin,currentPin);currentPin=newPin;mustChange=false;},authenticate:async()=>{authenticated++;return{code:'success'};}});
  await assert.rejects(UI.loginFlow({client:f.client}),{code:'PIN_CANCELLED'});assert.equal(authenticated,0);assert.equal(currentPin,'140788');
  pins.push('140788');await assert.rejects(UI.loginFlow({client:f.client}),{code:'PIN_CANCELLED'});assert.equal(authenticated,0);
  pins.push('140788','140788','728405','728405');await UI.loginFlow({client:f.client});assert.equal(currentPin,'728405');assert.equal(authenticated,1);
});
test('login fails closed on profile read errors other than known initial 6985 and accepts missing DOB with nonweak PIN',async()=>{
  for(const initial of [false,true]){let authenticated=false;const f=fixture({openSession:async()=>({cardId:id,cardType:1,state:2,mustChangePin:initial}),readProfile:async()=>{throw Object.assign(new Error('thẻ không đọc được'),{sw:'6F00'});},authenticate:async()=>{authenticated=true;}});await assert.rejects(UI.loginFlow({client:f.client}));assert.equal(authenticated,false);}
  let authenticated=false;const f=fixture({readProfile:async()=>({fullName:'Không ngày sinh'}),authenticate:async()=>{authenticated=true;return{code:'success'};}});await UI.loginFlow({client:f.client});assert.equal(authenticated,true);
});
test('topup=1 return page reports the real outcome: credited, pending, waiting, login, wrong card, no card',async()=>{
  const cases=[
    ['credited',{balance:800000,pendingCredit:0},'Đã ghi 100.000 đ vào thẻ.'],
    ['pending',{balance:700000,pendingCredit:100000},/chưa ghi được vào thẻ/],
    ['waiting',{balance:700000,pendingCredit:0},/chờ cổng thanh toán/],
    ['login',null,/đăng nhập lại/],
    ['wrong',{balance:700000,pendingCredit:0},/thẻ khác/],
    ['nocard',{balance:700000,pendingCredit:0},'Cắm thẻ để nhận tiền']
  ];
  for(const [name,snapshot,expected] of cases){
    const f=fixture({openSession:async opts=>{f.calls.push(['open',opts]);if(name==='nocard')throw new Error('no card');return{cardId:name==='wrong'?'B0'.repeat(16):id,cardType:1,state:2,mustChangePin:false};}});
    const browser=browserFixture(f.client);browser.window.location.search='?topup=1';
    browser.window.fetch=async()=>snapshot?{ok:true,json:async()=>({code:'success',...snapshot})}:{ok:false,json:async()=>({code:'error'})};
    browser.mount();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
    if(expected instanceof RegExp)assert.match(browser.status.textContent,expected);else assert.equal(browser.status.textContent,expected);
    assert.equal(f.calls.filter(call=>call[0]==='open').length,1);
  }
  // Return thất bại từ cổng: báo lỗi, không đụng tới thẻ.
  const f=fixture(),failed=browserFixture(f.client);failed.window.location.search='?topup=fail';failed.mount();await new Promise(r=>setImmediate(r));
  assert.match(failed.status.textContent,/không thành công/);assert.equal(f.calls.length,0);
  const idle=fixture(),plain=browserFixture(idle.client);plain.mount();await new Promise(r=>setImmediate(r));assert.equal(idle.calls.length,0);
});
