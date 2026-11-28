const Category = require("../models/category.model");
const inTransaction = require("./mongo-transaction.helper");

const isCategoryId = id => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const liveCategory = { deleted: { $ne: true } };
module.exports.isCategoryId = isCategoryId;
module.exports.liveCategory = liveCategory;

const categoryLock = () => Category.db.collection("category_write_locks");
const lockKey = { _id: "category-tree" };

// Khởi tạo trước transaction để hai tiến trình khởi động đồng thời dùng cùng một tài liệu.
module.exports.ensureCategoryLock = async () => {
  try {
    await categoryLock().updateOne(lockKey, { $setOnInsert: { revision: 0 } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
};

module.exports.lockCategories = async session => {
  const result = await categoryLock().updateOne(lockKey, { $inc: { revision: 1 } }, { session });
  if (result.matchedCount !== 1) throw new Error("Không thể khóa thao tác danh mục.");
};

module.exports.withCategoryWrite = async work => {
  await module.exports.ensureCategoryLock();
  return inTransaction(async session => {
    await module.exports.lockCategories(session);
    return work(session);
  });
};

module.exports.validateParent = async (parent, categoryId, session = null, restoring = new Map()) => {
  const visited = new Set(categoryId ? [categoryId] : []);
  while (parent) {
    if (!isCategoryId(parent)) return "Danh mục cha không hợp lệ!";
    parent = parent.toLowerCase();
    if (visited.has(parent)) {
      return "Danh mục cha không được là chính danh mục này hoặc tạo quan hệ vòng tròn!";
    }
    visited.add(parent);
    const ancestor = restoring.get(parent) ||
      await Category.findOne({ _id: parent, ...liveCategory }).select("parent").session(session).lean();
    if (!ancestor) return "Danh mục cha hoặc danh mục cấp trên đã bị xóa hoặc không tồn tại!";
    parent = ancestor.parent;
  }
};

module.exports.isAvailableCategory = async (id, session = null) =>
  isCategoryId(id) && !(await module.exports.validateParent(id, null, session));

module.exports.buildCategoryTree = (categories, parentId = "") => {
  const byParent = new Map();
  for (const { id, name, slug, parent } of categories) {
    const key = typeof parent === "string" ? parent.toLowerCase() : "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push({ id, name, slug, children: [] });
  }

  const tree = [];
  const visited = new Set(parentId ? [parentId] : []);
  const pending = [{ id: parentId, children: tree }];
  while (pending.length) {
    const node = pending.pop();
    for (const child of byParent.get(node.id) || []) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      node.children.push(child);
      pending.push(child);
    }
  }
  return tree;
};

module.exports.publicCategoryTree = async (session = null) => {
  const categories = await Category.find({ deleted: false, status: "active" })
    .select("name slug parent").session(session);
  return module.exports.buildCategoryTree(categories);
};

module.exports.treeIds = tree => {
  const ids = [];
  const nodes = [...tree];
  for (let index = 0; index < nodes.length; index++) {
    ids.push(nodes[index].id);
    nodes.push(...nodes[index].children);
  }
  return ids;
};

module.exports.findCategoryNode = (tree, predicate) => {
  const nodes = [...tree];
  for (let index = 0; index < nodes.length; index++) {
    if (predicate(nodes[index])) return nodes[index];
    nodes.push(...nodes[index].children);
  }
};

module.exports.categoryReferences = ids => ids.map(id => new RegExp("^" + id + "$", "i"));

module.exports.publicTourCategoryFilter = tree => ({
  // Các tour cũ chưa phân nhóm vẫn bán được theo chính sách hiện tại.
  category: { $in: [null, "", ...module.exports.categoryReferences(module.exports.treeIds(tree))] }
});

module.exports.isPublicCategory = async (id, session) => {
  if (id == null || id === "") return true;
  const seen = new Set();
  for (let parent = id; parent;) {
    if (!isCategoryId(parent) || seen.has(parent.toLowerCase())) return false;
    seen.add(parent.toLowerCase());
    // Ghi cùng transaction tồn kho để thay đổi tổ tiên phải tranh trên chính tài liệu đó.
    const active = await Category.findOneAndUpdate({ _id: parent, deleted: false, status: "active" },
      { $inc: { __v: 1 } }, { session, timestamps: false }).select("parent").lean();
    if (!active) return false;
    parent = active.parent;
  }
  return true;
};

// Lấy tất cả id của danh mục cha + con
module.exports.getAllSubcategoryIds = async (parentId) => {
  const result = [parentId];
  const visited = new Set(result);

  // Hàm đệ quy để tìm các danh mục con
  const findChildren = async (currentId) => {
    // Tìm các danh mục con có parent = currentId, không bị xóa và đang hoạt động
    const children = await Category
      .find({
        parent: currentId,
        deleted: false,
        status: "active"
      });

    // Duyệt qua từng danh mục con tìm được
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      result.push(child.id); // Thêm ID vào danh sách kết quả
      await findChildren(child.id); // Gọi đệ quy để tìm danh mục con của danh mục này
    }
  };

  // Bắt đầu đệ quy từ danh mục gốc
  await findChildren(parentId);

  // Trả về toàn bộ danh sách ID đã thu thập được
  return result;
};
// Hết Lấy tất cả id của danh mục cha + con
