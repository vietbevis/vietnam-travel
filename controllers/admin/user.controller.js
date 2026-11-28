const Customer = require('../../models/customer.model');
const Card = require('../../models/card.model');
const Order = require('../../models/order.model');
const Tx = require('../../models/card-transaction.model');
const { requirePermission } = require('../../middlewares/admin/permission.middleware');
const { paginate } = require('../../helpers/admin-pagination.helper');
const { listFilters, nameSearch, escapeRegex, objectId, vietnamDate } = require('../../helpers/admin-list.helper');
const { tiers, tierOf } = require('../../helpers/tier.helper');
const { unresolvedFilter } = require('../../helpers/card-op.helper');
const { acceptedReceipt, lateDebitSummary } = require('../../helpers/ledger-report.helper');
const { cardTxType, cardTxStatus, cardTxSource, ticketStatusLabel } = require('../../helpers/card-presentation.helper');
const { orderStatus, paymentStatus, paymentMethod } = require('../../config/variable');

const activeCustomers = { deleted: { $ne: true }, status: 'active' };
const newest = { createdAt: -1, _id: -1 };
const cardStates = [
  { value: 'none', label: 'Chưa có thẻ hiện hành' }, { value: 'issuing', label: 'Đang phát hành' },
  { value: 'active', label: 'Hoạt động' }, { value: 'locked', label: 'Đã khóa' },
  { value: 'revoked', label: 'Từng thu hồi và chưa có thẻ hiện hành' }
];
const tabConfig = {
  profile: { label: 'Hồ sơ', allowed: () => true },
  orders: { label: 'Đơn hàng', allowed: permissions => permissions.includes('order-view') },
  wallet: { label: 'Giao dịch ví', allowed: permissions => permissions.includes('card-view') },
  tickets: { label: 'Vé', allowed: permissions => permissions.includes('order-view') &&
    (permissions.includes('card-view') || permissions.includes('card-checkin')) },
  cards: { label: 'Lịch sử thẻ', allowed: permissions => permissions.includes('card-view') }
};
const money = value => Number.isSafeInteger(value) && value >= 0;
const label = (choices, value) => choices.find(choice => choice.value === value)?.label || 'Chưa xác định';
const historyOrderFields = 'orderCode total paymentMethod paymentStatus status createdAt deleted adminVisibleAfterRestore';
const baseProjection = { fullName: 1, email: 1, phone: 1, avatar: 1 };

function customerSearch(value) {
  const literal = new RegExp(escapeRegex(value), 'i');
  return [{ fullName: nameSearch(value) }, { email: literal }, { phone: literal }];
}

function ownerCards(ownerId) {
  return { ownerId, cardType: 'customer' };
}

async function aggregatePage(Model, pipeline, query, tail, sort = newest) {
  const [{ total = 0 } = {}] = await Model.aggregate([...pipeline, { $count: 'total' }]);
  const pagination = paginate(query, total);
  const rows = !total ? [] : await Model.aggregate([
    ...pipeline, { $sort: sort }, { $skip: pagination.skip }, { $limit: pagination.limit }, ...tail
  ]);
  return { rows, pagination };
}

async function findPage(Model, where, query, select) {
  const pagination = paginate(query, await Model.countDocuments(where));
  const rows = pagination.totalRecord ? await Model.find(where).select(select).sort(newest)
    .skip(pagination.skip).limit(pagination.limit).lean() : [];
  return { pagination, rows };
}

function tierFilter(code) {
  const index = tiers.findIndex(tier => tier.code === code);
  const range = { $gte: tiers[index].min, $lte: Number.MAX_SAFE_INTEGER };
  if (index > 0) range.$lt = tiers[index - 1].min;
  return { totalSpent: range, $expr: {
    $cond: [
      { $in: [{ $type: '$totalSpent' }, ['int', 'long', 'double']] },
      { $eq: ['$totalSpent', { $trunc: '$totalSpent' }] },
      false
    ]
  } };
}

module.exports.list = async (req, res) => {
  const canReadProfile = req.permissions.includes('customer-view');
  const availableStates = req.permissions.includes('card-view') ? cardStates : cardStates.filter(state => state.value !== 'revoked');
  const { filter, filters, error } = listFilters(req.query, {
    where: activeCustomers, search: customerSearch, searchMax: 120,
    enums: { cardStatus: availableStates.map(state => state.value),
      tier: canReadProfile ? tiers.map(tier => tier.code) : [] }
  });
  const projection = canReadProfile ? { ...baseProjection, createdAt: 1, totalSpent: 1 } : baseProjection;
  let pagination = paginate(req.query, 0);
  let customers = [];
  if (!error) {
    delete filter.cardStatus;
    delete filter.tier;
    if (filters.tier) Object.assign(filter, tierFilter(filters.tier));
    if (filters.cardStatus) {
      // Count customers after filtering their current card. Never unwind old cards.
      const withoutCurrent = ['none', 'revoked'].includes(filters.cardStatus);
      const pipeline = [
        { $match: filter },
        { $set: { ownerKey: { $toString: '$_id' } } },
        { $lookup: {
          from: Card.collection.name, localField: 'ownerKey', foreignField: 'ownerId',
          pipeline: [{ $match: { isCurrent: true, cardType: 'customer' } }, { $project: { _id: 0, status: 1 } }],
          as: 'current'
        } },
        { $match: withoutCurrent ? { 'current.0': { $exists: false } } : { 'current.0.status': filters.cardStatus } }
      ];
      if (filters.cardStatus === 'revoked') {
        pipeline.push(
          { $lookup: {
            from: Card.collection.name, localField: 'ownerKey', foreignField: 'ownerId',
            pipeline: [
              { $match: { isCurrent: false, cardType: 'customer', status: 'revoked' } },
              { $limit: 1 }, { $project: { _id: 1 } }
            ], as: 'revoked'
          } },
          { $match: { 'revoked.0': { $exists: true } } }
        );
      }
      const page = await aggregatePage(Customer, pipeline, req.query, [
        { $project: { ...projection, card: { $arrayElemAt: ['$current', 0] } } }
      ]);
      ({ rows: customers, pagination } = page);
    } else {
      ({ rows: customers, pagination } = await findPage(Customer, filter, req.query, projection));
      if (customers.length) {
        const cards = await Card.find(ownerCards({ $in: customers.map(customer => String(customer._id)) }))
          .where({ isCurrent: true }).select('ownerId status').lean();
        const byOwner = new Map(cards.map(card => [card.ownerId, card]));
        for (const customer of customers) customer.card = byOwner.get(String(customer._id));
      }
    }
  }
  for (const customer of customers) {
    customer.tier = money(customer.totalSpent) ? tierOf(customer.totalSpent) : undefined;
    customer.joined = vietnamDate(customer.createdAt, 'DD/MM/YYYY');
  }
  res.status(error ? 400 : 200).render('admin/pages/user-list', {
    pageTitle: 'Quản lý khách hàng', customers, filters, pagination, listError: error,
    canReadProfile, cardStates: availableStates, tiers
  });
};

function notFound(req, res) {
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(404).json({ code: 'error', message: 'Không tìm thấy khách hàng.' });
  }
  return res.status(404).render('admin/pages/error-404', { pageTitle: '404 Not Found' });
}

function ownedLedger(owner) {
  return [
    { $match: ownerCards(owner) },
    { $lookup: { from: Tx.collection.name, localField: 'cardId', foreignField: 'cardId', as: 'entry' } },
    { $unwind: '$entry' },
    { $replaceWith: '$entry' }
  ];
}

async function walletSnapshot(owner, currentCardId) {
  const unresolved = unresolvedFilter({});
  const [lastChip, pendingRows, lateDebit] = await Promise.all([
    currentCardId ? Tx.findOne({
      cardId: currentCardId, status: 'done', completedAt: { $type: 'date' }, balanceAfter: { $gte: 0 },
      $expr: acceptedReceipt()
    }).select('balanceAfter completedAt').sort({ completedAt: -1, _id: -1 }).lean() : null,
    Card.aggregate([
      ...ownedLedger(owner),
      { $match: { $or: [
        unresolved, { type: 'debit', status: 'reconciliation' },
        { type: 'credit', status: { $in: ['pending-card', 'reconciliation'] } }
      ] } },
      { $group: {
        _id: { type: '$type', held: { $or: [
          { $eq: [{ $type: '$capHeldAt' }, 'date'] }, { $eq: ['$reconciliationReason', 'wallet-cap'] }
        ] } },
        amount: { $sum: '$amount' }
      } }
    ]),
    lateDebitSummary(owner)
  ]);
  const pending = { credit: 0, debit: 0, cap: 0 };
  for (const row of pendingRows) {
    if (row._id.type === 'credit') pending[row._id.held ? 'cap' : 'credit'] += row.amount;
    if (row._id.type === 'debit') pending.debit += row.amount;
  }
  return { lastChip, pending, lateDebit };
}

async function customerHistory(tab, owner, query, canReadTrash) {
  const orderScope = { customerId: owner, ...(canReadTrash ? {} : {
    $or: [{ deleted: { $ne: true } }, { deleted: true, adminVisibleAfterRestore: true }]
  }) };
  if (tab === 'orders') return findPage(Order, orderScope, query, historyOrderFields);
  if (tab === 'cards') return findPage(Card, ownerCards(owner), query, 'cardId status isCurrent createdAt issuedAt activatedAt revokedAt');
  if (tab === 'wallet') {
    return aggregatePage(Card, [
      ...ownedLedger(owner),
      { $project: { txRef: 1, type: 1, source: 1, amount: 1, status: 1, createdAt: 1, completedAt: 1,
        cardId: 1, txCounter: 1, balanceAfter: 1, receiptHex: 1, failReason: 1, capHeldAt: 1, reconciliationReason: 1, signedOpId: 1 } }
    ], query, [
      { $set: {
        signed: { $eq: [{ $type: '$signedOpId' }, 'string'] },
        receiptMatched: acceptedReceipt(),
        serverDebit: { $and: [{ $eq: ['$type', 'debit'] }, { $in: ['$source', ['transfer', 'refund']] }] }
      } },
      { $unset: ['signedOpId', 'cardId', 'txCounter', 'balanceAfter', 'receiptHex'] }
    ]);
  }
  return aggregatePage(Order, [
    { $match: orderScope },
    { $unwind: { path: '$items', includeArrayIndex: 'itemIndex' } },
    { $match: { 'items.ticketStatus': { $in: ['pending', 'written', 'used', 'pending-delete', 'deleted'] } } },
    { $project: { orderCode: 1, itemIndex: 1, createdAt: 1, deleted: 1, adminVisibleAfterRestore: 1,
      tourName: '$items.name', ticketStatus: '$items.ticketStatus', checkedInAt: '$items.checkedInAt', departureDate: '$items.departureDate' } }
  ], query, [], { createdAt: -1, _id: -1, itemIndex: 1 });
}

module.exports.detail = async (req, res) => {
  const { id } = req.params;
  const tab = req.query.tab === undefined ? 'profile' : req.query.tab;
  if (!objectId(id) || typeof tab !== 'string' || !Object.hasOwn(tabConfig, tab)) return notFound(req, res);
  if (!tabConfig[tab].allowed(req.permissions)) return requirePermission([])(req, res);
  const customer = await Customer.findOne({ _id: id, ...activeCustomers })
    .select('fullName email phone avatar createdAt status totalSpent').lean();
  if (!customer) return notFound(req, res);
  const owner = String(customer._id);
  const canReadCard = req.permissions.includes('card-view');
  const current = tab === 'profile'
    ? await Card.findOne({ ...ownerCards(owner), isCurrent: true }).select(canReadCard ? 'cardId status balance' : 'status').lean()
    : null;
  const snapshot = tab === 'profile' && canReadCard ? await walletSnapshot(owner, current?.cardId) : null;
  const history = tab === 'profile' ? null : await customerHistory(tab, owner, req.query, req.permissions.includes('order-trash'));
  const tabs = Object.entries(tabConfig).filter(([, data]) => data.allowed(req.permissions))
    .map(([value, data]) => ({ value, label: data.label }));
  res.render('admin/pages/user-detail', {
    pageTitle: 'Chi tiết khách hàng', customer, owner, tab, tabs, current, snapshot, history, canReadCard,
    tier: money(customer.totalSpent) ? tierOf(customer.totalSpent) : null,
    label, vietnamDate, cardTxType, cardTxStatus, cardTxSource, ticketStatusLabel, orderStatus, paymentStatus, paymentMethod
  });
};
