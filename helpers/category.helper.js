const Category = require("../models/category.model");

const isCategoryId = id => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
const liveCategory = { deleted: { $ne: true } };
module.exports.isCategoryId = isCategoryId;
module.exports.liveCategory = liveCategory;

// Giữ kiểm tra liên kết và thao tác ghi cùng thứ tự trong tiến trình Node.
let pendingWrite = Promise.resolve();
module.exports.withCategoryWrite = work => {
  const result = pendingWrite.then(work);
  pendingWrite = result.catch(() => {});
  return result;
};

module.exports.isAvailableCategory = async id => {
  return isCategoryId(id) && !!(await Category.exists({ _id: id, ...liveCategory }));
};

module.exports.validateParent = async (parent, categoryId) => {
  const visited = new Set(categoryId ? [categoryId] : []);
  while (parent) {
    if (!isCategoryId(parent)) return "Danh mục cha không hợp lệ!";
    parent = parent.toLowerCase();
    if (visited.has(parent)) {
      return "Danh mục cha không được là chính danh mục này hoặc tạo quan hệ vòng tròn!";
    }
    visited.add(parent);
    const ancestor = await Category.findOne({ _id: parent, ...liveCategory }).select("parent").lean();
    if (!ancestor) return "Danh mục cha hoặc danh mục cấp trên đã bị xóa hoặc không tồn tại!";
    parent = ancestor.parent;
  }
};

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
