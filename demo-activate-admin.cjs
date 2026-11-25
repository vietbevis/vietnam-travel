
require("dotenv").config();

const mongoose = require("mongoose");
const Account = require("./models/account-admin.model");
const Role = require("./models/role.model");
const Setting = require("./models/setting-website-info.model");
const permissionList = require("./config/permission").permissionList;

const EMAIL = "dangninh138@gmail.com";

async function main() {
  await mongoose.connect(process.env.DATABASE);

  const hello = await mongoose.connection.db.admin().command({
    hello: 1
  });

  if (
    mongoose.connection.name !== "vietnam-travel-smartcard-demo" ||
    hello.setName !== "rsdemo" ||
    !hello.isWritablePrimary
  ) {
    throw new Error("Sai database demo hoac replica set!");
  }

  const admin = await Account.findOne({
    email: EMAIL,
    deleted: false
  });

  if (!admin) {
    throw new Error("Khong tim thay admin. Hay dang ky truoc!");
  }

  const permissions = permissionList.map(p => p.value);

  const role = await Role.findOneAndUpdate(
    { name: "Demo Smartcard Full" },
    {
      $set: { permissions },
      $setOnInsert: {
        description: "Quyen demo Smart Card",
        deleted: false
      }
    },
    { upsert: true, new: true }
  );

  await Account.updateOne(
    { _id: admin._id },
    {
      $set: {
        role: String(role._id),
        status: "active",
        cardRequired: false
      }
    }
  );

  if (!(await Setting.exists({}))) {
    await Setting.create({
      websiteName: "Vietnam Travel Demo",
      logo: "",
      favicon: "",
      phone: "",
      email: "",
      address: ""
    });
  }

  console.log("THANH CONG!");
  console.log("Admin da duoc kich hoat:", EMAIL);
  console.log("So quyen:", permissions.length);
  console.log("MongoDB:", mongoose.connection.name);
}

main()
  .catch(error => {
    console.error("LOI:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
