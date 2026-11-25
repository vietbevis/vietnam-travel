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
  // Bảng thông báo tiếng Việt cho mọi errorCode server / card-client / card-shared có thể trả về.
  const ERROR_MESSAGES={
    PIN_CANCELLED:'Đã hủy nhập PIN; thao tác chưa được thực hiện.',PIN_BUSY:'Đang có hộp nhập PIN khác mở. Hãy hoàn tất hoặc đóng hộp đó rồi thử lại.',PIN_FORMAT:'PIN phải gồm đúng 6 chữ số.',PIN_MODAL_UNAVAILABLE:'Không mở được hộp nhập PIN. Hãy tải lại trang rồi thử lại.',
    WEAK_PIN:'PIN quá yếu (không dùng 6 số giống nhau, dãy số liên tiếp hoặc ngày sinh DDMMYY). Vui lòng nhập mã khác.',INVALID_PIN:'PIN không hợp lệ. PIN phải gồm đúng 6 chữ số.',
    AUTH_REQUIRED:'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',CARD_AUTH_INVALID:'Không thể xác thực thẻ. Hãy kiểm tra thẻ trong đầu đọc và thử lại.',
    OP_FORBIDDEN:'Bạn không có quyền thực hiện thao tác này, hoặc thẻ đang cắm không phải thẻ của tài khoản hiện tại.',OP_STATE:'Thao tác đã hết hạn hoặc đã thay đổi trạng thái. Hãy tải lại trang và thử lại.',OP_NOT_FOUND:'Không tìm thấy thao tác thẻ này (có thể đã hết hạn). Hãy bắt đầu lại.',
    STEP_UP_REQUIRED:'Cần xác thực lại bằng thẻ nhân viên của tài khoản hiện tại.',
    STAFF_CARD_REQUIRED:'Tài khoản của bạn chưa có thẻ nhân viên đang hoạt động. Hãy phát hành thẻ nhân viên cho tài khoản này (Phát hành thẻ → Nhân viên) rồi đăng nhập lại bằng thẻ.',
    STAFF_CARD_CHANGED:'Phiên đăng nhập gắn với thẻ nhân viên khác thẻ đang hoạt động (có thể thẻ đã được thay). Hãy đăng xuất và đăng nhập lại bằng thẻ nhân viên mới.',
    STAFF_CARD_MISMATCH:'Thẻ đang cắm không phải thẻ nhân viên của phiên đăng nhập này. Hãy cắm đúng thẻ đã dùng để đăng nhập, hoặc đăng nhập lại bằng thẻ này.',
    RATE_LIMITED:'Bạn thao tác quá nhanh. Hãy đợi giây lát rồi thử lại.',
    CARD_RELOGIN_REQUIRED:'Tài khoản đã được yêu cầu đăng nhập bằng thẻ nhân viên. Vui lòng đăng nhập lại bằng mật khẩu và thẻ.',
    CARD_NOT_FOUND:'Không tìm thấy thẻ này trên hệ thống.',CARD_STATE:'Trạng thái thẻ hiện không cho phép thao tác này.',CURRENT_CARD:'Đây không phải thẻ hiện hành của chủ thẻ. Hãy dùng thẻ mới nhất.',OWNER_STATE:'Chủ thẻ hiện không ở trạng thái cho phép thao tác này.',
    INVALID_INPUT:'Dữ liệu nhập không hợp lệ. Hãy kiểm tra lại các trường rồi thử lại.',INVALID_BODY:'Dữ liệu gửi lên không hợp lệ.',INVALID_AMOUNT:'Số tiền không hợp lệ.',INVALID_PHOTO:'Ảnh không hợp lệ. Hãy chọn ảnh khác.',PHOTO_UPLOAD:'Không tải được ảnh lên. Hãy chọn ảnh khác và thử lại.',PROFILE_TOO_LARGE:'Hồ sơ quá lớn để ghi vào thẻ. Hãy rút gọn thông tin.',INVALID_PROFILE:'Hồ sơ thẻ không hợp lệ.',INVALID_PROFILE_TLV:'Hồ sơ trên thẻ bị lỗi định dạng.',INVALID_REPLACEMENT:'Yêu cầu cấp lại thẻ không hợp lệ hoặc đã khác với yêu cầu trước đó.',INVALID_TARGET:'Vùng dữ liệu thẻ không hợp lệ.',INVALID_CARD_TYPE:'Loại thẻ không đúng. Hãy cắm đúng loại thẻ.',INVALID_OP_ID:'Mã thao tác không hợp lệ.',INVALID_INIT:'Dữ liệu khởi tạo thẻ không hợp lệ.',INVALID_PAYLOAD:'Dữ liệu thao tác không hợp lệ.',INVALID_AUTH_PURPOSE:'Mục đích xác thực không hợp lệ.',INVALID_ORDER_CODE:'Mã đơn hàng không hợp lệ.',INVALID_DEPARTURE_DATE:'Ngày khởi hành không hợp lệ.',INVALID_ESCROW_KEY:'Khóa ký quỹ không hợp lệ. Hãy liên hệ quản trị.',INVALID_SERVER_KEY:'Khóa máy chủ thẻ không hợp lệ. Hãy liên hệ quản trị.',CARD_SERVER_KEY_PATH_REQUIRED:'Máy chủ chưa cấu hình khóa thẻ. Hãy liên hệ quản trị.',
    INVALID_APDU:'Lệnh gửi thẻ không hợp lệ.',INVALID_APDU_DATA:'Dữ liệu lệnh gửi thẻ không hợp lệ.',INVALID_APDU_HEADER:'Tiêu đề lệnh gửi thẻ không hợp lệ.',INVALID_BYTE:'Dữ liệu thẻ không hợp lệ.',INVALID_BYTES:'Dữ liệu thẻ không hợp lệ.',INVALID_HEX:'Dữ liệu thẻ không hợp lệ.',INVALID_HEX_LENGTH:'Độ dài dữ liệu thẻ không hợp lệ.',INVALID_RANDOM_LENGTH:'Độ dài dữ liệu ngẫu nhiên không hợp lệ.',INVALID_UINT32:'Dữ liệu thẻ không hợp lệ.',TARGET_LENGTH:'Độ dài dữ liệu thẻ không hợp lệ.',
    TOPUP_LIMIT:'Khoản nạp vượt hạn mức cho phép (tối đa 20.000.000 VNĐ mỗi lần và mỗi nhân viên mỗi ngày; số dư thẻ tối đa 50.000.000 VNĐ).',
    REQUEST_MISMATCH:'Yêu cầu trùng mã nhưng khác nội dung. Hãy tải lại trang và tạo yêu cầu mới.',REQUEST_TIMEOUT:'Yêu cầu quá thời gian. Hãy kiểm tra kết nối rồi thử lại; nếu đang thu tiền, hãy đối chiếu giao dịch, không thu lần nữa.',
    ISSUE_CLOSED:'Yêu cầu phát hành đã đóng. Hãy bắt đầu phát hành mới.',ISSUE_EXPIRED:'Yêu cầu phát hành đã hết hạn. Hãy bắt đầu phát hành mới.',ISSUE_INCOMPLETE:'Phát hành chưa hoàn tất. Hãy kiểm tra trạng thái thẻ trước khi thử lại.',ISSUE_PREPARING:'Yêu cầu phát hành đang được chuẩn bị. Vui lòng đợi giây lát rồi thử lại.',ISSUE_STARTED:'Yêu cầu phát hành đã bắt đầu ghi thẻ. Hãy kiểm tra trạng thái thẻ trước khi thử lại.',
    REPLACEMENT_DEFERRED:'Việc cấp lại thẻ đang chờ xử lý. Hãy hoàn tất từ thẻ nguồn.',REFUND_REQUIRED:'Thẻ còn số dư; cần xác nhận đã hoàn tiền cho khách trước khi thu hồi.',RECONCILIATION_REQUIRED:'Cần đối soát giao dịch trước khi tiếp tục. Không thu tiền lại.',SYNC_LOOP:'Đồng bộ thẻ lặp quá nhiều lần. Hãy rút thẻ, cắm lại và thử lại.',
    CHECKIN:'Không thể check-in cho vé này.',CHECKIN_WINDOW:'Chưa đến hoặc đã quá thời gian check-in của tour này.',ITEM_NOT_FOUND:'Không tìm thấy vé trong đơn hàng.',ORDER_STATE:'Trạng thái đơn hàng không cho phép thao tác này.',TICKET_GONE:'Vé không còn hiệu lực.',TICKET_NOT_WRITTEN:'Vé chưa được ghi lên thẻ. Hãy để khách đăng nhập để đồng bộ trước.',TICKET_USED:'Vé đã được sử dụng.',
    AGENT_HTTP:'Card Agent chưa sẵn sàng hoặc khe đọc không có thẻ.',AGENT_RESPONSE:'Card Agent trả về dữ liệu không hợp lệ. Hãy kiểm tra Card Agent.',AGENT_URL:'Địa chỉ Card Agent không hợp lệ.',CARD_RESPONSE:'Không đọc được thẻ. Hãy kiểm tra thẻ trong khe đọc.',
    SERVER_HTTP:'Máy chủ từ chối yêu cầu. Hãy thử lại sau.',SERVER_REJECTED:'Máy chủ từ chối thao tác thẻ. Hãy thử lại hoặc liên hệ quản trị.',SERVER_RESPONSE:'Máy chủ trả về dữ liệu không hợp lệ. Hãy thử lại sau.',SERVER_UNAVAILABLE:'Không kết nối được máy chủ. Hãy kiểm tra mạng và thử lại.',SERVER_URL:'Địa chỉ máy chủ không hợp lệ.',
    CLIENT_STALE:'Trang đã thay đổi. Hãy tải lại trang và thử lại.',CLIENT_SUSPENDED:'Trang đã tạm dừng. Hãy tải lại trang và thử lại.',CLIENT_DISPOSED:'Trang đã đóng. Hãy tải lại trang và thử lại.',INTERNAL:'Máy chủ gặp lỗi nội bộ. Hãy thử lại sau.'
  };
  const GENERIC_ERROR='Không thể hoàn tất thao tác thẻ. Hãy kiểm tra Card Agent, thẻ trong đầu đọc rồi thử lại.';
  const VIET=/[À-ỹ]/;
  // Luôn trả về thông báo tiếng Việt; không bao giờ trả mã lỗi thô.
  function errorMessage(error,fallback){
    if(error==null)return fallback||GENERIC_ERROR;
    if(error.sw)return S.swMessage(error.sw);
    const code=typeof error.code==='string'?error.code:'',text=typeof error.message==='string'?error.message:'';
    // Thông báo tiếng Việt đã có (từ server hoặc client) thì giữ nguyên.
    if(text&&text!==code&&VIET.test(text))return text;
    if(code&&ERROR_MESSAGES[code])return ERROR_MESSAGES[code];
    if(text&&ERROR_MESSAGES[text])return ERROR_MESSAGES[text];
    if(error.name==='AbortError')return 'Yêu cầu đã bị hủy hoặc quá thời gian. Hãy kiểm tra kết nối rồi thử lại.';
    if(error instanceof TypeError)return 'Không thể kết nối. Hãy kiểm tra mạng và Card Agent rồi thử lại.';
    const raw=code||(/^[A-Z][A-Z0-9_]{2,}$/.test(text)?text:'');
    if(raw)return (fallback||GENERIC_ERROR)+' ('+raw+')';
    return text&&VIET.test(text)?text:(fallback||GENERIC_ERROR);
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
        if(!response.ok||json.code!=='success'){const error=new Error(json.message||'Yêu cầu phát hành bị từ chối.');error.status=response.status;if(typeof json.errorCode==='string')error.code=json.errorCode;throw error;}
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
      return {cardId:prepared.cardId,initialPin:prepared.initialPin,emailStatus:finished.emailStatus,reloginRequired:finished.reloginRequired===true};
    }catch(error){
      if(prepareSent){
        let cancelled;
        try{cancelled=await post('/issue/cancel',{requestId},true);}
        catch{const pending=new Error(finishStarted?'Chưa xác nhận được kết quả phát hành. Hãy kiểm tra trạng thái thẻ trước khi thử lại; yêu cầu hủy chưa được xác nhận.':'Phát hành bị gián đoạn; chưa xác nhận được việc hủy trên server. Hãy thử lại để đối chiếu yêu cầu trước khi bắt đầu phát hành mới.');pending.pendingRequestId=requestId;throw pending;}
        const failure=new Error(!prepared?(error.status?errorMessage(error):'Đã hủy yêu cầu chuẩn bị chưa rõ kết quả; thẻ chưa được gửi INIT. Có thể thử lại với cùng khách hàng.'):finishStarted?'Chưa xác nhận được phát hành; server đã hủy bản ghi đang phát hành. Hãy kiểm tra thẻ và reset thẻ ảo hoặc cài lại applet trước khi thử lại.':'Phát hành chưa hoàn tất và đã hủy trên server. Hãy cài lại applet trên thẻ thật hoặc reset thẻ ảo trước khi thử lại.');
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
  async function statusFlow(body,options={}){
    const client=options.client||root.cardClient,fetcher=options.fetch||root.fetch.bind(root),base=options.base||'/admin/card';
    // Chụp payload một lần để yêu cầu gửi lại không thay đổi ý định ban đầu.
    const payload=JSON.stringify(body);
    async function send(){
      const controller=new AbortController(),signal=options.signal;
      const abort=()=>controller.abort();if(signal?.aborted)controller.abort();signal?.addEventListener('abort',abort,{once:true});
      const timeout=setTimeout(abort,15000);
      try{
        const response=await fetcher(base+'/status',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:payload,signal:controller.signal});
        const result=await response.json();
        if(controller.signal.aborted)throw new Error('Yêu cầu đã bị hủy. Hãy kiểm tra trạng thái thẻ trước khi thử lại.');
        return {response,result};
      }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);controller.abort();}
    }
    let output=await send();
    if(output.result.code==='step-up-required'){
      options.onStepUp?.();
      const info=await client.openSession();
      if(info.state!==S.STATE.ACTIVE||info.cardType!==2)throw new Error('Hãy cắm thẻ nhân viên đang hoạt động của tài khoản hiện tại để xác thực lại.');
      let pin;
      try{pin=await client.askPin('Nhập PIN thẻ nhân viên để xác thực thao tác');await client.verifyPin(pin);}finally{pin='';}
      const proof=await client.authenticate({challengeUrl:base+'/step-up/challenge',verifyUrl:base+'/step-up/verify'});
      if(proof.code!=='success')throw new Error('Không thể xác thực thẻ nhân viên.');
      if(options.signal?.aborted)throw new Error('Yêu cầu đã bị hủy.');
      output=await send();
    }
    if(!output.response.ok||output.result.code!=='success')throw new Error(output.result.message||'Không thể cập nhật trạng thái thẻ.');
    return output.result;
  }
  async function operationPost(path,body,options={},requestId){
    const controller=new AbortController(),signal=options.signal,abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();signal?.addEventListener('abort',abort,{once:true});
    let timeout;
    try{
      return await Promise.race([(async()=>{
        if(controller.signal.aborted)throw new Error('Yêu cầu đã bị hủy.');
        const response=await (options.fetch||root.fetch.bind(root))((options.base||'/admin/card')+path,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json',...(requestId?{'Idempotency-Key':requestId}:{})},body:JSON.stringify(body),signal:controller.signal});
        const result=await response.json();
        if(controller.signal.aborted)throw new Error('Yêu cầu đã bị hủy; cần đối chiếu kết quả trên server.');
        if(result.code==='step-up-required'){
          const error=new Error('Cần xác thực lại thẻ nhân viên.');error.code='STEP_UP_REQUIRED';error.status=response.status;throw error;
        }
        if(!response.ok||result.code!=='success'){const error=new Error(result.message||'Yêu cầu thẻ bị từ chối.');error.status=response.status;if(typeof result.errorCode==='string')error.code=result.errorCode;throw error;}
        return result;
      })(),new Promise((resolve,reject)=>{timeout=setTimeout(()=>{abort();reject(new Error('Hết thời gian chờ; hãy đối chiếu cùng yêu cầu, không thu tiền lần nữa.'));},15000);})]);
    }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);controller.abort();}
  }
  async function renewOperationStepUp(client,options){
    await authenticateStaff(client,options);
    const error=new Error('Đã xác thực nhân viên. Hãy cắm lại đúng thẻ đang xem rồi bấm lại thao tác; giữ nguyên yêu cầu tiền mặt cũ nếu có.');error.code='SWITCH_TARGET_CARD';throw error;
  }
  async function authenticateStaff(client,options){
    await options.onStepUp?.();
    const base=options.base||'/admin/card',info=await client.openSession();
    if(info.state!==S.STATE.ACTIVE||info.cardType!==2)throw new Error('Hãy cắm thẻ nhân viên đang hoạt động của tài khoản hiện tại để xác thực lại.');
    let pin;try{pin=await client.askPin('Nhập PIN thẻ nhân viên để xác thực thao tác');await client.verifyPin(pin);}finally{pin='';}
    const proof=await client.authenticate({challengeUrl:base+'/step-up/challenge',verifyUrl:base+'/step-up/verify'});
    if(proof.code!=='success')throw new Error('Không thể xác thực thẻ nhân viên.');
  }
  async function replaceFlow(body,options={}){
    const payload={cardId:body.cardId,reason:body.reason};
    try{return await operationPost('/replace',payload,options);}
    catch(error){if(error.code!=='STEP_UP_REQUIRED')throw error;await authenticateStaff(options.client||root.cardClient,options);return operationPost('/replace',payload,options);}
  }
  async function profileFlow(body,options={}){
    const client=options.client||root.cardClient,base=options.base||'/admin/card';
    const card=await client.openSession({expectedCardId:body.cardId,sync:false});
    if(card.state!==S.STATE.ACTIVE||card.cardType!==1||card.cardId!==body.cardId.toUpperCase())throw new Error('Hãy cắm đúng thẻ khách đang hoạt động.');
    let pin;try{pin=await client.askPin('Khách nhập PIN để sửa hồ sơ / ảnh');await client.verifyPin(pin);}finally{pin='';}
    const bytes=body.photo?(body.photo instanceof Uint8Array?body.photo:await preparePhoto(body.photo)):undefined;
    const prepared=await operationPost('/profile/build',{cardId:body.cardId,...(body.fields?{fields:body.fields}:{}),...(bytes?{photoBase64:base64(bytes)}:{})},options);
    const result={profile:'not-requested',photo:'not-requested'};
    for(const [key,target,id,data]of [['profile',1,prepared.profileOpId,prepared.profileHex&&S.fromHex(prepared.profileHex)],['photo',2,prepared.photoOpId,bytes]]){
      if(!id)continue;
      try{await client.writeTarget(target,data);const confirmed=await client.runSignedOp({opId:id,signUrl:base+'/op/sign',confirmUrl:base+'/op/confirm'});result[key]=confirmed.ok?'done':'failed';}
      catch(error){result[key]='unknown';result[key+'Message']=errorMessage(error);}
    }
    return result;
  }
  function bindProfileReplacement(){
    const document=root.document,profile=document.querySelector('[data-card-profile-form]'),replace=document.querySelector('[data-card-replace-form]');
    let busy=false,aborter,previewUrl;
    const controls=()=>Array.from(document.querySelectorAll('[card-actions] button,[card-actions] input,[card-actions] select'));
    const setBusy=value=>{busy=value;for(const element of controls())element.disabled=value;};
    root.addEventListener('pagehide',()=>{aborter?.abort();if(previewUrl)root.URL.revokeObjectURL(previewUrl);});
    profile?.elements.photo.addEventListener('change',()=>{if(previewUrl)root.URL.revokeObjectURL(previewUrl);previewUrl=null;const preview=document.querySelector('[data-card-profile-preview]');preview.removeAttribute('src');if(profile.elements.photo.files[0]){previewUrl=root.URL.createObjectURL(profile.elements.photo.files[0]);preview.src=previewUrl;}});
    profile?.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!profile.reportValidity())return;setBusy(true);aborter=new AbortController();const message=document.querySelector('[data-card-profile-message]');message.textContent='Đang ghi hồ sơ / ảnh; giữ nguyên thẻ khách…';
      const fields={};for(const element of profile.querySelectorAll('[data-profile-field]'))if(element.value!==element.defaultValue)fields[element.name]=element.name==='dob'?element.value.replace(/-/g,''):element.value;
      try{
        const result=await profileFlow({cardId:profile.dataset.cardId,...(Object.keys(fields).length?{fields}:{}),photo:profile.elements.photo.files[0]},{base:profile.dataset.cardBase,signal:aborter.signal});
        const names={done:'đã xác nhận',failed:'thẻ báo lỗi',unknown:'chưa rõ kết quả', 'not-requested':'không yêu cầu'};
        message.textContent='Hồ sơ: '+names[result.profile]+'. Ảnh: '+names[result.photo]+'. Tải lại dữ liệu server trước khi sửa tiếp. Kết quả chưa rõ cần đối chiếu và ghi lại từ hồ sơ chuẩn; không tự áp thay đổi.';
        profile.querySelector('[data-card-profile-reload]').hidden=false;
        // Không gửi lại form chứa dữ liệu trước khi biết kết quả từng operation.
        profile.querySelector('button[type="submit"]').dataset.finished='true';
      }catch(error){message.textContent=errorMessage(error);}
      finally{setBusy(false);if(profile.querySelector('button[type="submit"]').dataset.finished)profile.querySelector('button[type="submit"]').disabled=true;}
    });
    profile?.querySelector('[data-card-profile-reload]').addEventListener('click',()=>root.location.reload());
    replace?.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!replace.reportValidity()||!root.confirm('Cấp lại sẽ thu hồi vĩnh viễn thẻ cũ. Số dư được giữ đến khi thẻ mới hoàn tất. Tiếp tục?'))return;
      setBusy(true);aborter=new AbortController();const message=document.querySelector('[data-card-replace-message]');
      try{const result=await replaceFlow({cardId:replace.dataset.cardId,reason:replace.elements.replacementReason.value.trim()},{base:replace.dataset.cardBase,signal:aborter.signal,onStepUp:()=>{if(!root.confirm('Cắm thẻ nhân viên của tài khoản hiện tại rồi bấm OK để xác thực cấp lại.'))throw new Error('Đã hủy xác thực.');}});root.location.assign(result.redirect);}
      catch(error){message.textContent=errorMessage(error)+' Nếu mất phản hồi, tải lại trang để tiếp tục từ thẻ nguồn; không hoàn tiền thủ công.';}
      finally{setBusy(false);}
    });
  }
  async function resetPinFlow(body,options={}){
    const client=options.client||root.cardClient,base=options.base||'/admin/card';
    const target=await client.openSession({expectedCardId:body.cardId,sync:false});
    if(target.state!==S.STATE.ACTIVE||target.cardId!==body.cardId.toUpperCase())throw new Error('Hãy cắm đúng thẻ đang hoạt động được xem trước khi reset PIN.');
    let prepared;
    try{prepared=await operationPost('/reset-pin',{cardId:body.cardId},options);}
    catch(error){if(error.code==='STEP_UP_REQUIRED')await renewOperationStepUp(client,options);throw error;}
    options.onPrepared?.(prepared.opId);
    const confirmed=await client.runSignedOp({opId:prepared.opId,signUrl:base+'/op/sign',confirmUrl:base+'/op/confirm'});
    if(!confirmed.ok||!S.isPinFormat(confirmed.result?.newPin))throw new Error('Chưa nhận được PIN mới. Không tự gửi lại RESET_PIN; hãy kiểm tra trạng thái thẻ.');
    const result={newPin:confirmed.result.newPin,emailStatus:confirmed.result.emailStatus};confirmed.result.newPin='';return result;
  }
  async function cashTopupFlow(intent,options={}){
    const client=options.client||root.cardClient;
    const body={cardId:intent.cardId,amount:intent.amount},requestId=intent.requestId;
    if(!/^[a-fA-F0-9]{32}$/.test(requestId||'')||!Number.isSafeInteger(body.amount)||body.amount<10000)throw new Error('Số tiền hoặc mã yêu cầu nạp không hợp lệ.');
    const target=await client.openSession({expectedCardId:body.cardId,sync:false});
    if(target.state!==S.STATE.ACTIVE||target.cardId!==body.cardId.toUpperCase())throw new Error('Hãy cắm đúng thẻ khách đang hoạt động được xem trước khi nạp tiền.');
    let accepted;
    try{
      try{accepted=await operationPost('/topup-cash',body,options,requestId);}
      catch(error){if(error.status||options.signal?.aborted)throw error;accepted=await operationPost('/topup-cash',body,options,requestId);}
    }catch(error){if(error.code==='STEP_UP_REQUIRED')await renewOperationStepUp(client,options);throw error;}
    options.onAccepted?.(accepted);
    if(accepted.status==='done')return accepted;
    try{
      await client.openSession({expectedCardId:body.cardId});
      return await operationPost('/topup-cash',body,options,requestId);
    }catch(error){error.txRef=accepted.txRef;throw error;}
  }
  function bindOperations(){
    const document=root.document,resetForm=document.querySelector('[data-card-reset-pin-form]'),cashForm=document.querySelector('[data-card-topup-cash-form]');
    if(!resetForm&&!cashForm)return;
    const section=document.querySelector('[card-actions]'),message=document.querySelector('[data-card-ops-message]'),dialog=document.querySelector('[data-card-new-pin-dialog]'),pin=document.querySelector('[data-card-new-pin]'),recover=document.querySelector('[data-card-cash-recover]'),newPayment=document.querySelector('[data-card-new-cash-payment]');
    let busy=false,aborter,intent=null,completed=false,resetUncertain=false;
    const controls=Array.from(section.querySelectorAll('button,input'));
    const clearPin=()=>{if(pin)pin.textContent='';if(dialog?.open)dialog.close();};
    dialog?.addEventListener('close',clearPin);document.querySelector('[data-card-new-pin-dismiss]')?.addEventListener('click',clearPin);
    function setBusy(value){busy=value;for(const control of controls)control.disabled=value;if(cashForm){cashForm.elements.amount.disabled=value||!!intent;cashForm.querySelector('button[type="submit"]').disabled=value||completed;}if(resetForm)resetForm.querySelector('button').disabled=value||resetUncertain;}
    root.addEventListener('pagehide',()=>{aborter?.abort();clearPin();});
    const options=form=>({base:form.dataset.cardBase,signal:aborter.signal,onStepUp:()=>{
      message.textContent='Yêu cầu chưa được tạo mới. Hãy cắm thẻ nhân viên của tài khoản hiện tại để xác thực; sau đó cắm lại thẻ đang xem và gửi lại cùng yêu cầu.';
      if(!root.confirm('Hãy cắm thẻ nhân viên của tài khoản hiện tại, sau đó bấm OK để xác thực. Chưa thu tiền hoặc tạo khoản nạp mới.'))throw new Error('Đã hủy xác thực; giữ nguyên yêu cầu để đối chiếu.');
    }});
    resetForm?.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||resetUncertain)return;clearPin();setBusy(true);aborter=new AbortController();message.textContent='Đang reset PIN; giữ đúng thẻ trong đầu đọc…';
      try{
        const result=await resetPinFlow({cardId:resetForm.dataset.cardId},{...options(resetForm),onPrepared:()=>{resetUncertain=true;}});
        try{
          if(aborter.signal.aborted)return;
          message.textContent=result.emailStatus==='failed'?'Đã reset PIN. Gửi email thất bại; PIN mới chỉ hiện một lần. Khách cần đổi PIN trước khi sử dụng.':result.emailStatus==='not-applicable'?'Đã reset PIN. Chủ thẻ chưa có email; PIN mới chỉ hiện một lần.':'Đã reset PIN và gửi email. PIN mới chỉ hiện một lần; khách cần đổi PIN.';
          pin.textContent=result.newPin;dialog.showModal();
        }finally{result.newPin='';}
      }catch(error){if(!aborter.signal.aborted)message.textContent=errorMessage(error)+(resetUncertain?' Kết quả reset cần kiểm tra; không tự gửi lệnh reset lần nữa.':'');}
      finally{setBusy(false);}
    });
    async function cashRun(){
      if(busy||completed)return;setBusy(true);aborter=new AbortController();message.textContent='Đang đối chiếu khoản tiền mặt; không thu tiền lần nữa…';
      try{
        const result=await cashTopupFlow(intent,{...options(cashForm),onAccepted:accepted=>{intent.txRef=accepted.txRef;}});
        if(aborter.signal.aborted)return;
        completed=result.status==='done';
        message.textContent=completed?`Giao dịch ${result.txRef} đã hoàn tất. Chỉ bắt đầu khoản nạp mới khi nhận một khoản tiền khác.`:`Giao dịch ${result.txRef}: ${result.status}. Chưa xác nhận nạp xong; giữ nguyên yêu cầu và đồng bộ/đối soát, không thu tiền lại.`;
        recover.hidden=completed;newPayment.hidden=!completed;
      }catch(error){if(error.txRef)intent.txRef=error.txRef;if(!aborter.signal.aborted)message.textContent=errorMessage(error)+(intent.txRef?` Giao dịch ${intent.txRef} cần đối soát; không thu tiền lại.`:' Giữ nguyên yêu cầu để đối chiếu; chưa xác nhận đã tạo khoản nạp.');recover.hidden=false;}
      finally{setBusy(false);}
    }
    cashForm?.addEventListener('submit',event=>{
      event.preventDefault();if(busy||completed||!cashForm.reportValidity())return;
      if(!intent){if(!root.confirm('Xác nhận đã nhận khoản tiền mặt này? Nếu đang đối soát khoản cũ, hãy đồng bộ thay vì tạo khoản mới.'))return;intent={cardId:cashForm.dataset.cardId,amount:Number(cashForm.elements.amount.value),requestId:root.crypto.randomUUID().replace(/-/g,'')};}
      cashRun();
    });
    recover?.addEventListener('click',()=>{if(intent)cashRun();});
    newPayment?.addEventListener('click',()=>{if(busy||!completed)return;intent=null;completed=false;cashForm.reset();recover.hidden=true;newPayment.hidden=true;message.textContent='Có thể nhập một khoản tiền mặt mới.';setBusy(false);});
  }
  function bindStatus(){
    const document=root.document,form=document.querySelector('[data-card-status-form]');if(!form)return;
    const message=document.querySelector('[data-card-status-message]'),sync=document.querySelector('[data-card-sync]'),controls=Array.from(form.querySelectorAll('button,input'));
    let busy=false,aborter;
    const setBusy=value=>{busy=value;for(const control of controls)control.disabled=value;if(sync)sync.disabled=value;};
    root.addEventListener('pagehide',()=>aborter?.abort());
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;
      const action=event.submitter?.value;if(!['lock','unlock','revoke'].includes(action))return;
      const reason=form.elements.reason.value.trim(),refunded=form.elements.refunded?.checked===true;
      if(action==='revoke'&&!reason){message.textContent='Vui lòng nhập lý do thu hồi.';form.elements.reason.focus();return;}
      if(action==='revoke'&&!root.confirm('Thu hồi thẻ là vĩnh viễn. Nếu chọn hoàn tiền, hãy bảo đảm đã hoàn tiền mặt cho chủ thẻ. Tiếp tục?'))return;
      setBusy(true);aborter=new AbortController();message.textContent='Đang cập nhật trạng thái thẻ…';
      try{
        const result=await statusFlow({cardId:form.dataset.cardId,action,reason,...(action==='revoke'?{refunded}:{})},{base:form.dataset.cardBase,signal:aborter.signal,onStepUp:()=>{message.textContent='Hãy cắm thẻ nhân viên của tài khoản hiện tại, sau đó nhập PIN trong hộp thoại để xác thực lại.';}});
        if(aborter.signal.aborted)return;
        document.querySelector('[data-card-current-status]').className='badge '+({active:'badge-green',locked:'badge-orange',revoked:'badge-red'})[result.status];document.querySelector('[data-card-current-status]').textContent=({active:'Đang hoạt động',locked:'Đã khóa',revoked:'Đã thu hồi'})[result.status]||result.status;
        message.textContent=result.message+' Nếu vừa xác thực lại, hãy cắm thẻ đang xem trước khi bấm Đồng bộ ngay.';
        for(const button of form.querySelectorAll('button[name="action"]'))button.hidden=result.status==='revoked'||button.value==='lock'&&result.status!=='active'||button.value==='unlock'&&result.status!=='locked';
      }catch(error){if(!aborter.signal.aborted)message.textContent=error.code==='PIN_CANCELLED'?'Đã hủy xác thực; trạng thái chưa được gửi lại.':errorMessage(error,'Không thể cập nhật trạng thái thẻ.');}
      finally{setBusy(false);}
    });
    if(sync)sync.addEventListener('click',async()=>{
      if(busy)return;setBusy(true);message.textContent='Đang đồng bộ; giữ nguyên thẻ đang xem trong đầu đọc…';
      try{
        const info=await root.cardClient.openSession({expectedCardId:form.dataset.cardId});
        message.textContent=info.state===S.STATE.TERMINATED?'Thẻ đã bị thu hồi. Đã đồng bộ trạng thái 7F.':info.state===S.STATE.LOCKED?'Đã đồng bộ trạng thái khóa (03).':info.state===S.STATE.ACTIVE?'Đã đồng bộ trạng thái hoạt động (02).':'Thẻ chưa được phát hành hoàn tất; chưa thể đồng bộ trạng thái.';
      }catch(error){message.textContent=errorMessage(error,'Không thể đồng bộ thẻ. Hãy kiểm tra Card Agent.');}finally{setBusy(false);}
    });
  }
  // Check-in: quét thẻ khách (PIN do khách nhập), đọc ảnh/hồ sơ/vé, tra cứu vé theo tour trên server.
  async function checkinScan(intent,options={}){
    const client=options.client||root.cardClient;
    if(!/^[a-fA-F0-9]{24}$/.test(intent.tourId||''))throw new Error('Hãy chọn tour cần check-in.');
    // Spec A9: đồng bộ trước để vé pending được ghi lên thẻ; bước admin không được ký thì dừng êm.
    const info=await client.openSession({});
    if(info.state!==S.STATE.ACTIVE||info.cardType!==1)throw new Error('Hãy cắm thẻ khách hàng đang hoạt động.');
    let pin;
    try{pin=await client.askPin('Khách nhập PIN thẻ để check-in');await client.verifyPin(pin);}finally{pin='';}
    const photoUrl=await client.readPhotoUrl(),profile=await client.readProfile(),tickets=await client.readTickets();
    const lookup=await operationPost('/checkin/lookup',{cardId:info.cardId,tourId:intent.tourId},options);
    // Vé hiển thị chỉ dùng được khi cả server (written) lẫn thẻ (VALID) cùng xác nhận.
    const items=lookup.items.map(item=>({...item,onCard:tickets.find(t=>t.orderCode===item.orderCode&&String(t.tourId).toLowerCase()===intent.tourId.toLowerCase())?.status===1}));
    return {cardId:info.cardId,photoUrl,profile,tickets,customer:lookup.customer,items,...(info.requiresAuth?{syncNotice:'Thẻ còn thao tác cần đồng bộ ở quầy hoặc tài khoản khách.'}:{})};
  }
  async function checkinUse(intent,options={}){
    const client=options.client||root.cardClient,base=options.base||'/admin/card';
    const prepared=await operationPost('/checkin/use',{cardId:intent.cardId,orderId:intent.orderId,itemIndex:intent.itemIndex},options);
    options.onPrepared?.(prepared.opId);
    const confirmed=await client.runSignedOp({opId:prepared.opId,signUrl:base+'/op/sign',confirmUrl:base+'/op/confirm'});
    if(!confirmed.ok)throw new Error(errorMessage({message:confirmed.message},'Thẻ không xác nhận check-in; hãy kiểm tra lại vé.'));
    return confirmed;
  }
  function bindCheckin(){
    const document=root.document,section=document.querySelector('[data-card-checkin]');
    if(!section)return;
    const message=section.querySelector('[data-checkin-message]'),scan=section.querySelector('[data-checkin-scan]'),result=section.querySelector('[data-checkin-result]'),confirmButton=section.querySelector('[data-checkin-confirm]'),photo=section.querySelector('[data-checkin-photo]');
    let busy=false,current=null;
    const options=()=>({base:section.dataset.cardBase});
    scan.addEventListener('click',async()=>{
      if(busy)return;busy=true;scan.disabled=true;confirmButton.hidden=true;message.textContent='Đang đọc thẻ, giữ nguyên thẻ trong đầu đọc…';
      try{
        current=await checkinScan({tourId:section.dataset.tourId},options());
        photo.src=current.photoUrl;
        section.querySelector('[data-checkin-name]').textContent=current.customer.fullName||current.profile.fullName||'';
        section.querySelector('[data-checkin-blood]').textContent=current.customer.bloodType||current.profile.bloodType||'';
        section.querySelector('[data-checkin-allergies]').textContent=current.customer.allergies||current.profile.allergies||'';
        const list=section.querySelector('[data-checkin-items]');list.textContent='';
        for(const item of current.items){const li=document.createElement('li');li.className=item.ticketStatus==='used'?'ca-used':item.onCard&&item.ticketStatus==='written'?'ca-valid':'ca-invalid';li.textContent=item.orderCode+' · '+item.pax+' khách · '+item.ticketStatus+(item.onCard?' · vé hợp lệ trên thẻ':' · chưa có vé hợp lệ trên thẻ');list.append(li);}
        const notice=current.syncNotice?current.syncNotice+' ':'';
        const ready=current.items.find(item=>item.ticketStatus==='written'&&item.onCard);
        current.ready=ready||null;confirmButton.hidden=!ready;result.hidden=false;
        message.textContent=notice+(ready?'Kiểm tra ảnh và thông tin rồi xác nhận check-in.':current.items.some(item=>item.ticketStatus==='used')?'Vé đã sử dụng.':'Không có vé sẵn sàng; nếu vé chờ ghi, hãy để khách đăng nhập bằng thẻ để đồng bộ trước.');
      }catch(error){message.textContent=errorMessage(error,'Không thể đọc thẻ.');}
      finally{busy=false;scan.disabled=false;}
    });
    confirmButton.addEventListener('click',async()=>{
      if(busy||!current?.ready)return;busy=true;confirmButton.disabled=true;message.textContent='Đang check-in, giữ nguyên thẻ…';
      try{
        await checkinUse({cardId:current.cardId,orderId:current.ready.orderId,itemIndex:current.ready.itemIndex},options());
        message.textContent='Đã check-in thành công.';confirmButton.hidden=true;
        root.setTimeout(()=>root.location.reload(),1200);
      }catch(error){message.textContent=errorMessage(error,'Không thể check-in.');}
      finally{busy=false;confirmButton.disabled=false;}
    });
  }
  function bind(){
    bindCheckin();
    bindStatus();
    bindOperations();
    bindProfileReplacement();
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
        if(form.dataset.replaceOf)body.replaceOf=form.dataset.replaceOf;
        if(body.ownerType==='staff')body.accountId=form.elements.accountId.value;
        else if(form.elements.customerId.value)body.customerId=form.elements.customerId.value;
        else{body.customer={};for(const key of ['fullName','email','phone','dob','gender','idNumber','emergencyName','emergencyPhone','bloodType','allergies'])if(form.elements[key].value)body.customer[key]=form.elements[key].value;}
        const result=await issueFlow(body,{base:form.dataset.cardBase,signal:aborter.signal});
        status.textContent=result.emailStatus==='failed'?'Thẻ đã hoạt động. Gửi email chưa thành công; PIN chỉ hiển thị một lần bên dưới.':'Thẻ đã hoạt động. PIN ban đầu chỉ hiển thị một lần; hãy đổi PIN khi đăng nhập.';
        if(result.reloginRequired){
          status.textContent+=' Thẻ nhân viên của chính bạn đã được kích hoạt: sau khi đóng hộp PIN, bạn sẽ được đăng xuất để đăng nhập lại bằng mật khẩu và thẻ.';
          pinDialog.addEventListener('close',()=>{const base=String(form.dataset.cardBase||'/admin/card').replace(/\/card$/,'');root.fetch(base+'/account/logout',{method:'POST',credentials:'same-origin',cache:'no-store'}).catch(()=>{}).finally(()=>{root.location.href=base+'/account/login?notice=card-required';});},{once:true});
        }
        if(!aborter.signal.aborted){pin.textContent=result.initialPin;pinDialog.showModal();}result.initialPin='';
      }catch(error){if(error.pendingRequestId)pendingRequestId=error.pendingRequestId;recoverCustomer(error.recoveryCustomerId);status.textContent=errorMessage(error,'Không thể phát hành thẻ.');}
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
  return {errorMessage,ERROR_MESSAGES,checkinScan,checkinUse,preparePhoto,issueFlow,resetSim,statusFlow,resetPinFlow,cashTopupFlow,profileFlow,replaceFlow,bind};
}));
