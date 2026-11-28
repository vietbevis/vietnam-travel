function money(value) {
  if (!Number.isSafeInteger(value) || value<0) throw new RangeError('Số tiền phải là số nguyên an toàn không âm.');
}
const tiers = Object.freeze([
  Object.freeze({ min: 80_000_000, code: 'platinum', label: 'Platinum', percent: 8 }),
  Object.freeze({ min: 30_000_000, code: 'gold', label: 'Gold', percent: 5 }),
  Object.freeze({ min: 10_000_000, code: 'silver', label: 'Silver', percent: 3 }),
  Object.freeze({ min: 0, code: 'standard', label: 'Standard', percent: 0 })
]);
function tierOf(totalSpent) {
  money(totalSpent);
  const { code, label, percent } = tiers.find(tier => totalSpent >= tier.min);
  return { code, label, percent };
}
function discountFor(totalSpent,subTotal) {
  money(subTotal);
  return Math.round(subTotal*tierOf(totalSpent).percent/100);
}
module.exports={tierOf,discountFor,tiers};
