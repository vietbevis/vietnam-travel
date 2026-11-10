function money(value) {
  if (!Number.isSafeInteger(value) || value<0) throw new RangeError('Số tiền phải là số nguyên an toàn không âm.');
}
function tierOf(totalSpent) {
  money(totalSpent);
  if (totalSpent>=80_000_000) return {code:'platinum',label:'Platinum',percent:8};
  if (totalSpent>=30_000_000) return {code:'gold',label:'Gold',percent:5};
  if (totalSpent>=10_000_000) return {code:'silver',label:'Silver',percent:3};
  return {code:'standard',label:'Standard',percent:0};
}
function discountFor(totalSpent,subTotal) {
  money(subTotal);
  return Math.round(subTotal*tierOf(totalSpent).percent/100);
}
module.exports={tierOf,discountFor};
