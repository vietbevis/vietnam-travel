const valid = value => Number.isSafeInteger(value) && value>=0;
function checkOnlineTopup({balance,pendingSum,amount}={}) {
  if (![balance,pendingSum,amount].every(valid)) return 'Số tiền phải là số nguyên an toàn không âm.';
  if (amount<10_000) return 'Số tiền nạp tối thiểu là 10.000 VNĐ.';
  if (balance>50_000_000 || pendingSum>50_000_000 || amount>50_000_000-balance-pendingSum) return 'Số dư và tiền chờ nạp vượt hạn mức 50.000.000 VNĐ.';
  return null;
}
function checkCashTopup({amount,staffTodaySum}={}) {
  if (![amount,staffTodaySum].every(valid)) return 'Số tiền phải là số nguyên an toàn không âm.';
  if (amount<10_000) return 'Số tiền nạp tối thiểu là 10.000 VNĐ.';
  if (staffTodaySum>20_000_000 || amount>20_000_000-staffTodaySum) return 'Vượt hạn mức tiền mặt 20.000.000 VNĐ mỗi nhân viên mỗi ngày.';
  return null;
}
module.exports={checkOnlineTopup,checkCashTopup};
