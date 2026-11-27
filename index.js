const express = require('express')
const path = require('path');
const { randomBytes } = require('node:crypto');
require('dotenv').config();
const database = require("./config/database");
const adminRoutes = require("./routes/admin/index.route");
const clientRoutes = require("./routes/client/index.route");
const variableConfig = require("./config/variable");
const cookieParser = require('cookie-parser');
const flash = require('express-flash');
const session = require('express-session');
const { errorHandler } = require('./middlewares/http-route.middleware');

const app = express()
const port = Number(process.env.PORT) || 3002

// Kết nối Database
database.connect();

// Thiết lập views
app.set('views', path.join(__dirname, "views"));
app.set('view engine', 'pug');

// Thiết lập thư mục chứa file tĩnh của Frontend
app.use(express.static(path.join(__dirname, "public")));

// Tạo biến toàn cục trong file PUG
app.locals.pathAdmin = variableConfig.pathAdmin;
app.locals.cardAgentUrl = process.env.CARD_AGENT_URL;
const tinyCloudKey = process.env.TINYMCE_API_KEY || '';
app.locals.tinyMceSrc = /^[A-Za-z0-9_-]{12,128}$/.test(tinyCloudKey) && tinyCloudKey !== 'your_tiny_cloud_api_key'
  ? 'https://cdn.tiny.cloud/1/' + tinyCloudKey + '/tinymce/8/tinymce.min.js'
  : '';

// Tạo biến toàn cục trong các file backend
global.pathAdmin = variableConfig.pathAdmin;

// Cho phép gửi data lên dạng json
app.use(express.json());

// Sử dụng cookie-parser
app.use(cookieParser());

// Nhúng Flash
const sessionSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production' ? undefined : randomBytes(32).toString('hex'));
if (!sessionSecret) throw new Error('Cần cấu hình SESSION_SECRET hoặc JWT_SECRET.');
app.use(session({
  secret: sessionSecret, resave: false, saveUninitialized: false,
  cookie: { maxAge: 60000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));
app.use(flash());

// Thiết lập đường dẫn
app.use(`/${variableConfig.pathAdmin}`, adminRoutes);
app.use("/", clientRoutes);
app.use('/card-api', require('./controllers/client/card-api.controller').errorHandler);
app.use('/account', require('./controllers/client/card-api.controller').errorHandler);
app.use('/'+variableConfig.pathAdmin+'/account', require('./controllers/client/card-api.controller').errorHandler);
app.use(`/${variableConfig.pathAdmin}/card`, require('./controllers/client/card-api.controller').errorHandler);
app.use(errorHandler);

app.listen(port, () => {
  require('./helpers/wallet-hold.helper').startWalletHoldRelease();
  console.log(`Website đang chạy trên cổng ${port}`)
})
