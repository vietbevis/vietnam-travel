const express = require('express')
const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.DATABASE);

const clientRoutes = require("./routes/client/index.route");

const app = express()
const port = 3000

// Thiết lập views
app.set('views', path.join(__dirname, "views"));
app.set('view engine', 'pug');

// Thiết lập thư mục chứa file tĩnh của Frontend
app.use(express.static(path.join(__dirname, "public")));

// Thiết lập đường dẫn
app.use("/", clientRoutes);

app.listen(port, () => {
  console.log(`Website đang chạy trên cổng ${port}`)
})