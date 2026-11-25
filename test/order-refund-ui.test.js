const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pug=require('pug');
const view=path.resolve('views/admin/pages/order-edit.pug');
function render(extra={}) {
  return pug.renderFile(view,{
    pathAdmin:'admin',
    messages:{},
    permissions:[],
    account:{fullName:'Admin',roleName:'Quản trị'},
    settingWebsiteInfo:{},
    orderDetail:{id:'a'.repeat(24),orderCode:'OD1',fullName:'Khách A',phone:'0901111111',note:'',paymentMethod:'card',paymentStatus:'paid',status:'initial',createdAtFormat:'',items:[],subTotal:1500000,discount:0,total:1500000},
    paymentMethod:[],
    paymentStatus:[],
    orderStatus:[],
    cardRefund:null,
    refundInfo:null,
    ...extra
  });
}
test('order edit page announces the wallet refund amount for a card-paid order',()=> {
  const html=render({cardRefund:{amount:1500000}});
  assert.match(html,/<form id="order-edit-form" data-card-refund="1500000">/);
  assert.match(html,/sẽ tự hoàn/);
  assert.match(html,/1\.500\.000đ/);
});
test('order edit page has no refund prompt when nothing would be refunded',()=> {
  const html=render();
  assert.match(html,/<form id="order-edit-form">/);
  assert.doesNotMatch(html,/sẽ tự hoàn/);
});
test('cancelled order shows the refund transaction and its card delivery state',()=> {
  const html=render({orderDetail:{id:'a'.repeat(24),orderCode:'OD1',fullName:'Khách A',phone:'0901111111',note:'',paymentMethod:'card',paymentStatus:'paid',status:'cancel',createdAtFormat:'',items:[],subTotal:1500000,discount:0,total:1500000},refundInfo:{txRef:'AB'.repeat(8),amount:1500000,statusLabel:'Chờ ghi lên thẻ ở lần cắm thẻ tiếp theo'}});
  assert.match(html,/Đã hoàn/);
  assert.match(html,new RegExp('ABABABABABABABAB'));
  assert.match(html,/Chờ ghi lên thẻ ở lần cắm thẻ tiếp theo/);
});
test('order edit script confirms the refund before cancelling and shows the server refund message',()=> {
  const source=fs.readFileSync(path.resolve('public/admin/assets/js/script.js'),'utf8');
  const start=source.indexOf('// Order Edit Form'),end=source.indexOf('// End Order Edit Form');
  const block=source.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(block,/dataset\.cardRefund/);
  assert.match(block,/status === "cancel"/);
  assert.match(block,/vào ví thẻ của khách/);
  assert.match(block,/if \(!confirmed\) return;/);
  assert.match(block,/data\.refund && data\.message/);
  assert.match(block,/showTravelNotice\(data\.message, "success"\)/);
});
test('order with a checked-in ticket disables cancel and explains why, without a refund prompt',()=> {
  const html=render({usedTicket:true,orderStatus:[{label:'Khởi tạo',value:'initial'},{label:'Hủy',value:'cancel'}]});
  assert.match(html,/<option value="cancel" disabled>/);
  assert.match(html,/<option value="initial" selected>/);
  assert.match(html,/Đơn có vé đã check-in nên không thể huỷ và hoàn tiền tự động/);
  assert.doesNotMatch(html,/data-card-refund/);
});
