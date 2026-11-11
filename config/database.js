const mongoose = require('mongoose');

module.exports.connect = async () => {
  try {
    await mongoose.connect(process.env.DATABASE);
    console.log("Kết nối DB thành công!");
    await module.exports.checkReplicaSet();
  } catch (error) {
    console.log("Kết nối DB thất bại!");
    console.log(error);
  }
}

// Đặt đơn cần transaction để bảo vệ tồn kho; thanh toán liên kết khách và thao tác thẻ cũng cần replica set.
// Standalone vẫn đọc dữ liệu/thanh toán đơn cũ không liên kết khách; chỉ cảnh báo rõ ràng, không dừng ứng dụng.
module.exports.checkReplicaSet = async (connection = mongoose.connection) => {
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    if (hello && hello.setName) return true;
  } catch (error) {}
  console.warn("[CẢNH BÁO] MongoDB không chạy replica set: đặt đơn mới, thanh toán đơn đã liên kết thẻ, nạp ví và mọi thao tác thẻ sẽ thất bại. Thanh toán đơn cũ không liên kết thẻ vẫn hoạt động. Hãy cấu hình replica set cho DATABASE.");
  return false;
}
