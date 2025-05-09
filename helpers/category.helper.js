const Category = require("../models/category.model");

// Lấy cây danh mục
const buildCategoryTree = (categories, parentId = "") => {
  const tree = [];

  categories.forEach(item => {
    if(item.parent == parentId) {
      const children = buildCategoryTree(categories, item.id);

      tree.push({
        id: item.id,
        name: item.name,
        slug: item.slug,
        children: children
      })
    }
  })

  return tree;
}

module.exports.buildCategoryTree = buildCategoryTree;
// Hết Lấy cây danh mục

// Lấy tất cả id của danh mục cha + con
module.exports.getAllSubcategoryIds = async (parentId) => {
  // Mảng lưu tất cả ID của danh mục (gồm danh mục cha và các danh mục con)
  const result = [parentId];

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