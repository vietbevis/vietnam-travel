(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(root,require('../../../assets/js/card/card-shared'));
  else {root.CardAdmin=factory(root,root.CardShared);root.addEventListener('DOMContentLoaded',()=>root.CardAdmin.bind());}
}(typeof window!=='undefined'?window:globalThis,function(root,S){
  'use strict';
  async function preparePhoto(file,environment=root){
    let image;
    try{
      image=await environment.createImageBitmap(file);
      if(!image.width||!image.height)throw new Error('Ảnh không hợp lệ.');
      const canvas=environment.document.createElement('canvas');canvas.width=160;canvas.height=200;
      const width=Math.min(image.width,image.height*0.8),height=width/0.8;
      canvas.getContext('2d').drawImage(image,(image.width-width)/2,(image.height-height)/2,width,height,0,0,160,200);
      for(let quality=8;quality>=3;quality--){
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality/10));
        if(!blob)throw new Error('Ảnh không thể chuyển sang JPEG.');
        const bytes=new Uint8Array(await blob.arrayBuffer());
        if(bytes.length&&bytes.length<=10080)return bytes;
      }
      throw new Error('Ảnh vẫn quá 10 080 byte; hãy chọn ảnh khác.');
    }catch(error){if(error.message?.startsWith('Ảnh'))throw error;throw new Error('Ảnh không thể đọc; hãy chọn ảnh khác.');}
    finally{if(image?.close)image.close();}
  }
  function base64(bytes){let value='';for(const byte of bytes)value+=String.fromCharCode(byte);return root.btoa(value);}
  async function issueFlow(formData,options={}){
    const client=options.client||root.cardClient;
    const fetcher=options.fetch||root.fetch.bind(root),base=options.base||'/admin/card';
    const requestId=formData.requestId||root.crypto.randomUUID().replace(/-/g,'');
    let prepared,finishStarted=false,prepareSent=false;
    async function post(path,body,cleanup=false){
      const controller=new AbortController();
      const signal=cleanup?undefined:options.signal;
      const abort=()=>controller.abort();if(signal?.aborted)controller.abort();signal?.addEventListener('abort',abort,{once:true});
      const timeout=setTimeout(abort,15000);
      try{
        const response=await fetcher(base+path,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
        const json=await response.json();
        if(!response.ok||json.code!=='success'){const error=new Error(json.message||'Yêu cầu phát hành bị từ chối.');error.status=response.status;throw error;}
        return json;
      }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);controller.abort();}
    }
    try{
      const session=await client.openSession();
      if(session.state!==S.STATE.CREATED)throw new Error('Thẻ phải ở trạng thái CREATED trước khi phát hành.');
      const photo=formData.photo instanceof Uint8Array?formData.photo:await preparePhoto(formData.photo);
      const {photo:discard,...body}=formData;
      const payload={...body,requestId,photoBase64:base64(photo)};
      prepareSent=true;
      try{prepared=await post('/issue/prepare',payload);}
      catch(error){if(error.status||options.signal?.aborted)throw error;prepared=await post('/issue/prepare',payload);}
      const [init]=await client.transmit([prepared.initApdu]);
      await post('/issue/init-confirm',{cardId:prepared.cardId,response:init.data,sw:init.sw});
      await client.verifyPin(prepared.initialPin);
      await client.writeTarget(1,S.fromHex(prepared.profileHex));
      await client.runSignedOp({opId:prepared.profileOpId,signUrl:base+'/op/sign',confirmUrl:base+'/op/confirm'});
      await client.writeTarget(2,photo);
      await client.runSignedOp({opId:prepared.photoOpId,signUrl:base+'/op/sign',confirmUrl:base+'/op/confirm'});
      finishStarted=true;
      let finished;
      try{finished=await post('/issue/finish',{cardId:prepared.cardId});}
      catch(error){if(error.status)throw error;finished=await post('/issue/finish',{cardId:prepared.cardId});}
      return {cardId:prepared.cardId,initialPin:prepared.initialPin,emailStatus:finished.emailStatus};
    }catch(error){
      if(prepareSent){
        let cancelled;
        try{cancelled=await post('/issue/cancel',{requestId},true);}
        catch{const pending=new Error(finishStarted?'Chưa xác nhận được kết quả phát hành. Hãy kiểm tra trạng thái thẻ trước khi thử lại; yêu cầu hủy chưa được xác nhận.':'Phát hành bị gián đoạn; chưa xác nhận được việc hủy trên server. Hãy thử lại để đối chiếu yêu cầu trước khi bắt đầu phát hành mới.');pending.pendingRequestId=requestId;throw pending;}
        const failure=new Error(!prepared?(error.status?error.message:'Đã hủy yêu cầu chuẩn bị chưa rõ kết quả; thẻ chưa được gửi INIT. Có thể thử lại với cùng khách hàng.'):finishStarted?'Chưa xác nhận được phát hành; server đã hủy bản ghi đang phát hành. Hãy kiểm tra thẻ và reset thẻ ảo hoặc cài lại applet trước khi thử lại.':'Phát hành chưa hoàn tất và đã hủy trên server. Hãy cài lại applet trên thẻ thật hoặc reset thẻ ảo trước khi thử lại.');
        failure.recoveryCustomerId=cancelled.customerId;throw failure;
      }
      throw error;
    }finally{if(prepared){prepared.initialPin='';prepared.initApdu='';}}
  }
  async function resetSim(options={}){
    const info=await (options.client||root.cardClient).status();
    if(info?.mode!=='sim'||!Number.isInteger(info.slot)||info.slot<0||info.slot>3)throw new Error('Chỉ reset được thẻ ảo.');
    const url=new URL(options.agentUrl||root.CARD_AGENT_URL||'http://127.0.0.1:31999');
    if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Cấu hình Agent không hợp lệ.');
    const response=await (options.fetch||root.fetch.bind(root))(url.origin+'/v1/sim/reset',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({slot:info.slot})}),json=await response.json();
    if(!response.ok||json.slot!==info.slot)throw new Error('Agent chưa xác nhận reset.');
    return true;
  }
  function bind(){
    const document=root.document,form=document.querySelector('[data-card-issue]');if(!form)return;
    const status=document.querySelector('[data-card-status]'),preview=document.querySelector('[data-card-preview]'),pinDialog=document.querySelector('[data-card-pin-dialog]'),pin=document.querySelector('[data-card-pin]'),reset=document.querySelector('[data-card-reset]');
    let previewUrl=null,busy=false,aborter,pendingRequestId=null;
    function recoverCustomer(customerId){
      if(!customerId)return;
      let option=Array.from(form.elements.customerId.options).find(item=>item.value===customerId);
      if(!option){option=document.createElement('option');option.value=customerId;option.textContent=form.elements.fullName.value||form.elements.email.value||'Khách hàng vừa tạo';form.elements.customerId.append(option);}
      form.elements.ownerType.value='customer';form.elements.customerId.value=customerId;choice();
    }
    const clearPin=()=>{pin.textContent='';if(pinDialog.open)pinDialog.close();};
    pinDialog.addEventListener('close',()=>{pin.textContent='';});
    document.querySelector('[data-card-pin-dismiss]').addEventListener('click',clearPin);
    function choice(){const staff=form.elements.ownerType.value==='staff',existing=!!form.elements.customerId.value;document.querySelector('[data-card-customer]').hidden=staff;document.querySelector('[data-card-staff]').hidden=!staff;document.querySelector('[data-card-new-customer]').hidden=staff||existing;form.elements.accountId.required=staff;for(const name of ['fullName','email'])form.elements[name].required=!staff&&!existing;}
    form.elements.ownerType.addEventListener('change',choice);form.elements.customerId.addEventListener('change',choice);choice();
    form.elements.photo.addEventListener('change',()=>{if(previewUrl)root.URL.revokeObjectURL(previewUrl);previewUrl=null;preview.removeAttribute('src');if(form.elements.photo.files[0]){previewUrl=root.URL.createObjectURL(form.elements.photo.files[0]);preview.src=previewUrl;}});
    const cleanup=()=>{clearPin();aborter?.abort();if(previewUrl)root.URL.revokeObjectURL(previewUrl);previewUrl=null;};
    root.addEventListener('pagehide',cleanup);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!form.reportValidity())return;
      clearPin();busy=true;aborter=new AbortController();form.querySelector('button[type="submit"]').disabled=true;status.textContent='Đang phát hành, giữ nguyên thẻ trong đầu đọc…';
      try{
        if(pendingRequestId){
          const response=await root.fetch(form.dataset.cardBase+'/issue/cancel',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:pendingRequestId})}),cancelled=await response.json();
          if(!response.ok||cancelled.code!=='success')throw new Error('Chưa đối chiếu được yêu cầu trước; hãy kiểm tra trạng thái thẻ.');
          pendingRequestId=null;recoverCustomer(cancelled.customerId);
        }
        const body={ownerType:form.elements.ownerType.value,photo:form.elements.photo.files[0]};
        if(body.ownerType==='staff')body.accountId=form.elements.accountId.value;
        else if(form.elements.customerId.value)body.customerId=form.elements.customerId.value;
        else{body.customer={};for(const key of ['fullName','email','phone','dob','gender','idNumber','emergencyName','emergencyPhone','bloodType','allergies'])if(form.elements[key].value)body.customer[key]=form.elements[key].value;}
        const result=await issueFlow(body,{base:form.dataset.cardBase,signal:aborter.signal});
        status.textContent=result.emailStatus==='failed'?'Thẻ đã hoạt động. Gửi email chưa thành công; PIN chỉ hiển thị một lần bên dưới.':'Thẻ đã hoạt động. PIN ban đầu chỉ hiển thị một lần; hãy đổi PIN khi đăng nhập.';
        if(!aborter.signal.aborted){pin.textContent=result.initialPin;pinDialog.showModal();}result.initialPin='';
      }catch(error){if(error.pendingRequestId)pendingRequestId=error.pendingRequestId;recoverCustomer(error.recoveryCustomerId);status.textContent=error.message||'Không thể phát hành thẻ.';}
      finally{busy=false;form.querySelector('button[type="submit"]').disabled=false;}
    });
    root.cardClient.status().then(info=>{reset.hidden=info?.mode!=='sim';});
    reset.addEventListener('click',async()=>{
      if(busy||!root.confirm('Reset thẻ ảo sẽ xóa dữ liệu trong slot hiện tại. Tiếp tục?'))return;
      try{
        await resetSim();
        status.textContent='Đã reset thẻ ảo; có thể bắt đầu phát hành lại.';
      }catch{status.textContent='Chưa xác nhận được reset thẻ ảo. Hãy kiểm tra Card Agent.';}
    });
  }
  return {preparePhoto,issueFlow,resetSim,bind};
}));
