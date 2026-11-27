const { asyncRoute } = require('../../middlewares/http-route.middleware');
const router = require('express').Router();
const categoryController = require("../../controllers/client/category.controller");

router.get('/:slug', asyncRoute(categoryController.list));

module.exports = router;