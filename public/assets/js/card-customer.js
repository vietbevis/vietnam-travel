(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(root,require('./card/card-shared'));
  else{root.CardCustomer=factory(root,root.CardShared);root.CardCustomer.mount();}
}(typeof window!=='undefined'?window:globalThis,function(root,S){
  'use strict';
  const invalid=message=>{throw new Error(message);};
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
        newPin=await client.askPin('Nhập PIN mới gồm 6 chữ số');
        if(!S.isPinFormat(newPin)||S.isWeakPin(newPin,dob))invalid('PIN mới quá yếu. Vui lòng chọn mã khác.');
        confirm=await client.askPin('Nhập lại PIN mới');
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
    try{const response=await fetcher(url,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const data=await response.json();if(!response.ok||data.code==='error')invalid(data.message||'Không thể xử lý yêu cầu.');return data;}finally{clearTimeout(timer);}
  }
  async function readFlow({client,cardId,serverBalance,fetch:fetcher=root.fetch.bind(root),onMismatch=()=>{}}){
    identity(await client.openSession({expectedCardId:cardId,sync:false}),cardId);
    await pin(client,'Nhập PIN để đọc thẻ');
    let wallet=await client.readBalance(),canonical=serverBalance;
    if(wallet.balance!==canonical){
      onMismatch(true);
      identity(await client.openSession({expectedCardId:cardId}),cardId);
      await pin(client,'Nhập lại PIN sau khi đồng bộ');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{const response=await fetcher('/account/card/snapshot',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});const data=await response.json();if(!response.ok||data.code!=='success')invalid('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');canonical=data.balance;}finally{clearTimeout(timer);}
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
    const built=await post(fetcher,'/card-api/profile/build',body);
    await client.writeTarget(S.TARGET.PROFILE,S.fromHex(built.profileHex));
    const result=await client.runSignedOp({opId:built.opId,signUrl:'/card-api/op/sign',confirmUrl:'/card-api/op/confirm'});
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
    const messages={PIN_CANCELLED:'Đã hủy nhập PIN.',WEAK_PIN:'PIN mới quá yếu.',PIN_FORMAT:'PIN phải gồm đúng 6 chữ số.',AUTH_REQUIRED:'Vui lòng đăng nhập lại.',CARD_AUTH_INVALID:'Không thể xác thực thẻ. Vui lòng kiểm tra thẻ và thử lại.',OP_FORBIDDEN:'Bạn không có quyền thực hiện thao tác này.',OP_STATE:'Thao tác đã hết hạn hoặc thay đổi. Vui lòng thử lại.',CARD_STATE:'Thẻ hiện không cho phép thao tác.',REQUEST_TIMEOUT:'Yêu cầu quá thời gian. Vui lòng kiểm tra kết nối.',CLIENT_STALE:'Trang đã thay đổi. Vui lòng thử lại.',CLIENT_SUSPENDED:'Trang đã tạm dừng.',CLIENT_DISPOSED:'Trang đã đóng.'};
    if(messages[error?.code])return messages[error.code];
    if(error instanceof TypeError||error?.name==='AbortError')return 'Không thể kết nối. Vui lòng kiểm tra Card Agent và thử lại.';
    return typeof error?.message==='string'&&/[À-ỹ]/.test(error.message)?error.message:'Không thể xử lý thẻ. Vui lòng kiểm tra Card Agent và thử lại.';
  }
  function mount(){
    const document=root.document;if(!document)return;
    const client=root.cardClient,status=document.querySelector('[data-customer-status]');
    const account=document.querySelector('[data-card-account]');
    let busy=false,stale=false;
    const text=(selector,value)=>{const el=document.querySelector(selector);if(el)el.textContent=value;};
    function clear(){
      stale=true;
      for(const el of document.querySelectorAll('input[name="otp"], input[type="password"]'))el.value='';
      for(const selector of ['[data-card-profile-read]','[data-card-balance]','[data-card-log]','[data-card-tickets]'])text(selector,'');
      const photo=document.querySelector('[data-card-photo]');if(photo)photo.removeAttribute('src');
    }
    root.addEventListener('pagehide',clear);
    root.addEventListener('pageshow',event=>{if(event.persisted){root.location.reload();}else stale=false;});
    async function run(button,fn){if(busy)return;busy=true;if(button)button.disabled=true;if(status)status.textContent='Đang xử lý…';try{await fn();}catch(error){if(!stale&&status)status.textContent=message(error);}finally{busy=false;if(button)button.disabled=false;}}
    const pay=document.querySelector('[data-card-pay]'),payButton=document.querySelector('[data-card-pay-button]');
    if(pay&&payButton)payButton.addEventListener('click',()=>run(payButton,async()=>{
      await payFlow({client,cardId:pay.dataset.cardId,orderId:pay.dataset.orderId});
      if(!stale)root.location.assign('/order/success?orderId='+encodeURIComponent(pay.dataset.orderId)+'&phone='+encodeURIComponent(pay.dataset.phone));
    }));
    const fill=document.querySelector('[data-card-autofill]');
    if(fill)fill.addEventListener('click',()=>run(fill,async()=>{
      const data=await autofillFlow({client,cardId:fill.dataset.cardId||undefined});
      if(stale)return;
      const name=document.querySelector('#full-name-input'),phone=document.querySelector('#phone-input');
      if(name)name.value=data.fullName;if(phone)phone.value=data.phone;
      if(status)status.textContent='Đã điền thông tin từ thẻ.';
    }));
    const login=document.querySelector('[data-card-login]');if(login)login.addEventListener('click',()=>run(login,async()=>{await loginFlow({client});if(!stale)root.location.assign('/account/card');}));
    for(const logout of document.querySelectorAll('[data-card-logout]'))logout.addEventListener('click',()=>run(logout,async()=>{await post(root.fetch.bind(root),'/card-api/logout',{});if(stale)return;clear();client?.dispose();document.body.replaceChildren();root.location.replace('/account/login');}));
    const read=document.querySelector('[data-card-read]');if(read)read.addEventListener('click',()=>run(read,async()=>{
      const banner=document.querySelector('[data-card-mismatch]');
      const result=await readFlow({client,cardId:account.dataset.cardId,serverBalance:Number(account.dataset.serverBalance),onMismatch:value=>{if(!stale&&banner)banner.hidden=!value;}});
      if(stale)return;
      account.dataset.serverBalance=String(result.serverBalance);
      text('strong[data-server-balance]',result.serverBalance.toLocaleString('vi-VN')+' đ');
      text('[data-card-profile-read]',Object.entries(result.profile).map(([key,value])=>({fullName:'Họ tên',dob:'Ngày sinh',gender:'Giới tính',phone:'Số điện thoại',idNumber:'Giấy tờ',emergencyName:'Liên hệ khẩn cấp',emergencyPhone:'Điện thoại khẩn cấp',bloodType:'Nhóm máu',allergies:'Dị ứng'}[key]||key)+': '+value).join('\n'));
      const photo=document.querySelector('[data-card-photo]');if(photo)photo.src=result.photo;
      text('[data-card-balance]',`Số dư thẻ: ${result.wallet.balance.toLocaleString('vi-VN')} đ · Bộ đếm: ${result.wallet.counter}`);
      text('[data-card-log]',result.transactions.length?result.transactions.map(tx=>`${tx.type===1?'Nạp':'Trừ'} ${tx.amount.toLocaleString('vi-VN')} đ · Số dư ${tx.balanceAfter.toLocaleString('vi-VN')} đ · Bộ đếm ${tx.counter} · ${tx.txRef}`).join('\n'):'Chưa có giao dịch trên thẻ.');
      text('[data-card-tickets]',result.tickets.length?result.tickets.map(ticket=>`${ticket.orderCode} · Tour ${ticket.tourId} · ${ticket.departure} · ${ticket.pax} khách · ${ticket.status===1?'Chưa dùng':'Đã dùng'}`).join('\n'):'Chưa có vé trên thẻ.');
      if(status)status.textContent=result.mismatch?'Số dư chưa khớp. Vui lòng liên hệ nhân viên để đối soát.':'Đã đọc thẻ.';
    }));
    const topup=document.querySelector('form[data-card-topup]');
    if(topup)topup.addEventListener('submit',event=>{event.preventDefault();run(topup.querySelector('button'),async()=>{
      const form=Object.fromEntries(new root.FormData(topup));
      const result=await post(root.fetch.bind(root),'/card-api/topup',{amount:Number(form.amount),method:form.method});
      if(!stale&&typeof result.redirectUrl==='string')root.location.assign(result.redirectUrl);
    });});
    // Quay lại từ cổng thanh toán: có thẻ cắm thì đồng bộ ngay để ghi tiền vào thẻ.
    if(account&&/(^|[?&])topup=1(&|$)/.test(root.location?.search||''))run(null,async()=>{
      try{
        identity(await client.openSession({expectedCardId:account.dataset.cardId}),account.dataset.cardId);
        if(!stale&&status)status.textContent='Đã đồng bộ thẻ, tiền nạp đã được ghi vào thẻ.';
      }catch{
        if(!stale&&status)status.textContent='Cắm thẻ để nhận tiền';
      }
    });
    const changeButton=document.querySelector('[data-card-change-pin]');if(changeButton)changeButton.addEventListener('click',()=>run(changeButton,async()=>{identity(await client.openSession({expectedCardId:account.dataset.cardId,sync:false}),account.dataset.cardId);await change(client,account.dataset.dob);if(!stale&&status)status.textContent='Đã đổi PIN.';}));
    const profile=document.querySelector('form[data-card-profile]');if(profile)profile.addEventListener('submit',event=>{event.preventDefault();run(profile.querySelector('button'),async()=>{const fields=Object.fromEntries(new root.FormData(profile));await profileFlow({client,cardId:account.dataset.cardId,fields});if(!stale)root.location.reload();});});
    for(const [selector,url] of [['form[data-card-lock-send]','/account/card-lock/otp'],['form[data-card-lock-confirm]','/account/card-lock/confirm']]){
      const form=document.querySelector(selector);if(form)form.addEventListener('submit',event=>{event.preventDefault();run(form.querySelector('button'),async()=>{
        const body=Object.fromEntries(new root.FormData(form));
        try{const result=await post(root.fetch.bind(root),url,body);if(stale)return;if(status)status.textContent=result.message;if(selector.includes('send')){const email=document.querySelector('form[data-card-lock-confirm] input[name="email"]');if(email)email.value=body.email;}else{client?.dispose();for(const item of document.querySelectorAll('[data-card-logout]'))item.hidden=true;}}finally{body.otp='';const otp=form.querySelector('input[name="otp"]');if(otp)otp.value='';}
      });});
    }
  }
  return{loginFlow,readFlow,profileFlow,payFlow,autofillFlow,mount};
}));
