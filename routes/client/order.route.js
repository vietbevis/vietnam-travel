const { asyncRoute } = require('../../middlewares/http-route.middleware');
const router = require('express').Router();

const orderController = require("../../controllers/client/order.controller");

router.get('/checkout-session', asyncRoute(orderController.checkoutSession))
router.post('/checkout-status', asyncRoute(orderController.checkoutStatus))
router.post('/create', asyncRoute(orderController.createPost))

router.get('/success', asyncRoute(orderController.success))
router.get('/processing', asyncRoute(orderController.processing))

router.get('/payment-card', asyncRoute(orderController.paymentCard))

router.get('/payment-zalopay', asyncRoute(orderController.paymentZaloPay))

router.post('/payment-zalopay-result', asyncRoute(orderController.paymentZaloPayResultPost))

router.get('/payment-vnpay', asyncRoute(orderController.paymentVNPay))

router.get('/payment-vnpay-result', asyncRoute(orderController.paymentVNPayResult))

module.exports = router;
