const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../helpers/wallet-rule.helper');
test('nạp online tối thiểu và trần bao gồm tiền chờ ghi', () => {
  assert.ok(W.checkOnlineTopup({balance:0,pendingSum:0,amount:9_999}));
  assert.equal(W.checkOnlineTopup({balance:0,pendingSum:0,amount:10_000}),null);
  assert.equal(W.checkOnlineTopup({balance:40_000_000,pendingSum:5_000_000,amount:5_000_000}),null);
  assert.ok(W.checkOnlineTopup({balance:40_000_000,pendingSum:5_000_000,amount:5_000_001}));
});
test('nạp tiền mặt tối thiểu và hạn mức mỗi nhân viên mỗi ngày', () => {
  assert.ok(W.checkCashTopup({amount:9_999,staffTodaySum:0}));
  assert.equal(W.checkCashTopup({amount:10_000,staffTodaySum:0}),null);
  assert.equal(W.checkCashTopup({amount:5_000_000,staffTodaySum:15_000_000}),null);
  assert.ok(W.checkCashTopup({amount:5_000_001,staffTodaySum:15_000_000}));
});
test('mọi đầu vào ví sai kiểu, âm hoặc không nguyên đều bị chặn', () => {
  for (const value of [-1,1.5,NaN,Infinity,'10000',null,undefined,Number.MAX_SAFE_INTEGER+1]) {
    for (const field of ['balance','pendingSum','amount']) assert.equal(typeof W.checkOnlineTopup({...{balance:0,pendingSum:0,amount:10_000},[field]:value}),'string');
    for (const field of ['amount','staffTodaySum']) assert.equal(typeof W.checkCashTopup({...{amount:10_000,staffTodaySum:0},[field]:value}),'string');
  }
});
