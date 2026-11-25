const router = require("express").Router();
const multer = require("multer");
const controller = require("../../controllers/admin/category.controller");
const { save } = require("../../validates/admin/category.validate");
const { isCategoryId } = require("../../helpers/category.helper");

const avatarFormats = {
  "image/jpeg": bytes => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  "image/png": bytes => bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  "image/gif": bytes => ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)),
  "image/webp": bytes => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
};
const avatarMessage = "Ảnh đại diện phải là tệp JPEG, PNG, GIF hoặc WebP hợp lệ!";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
}).single("avatar");

const asyncRoute = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);

function requirePermission(permission) {
  return (req, res, next) => {
    if (req.permissions.includes(permission)) return next();
    const message = "Không có quyền sử dụng tính năng này!";
    if (req.method === "GET") return res.status(403).send(message);
    return res.status(403).json({ code: "error", message });
  };
}

function validateId(req, res, next) {
  if (isCategoryId(req.params.id)) return next();
  return res.status(400).json({ code: "error", message: "Mã danh mục không hợp lệ!" });
}

function parseAvatar(req, res, next) {
  upload(req, res, error => {
    if (error) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({
        code: "error",
        message: tooLarge ? "Ảnh đại diện không được vượt quá 5 MB!" : "Dữ liệu tải ảnh đại diện không hợp lệ!"
      });
    }
    if (req.file) {
      const { mimetype, buffer } = req.file;
      if (!Object.hasOwn(avatarFormats, mimetype) || !avatarFormats[mimetype](buffer)) {
        return res.status(400).json({ code: "error", message: avatarMessage });
      }
    }
    next();
  });
}

router.get("/list", requirePermission("category-view"), asyncRoute(controller.list));
router.get("/create", requirePermission("category-create"), asyncRoute(controller.create));
router.post("/create", requirePermission("category-create"), parseAvatar, save, asyncRoute(controller.createPost));
router.get("/edit/:id", requirePermission("category-edit"), asyncRoute(controller.edit));
router.patch("/edit/:id", requirePermission("category-edit"), validateId, parseAvatar, save, asyncRoute(controller.editPatch));
router.patch("/delete/:id", requirePermission("category-delete"), validateId, asyncRoute(controller.deletePatch));
router.patch("/change-multi", asyncRoute(controller.changeMultiPatch));

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Lỗi quản lý danh mục", error);
  const message = "Không thể xử lý yêu cầu danh mục. Vui lòng thử lại!";
  if (req.method === "GET") return res.status(500).send(message);
  return res.status(500).json({ code: "error", message });
});

module.exports = router;
