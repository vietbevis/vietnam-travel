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
    try{const response=await fetcher(url,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const data=await response.json();if(!response.ok||data.code==='error'){const failure=new Error(data.message||'Không thể xử lý yêu cầu.');failure.code=data.errorCode;throw failure;}return data;}finally{clearTimeout(timer);}
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
  // Đọc hồ sơ trên chip để điền form; chỉ trả hai trường, không gửi gì lên server.
  async function autofillFlow({client,cardId}){
    identity(await client.openSession({expectedCardId:cardId,sync:false}),cardId);
    await pin(client,'Nhập PIN để điền thông tin từ thẻ');
    const profile=await client.readProfile();
    const fullName=typeof profile.fullName==='string'?profile.fullName.trim().slice(0,50):'';
    const phone=typeof profile.phone==='string'?profile.phone.replace(/[^\d+]/g,'').slice(0,15):'';
    return{fullName,phone};
  }
  const payError=(code,text)=>Object.assign(new Error(text),{code});
  // Thứ tự bắt buộc: openSession(sync khôi phục biên nhận) → PIN → kiểm số dư chip → prepare → ký/DEBIT/confirm.
  async function payFlow({client,cardId,orderId,total,fetch:fetcher=root.fetch.bind(root),onState=()=>{}}){
    onState('processing');
    const info=await client.openSession({expectedCardId:cardId});identity(info,cardId);
    if(info.requiresAuth)throw payError('AUTH_REQUIRED');
    await pin(client,'Nhập PIN để thanh toán');
    // Chặn sớm: nếu chip không đủ tiền thì không tạo giao dịch ký (tránh lệnh bị thẻ từ chối rồi treo đối soát).
    const wallet=await client.readBalance();
    if(wallet.balance<total)throw payError('INSUFFICIENT_BALANCE');
    let prepared;
    try{prepared=await post(fetcher,'/card-api/pay/prepare',{orderId});}
    catch(error){if(error?.code==='ORDER_STATE')return{status:'refresh'};throw error;}
    // Số tiền hiển thị phải khớp số tiền server ký; APDU luôn do server dựng.
    if(prepared.amount!==total)throw payError('AMOUNT_MISMATCH');
    let result;
    try{result=await client.runSignedOp({opId:prepared.opId,signUrl:'/card-api/op/sign',confirmUrl:'/card-api/op/confirm'});}
    catch(error){
      // Lỗi SW là thẻ từ chối; còn lỗi khác (mất mạng, timeout) có thể đã trừ tiền nên chờ đồng bộ, không trừ lại.
      if(error?.sw)throw error;
      throw payError('PAY_PENDING_SYNC');
    }
    if(!result||result.ok!==true)throw payError('PAY_PENDING_SYNC');
    onState('done');
    return{status:'paid'};
  }
  async function syncFlow({client,cardId}){
    const info=await client.openSession({expectedCardId:cardId});identity(info,cardId);
    return info;
  }
  function message(error){
    if(error?.sw)return S.swMessage(error.sw);
    const messages={PIN_CANCELLED:'Đã hủy nhập PIN.',WEAK_PIN:'PIN mới quá yếu.',PIN_FORMAT:'PIN phải gồm đúng 6 chữ số.',AUTH_REQUIRED:'Vui lòng đăng nhập lại.',CARD_AUTH_INVALID:'Không thể xác thực thẻ. Vui lòng kiểm tra thẻ và thử lại.',OP_FORBIDDEN:'Bạn không có quyền thực hiện thao tác này.',OP_STATE:'Thao tác đã hết hạn hoặc thay đổi. Vui lòng thử lại.',CARD_STATE:'Thẻ hiện không cho phép thao tác.',REQUEST_TIMEOUT:'Yêu cầu quá thời gian. Vui lòng kiểm tra kết nối.',CLIENT_STALE:'Trang đã thay đổi. Vui lòng thử lại.',CLIENT_SUSPENDED:'Trang đã tạm dừng.',CLIENT_DISPOSED:'Trang đã đóng.',INSUFFICIENT_BALANCE:'Số dư ví không đủ',UNRESOLVED_TX:'Giao dịch trước chưa hoàn tất, vui lòng cắm thẻ để đồng bộ',ORDER_STATE:'Đơn hàng không thể thanh toán bằng ví thẻ.',AMOUNT_MISMATCH:'Số tiền thanh toán không khớp với hệ thống. Vui lòng tải lại trang.',PAY_PENDING_SYNC:'Chờ đồng bộ: vui lòng cắm thẻ và đồng bộ lại, không thanh toán lại.'};
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
    const changeButton=document.querySelector('[data-card-change-pin]');if(changeButton)changeButton.addEventListener('click',()=>run(changeButton,async()=>{identity(await client.openSession({expectedCardId:account.dataset.cardId,sync:false}),account.dataset.cardId);await change(client,account.dataset.dob);if(!stale&&status)status.textContent='Đã đổi PIN.';}));
    const profile=document.querySelector('form[data-card-profile]');if(profile)profile.addEventListener('submit',event=>{event.preventDefault();run(profile.querySelector('button'),async()=>{const fields=Object.fromEntries(new root.FormData(profile));await profileFlow({client,cardId:account.dataset.cardId,fields});if(!stale)root.location.reload();});});
    const pay=document.querySelector('[data-card-pay]');
    if(pay&&client){
      const payButton=document.querySelector('[data-card-pay-button]'),syncButton=document.querySelector('[data-card-pay-sync]'),payStatus=document.querySelector('[data-card-pay-status]');
      const setStatus=value=>{if(!stale&&payStatus)payStatus.textContent=value;};
      // Sau đồng bộ, nếu server đã chuyển đơn sang paid thì trang này tự chuyển hướng sang trang thành công.
      async function refreshPaid(){
        try{
          const response=await root.fetch(root.location.href,{credentials:'same-origin',cache:'no-store',redirect:'follow'});
          if(response.redirected&&new URL(response.url).pathname==='/order/success'){root.location.assign(pay.dataset.successUrl);return true;}
        }catch{}
        return false;
      }
      async function guarded(button,fn){
        if(busy)return;busy=true;if(payButton)payButton.disabled=true;if(syncButton)syncButton.disabled=true;
        try{await fn();}
        catch(error){
          if(stale)return;
          if(error?.code==='PAY_PENDING_SYNC'){pay.dataset.unresolved='1';
            setStatus('Chờ đồng bộ: kết nối bị gián đoạn. Nếu thẻ đã bị trừ tiền, hệ thống sẽ tự đối soát biên nhận khi đồng bộ; vui lòng không thanh toán lại.');
            try{await syncFlow({client,cardId:pay.dataset.cardId});if(await refreshPaid())return;}catch{}
          }
          else setStatus(message(error));
        }
        finally{busy=false;if(payButton)payButton.disabled=Number(pay.dataset.serverBalance)<Number(pay.dataset.total)||pay.dataset.unresolved==='1';if(syncButton)syncButton.disabled=false;}
      }
      const doSync=()=>guarded(syncButton,async()=>{
        setStatus('Đang xử lý…');
        await syncFlow({client,cardId:pay.dataset.cardId});
        if(await refreshPaid())return;
        setStatus('Chờ đồng bộ: chưa tìm thấy biên nhận hợp lệ trên thẻ. Giữ nguyên thẻ và thử lại, hoặc liên hệ nhân viên để đối soát.');
      });
      if(syncButton)syncButton.addEventListener('click',doSync);
      if(payButton)payButton.addEventListener('click',()=>guarded(payButton,async()=>{
        setStatus('Đang xử lý…');
        const result=await payFlow({client,cardId:pay.dataset.cardId,orderId:pay.dataset.orderId,total:Number(pay.dataset.total),onState:value=>{if(value==='processing')setStatus('Đang xử lý…');}});
        if(stale)return;
        if(result.status==='paid'){setStatus('Thành công');root.location.assign(pay.dataset.successUrl);return;}
        if(!await refreshPaid())setStatus('Đơn hàng đã thay đổi. Vui lòng tải lại trang.');
      }));
      if(pay.dataset.unresolved==='1')doSync();
    }
    for(const [selector,url] of [['form[data-card-lock-send]','/account/card-lock/otp'],['form[data-card-lock-confirm]','/account/card-lock/confirm']]){
      const form=document.querySelector(selector);if(form)form.addEventListener('submit',event=>{event.preventDefault();run(form.querySelector('button'),async()=>{
        const body=Object.fromEntries(new root.FormData(form));
        try{const result=await post(root.fetch.bind(root),url,body);if(stale)return;if(status)status.textContent=result.message;if(selector.includes('send')){const email=document.querySelector('form[data-card-lock-confirm] input[name="email"]');if(email)email.value=body.email;}else{client?.dispose();for(const item of document.querySelectorAll('[data-card-logout]'))item.hidden=true;}}finally{body.otp='';const otp=form.querySelector('input[name="otp"]');if(otp)otp.value='';}
      });});
    }
  }
  return{loginFlow,readFlow,profileFlow,autofillFlow,payFlow,syncFlow,message,mount};
}));
