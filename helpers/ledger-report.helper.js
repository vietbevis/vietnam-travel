// Evidence is written only by the verified-receipt transaction in the card engine.
const Log = require('../models/card-log.model');
const Card = require('../models/card.model');
const Tx = require('../models/card-transaction.model');
const mongoDate = field => ({ $eq: [{ $type: field }, 'date'] });
const asText = field => ({ $convert: { input: field, to: 'string', onError: '', onNull: '' } });
const matchingHex = (field, length) => ({
  $regexMatch: { input: asText(field), regex: '^[a-fA-F0-9]{' + length + '}$' }
});

function receiptUInt32(offset) {
  return { $reduce: {
    input: { $range: [offset, offset + 8] }, initialValue: 0,
    in: { $add: [
      { $multiply: ['$$value', 16] },
      { $indexOfBytes: ['0123456789abcdef', { $substrBytes: ['$$hex', '$$this', 1] }] }
    ] }
  } };
}

// Verify the persisted receipt matches its ledger row. Signature verification is
// performed by receiptInSession before marking the row done.
function acceptedReceipt(prefix = '$') {
  const field = name => prefix + name;
  const text = name => ({ $toLower: asText(field(name)) });
  return { $cond: [
    { $and: [
      { $eq: [field('status'), 'done'] },
      { $in: [field('type'), ['credit', 'debit']] },
      matchingHex(field('signedOpId'), 24),
      matchingHex(field('receiptHex'), 332)
    ] },
    { $let: { vars: { hex: text('receiptHex') }, in: { $and: [
      { $eq: [
        { $substrBytes: ['$$hex', 0, 52] },
        { $concat: ['52', text('cardId'), { $cond: [{ $eq: [field('type'), 'credit'] }, '01', '02'] }, text('txRef')] }
      ] },
      { $eq: [receiptUInt32(52), field('amount')] },
      { $eq: [receiptUInt32(60), field('balanceAfter')] },
      { $eq: [receiptUInt32(68), field('txCounter')] }
    ] } } },
    false
  ] };
}

async function lateDebitSummary(owner) {
  // The engine logs late evidence without reopening the order. Multiple reads
  // of the same receipt must contribute only once to reconciliation.
  const [summary] = await Log.aggregate([
    { $match: { action: 'card-receipt-recovery', result: 'fail', actorType: 'system',
      'detail.releasedButApplied': true, 'detail.type': 'debit', 'detail.txRef': /^[A-F0-9]{16}$/ } },
    { $group: { _id: { card: '$cardId', ref: '$detail.txRef' } } },
    ...(owner ? [
      { $lookup: {
        from: Card.collection.name, localField: '_id.card', foreignField: 'cardId',
        pipeline: [{ $match: { ownerId: owner, cardType: 'customer' } }, { $project: { _id: 1 } }], as: 'card'
      } },
      { $match: { 'card.0': { $exists: true } } }
    ] : []),
    { $lookup: {
      from: Tx.collection.name, localField: '_id.ref', foreignField: 'txRef', let: { card: '$_id.card' },
      pipeline: [
        { $match: { type: 'debit', source: 'order', status: { $ne: 'done' }, $expr: { $eq: ['$cardId', '$$card'] } } },
        { $project: { _id: 0, amount: 1 } }
      ], as: 'tx'
    } },
    { $unwind: '$tx' },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$tx.amount' } } },
    { $project: { _id: 0 } }
  ]);
  return summary ?? { count: 0, amount: 0 };
}

module.exports = { acceptedReceipt, matchingHex, mongoDate, lateDebitSummary };
