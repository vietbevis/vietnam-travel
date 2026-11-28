const Order = require('../models/order.model');
const Tx = require('../models/card-transaction.model');
const Card = require('../models/card.model');
const { monthBoundsVN } = require('./card-stats.helper');
const { acceptedReceipt, matchingHex, mongoDate, lateDebitSummary } = require('./ledger-report.helper');

const methods = ['money', 'bank', 'vnpay', 'zalopay', 'card'];
const topupSources = ['cash', 'vnpay', 'zalopay'];
const dayMs = 86400000;
const between = (field, { start, end }) => ({ $and: [mongoDate(field), { $gte: [field, start] }, { $lt: [field, end] }] });
const vnd = field => ({
  $cond: [
    { $in: [{ $type: field }, ['int', 'long', 'double']] },
    { $and: [{ $gt: [field, 0] }, { $lte: [field, Number.MAX_SAFE_INTEGER] }, { $eq: [field, { $trunc: field }] }] },
    false
  ]
});
const dayInRange = (field, range) => ({
  $cond: [between(field, range), { $dateToString: { date: field, format: '%Y-%m-%d', timezone: '+07:00' } }, null]
});
const countWhen = condition => ({ $sum: { $cond: [condition, 1, 0] } });
const sumWhen = (condition, field) => ({ $sum: { $cond: [condition, field, 0] } });

function monthPeriod(year, month) {
  const bounds = monthBoundsVN(new Date(Date.UTC(year, month - 1, 1)));
  const days = Array.from({ length: (bounds.end - bounds.start) / dayMs }, (_, i) => ({
    day: i + 1, gross: 0, refunded: 0, net: 0
  }));
  return { year, month, bounds, days, orderCount: 0, gross: 0, refunded: 0,
    refundChip: 0, refundCash: 0, refundObligations: 0, net: 0,
    methods: Object.fromEntries(methods.map(method => [method, 0])) };
}

function salesByDay(range) {
  return Order.aggregate([
    { $match: { paymentStatus: 'paid' } },
    { $project: { paymentMethod: 1, paidAt: 1, paidAmount: 1, total: 1, cardTxRef: 1, customerId: 1 } },
    { $lookup: {
      from: Tx.collection.name, localField: 'cardTxRef', foreignField: 'txRef',
      let: { orderId: { $toString: '$_id' }, owner: '$customerId' },
      pipeline: [
        { $match: { type: 'debit', source: 'order', status: 'done',
          $expr: { $and: [{ $eq: ['$orderId', '$$orderId'] }, acceptedReceipt('$'), vnd('$amount')] } } },
        { $lookup: {
          from: Card.collection.name, localField: 'cardId', foreignField: 'cardId',
          pipeline: [
            { $match: { cardType: 'customer', $expr: { $eq: ['$ownerId', '$$owner'] } } },
            { $project: { _id: 1 } }
          ], as: 'cardOwner'
        } },
        { $match: { 'cardOwner.0': { $exists: true } } },
        { $project: { _id: 0, amount: 1, completedAt: 1 } }
      ],
      as: 'debit'
    } },
    { $set: { debit: { $arrayElemAt: ['$debit', 0] } } },
    { $set: {
      amount: { $cond: [
        { $eq: ['$paymentMethod', 'card'] },
        { $cond: [{ $or: [{ $eq: ['$paidAmount', '$debit.amount'] },
          { $and: [{ $not: [vnd('$paidAmount')] }, { $eq: ['$total', '$debit.amount'] }] }] }, '$debit.amount', null] },
        { $cond: [vnd('$paidAmount'), '$paidAmount', null] }
      ] },
      settled: { $cond: [
        { $eq: ['$paymentMethod', 'card'] },
        { $cond: [
          { $and: [mongoDate('$debit.completedAt'), { $or: [{ $not: [mongoDate('$paidAt')] }, { $eq: ['$paidAt', '$debit.completedAt'] }] }] },
          '$debit.completedAt', null
        ] },
        '$paidAt'
      ] }
    } },
    { $group: {
      _id: { day: dayInRange('$settled', range),
        method: { $cond: [{ $in: ['$paymentMethod', methods] }, '$paymentMethod', null] } },
      gross: sumWhen(vnd('$amount'), '$amount'),
      missingTime: countWhen({ $not: [mongoDate('$settled')] }),
      undatedAmount: sumWhen({ $and: [{ $not: [mongoDate('$settled')] }, vnd('$amount')] }, '$amount'),
      snapshotAmount: sumWhen({ $and: [{ $not: [mongoDate('$settled')] }, { $not: [vnd('$amount')] }, vnd('$total')] }, '$total'),
      missingAmount: countWhen({ $and: [{ $not: [vnd('$amount')] }, { $not: [vnd('$total')] }] }),
      unverifiedAmount: countWhen({ $and: [{ $not: [vnd('$amount')] }, vnd('$total')] }),
      unsupportedMethod: countWhen({ $not: [{ $in: ['$paymentMethod', methods] }] })
    } }
  ]);
}

// Mỗi bút toán gốc là một lần thu/ghi nghĩa vụ. Cấp lại thẻ có thể chuyển một
// credit chưa ký nhiều lần qua movedFrom, nhưng chỉ đầu cuối quyết định kết quả.
function walletEvents(range, showWallet) {
  return Tx.aggregate([
    { $match: { type: 'credit', source: { $in: showWallet ? [...topupSources, 'refund'] : ['refund'] },
      movedFrom: { $exists: false } } },
    { $lookup: {
      from: Card.collection.name, localField: 'cardId', foreignField: 'cardId',
      pipeline: [{ $match: { cardType: 'customer' } }, { $project: { _id: 0, ownerId: 1 } }],
      as: 'rootOwner'
    } },
    { $lookup: {
      from: Order.collection.name,
      let: { id: { $convert: { input: '$orderId', to: 'objectId', onError: null, onNull: null } }, ref: '$txRef', amount: '$amount' },
      pipeline: [
        { $match: { paymentStatus: 'paid', paymentMethod: 'card', status: 'cancel',
          $expr: { $and: [{ $eq: ['$_id', '$$id'] }, { $eq: ['$refundTxRef', '$$ref'] },
            { $eq: [{ $ifNull: ['$paidAmount', '$total'] }, '$$amount'] }] } } },
        { $project: { _id: 0, customerId: 1 } }
      ],
      as: 'refundOrder'
    } },
    { $set: { gatewayReceipt: { $and: [{ $in: ['$source', ['vnpay', 'zalopay']] }, mongoDate('$paymentReceivedAt')] } } },
    { $set: { validRoot: { $and: [vnd('$amount'), { $or: ['$gatewayReceipt', { $and: [
      { $eq: [{ $size: '$rootOwner' }, 1] }, { $or: [{ $ne: ['$source', 'refund'] }, { $and: [
        { $eq: [{ $size: '$refundOrder' }, 1] },
        { $eq: [{ $arrayElemAt: ['$rootOwner.ownerId', 0] }, { $arrayElemAt: ['$refundOrder.customerId', 0] }] }
      ] }] }
    ] }] }] } } },
    { $graphLookup: {
      from: Tx.collection.name,
      startWith: { $cond: [{ $and: ['$validRoot', { $eq: ['$failReason', 'moved'] }] }, '$txRef', []] },
      connectFromField: 'txRef', connectToField: 'movedFrom',
      restrictSearchWithMatch: { type: 'credit' }, as: 'moves'
    } },
    { $set: {
      leaves: { $cond: [
        { $eq: ['$failReason', 'moved'] },
        { $filter: { input: '$moves', as: 'next', cond: { $ne: ['$$next.failReason', 'moved'] } } },
        ['$$ROOT']
      ] },
      sameCredit: { $allElementsTrue: [{ $map: { input: '$moves', as: 'next', in: { $and: [
        { $eq: ['$$next.amount', '$amount'] }, { $eq: ['$$next.source', '$source'] }
      ] } } }] }
    } },
    { $set: {
      leaf: { $arrayElemAt: ['$leaves', 0] },
      validChain: { $and: ['$validRoot', '$sameCredit', { $eq: [{ $size: '$leaves' }, 1] }] }
    } },
    { $lookup: {
      from: Card.collection.name, localField: 'leaf.cardId', foreignField: 'cardId',
      pipeline: [{ $match: { cardType: 'customer' } }, { $project: { _id: 0, ownerId: 1 } }],
      as: 'owner'
    } },
    { $set: { validChain: { $and: [
      '$validChain', { $eq: [{ $size: '$owner' }, 1] },
      { $eq: [{ $arrayElemAt: ['$owner.ownerId', 0] }, { $arrayElemAt: ['$rootOwner.ownerId', 0] }] }
    ] } } },
    { $lookup: {
      from: Tx.collection.name,
      let: { ref: { $cond: [{ $and: ['$validChain', { $eq: ['$leaf.failReason', 'refunded'] }] }, '$leaf.txRef', null] },
        amount: '$amount', card: '$leaf.cardId' },
      pipeline: [
        { $match: { source: 'refund', type: 'debit', status: 'done', movedFrom: { $exists: true },
          $expr: { $and: [{ $ne: ['$$ref', null] }, { $eq: ['$movedFrom', '$$ref'] },
            { $eq: ['$amount', '$$amount'] }, { $eq: ['$cardId', '$$card'] }] } } },
        { $project: { _id: 0, createdAt: 1 } },
        { $limit: 2 }
      ],
      as: 'payouts'
    } },
    { $set: {
      chipConfirmed: { $and: ['$validChain', acceptedReceipt('$leaf.')] },
      cashRefunded: { $and: ['$validChain', { $eq: [{ $size: '$payouts' }, 1] }] },
      recordedAt: { $cond: [{ $in: ['$source', ['cash', 'refund']] }, '$createdAt', '$paymentReceivedAt'] },
      pending: { $or: [
        { $and: ['$validRoot', '$gatewayReceipt', { $eq: ['$status', 'reconciliation'] }] },
        { $and: ['$validChain', { $or: [
          { $in: ['$leaf.status', ['pending-card', 'sent', 'reconciliation']] },
          { $and: [{ $eq: ['$leaf.status', 'failed'] }, matchingHex('$leaf.signedOpId', 24)] }
        ] }] }
      ] },
      capHeld: { $or: [mongoDate('$leaf.capHeldAt'), { $eq: ['$leaf.reconciliationReason', 'wallet-cap'] }] }
    } },
    { $set: {
      doneAt: { $switch: { branches: [
        { case: '$chipConfirmed', then: '$leaf.completedAt' },
        { case: '$cashRefunded', then: { $arrayElemAt: ['$payouts.createdAt', 0] } }
      ], default: null } }
    } },
    { $group: {
      _id: { source: '$source', recorded: dayInRange('$recordedAt', range), done: dayInRange('$doneAt', range) },
      recorded: sumWhen('$validRoot', '$amount'),
      chip: sumWhen('$chipConfirmed', '$amount'),
      cash: sumWhen('$cashRefunded', '$amount'),
      pending: sumWhen({ $and: ['$pending', { $not: ['$capHeld'] }] }, '$amount'),
      capHeld: sumWhen({ $and: ['$pending', '$capHeld'] }, '$amount'),
      awaitingPayment: sumWhen({ $and: ['$validChain', { $eq: ['$leaf.status', 'awaiting-payment'] }] }, '$amount'),
      failed: sumWhen({ $and: ['$validChain', { $eq: ['$leaf.status', 'failed'] }, { $not: ['$cashRefunded'] },
        { $not: ['$pending'] }, { $ne: ['$leaf.failReason', 'refunded'] }] }, '$amount'),
      missingTime: countWhen({ $and: [{ $or: ['$chipConfirmed', '$cashRefunded'] }, { $not: [mongoDate('$doneAt')] }] }),
      undatedDone: sumWhen({ $and: [{ $or: ['$chipConfirmed', '$cashRefunded'] }, { $not: [mongoDate('$doneAt')] }] }, '$amount'),
      missingRecordedTime: countWhen({ $and: ['$validRoot', { $not: [mongoDate('$recordedAt')] }, { $or: [
        { $in: ['$source', ['cash', 'refund']] },
        { $in: ['$status', ['pending-card', 'sent', 'done', 'reconciliation']] },
        { $in: ['$failReason', ['moved', 'refunded']] }
      ] }] }),
      missingAmount: countWhen({ $not: [vnd('$amount')] }),
      unverified: countWhen({ $or: [{ $not: ['$validChain'] },
        { $and: [{ $eq: ['$leaf.status', 'done'] }, { $not: ['$chipConfirmed'] }] },
        { $and: [{ $eq: ['$leaf.failReason', 'refunded'] }, { $not: ['$cashRefunded'] }] }] })
    } }
  ]);
}

function debitReconciliation() {
  return Tx.aggregate([
    { $match: { type: 'debit', source: 'order', $or: [
      { status: { $in: ['done', 'sent', 'reconciliation'] } },
      { status: { $in: ['pending-card', 'failed'] }, signedOpId: { $type: 'string' } }
    ] } },
    { $set: { proven: acceptedReceipt() } },
    { $lookup: {
      from: Card.collection.name, localField: 'cardId', foreignField: 'cardId',
      pipeline: [{ $match: { cardType: 'customer' } }, { $project: { _id: 0, ownerId: 1 } }], as: 'owner'
    } },
    { $lookup: {
      from: Order.collection.name, let: {
        id: { $cond: ['$proven', { $convert: { input: '$orderId', to: 'objectId', onError: null, onNull: null } }, null] },
        ref: '$txRef', amount: '$amount', owner: { $arrayElemAt: ['$owner.ownerId', 0] }
      },
      pipeline: [
        { $match: { paymentStatus: 'paid', paymentMethod: 'card', $expr: { $and: [
          { $eq: ['$_id', '$$id'] }, { $eq: ['$cardTxRef', '$$ref'] }, { $eq: ['$customerId', '$$owner'] },
          { $eq: [{ $ifNull: ['$paidAmount', '$total'] }, '$$amount'] }
        ] } } },
        { $project: { _id: 1 } }
      ], as: 'order'
    } },
    { $match: { 'order.0': { $exists: false } } },
    { $group: { _id: { $cond: [{ $eq: ['$status', 'done'] }, 'unlinkedDebit', 'unresolvedDebit'] },
      count: { $sum: 1 }, amount: sumWhen(vnd('$amount'), '$amount') } }
  ]);
}

async function revenue(year, month, showWallet) {
  const period = monthPeriod(year, month);
  const previous = month === 1 ? monthPeriod(year - 1, 12) : monthPeriod(year, month - 1);
  const range = { start: previous.bounds.start, end: period.bounds.end };
  const [sales, credits, orderCounts, debits, lateDebit] = await Promise.all([
    salesByDay(range),
    walletEvents(range, showWallet),
    Order.aggregate([
      { $match: { createdAt: { $gte: range.start, $lt: range.end } } },
      { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m', timezone: '+07:00' } },
        count: { $sum: 1 } } }
    ]),
    showWallet ? debitReconciliation() : [],
    showWallet ? lateDebitSummary() : null
  ]);
  const byMonth = new Map([period, previous].map(data => [monthValue(data), data]));
  const at = date => date ? byMonth.get(date.slice(0, 7)) : null;
  for (const row of orderCounts) {
    const data = at(row._id);
    if (data) data.orderCount = row.count;
  }
  const dayOf = (data, date) => data.days[Number(date.slice(8)) - 1];
  const reconciliation = {
    salesMissingTime: { count: 0, amount: 0, snapshotAmount: 0 },
    salesMissingAmount: 0, salesUnverifiedAmount: 0, unsupportedMethod: 0,
    refundsMissingTime: 0, refundsUndatedAmount: 0, refundsMissingRecordedTime: 0,
    refundUnverified: 0, refundsPending: 0, refundsCapHeld: 0
  };
  const wallet = {
    topupReceived: 0, topupChip: 0, topupPending: 0, topupCapHeld: 0, topupFailed: 0, topupAwaitingPayment: 0,
    topupMissingTime: 0, topupUndatedAmount: 0, topupMissingRecordedTime: 0,
    topupUnverified: 0, unresolvedDebit: { count: 0, amount: 0 }, unlinkedDebit: { count: 0, amount: 0 }, lateDebit
  };
  for (const { _id, count, amount } of debits) wallet[_id] = { count, amount };
  for (const row of sales) {
    const { day, method } = row._id;
    const data = at(day);
    if (data && Object.hasOwn(data.methods, method)) {
      data.methods[method] += row.gross;
      dayOf(data, day).gross += row.gross;
    }
    reconciliation.salesMissingTime.count += row.missingTime;
    reconciliation.salesMissingTime.amount += row.undatedAmount;
    reconciliation.salesMissingTime.snapshotAmount += row.snapshotAmount;
    reconciliation.salesMissingAmount += row.missingAmount;
    reconciliation.salesUnverifiedAmount += row.unverifiedAmount;
    reconciliation.unsupportedMethod += row.unsupportedMethod;
  }
  for (const row of credits) {
    const { source, recorded, done } = row._id;
    if (source === 'refund') {
      const requestPeriod = at(recorded);
      if (requestPeriod) requestPeriod.refundObligations += row.recorded;
      const appliedPeriod = at(done);
      if (appliedPeriod) {
        dayOf(appliedPeriod, done).refunded += row.chip + row.cash;
        appliedPeriod.refundChip += row.chip;
        appliedPeriod.refundCash += row.cash;
      }
      reconciliation.refundsMissingTime += row.missingTime;
      reconciliation.refundsUndatedAmount += row.undatedDone;
      reconciliation.refundsMissingRecordedTime += row.missingRecordedTime;
      reconciliation.refundUnverified += row.unverified;
      reconciliation.refundsPending += row.pending;
      reconciliation.refundsCapHeld += row.capHeld;
    } else {
      if (at(recorded) === period) wallet.topupReceived += row.recorded;
      if (at(done) === period) wallet.topupChip += row.chip;
      wallet.topupPending += row.pending;
      wallet.topupCapHeld += row.capHeld;
      wallet.topupAwaitingPayment += row.awaitingPayment;
      wallet.topupFailed += row.failed;
      wallet.topupMissingTime += row.missingTime;
      wallet.topupUndatedAmount += row.undatedDone;
      wallet.topupMissingRecordedTime += row.missingRecordedTime;
      wallet.topupUnverified += row.unverified;
    }
  }
  for (const data of [period, previous]) {
    for (const day of data.days) {
      day.net = day.gross - day.refunded;
      data.gross += day.gross;
      data.refunded += day.refunded;
    }
    data.net = data.gross - data.refunded;
    delete data.bounds;
  }
  return { period, previous, reconciliation, ...(showWallet ? { wallet } : {}) };
}

const monthValue = ({ year, month }) => year + '-' + String(month).padStart(2, '0');
function currentMonth() {
  const { start } = monthBoundsVN();
  const vn = new Date(start.getTime() + dayMs);
  return { year: vn.getUTCFullYear(), month: vn.getUTCMonth() + 1 };
}

function validMonth(year, month) {
  return Number.isInteger(year) && year >= 1900 && year <= 9999 && Number.isInteger(month) && month >= 1 && month <= 12;
}

module.exports = { revenue, monthValue, currentMonth, validMonth };
