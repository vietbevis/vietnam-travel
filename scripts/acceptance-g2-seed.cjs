'use strict';

// Chỉ gọi sau connectFixture và seed G1 trong website fixture. Không có đường chạy độc lập.
module.exports = async function seedG2({
  Role, Account, Category, Tour, Order, Tx, actor, backup, city, customer, hash, domain, common, booking, item
}) {
  const dayStart = new Date('2026-11-27T17:00:00.000Z');
  const previousDay = new Date('2026-11-27T16:59:59.999Z');
  const [readerRole, trashRole, editorRole] = await Role.create([
    { name: 'G2 Fixture - Read only', permissions: ['category-view', 'tour-view', 'order-view'] },
    { name: 'G2 Fixture - Trash read', permissions: ['category-trash', 'order-trash'] },
    { name: 'G2 Fixture - Editor', permissions: ['category-view', 'category-edit', 'category-create', 'tour-view', 'tour-edit', 'tour-create', 'order-view', 'order-edit'] }
  ]);
  await Account.create([
    { fullName: 'G2 Read Only', email: 'g2-reader' + domain, role: readerRole.id, password: hash, status: 'active' },
    { fullName: 'G2 Trash Read', email: 'g2-trash' + domain, role: trashRole.id, password: hash, status: 'active' },
    { fullName: 'G2 Editor', email: 'g2-editor' + domain, role: editorRole.id, password: hash, status: 'active' }
  ]);
  const root = await Category.create({ name: 'G2 Đà Nẵng Gốc', status: 'active', position: 100, createdBy: actor.id, createdAt: dayStart });
  const categories = await Category.create(Array.from({ length: 12 }, (_, index) => ({
    name: 'G2 Đà Nẵng ' + String(index + 1).padStart(2, '0'), parent: index < 2 ? root.id : '',
    status: index === 11 ? 'inactive' : 'active', position: 99 - index,
    createdBy: (index === 11 ? backup : actor).id, createdAt: index === 11 ? previousDay : dayStart
  })));
  const trashParent = await Category.create({
    name: 'G2 Rác Danh Mục Cha', deleted: true, status: 'active', statusBeforeDelete: 'active', deletedBy: actor.id, deletedAt: dayStart
  });
  const [trashChild] = await Category.create([
    { name: 'G2 Rác Danh Mục Con', parent: trashParent.id, deleted: true, statusBeforeDelete: 'inactive', deletedBy: actor.id, deletedAt: dayStart },
    { name: 'G2 Rác Danh Mục Cũ', deleted: true, status: 'active' }
  ]);
  const tours = await Tour.create(Array.from({ length: 12 }, (_, index) => ({
    ...common, name: 'G2 Chuyến Đà Lạt ' + String(index + 1).padStart(2, '0'),
    category: categories[0].id, status: index === 11 ? 'inactive' : 'active', position: 91 - index,
    createdBy: (index === 11 ? backup : actor).id, createdAt: index === 11 ? previousDay : dayStart,
    priceAdult: 3_000_000, priceNewAdult: 2_000_000
  })));
  const [tourTrash, referencedTour] = await Tour.create([
    { ...common, name: 'G2 Rác Tour Chưa Đặt', category: categories[0].id, deleted: true, status: 'inactive', statusBeforeDelete: 'active', deletedBy: actor.id, deletedAt: dayStart },
    { ...common, name: 'G2 Rác Tour Có Vé', category: categories[0].id, deleted: true, status: 'inactive', deletedBy: backup.id, deletedAt: previousDay }
  ]);
  const [order] = await Order.create(Array.from({ length: 12 }, (_, index) => ({
    ...booking, orderCode: 'G2-LIST-' + String(index + 1).padStart(2, '0'), fullName: 'Khách Đặng Hà G2',
    phone: '0900000044', createdAt: index === 11 ? previousDay : dayStart,
    status: index === 0 ? 'done' : (index === 10 ? 'cancel' : 'initial'),
    paymentMethod: index === 0 ? 'zalopay' : (index % 2 ? 'bank' : 'money'),
    paymentStatus: index === 0 ? 'paid' : 'unpaid', items: [item(tours[index])]
  })));
  const [pending, restored, archivedGuest] = await Order.create([
    { ...booking, orderCode: 'G2-ARCH-PENDING', fullName: 'Khách Đặng Hà G2', phone: '0900000044', deleted: true,
      deletedBy: actor.id, deletedAt: dayStart, status: 'cancel', paymentMethod: 'card', paymentStatus: 'paid',
      customerId: customer.id, refundTxRef: 'C1'.repeat(8), cardTxRef: 'A1'.repeat(8), stockRestoredAt: dayStart,
      items: [{ ...item(referencedTour), ticketStatus: 'pending-delete' }] },
    { ...booking, orderCode: 'G2-ARCH-DONE', fullName: 'Khách Đặng Hà G2', phone: '0900000044', deleted: true,
      deletedBy: backup.id, deletedAt: previousDay, status: 'cancel', paymentMethod: 'card', paymentStatus: 'paid',
      customerId: customer.id, refundTxRef: 'C2'.repeat(8), cardTxRef: 'A2'.repeat(8), stockRestoredAt: previousDay,
      items: [{ ...item(referencedTour), ticketStatus: 'deleted' }] },
    { ...booking, orderCode: 'G2-ARCH-LEGACY', status: 'cancel', deleted: true, stockRestoredAt: previousDay }
  ]);
  await Order.create({
    ...booking, orderCode: 'G2-USED', status: 'done', paymentStatus: 'paid', paymentMethod: 'money', customerId: customer.id,
    items: [{ ...item(tours[0]), ticketStatus: 'used', checkedInAt: dayStart }]
  });
  for (const [entry, status] of [[pending, 'pending-card'], [restored, 'done']]) {
    await Tx.create({ txRef: entry.refundTxRef, cardId: 'F1'.repeat(16), orderId: entry.id,
      type: 'credit', source: 'refund', amount: entry.total, status });
  }
  const paging = Array.from({ length: 12 }, (_, index) => ({
    suffix: String(index + 1).padStart(2, '0'), deleted: true,
    deletedBy: backup.id, deletedAt: previousDay
  }));
  await Category.create(paging.map(({ suffix, ...metadata }) => ({
    ...metadata, name: 'G2 Phân Trang Rác Danh Mục ' + suffix, status: 'inactive', statusBeforeDelete: 'inactive'
  })));
  await Tour.create(paging.map(({ suffix, ...metadata }) => ({
    ...common, ...metadata, name: 'G2 Phân Trang Rác Tour ' + suffix,
    category: categories[1].id, status: 'inactive', statusBeforeDelete: 'inactive'
  })));
  await Order.create(paging.map(({ suffix, ...metadata }) => ({
    ...booking, ...metadata, orderCode: 'G2-ARCH-PAGING-' + suffix, status: 'cancel', stockRestoredAt: previousDay
  })));
  const trashed = { deleted: true, deletedBy: actor.id, deletedAt: dayStart, status: 'inactive', statusBeforeDelete: 'inactive' };
  const g21 = await Category.create([
    ...Array.from({ length: 6 }, (_, index) => ({ ...trashed, name: 'G21 Xóa Trang 0' + (index + 1) })),
    ...Array.from({ length: 3 }, (_, index) => ({ ...trashed, name: 'G21 Bulk Trống 0' + (index + 1) })),
    { ...trashed, name: 'G21 Bulk Có Tour' }
  ]);
  await Tour.create({ ...common, ...trashed, name: 'G21 Tour Đã Xóa Mềm', category: g21.at(-1).id });
  return {
    actorId: actor.id, backupId: backup.id, cityId: city.id, rootId: root.id, categoryIds: categories.map(row => row.id),
    categoryTrash: [trashParent.id, trashChild.id], tourIds: tours.map(row => row.id), tourTrash: [tourTrash.id, referencedTour.id],
    orderId: order.id, orderTrash: [pending.id, restored.id, archivedGuest.id]
  };
};
