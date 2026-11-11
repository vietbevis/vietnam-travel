const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  txRef:{type:String,required:true,match:/^[a-fA-F0-9]{16}$/,uppercase:true},
  cardId:{type:String,required:true,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  type:{type:String,required:true,enum:['credit','debit']},
  source:{type:String,required:true,enum:['cash','zalopay','vnpay','order','transfer','refund']},
  amount:{type:Number,required:true,min:1,max:50_000_000,validate:Number.isSafeInteger},
  orderId:String,
  status:{type:String,required:true,enum:['awaiting-payment','pending-card','sent','done','failed'],default:'pending-card'},
  // Lý do giao dịch bị đóng: nạp online hết hạn/cổng báo thất bại; giao dịch chưa ký bị huỷ (voided),
  // chuyển sang thẻ mới khi cấp lại (moved), đã hoàn tiền mặt khi thu hồi (refunded) hoặc debit đã ký nhưng
  // thẻ chứng minh chưa từng nhận (not-on-card: GET_RECEIPT 6A88 sau khi đổi challenge).
  failReason:{type:String,enum:['expired','gateway','voided','moved','refunded','not-on-card']},
  balanceAfter:{type:Number,min:0,max:50_000_000,validate:{validator:value=>value==null || Number.isSafeInteger(value)}},
  txCounter:{type:Number,min:0,max:0xffffffff,validate:{validator:value=>value==null || Number.isSafeInteger(value)}},
  receiptHex:{type:String,match:/^[a-fA-F0-9]{332}$/,uppercase:true},
  createdBy:String,
  // Mã ý định thu tiền mặt không hết hạn: gửi lại không được tạo khoản nạp mới.
  cashRequestId:{type:String,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  // Dấu đã cấp quyền ký sống lâu hơn TTL operation, ngăn ký ví lần hai.
  signedOpId:{type:String,match:/^[a-fA-F0-9]{24}$/},
  signedAt:Date,
  // Challenge của thẻ mà lệnh ví đã ký gắn vào; dùng để từ chối "đổi challenge" giả khi thẻ báo 6A88.
  signedChallenge:{type:String,match:/^[a-fA-F0-9]{32}$/,uppercase:true},
  // Các op đã ký nhưng thẻ chứng minh chưa từng chạy (6A88 sau khi đổi challenge): giữ lại để kiểm toán.
  abandonedOpIds:{type:[{type:String,match:/^[a-fA-F0-9]{24}$/}],default:undefined},
  // txRef của credit chưa ký mà giao dịch này thay thế (chuyển sang thẻ mới) hoặc hoàn tiền khi thu hồi.
  movedFrom:{type:String,match:/^[a-fA-F0-9]{16}$/,uppercase:true},
  // Đồng bộ phát hiện credit sẽ làm số dư chip vượt 50 000 000: giữ lại chờ đối soát thủ công (đã ghi nhật ký).
  capHeldAt:Date
},{timestamps:true});
schema.index({txRef:1},{unique:true});
schema.index({cashRequestId:1},{unique:true,partialFilterExpression:{cashRequestId:{$type:'string'}}});
module.exports=mongoose.model('CardTransaction',schema,'card-transactions');
