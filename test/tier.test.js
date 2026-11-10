const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../helpers/tier.helper');

test('hạng đổi đúng tại từng ngưỡng tổng chi tiêu', () => {
  for (const [spent, code, label, percent] of [[0,'standard','Standard',0],[9_999_999,'standard','Standard',0],[10_000_000,'silver','Silver',3],[29_999_999,'silver','Silver',3],[30_000_000,'gold','Gold',5],[79_999_999,'gold','Gold',5],[80_000_000,'platinum','Platinum',8]]) {
    assert.deepEqual(T.tierOf(spent), {code,label,percent});
  }
});
test('giảm giá làm tròn VNĐ và cho phép tổng bằng không', () => {
  assert.equal(T.discountFor(30_000_000,1_234_567),61_728);
  assert.equal(T.discountFor(10_000_000,10_050),302);
  assert.equal(T.discountFor(80_000_000,0),0);
  assert.equal(T.discountFor(0,10_000),0);
});
test('từ chối tổng chi tiêu và tiền hàng không phải số nguyên an toàn không âm', () => {
  for (const value of [-1,1.5,NaN,Infinity,'10000',null,undefined,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(() => T.tierOf(value), RangeError);
    assert.throws(() => T.discountFor(0,value), RangeError);
  }
});
