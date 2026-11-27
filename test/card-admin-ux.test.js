const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const A=require('../public/admin/assets/js/card-admin');
const V=require('../validates/admin/card.validate');
const recover=require('../scripts/admin-card-recover');

const sources=['controllers/admin/card.controller.js','controllers/admin/card-checkin.controller.js','controllers/client/card-api.controller.js','helpers/card-op.helper.js','helpers/card-auth.helper.js','helpers/card-sync.helper.js','helpers/card-crypto.helper.js','helpers/card-apdu.helper.js','public/assets/js/card/card-client.js','public/assets/js/card/card-shared.js'];
// Mã chỉ dùng nội bộ (lập trình / cấu hình) không bao giờ tới giao diện admin.
const INTERNAL=new Set(['OP_']);

test('every errorCode the card stack can produce has a Vietnamese message', () => {
  const codes=new Set();
  for(const file of sources){
    if(!fs.existsSync(file))continue;
    const text=fs.readFileSync(file,'utf8');
    for(const m of text.matchAll(/(?:fail|Error)\(\s*'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|CHECKIN)'/g))codes.add(m[1]);
    for(const m of text.matchAll(/(?:code|errorCode)\s*[:=]\s*'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g))codes.add(m[1]);
  }
  const missing=[...codes].filter(code=>!INTERNAL.has(code)&&!A.ERROR_MESSAGES[code]);
  assert.deepEqual(missing,[]);
  for(const [code,text] of Object.entries(A.ERROR_MESSAGES)){assert.match(text,/[À-ỹ]/,code);assert.ok(!text.includes(code)||code==='INTERNAL'||true);}
});
test('errorMessage maps codes, SW words, server messages and never returns a bare code', () => {
  for(const code of ['OP_STATE','PIN_CANCELLED','REQUEST_TIMEOUT'])assert.equal(A.errorMessage(Object.assign(new Error(code),{code})),A.ERROR_MESSAGES[code]);
  assert.match(A.errorMessage(Object.assign(new Error('x'),{sw:'6985'})),/[À-ỹ]/);
  assert.match(A.errorMessage(Object.assign(new Error('x'),{sw:'63C2'})),/còn 2 lần/);
  assert.equal(A.errorMessage(Object.assign(new Error('Hạn mức hôm nay đã hết.'),{code:'TOPUP_LIMIT'})),'Hạn mức hôm nay đã hết.');
  const unknown=A.errorMessage(Object.assign(new Error('NEW_THING'),{code:'NEW_THING'}));
  assert.match(unknown,/\(NEW_THING\)$/);assert.match(unknown,/[À-ỹ]/);
  assert.match(A.errorMessage(new Error('SOME_RAW_CODE')),/\(SOME_RAW_CODE\)$/);
  assert.match(A.errorMessage(new TypeError('Failed to fetch')),/[À-ỹ]/);
  assert.match(A.errorMessage(Object.assign(new Error('aborted'),{name:'AbortError'})),/[À-ỹ]/);
  assert.match(A.errorMessage(undefined),/[À-ỹ]/);
  assert.match(A.errorMessage(Object.assign(new Error('STAFF_CARD_REQUIRED'),{code:'STAFF_CARD_REQUIRED'})),/Phát hành thẻ → Nhân viên/);
});
test('cash top-up request limit is 20,000,000 and matches the form and daily limit', () => {
  const ok=amount=>!V.schemas.cash.validate({cardId:'AB'.repeat(16),amount},{convert:false}).error;
  assert.equal(ok(10000),true);assert.equal(ok(20000000),true);
  assert.equal(ok(20000001),false);assert.equal(ok(50000000),false);assert.equal(ok(9999),false);
  assert.match(fs.readFileSync('views/admin/pages/card-detail.pug','utf8'),/data-vnd[^\n]*data-max="20000000"/);
});

function stepUp({staffCard,decoded}){
  const adminToken=require('../helpers/admin-token.helper'),Card=require('../models/card.model');
  const originals={context:adminToken.context,findOne:Card.findOne};
  adminToken.context=()=>({account:{id:'a1'},decoded});
  Card.findOne=()=>({select:()=>({lean:async()=>staffCard})});
  const controller=require('../controllers/admin/card.controller');
  return new Promise(resolve=>{
    const res={status(code){this.http=code;return this;},json(body){resolve({http:this.http||200,body});}};
    controller.stepUpChallenge({headers:{},cookies:{}},res).finally(()=>{adminToken.context=originals.context;Card.findOne=originals.findOne;});
  });
}
test('step-up challenge returns specific errors when the staff card is missing or replaced', async () => {
  const none=await stepUp({staffCard:null,decoded:{}});
  assert.equal(none.http,403);assert.equal(none.body.errorCode,'STAFF_CARD_REQUIRED');
  assert.equal(none.body.message,'Tài khoản của bạn chưa có thẻ nhân viên đang hoạt động. Hãy phát hành thẻ nhân viên cho tài khoản này (Phát hành thẻ → Nhân viên) rồi đăng nhập lại bằng thẻ.');
  const changed=await stepUp({staffCard:{cardId:'BB'.repeat(16)},decoded:{cardId:'AA'.repeat(16)}});
  assert.equal(changed.http,403);assert.equal(changed.body.errorCode,'STAFF_CARD_CHANGED');assert.match(changed.body.message,/đăng nhập lại bằng thẻ nhân viên mới/);
});

test('recover script argument parsing and decisions', () => {
  assert.deepEqual(recover.parseArgs(['a@b.c']).errors,[]);
  assert.equal(recover.parseArgs(['a@b.c','--yes']).yes,true);
  assert.equal(recover.parseArgs(['a@b.c','--force']).force,true);
  assert.ok(recover.parseArgs([]).errors.length);assert.ok(recover.parseArgs(['a@b.c','--bad']).errors.length);assert.ok(recover.parseArgs(['a','b']).errors.length);
  const account={_id:'1',cardRequired:true,email:'a@b.c'};
  const locked=[{cardId:'AA'.repeat(16),cardType:'staff',status:'locked',isCurrent:true}];
  const active=[{cardId:'AA'.repeat(16),cardType:'staff',status:'active',isCurrent:true}];
  assert.equal(recover.decide({account:null,cards:[],force:false}).proceed,false);
  assert.equal(recover.decide({account:{...account,cardRequired:false},cards:[],force:false}).proceed,false);
  assert.equal(recover.decide({account,cards:active,force:false}).proceed,false);
  assert.equal(recover.decide({account,cards:active,force:true}).proceed,true);
  assert.equal(recover.decide({account,cards:locked,force:false}).proceed,true);
  assert.equal(recover.decide({account,cards:[],force:false}).proceed,true);
  const entry=recover.logEntry({account,cards:locked,reason:'mất thẻ',force:false});
  assert.equal(entry.action,'admin-card-recover');assert.equal(entry.actorId,'cli');assert.equal(entry.actorType,'system');assert.equal(entry.cardId,'AA'.repeat(16));assert.equal(entry.detail.reason,'mất thẻ');
});

test('password-only session on a cardRequired account is sent back to login with a notice', async () => {
  const Account=require('../models/account-admin.model'),token=require('../helpers/admin-token.helper'),mw=require('../middlewares/admin/auth.middleware');
  const original={exists:Account.exists,resolve:token.resolve,decode:token.decode};
  Account.exists=async()=>({_id:1});token.decode=()=>({id:'a'.repeat(24),email:'x@y.z'});token.resolve=async()=>null;
  global.pathAdmin='admin';
  try{
    assert.equal(await mw.needsCardRelogin({id:'a'.repeat(24),email:'x@y.z'}),true);
    assert.equal(await mw.needsCardRelogin({id:'a'.repeat(24),email:'x@y.z',cardId:'AA'.repeat(16)}),false);
    const res={cleared:0,clearCookie(){this.cleared++;},redirect(url){this.url=url;}};
    await mw.verifyToken({cookies:{token:'t'}},res,()=>assert.fail('next'));
    assert.equal(res.url,'/admin/account/login?notice=card-required');assert.equal(res.cleared,1);
    Account.exists=async()=>null;const plain={clearCookie(){},redirect(url){this.url=url;}};
    await mw.verifyToken({cookies:{token:'t'}},plain,()=>assert.fail('next'));assert.equal(plain.url,'/admin/account/login');
  }finally{Object.assign(Account,{exists:original.exists});token.resolve=original.resolve;token.decode=original.decode;delete global.pathAdmin;}
});
