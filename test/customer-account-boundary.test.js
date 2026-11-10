const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),express=require('express');
// Thực thi entrypoint với adapter DB/listen vô hiệu; không tải .env hoặc nối DB website.
test('application account parser boundary returns sanitized JSON before default logger can expose OTP body',async()=>{
  const app=express(),realListen=app.listen.bind(app);app.listen=()=>{};
  const expressFactory=()=>app;Object.assign(expressFactory,express);
  const pass=(req,res,next)=>next();
  vm.runInNewContext(fs.readFileSync('index.js','utf8'),{require(name){if(name==='express')return expressFactory;if(name==='dotenv')return{config(){}};if(name==='./config/database')return{connect(){}};if(name==='./routes/admin/index.route'||name==='./routes/client/index.route')return express.Router();if(name==='express-flash'||name==='express-session')return()=>pass;if(name.startsWith('.'))return require(path.resolve(name));return require(name);},global:{},process:{env:{}},__dirname:path.resolve('.'),console:{log(){}}});
  let leaked=false;app.use((error,req,res,next)=>{leaked=true;res.status(500).end();});
  const server=realListen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const r=await fetch('http://127.0.0.1:'+server.address().port+'/account/card-lock/confirm',{method:'POST',headers:{'content-type':'application/json'},body:'{"otp":"482057",'});assert.equal(r.status,400);const body=await r.json();assert.equal(body.errorCode,'INVALID_INPUT');assert.equal(leaked,false);assert.ok(!JSON.stringify(body).includes('482057'));}finally{await new Promise(r=>server.close(r));}
});
