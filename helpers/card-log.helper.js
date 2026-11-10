const CardLog = require('../models/card-log.model');
const hidden = '[Đã ẩn]';
function sanitize(value,seen=new WeakSet()) {
  if (typeof value==='string') return value.replace(/-----BEGIN[\s\S]*?-----END[^\r\n]*-----/g,hidden).replace(/\b(?:pin|password|secret|token|private[-_ ]?key|escrow)\s*[:=]\s*[^\s,;]+/gi,hidden).replace(/\b\d{6}\b/g,hidden);
  if (!value || typeof value!=='object') return value;
  if (seen.has(value)) return hidden;
  seen.add(value);
  if (Array.isArray(value)) return value.map(item=>sanitize(item,seen));
  const clean={};
  for(const [key,item] of Object.entries(value)) {
    if (/pin|password|secret|token|private.?key|escrow|(^|_)(dek|kek)($|_)/i.test(key)) continue;
    Object.defineProperty(clean,key,{value:sanitize(item,seen),enumerable:true,configurable:true,writable:true});
  }
  return clean;
}
async function write(input,{session}={}) {
  try {
    const {action,cardId,actorType,actorId,result,detail,req}=input;
    const entry={action:sanitize(action),cardId,actorType,actorId:sanitize(actorId),result,detail:sanitize(detail),ip:sanitize(req?.ip)};
    if(session)await CardLog.create([entry],{session});
    else await CardLog.create(entry);
  } catch(error) {
    // Audit trong transaction phải thành công cùng nghiệp vụ hoặc cùng rollback.
    if(session)throw error;
    // Nhật ký không được làm gián đoạn nghiệp vụ; không in dữ liệu nhạy cảm khi lỗi.
  }
}
module.exports={write};
