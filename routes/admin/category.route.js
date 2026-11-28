const router = require("express").Router();
const multer = require("multer");
const controller = require("../../controllers/admin/category.controller");
const { save } = require("../../validates/admin/category.validate");
const { isCategoryId } = require("../../helpers/category.helper");
const { asyncRoute } = require("../../middlewares/http-route.middleware");
const { requirePermission } = require("../../middlewares/admin/permission.middleware");
const { imageMatchesType } = require("../../middlewares/admin/image-upload.middleware");

const avatarMessage = "Ảnh đại diện phải là tệp JPEG, PNG, GIF hoặc WebP hợp lệ!";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
}).single("avatar");

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
      if (!imageMatchesType(req.file)) {
        return res.status(400).json({ code: "error", message: avatarMessage });
      }
    }
    next();
  });
}

router.get("/list", requirePermission("category-view"), asyncRoute(controller.list));
router.get("/trash", requirePermission("category-trash"), asyncRoute(controller.trash));
router.get("/create", requirePermission("category-create"), asyncRoute(controller.create));
router.post("/create", requirePermission("category-create"), parseAvatar, save, asyncRoute(controller.createPost));
router.get("/edit/:id", requirePermission("category-edit"), asyncRoute(controller.edit));
router.patch("/edit/:id", requirePermission("category-edit"), validateId, parseAvatar, save, asyncRoute(controller.editPatch));
router.patch("/delete/:id", requirePermission("category-delete"), validateId, asyncRoute(controller.deletePatch));
router.patch("/change-multi", asyncRoute(controller.changeMultiPatch));
router.patch("/undo/:id", requirePermission("category-trash"), requirePermission("category-edit"),
  validateId, asyncRoute(controller.undoPatch));
router.patch("/delete-destroy/:id", requirePermission("category-trash"), requirePermission("category-delete"),
  validateId, asyncRoute(controller.deleteDestroyPatch));
router.patch("/trash/change-multi", requirePermission("category-trash"),
  asyncRoute(controller.trashChangeMultiPatch));

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Không thể xử lý yêu cầu danh mục.", req.method);
  const message = "Không thể xử lý yêu cầu danh mục. Vui lòng thử lại!";
  if (req.method === "GET") return res.status(500).send(message);
  return res.status(500).json({ code: "error", message });
});

module.exports = router;
