const {test}=require('node:test');
const assert=require('node:assert/strict');
const H=require('../helpers/ticket.helper');

// Cửa sổ check-in theo giờ Việt Nam: [ngày khởi hành − 1, hết ngày khởi hành].
test('checkin window VN time',()=>{
  const d=new Date('2026-12-14T17:00:00Z'); // = 15/12 00:00 giờ VN
  assert.ok(H.isWithinCheckinWindow(d,new Date('2026-12-13T17:30:00Z')));
  assert.ok(H.isWithinCheckinWindow(d,new Date('2026-12-15T16:59:00Z')));
  assert.ok(!H.isWithinCheckinWindow(d,new Date('2026-12-15T17:01:00Z')));
  assert.ok(!H.isWithinCheckinWindow(d,new Date('2026-12-13T16:59:00Z')));
});
test('checkin window rejects invalid dates',()=>{
  assert.ok(!H.isWithinCheckinWindow(undefined,new Date()));
  assert.ok(!H.isWithinCheckinWindow('rác',new Date()));
});
test('cancel mapping',()=>{
  assert.equal(H.statusOnCancel('written'),'pending-delete');
  assert.equal(H.statusOnCancel('pending'),'none');
  assert.equal(H.statusOnCancel('used'),'used');
  assert.equal(H.statusOnCancel('pending-delete'),'pending-delete');
  assert.equal(H.statusOnCancel('none'),'none');
  assert.equal(H.statusOnCancel('deleted'),'deleted');
});
// Vé pending đã từng được ký ghi có thể đang nằm trên thẻ: không được quên.
test('cancel mapping keeps track of a pending ticket whose write was signed',()=>{
  assert.equal(H.statusOnCancel('pending',{writeSignedAt:new Date()}),'pending-delete');
  assert.equal(H.statusOnCancel('pending',{}),'none');
});
