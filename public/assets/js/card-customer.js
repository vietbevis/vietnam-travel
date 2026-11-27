(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(root,require('./card/card-shared'));
  else{root.CardCustomer=factory(root,root.CardShared);root.CardCustomer.mount();}
}(typeof window!=='undefined'?window:globalThis,function(root,S){
  'use strict';
  const invalid=message=>{throw new Error(message);};
  const WEAK_PIN_HINT='PIN quá yếu (không dùng 6 số giống nhau, dãy số liên tiếp hoặc ngày sinh DDMMYY). Vui lòng nhập mã khác.';
  function identity(info,cardId){
    if(info.cardType===0||info.state===0)invalid('Thẻ chưa được phát hành.');
    if(info.cardType!==1)invalid('Vui lòng cắm thẻ khách hàng.');
    if(info.state===3)invalid('Thẻ đang bị khóa.');
    if(info.state===127)invalid('Thẻ đã bị thu hồi.');
    if(info.state!==2)invalid('Trạng thái thẻ không hợp lệ.');
    if(cardId&&info.cardId!==cardId.toUpperCase())invalid('Đang cắm thẻ khác. Vui lòng cắm đúng thẻ của bạn.');
  }
  async function pin(client,title){let value=await client.askPin(title);try{await client.verifyPin(value);}finally{value='';}}
  async function change(client,dob,initial=false){
    let title='Nhập PIN hiện tại';
    for(;;){
      let oldPin='',newPin='',confirm='';
      try{
        oldPin=await client.askPin(title);await client.verifyPin(oldPin);
        if(dob===undefined){
          try{dob=(await client.readProfile()).dob;}
          catch(error){if(!initial||error?.sw!=='6985')throw error;}
        }
        // Kiểm tra ngay trong modal: PIN yếu / nhập lại không khớp thì giữ modal và yêu cầu nhập lại.
        newPin=await client.askPin('Nhập PIN mới gồm 6 chữ số',{validate:value=>S.isWeakPin(value,dob)?WEAK_PIN_HINT:''});
        if(!S.isPinFormat(newPin)||S.isWeakPin(newPin,dob))invalid('PIN mới quá yếu. Vui lòng chọn mã khác.');
        confirm=await client.askPin('Nhập lại PIN mới',{validate:value=>value!==newPin?'PIN nhập lại không khớp. Vui lòng nhập lại.':''});
        if(newPin!==confirm)invalid('Hai lần nhập PIN mới không khớp.');
        await client.changePin(oldPin,newPin,dob);await client.verifyPin(newPin);
        // Thẻ mới chặn READ_DATA trước CHANGE_PIN. Chỉ khi đã VERIFY PIN mới
        // mới đọc DOB cục bộ; không AUTH nếu mã vừa chọn trùng ngày sinh.
        dob=(await client.readProfile()).dob;initial=false;
        if(!S.isWeakPin(newPin,dob))return;
        title='PIN vừa chọn trùng ngày sinh. Nhập PIN hiện tại để đổi lại';
      }finally{oldPin='';newPin='';confirm='';}
    }
  }
  async function loginFlow({client}){
    const info=await client.openSession();identity(info);
    if(info.mustChangePin)await change(client,undefined,true);
    else{
      let currentPin='';
      try{
        currentPin=await client.askPin('Nhập PIN để đăng nhập');await client.verifyPin(currentPin);
        const dob=(await client.readProfile()).dob;
        // Cũng kiểm lại ở lần đăng nhập thường để lần đổi PIN ban đầu bị
        // ngắt sau CHANGE_PIN không biến mã yếu thành quyền đăng nhập web.
        if(S.isWeakPin(currentPin,dob))await change(client,dob);
      }finally{currentPin='';}
    }
    await client.authenticate({challengeUrl:'/card-api/login/challenge',verifyUrl:'/card-api/login/verify'});
    identity(await client.openSession({expectedCardId:info.cardId}),info.cardId);
    return{cardId:info.cardId};
  }
  async function post(fetcher,url,body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{const response=await fetcher(url,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const data=await response.json();if(!response.ok||data.code==='error')throw Object.assign(new Error(data.message||'Không thể xử lý yêu cầu.'),{code:data.errorCode});return data;}finally{clearTimeout(timer);}
  }
  async function cardSnapshot(fetcher){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetcher('/account/card/snapshot',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
      const data=await response.json();
      if(response.status===401)throw Object.assign(new Error('Phiên đăng nhập đã hết hạn.'),{code:'AUTH_REQUIRED'});
      if(!response.ok||data.code!=='success'||!Number.isSafeInteger(data.balance))invalid('Không thể kiểm tra trạng thái trên hệ thống.');
      return data;
    }finally{clearTimeout(timer);}
  }
  async function walletSyncFlow({client,cardId,onStep,fetch:fetcher=root.fetch.bind(root)}){
    await cardSnapshot(fetcher);
    const info=await client.openSession({expectedCardId:cardId,onSyncStep:onStep});
    identity(info,cardId);
    if(info.mustChangePin)invalid('Thẻ yêu cầu đổi PIN trước khi đồng bộ.');
    if(info.requiresAuth)throw Object.assign(new Error('Phiên của thẻ không còn hợp lệ.'),{code:'AUTH_REQUIRED'});
    return cardSnapshot(fetcher);
  }
  async function readFlow({client,cardId,serverBalance,fetch:fetcher=root.fetch.bind(root),onMismatch=()=>{}}){
    identity(await client.openSession({expectedCardId:cardId,sync:false}),cardId);
    await pin(client,'Nhập PIN để đọc thẻ');
    let wallet=await client.readBalance(),canonical=serverBalance;
    if(wallet.balance!==canonical){
      onMismatch(true);
      identity(await client.openSession({expectedCardId:cardId}),cardId);
      await pin(client,'Nhập lại PIN sau khi đồng bộ');
      canonical=(await cardSnapshot(fetcher)).balance;
      wallet=await client.readBalance();
    }
    const profile=await client.readProfile(),photo=await client.readPhotoUrl(),transactions=await client.readTxLog(),tickets=await client.readTickets();
    const mismatch=wallet.balance!==canonical;onMismatch(mismatch);
    return{profile,photo,wallet,transactions,tickets,mismatch,serverBalance:canonical};
  }
  async function profileFlow({client,cardId,fields,fetch:fetcher=root.fetch.bind(root)}){
    identity(await client.openSession({expectedCardId:cardId,sync:false}),cardId);
    await pin(client,'Nhập PIN để sửa hồ sơ');
    const body={phone:fields.phone,emergencyName:fields.emergencyName,emergencyPhone:fields.emergencyPhone};
    if (fields.gender) body.gender = fields.gender;
    if (fields.revision) body.revision = fields.revision;
    const built=await post(fetcher,'/card-api/profile/build',body);
    await client.writeTarget(S.TARGET.PROFILE,S.fromHex(built.profileHex));
    const result=await client.runSignedOp({opId:built.opId,signUrl:'/card-api/op/sign',confirmUrl:'/card-api/op/confirm',expectedCardId:cardId,retryConfirmation:true});
    if(!result.ok)invalid('Chưa xác nhận ghi thẻ. Hồ sơ trên hệ thống chưa được cập nhật.');
    return result;
  }
  // U5: trả tiền đơn bằng ví thẻ. Đồng bộ trước để khôi phục biên nhận cũ, PIN mỗi giao dịch.
  async function payFlow({client,cardId,orderId,fetch:fetcher=root.fetch.bind(root)}){
    identity(await client.openSession({expectedCardId:cardId}),cardId);
    await pin(client,'Nhập PIN để thanh toán');
    const prepared=await post(fetcher,'/card-api/pay/prepare',{orderId});
    const result=await client.runSignedOp({opId:prepared.opId,signUrl:'/card-api/op/sign',confirmUrl:'/card-api/op/confirm'});
    if(!result.ok)invalid('Chưa xác nhận thanh toán. Vui lòng cắm lại thẻ để hệ thống đối soát, không thanh toán lại.');
    // Spec U5 bước 6: đơn đã paid → sync ghi vé lên thẻ ngay. Lỗi sync không làm hỏng giao dịch đã xác nhận;
    // vé còn pending sẽ được ghi ở lần đồng bộ sau.
    try{await client.openSession({expectedCardId:cardId});}catch{}
    return result;
  }
  // U4: chỉ đọc họ tên và số điện thoại từ thẻ (cần PIN), không gửi gì lên máy chủ.
  async function autofillFlow({client,cardId}){
    identity(await client.openSession({expectedCardId:cardId,sync:false}),cardId);
    await pin(client,'Nhập PIN để điền thông tin từ thẻ');
    const profile=await client.readProfile();
    return{fullName:profile.fullName||'',phone:profile.phone||''};
  }
  function message(error){
    if(error?.sw)return S.swMessage(error.sw);
    const messages={PIN_CANCELLED:'Đã hủy nhập PIN.',WEAK_PIN:'PIN mới quá yếu.',PIN_FORMAT:'PIN phải gồm đúng 6 chữ số.',AUTH_REQUIRED:'Vui lòng đăng nhập lại.',CARD_AUTH_INVALID:'Không thể xác thực thẻ. Vui lòng kiểm tra thẻ và thử lại.',OP_FORBIDDEN:'Bạn không có quyền thực hiện thao tác này.',OP_STATE:'Thao tác đã hết hạn hoặc thay đổi. Vui lòng thử lại.',CARD_STATE:'Thẻ hiện không cho phép thao tác.',INSUFFICIENT_BALANCE:'Số dư ví khả dụng không đủ. Kiểm tra số dư và trạng thái đơn trước khi thử lại.',REQUEST_TIMEOUT:'Yêu cầu quá thời gian. Vui lòng kiểm tra kết nối.',CLIENT_STALE:'Trang đã thay đổi. Vui lòng thử lại.',CLIENT_SUSPENDED:'Trang đã tạm dừng.',CLIENT_DISPOSED:'Trang đã đóng.'};
    if(messages[error?.code])return messages[error.code];
    if(error instanceof TypeError||error?.name==='AbortError')return 'Không thể kết nối. Vui lòng kiểm tra Card Agent và thử lại.';
    return typeof error?.message==='string'&&/[À-ỹ]/.test(error.message)?error.message:'Không thể xử lý thẻ. Vui lòng kiểm tra Card Agent và thử lại.';
  }
  const money=amount=>new Intl.NumberFormat('vi-VN').format(amount)+' đ';
  const compactDate=value=>typeof value==='string'&&/^\d{8}$/.test(value)?`${value.slice(6)}/${value.slice(4,6)}/${value.slice(0,4)}`:value;
  const profileLabels={fullName:'Họ tên',dob:'Ngày sinh',gender:'Giới tính',phone:'Số điện thoại',idNumber:'Giấy tờ',emergencyName:'Liên hệ khẩn cấp',emergencyPhone:'Điện thoại khẩn cấp',bloodType:'Nhóm máu',allergies:'Dị ứng'};
  const syncLabels={credit:'Đã ghi một khoản tiền vào thẻ.', 'write-ticket':'Đã ghi một vé lên thẻ.', 'delete-ticket':'Đã xử lý xóa một vé trên thẻ.', 'set-state':'Đã cập nhật trạng thái thẻ.', receipt:'Đã đối soát một biên nhận.', released:'Đã xử lý một giao dịch chưa thực hiện trên thẻ.'};
  function mount(){
    const document=root.document;if(!document)return;
    const client=root.cardClient,status=document.querySelector('[data-customer-status]');
    const account=document.querySelector('[data-card-account]');
    let busy=false,stale=false;
    const text=(selector,value)=>{const el=document.querySelector(selector);if(el)el.textContent=value;};
    const element=(tag,value)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;return node;};
    function paintList(selector,items,render,emptyMessage){
      const list=document.querySelector(selector);
      if(list)list.replaceChildren(...items.map(render));
      text(selector.replace(']','-empty]'),items.length?'':emptyMessage);
    }
    function clearChipLog() {
      document.querySelector('[data-card-log-rest]')?.replaceChildren();
      const more = document.querySelector('[data-card-log-more]');
      if (more) more.hidden = true;
      if (more) more.open = false;
    }
    function updateWallet(data){
      account.dataset.serverBalance=String(data.balance);
      text('strong[data-server-balance]',money(data.balance));
      text('[data-card-pending-total]',money(data.pendingCredit));
      for(const [key,value] of Object.entries(data.pending||{}))text(`[data-card-pending="${key}"]`,['credit','refund','transfer'].includes(key)?money(value):value);
    }
    function clear(){
      stale=true;
      for(const el of document.querySelectorAll('input[name="otp"], input[type="password"]'))el.value='';
      for(const selector of ['[data-card-profile-read]','[data-card-balance]','[data-card-log]','[data-card-tickets]'])text(selector,'');
      clearChipLog();
      const photo=document.querySelector('[data-card-photo]');if(photo)photo.removeAttribute('src');
    }
    root.addEventListener('pagehide',clear);
    root.addEventListener('pageshow',event=>{if(event.persisted){root.location.reload();}else stale=false;});
    async function run(button,fn){if(busy)return;busy=true;if(button)button.disabled=true;if(status)status.textContent='Đang xử lý…';try{await fn();}catch(error){if(!stale&&status)status.textContent=message(error);}finally{busy=false;if(button)button.disabled=false;}}
    const pay=document.querySelector('[data-card-pay]'),payButton=document.querySelector('[data-card-pay-button]');
    if(pay&&payButton)payButton.addEventListener('click',()=>run(payButton,async()=>{
      await payFlow({client,cardId:pay.dataset.cardId,orderId:pay.dataset.orderId});
      if(!stale)root.location.assign('/order/success?orderId='+encodeURIComponent(pay.dataset.orderId));
    }));
    const recover=document.querySelector('[data-card-pay-recover]');
    if(pay&&recover)recover.addEventListener('click',()=>run(recover,async()=>{
      await walletSyncFlow({client,cardId:pay.dataset.cardId});
      if(!stale)root.location.assign('/order/success?orderId='+encodeURIComponent(pay.dataset.orderId));
    }));
    const fill=document.querySelector('[data-card-autofill]');
    if(fill)fill.addEventListener('click',()=>run(fill,async()=>{
      const data=await autofillFlow({client,cardId:fill.dataset.cardId||undefined});
      if(stale)return;
      const name=document.querySelector('#full-name-input'),phone=document.querySelector('#phone-input');
      if(name)name.value=data.fullName;if(phone)phone.value=data.phone;
      if(status)status.textContent='Đã điền thông tin từ thẻ.';
    }));
    const login=document.querySelector('[data-card-login]');if(login)login.addEventListener('click',()=>run(login,async()=>{await loginFlow({client});if(!stale)root.location.assign(login.dataset.cardLoginTarget||'/account/card');}));
    for(const logout of document.querySelectorAll('[data-card-logout]'))logout.addEventListener('click',()=>run(logout,async()=>{await post(root.fetch.bind(root),'/card-api/logout',{});if(stale)return;clear();client?.dispose();document.body.replaceChildren();root.location.replace('/account/login');}));
    const read=document.querySelector('[data-card-read]');if(read)read.addEventListener('click',()=>run(read,async()=>{
      clearChipLog();
      document.querySelector('[data-card-log]')?.replaceChildren();
      text('[data-card-log-empty]', 'Chưa đọc được nhật ký chip.');
      const banner=document.querySelector('[data-card-mismatch]');
      const result=await readFlow({client,cardId:account.dataset.cardId,serverBalance:Number(account.dataset.serverBalance),onMismatch:value=>{if(!stale&&banner)banner.hidden=!value;}});
      if(stale)return;
      account.dataset.serverBalance=String(result.serverBalance);
      text('strong[data-server-balance]',result.serverBalance.toLocaleString('vi-VN')+' đ');
      const profileFields=Object.entries(profileLabels).map(([key,label])=>{
        const field=element('div');
        const value=key==='dob'?compactDate(result.profile[key]):result.profile[key];
        field.append(element('dt',label),element('dd',value||'Chưa cập nhật'));
        return field;
      });
      document.querySelector('[data-card-profile-read]')?.replaceChildren(...profileFields);
      const photo=document.querySelector('[data-card-photo]');if(photo&&result.photo){photo.src=result.photo;photo.hidden=false;}
      text('[data-card-balance]',money(result.wallet.balance));
      function transactionRow(tx) {
        const row=element('li'),icon=element('i');
        icon.className=tx.type===1?'fa-solid fa-circle-plus':'fa-solid fa-circle-minus';
        icon.setAttribute('aria-hidden','true');
        row.append(icon,element('strong',(tx.type===1?'Ghi có · +':'Ghi nợ · −')+money(tx.amount)),element('p',`Số dư ${money(tx.balanceAfter)} · ${tx.txRef}`));
        return row;
      }
      const transactions = [...result.transactions].sort((a,b) => b.counter - a.counter);
      paintList('[data-card-log]',transactions.slice(0, 3),transactionRow,'Chưa có giao dịch trên thẻ.');
      const more = document.querySelector('[data-card-log-more]');
      if (more && transactions.length > 3) {
        more.hidden = false;
        const summary = document.querySelector('[data-card-log-summary]');
        const label = () => { summary.textContent = more.open ? 'Thu gọn' : 'Xem toàn bộ (' + transactions.length + ' giao dịch)'; };
        more.ontoggle = label;
        label();
        document.querySelector('[data-card-log-rest]').replaceChildren(...transactions.slice(3).map(transactionRow));
      }
      const serverTickets=Array.from(document.querySelectorAll('[data-card-server-tickets] li'));
      paintList('[data-card-tickets]',result.tickets,ticket=>{
        const row=element('li'),date=compactDate(ticket.departure);
        const match=serverTickets.find(({dataset})=>dataset.ticketOrder===ticket.orderCode&&dataset.ticketTour.toUpperCase()===ticket.tourId&&dataset.ticketDeparture===date);
        row.append(element('strong',match?.querySelector('[data-ticket-name]')?.textContent||`Tour ${ticket.tourId}`),element('p',`Đơn ${ticket.orderCode} · ${date} · ${ticket.pax} khách · ${ticket.status===1?'Chưa dùng':'Đã dùng'}`));
        return row;
      },'Chưa có vé trên thẻ.');
      if(status)status.textContent=result.mismatch?'Số dư chưa khớp. Vui lòng liên hệ nhân viên để đối soát.':'Đã đọc thẻ.';
    }));
    const sync=document.querySelector('[data-card-sync]');
    if(account&&sync)sync.addEventListener('click',()=>run(sync,async()=>{
      const history=document.querySelector('[data-card-sync-steps]');
      const refresh=document.querySelector('[data-card-refresh]');
      history?.replaceChildren();
      if(history)history.hidden=true;
      clearChipLog();
      text('[data-card-balance]','Chưa đọc lại thẻ');
      for(const kind of ['log','tickets']){
        document.querySelector(`[data-card-${kind}]`)?.replaceChildren();
        text(`[data-card-${kind}-empty]`,'Bấm Đọc thẻ để xem dữ liệu chip hiện tại.');
      }
      const photo=document.querySelector('[data-card-photo]');
      if(photo)photo.removeAttribute('src');
      const data=await walletSyncFlow({client,cardId:account.dataset.cardId,onStep:type=>{
        if(stale)return;
        history?.append(element('li',syncLabels[type]||'Đã xác nhận một bước đồng bộ.'));
        if(history)history.hidden=false;
        if(refresh)refresh.hidden=false;
      }});
      if(stale)return;
      updateWallet(data);
      if(refresh)refresh.hidden=false;
      const pending=data.pending;
      if(status)status.textContent=pending&&(data.pendingCredit||pending.writeTickets||pending.deleteTickets||pending.reconciliation)?'Đã nhận trạng thái mới. Các mục còn chờ có thể cần thêm lượt đồng bộ hoặc nhân viên hỗ trợ.':'Đã kiểm tra đồng bộ. Thẻ không còn mục chờ xử lý.';
    }));
    const topup=document.querySelector('form[data-card-topup]');
    if(topup)topup.addEventListener('submit',event=>{event.preventDefault();run(topup.querySelector('button'),async()=>{
      const amount=root.TravelMoney.value(topup.elements.amount);
      if(!Number.isSafeInteger(amount))invalid('Vui lòng kiểm tra số tiền nạp.');
      const result=await post(root.fetch.bind(root),'/card-api/topup',{amount,method:topup.elements.method.value});
      if(!stale&&typeof result.redirectUrl==='string')root.location.assign(result.redirectUrl);
    });});
    const owner = account || document.querySelector('[data-customer-profile]');
    const changeButton=document.querySelector('[data-card-change-pin]');if(changeButton&&owner)changeButton.addEventListener('click',()=>run(changeButton,async()=>{identity(await client.openSession({expectedCardId:owner.dataset.cardId,sync:false}),owner.dataset.cardId);await change(client,owner.dataset.dob);if(!stale&&status)status.textContent='Đã đổi PIN.';}));
    const profile=document.querySelector('form[data-card-profile]');if(profile&&owner)profile.addEventListener('submit',event=>{event.preventDefault();run(profile.querySelector('button'),async()=>{
      const fields=Object.fromEntries(new root.FormData(profile));
      try {
        await profileFlow({client,cardId:owner.dataset.cardId,fields});
        if (!stale && status) status.textContent = 'Đã xác nhận cập nhật thông tin trên thẻ và hệ thống.';
      } catch (error) {
        if (error instanceof TypeError || ['REQUEST_TIMEOUT','SERVER_HTTP','SERVER_RESPONSE','OP_STATE'].includes(error.code)) {
          invalid('Chưa xác nhận được hồ sơ. Giữ đúng thẻ và kiểm tra dữ liệu trước khi thử lại.');
        }
        throw error;
      }
    });});
    const webProfile = document.querySelector('form[data-web-profile]');
    if (webProfile) {
      const clear = webProfile.elements.clearAvatar;
      const avatar = document.querySelector('[data-web-avatar]');
      clear?.addEventListener('change', () => { if (avatar) avatar.hidden = clear.checked; });
      webProfile.addEventListener('submit', event => {
        event.preventDefault();
        run(webProfile.querySelector('button[type="submit"]'), async () => {
          const data = new root.FormData(webProfile);
          const file = webProfile.elements.webAvatar.files[0];
          if (!file) data.delete('webAvatar');
          if (file && clear?.checked) invalid('Chọn xóa hoặc thay ảnh đại diện.');
          if (file && file.size > 5 * 1024 * 1024) invalid('Ảnh đại diện tối đa 5 MB.');
          await root.travelRequest('/account/profile/web', { method: 'PATCH', body: data });
          if (!stale) root.location.reload();
        });
      });
    }
    for(const [selector,url] of [['form[data-card-lock-send]','/account/card-lock/otp'],['form[data-card-lock-confirm]','/account/card-lock/confirm']]){
      const form=document.querySelector(selector);if(form)form.addEventListener('submit',event=>{event.preventDefault();run(form.querySelector('button'),async()=>{
        const body=Object.fromEntries(new root.FormData(form));
        try{const result=await post(root.fetch.bind(root),url,body);if(stale)return;if(status)status.textContent=result.message;if(selector.includes('send')){const email=document.querySelector('form[data-card-lock-confirm] input[name="email"]');if(email)email.value=body.email;}else{client?.dispose();for(const item of document.querySelectorAll('[data-card-logout]'))item.hidden=true;}}finally{body.otp='';const otp=form.querySelector('input[name="otp"]');if(otp)otp.value='';}
      });});
    }
  }
  return{loginFlow,readFlow,walletSyncFlow,profileFlow,payFlow,autofillFlow,mount};
}));
