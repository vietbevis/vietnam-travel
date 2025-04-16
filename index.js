const express = require('express')
const path = require('path');
require('dotenv').config();
const database = require("./config/database");
const adminRoutes = require("./routes/admin/index.route");
const clientRoutes = require("./routes/client/index.route");
const variableConfig = require("./config/variable");
const cookieParser = require('cookie-parser');
const flash = require('express-flash');
const session = require('express-session');

const app = express()
const port = 3000

// Kết nối Database
database.connect();

// Thiết lập views
app.set('views', path.join(__dirname, "views"));
app.set('view engine', 'pug');

// Thiết lập thư mục chứa file tĩnh của Frontend
app.use(express.static(path.join(__dirname, "public")));

// Tạo biến toàn cục trong file PUG
app.locals.pathAdmin = variableConfig.pathAdmin;

// Tạo biến toàn cục trong các file backend
global.pathAdmin = variableConfig.pathAdmin;

// Cho phép gửi data lên dạng json
app.use(express.json());

// Sử dụng cookie-parser
app.use(cookieParser("SFGWHSDSGSDSD"));

// Nhúng Flash
app.use(session({ cookie: { maxAge: 60000 }}));
app.use(flash());

// Thiết lập đường dẫn
app.use(`/${variableConfig.pathAdmin}`, adminRoutes);
app.use("/", clientRoutes);

app.listen(port, () => {
  console.log(`Website đang chạy trên cổng ${port}`)
})