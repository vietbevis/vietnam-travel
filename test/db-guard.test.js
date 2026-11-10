const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const target = 'mongodb://127.0.0.1:27017/vietnam-travel-smartcard-test';
const dev = 'mongodb://127.0.0.1:27017/vietnam-travel-smartcard-dev';

test('guard từ chối cấu hình nguy hiểm trước mọi I/O', async t => {
  const oldTest = process.env.TEST_DATABASE, oldDatabase = process.env.DATABASE;
  let calls = 0;
  const originalConnect = mongoose.connect;
  mongoose.connect = async () => { calls++; throw new Error('Đã chạm I/O'); };
  t.after(() => { mongoose.connect = originalConnect; if(oldTest===undefined) delete process.env.TEST_DATABASE; else process.env.TEST_DATABASE=oldTest; if(oldDatabase===undefined) delete process.env.DATABASE; else process.env.DATABASE=oldDatabase; });
  for (const uri of [undefined,'',dev,'mongodb://127.0.0.1:27017/production','mongodb://remote.test:27017/vietnam-travel-smartcard-test',target+'?dbName=production',target+'?authSource=admin','mongodb://127.0.0.1:27017/other-test',target+'/other','mongodb+srv://127.0.0.1/vietnam-travel-smartcard-test']) {
    if(uri===undefined) delete process.env.TEST_DATABASE; else process.env.TEST_DATABASE=uri;
    process.env.DATABASE=dev;
    await assert.rejects(db.connect(), /an toàn|TEST_DATABASE|loopback|kiểm thử/i);
  }
  process.env.TEST_DATABASE=target;
  for (const database of [target,'mongodb://localhost:27017/vietnam-travel-smartcard-test','mongodb://[::1]:27017/vietnam-travel-smartcard-test','mongodb://localhost:27017/vietnam-travel-smartcard-test?dbName=other','mongodb://localhost:27017/other?dbName=vietnam-travel-smartcard-test']) {
    process.env.DATABASE=database;
    await assert.rejects(db.connect(), /DATABASE|an toàn/i);
  }
  assert.equal(calls,0);
});
test('reset không có kết nối đã xác minh bị chặn trước xóa', async () => {
  await assert.rejects(db.reset(), /an toàn|kết nối|TEST_DATABASE/i);
});

test('guard chặn kết nối đang sai và reset sau thay đổi env hoặc database thật', async t => {
  const oldTest=process.env.TEST_DATABASE, oldDatabase=process.env.DATABASE;
  const connection=mongoose.connection;
  const descriptors={};
  for(const key of ['readyState','host','port','name','getClient','collections','db']) descriptors[key]=Object.getOwnPropertyDescriptor(connection,key);
  const originalConnect=mongoose.connect;
  let deletes=0,connects=0;
  const clientOptions={dbName:'vietnam-travel-smartcard-test',hosts:[{host:'127.0.0.1',port:27017}]};
  for (const [key,value] of Object.entries({readyState:1,host:'127.0.0.1',port:27017,name:'vietnam-travel-smartcard-dev',getClient:()=>({options:clientOptions}),collections:{},db:{collections:async()=>[{deleteMany:async()=>{deletes++;}}]}})) Object.defineProperty(connection,key,{value,writable:true,configurable:true});
  mongoose.connect=async()=>{connects++;connection.readyState=1;};
  t.after(async()=>{
    connection.collections={};
    connection.readyState=0;
    await db.close();
    mongoose.connect=originalConnect;
    for(const key of Object.keys(descriptors)) { if(descriptors[key]) Object.defineProperty(connection,key,descriptors[key]); else delete connection[key]; }
    if(oldTest===undefined) delete process.env.TEST_DATABASE; else process.env.TEST_DATABASE=oldTest;
    if(oldDatabase===undefined) delete process.env.DATABASE; else process.env.DATABASE=oldDatabase;
  });
  process.env.TEST_DATABASE=target; process.env.DATABASE=dev;
  await assert.rejects(db.connect(),/an toàn/); assert.equal(connects,0);
  connection.name='vietnam-travel-smartcard-test';
  await assert.rejects(db.connect(),/an toàn/); assert.equal(connects,0);
  connection.readyState=0; await db.connect();
  process.env.TEST_DATABASE='mongodb://localhost:27017/vietnam-travel-smartcard-test';
  await assert.rejects(db.reset(),/an toàn/);
  process.env.TEST_DATABASE=target;
  process.env.DATABASE=target; await assert.rejects(db.reset(),/an toàn/); process.env.DATABASE=dev;
  for(const [key,value] of [['name','vietnam-travel-smartcard-dev'],['host','remote.test'],['port',27018],['readyState',0]]) {
    const old=connection[key]; connection[key]=value; await assert.rejects(db.reset(),/an toàn/); connection[key]=old;
  }
  clientOptions.dbName='vietnam-travel-smartcard-dev'; await assert.rejects(db.reset(),/an toàn/); clientOptions.dbName='vietnam-travel-smartcard-test';
  assert.equal(deletes,0);
  await db.reset(); assert.equal(deletes,1);
});
