const { asyncRoute } = require('../../middlewares/http-route.middleware');
const router = require('express').Router();

const searchController = require("../../controllers/client/search.controller");

router.get('/', asyncRoute(searchController.list))

module.exports = router;