const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/admin/assets/js/account.js','utf8');
function fixture(client){
  let submit,requested=0;const status={textContent:''},button={disabled:false};
  const form={email:{value:'staff@example.com'},password:{value:'Password1!'},rememberPassword:{checked:true},checkValidity:()=>true,reportValidity(){},querySelector:()=>button,addEventListener:(event,fn)=>{if(event==='submit')submit=fn;}};
  const window={location:{href:''},cardClient:client,CardShared:require('../public/assets/js/card/card-shared')};
  vm.runInNewContext(source,{document:{querySelector:s=>s==='#login-form'?form:s==='[card-login-status]'?status:null},window,pathAdmin:'admin',fetch:async()=>{requested++;return {ok:true,json:async()=>({code:'card-required'})};},alert:message=>{status.textContent=message;},console});
  return {window,form,status,button,requested:()=>requested,submit:()=>submit({preventDefault(){},target:form})};
}
test('login works with HTML fallback when JustValidate CDN is unavailable and clears password',async()=>{let pin='';const f=fixture({openSession:async()=>({state:2,cardType:2}),askPin:async()=> '482759',verifyPin:async value=>{pin=value;},authenticate:async()=>({code:'success'})});await f.submit();assert.equal(f.requested(),1);assert.equal(f.window.location.href,'/admin/dashboard');assert.equal(pin,'482759');assert.equal(f.form.password.value,'');assert.equal(f.button.disabled,false);});
test('login reports PIN retry Agent down CREATED empty slot and first PIN without navigating',async()=>{for(const detail of [{error:Object.assign(new Error('Con 2 lan'),{sw:'63C2'})},{error:new Error('Không kết nối được Card Agent')},{info:{state:0,cardType:2}},{info:{state:2,cardType:2,mustChangePin:true}}]){const f=fixture({openSession:async()=>{if(detail.error)throw detail.error;return detail.info;}});await f.submit();assert.ok(f.status.textContent.length>5);assert.equal(f.window.location.href,'');assert.equal(f.button.disabled,false);}});
test('new staff card must change initial PIN with confirmation before AUTHENTICATE',async()=>{const calls=[],pins=['482759','759284','759284'];const f=fixture({openSession:async()=>({state:2,cardType:2,mustChangePin:true}),readProfile:async()=>({dob:'20040315'}),askPin:async()=>pins.shift(),verifyPin:async pin=>calls.push(['verify',pin]),changePin:async(oldPin,newPin)=>calls.push(['change',oldPin,newPin]),authenticate:async()=>{calls.push(['authenticate']);return {code:'success'};}});await f.submit();assert.deepEqual(calls,[['verify','482759'],['change','482759','759284'],['verify','759284'],['authenticate']]);assert.equal(f.window.location.href,'/admin/dashboard');});
test('initial PIN change mismatch weak PIN and cancelled dialog never authenticate',async()=>{for(const detail of [{pins:['482759','759284','759285']},{pins:['482759','111111','111111'],error:Object.assign(new Error('weak'),{code:'WEAK_PIN'})},{pins:['482759'],cancel:true}]){let authenticated=false;const f=fixture({openSession:async()=>({state:2,cardType:2,mustChangePin:true}),readProfile:async()=>({dob:'20040315'}),askPin:async()=>{const pin=detail.pins.shift();if(pin===undefined)throw Object.assign(new Error('cancel'),{code:'PIN_CANCELLED'});return pin;},verifyPin:async()=>{},changePin:async()=>{if(detail.error)throw detail.error;},authenticate:async()=>{authenticated=true;return {code:'success'};}});await f.submit();assert.equal(authenticated,false);assert.equal(f.window.location.href,'');assert.ok(f.status.textContent);}});

function pinFixture(extra){const calls=[],validators=[];const client={openSession:async()=>({state:2,cardType:2,mustChangePin:true}),readProfile:async()=>({dob:'20040315'}),askPin:async(title,options)=>{validators.push(options&&options.validate);return client.pins.shift();},verifyPin:async pin=>calls.push(['verify',pin]),changePin:async(...args)=>calls.push(['change',...args]),authenticate:async()=>{calls.push(['authenticate']);return {code:'success'};},pins:['482759','759284','759284'],...extra};return {calls,validators,client,f:fixture(client)};}
test('initial staff PIN change validates birth date inside the modal and passes dob to changePin',async()=>{
  const {calls,validators,client,f}=pinFixture();await f.submit();
  assert.deepEqual(calls,[['verify','482759'],['change','482759','759284','20040315'],['verify','759284'],['authenticate']]);
  const validate=validators[1];assert.match(validate('150304'),/ngày sinh DDMMYY/);assert.equal(validate('759284'),'');
  assert.match(validators[2]('111111'),/không khớp/);assert.equal(validators[2]('759284'),'');
  assert.ok(client);
});
test('initial staff PIN change on a fresh card (READ_DATA 6985) rechecks birth date after change and asks again',async()=>{
  let reads=0;const {calls,f}=pinFixture({pins:['482759','150304','150304','150304','759284','759284'],readProfile:async()=>{if(!reads++)throw Object.assign(new Error('6985'),{sw:'6985'});return {dob:'20040315'};}});
  await f.submit();
  assert.deepEqual(calls.map(c=>c[0]),['verify','change','verify','verify','change','verify','authenticate']);
  assert.deepEqual(calls[1],['change','482759','150304',undefined]);assert.deepEqual(calls[4],['change','150304','759284','20040315']);
});
test('unknown card error codes never reach the login status as bare codes',async()=>{
  const f=fixture({openSession:async()=>{throw Object.assign(new Error('SOMETHING_NEW'),{code:'SOMETHING_NEW'});}});await f.submit();
  assert.match(f.status.textContent,/\(SOMETHING_NEW\)/);assert.notEqual(f.status.textContent,'SOMETHING_NEW');
  const g=fixture({openSession:async()=>{throw Object.assign(new Error('REQUEST_TIMEOUT'),{code:'REQUEST_TIMEOUT'});}});await g.submit();assert.match(g.status.textContent,/quá thời gian/);
});
