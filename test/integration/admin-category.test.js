const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const cookies = require("cookie-parser");
const session = require("express-session");
const flash = require("express-flash");
const jwt = require("jsonwebtoken");
const { Types } = require("mongoose");
const cloudinary = require("cloudinary").v2;
const db = require("../helpers/db");
const Category = require("../../models/category.model");
const Tour = require("../../models/tour.model");
const { getAllSubcategoryIds } = require("../../helpers/category.helper");
const Account = require("../../models/account-admin.model");
const Role = require("../../models/role.model");
const auth = require("../../middlewares/admin/auth.middleware");
const categoryRoutes = require("../../routes/admin/category.route");

const it = (name, run) => test(name, { skip: !db.enabled }, run);
const missingId = new Types.ObjectId().toString();
const adminPermissions = ["category-view", "category-create", "category-edit", "category-delete"];
let server, base, account, role, cookie;

before(async () => {
  if (!db.enabled) return;
  process.env.JWT_SECRET = "isolated-category-test-secret";
  global.pathAdmin = "admin";
  await db.connect();
  await Promise.all([Category, Tour, Account, Role].map(model => model.init()));

  const app = express();
  app.set("views", path.resolve(__dirname, "../../views"));
  app.set("view engine", "pug");
  app.locals.pathAdmin = "admin";
  app.use(express.json(), cookies(), session({
    secret: "isolated-session",
    resave: false,
    saveUninitialized: false
  }), flash());
  app.use("/admin/category", auth.verifyToken, categoryRoutes);
  app.use("/admin/tour", auth.verifyToken, require("../../routes/admin/tour.route"));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port + "/admin";
});

beforeEach(async () => {
  if (!db.enabled) return;
  await db.reset();
  role = await Role.create({ name: "Test", permissions: adminPermissions });
  account = await Account.create({ email: "category@example.test", fullName: "Admin Fixture", role: role.id, status: "active" });
  cookie = "token=" + jwt.sign({ id: account.id, email: account.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db.enabled) await db.close();
});

function category(name, extra = {}) {
  return Category.create({ name, parent: "", position: 1, status: "active", createdBy: account.id, ...extra });
}

async function request(route, method = "GET", body) {
  const headers = { cookie };
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(base + route, {
    method, headers, body, redirect: "manual", signal: AbortSignal.timeout(10000)
  });
  const data = response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text();
  return { status: response.status, data };
}

const listing = query => request("/category/list" + (query ? "?" + new URLSearchParams(query) : ""));
const form = (name, extra = {}) => ({ name, parent: "", status: "active", position: "", ...extra });
const create = body => request("/category/create", "POST", body);
const edit = (id, body) => request("/category/edit/" + id, "PATCH", body);
const remove = id => request("/category/delete/" + id, "PATCH");
const multi = (option, ids) => request("/category/change-multi", "PATCH", { option, ids });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/1h8AAAAASUVORK5CYII=", "base64");

it("renders zero results for an empty database, missing keyword and combined filters", async () => {
  const empty = await listing();
  assert.equal(empty.status, 200);
  assert.match(empty.data, /Không tìm thấy danh mục phù hợp/);
  assert.match(empty.data, /Hiển thị 0 - 0 của 0/);
  assert.doesNotMatch(empty.data, /<option[^>]*>Trang /);

  await category("Tour Phú Quốc", { createdAt: new Date(2026, 10, 20, 12) });
  for (const query of [
    { keyword: "sass", page: "999" },
    { status: "inactive" },
    { createdBy: missingId },
    { startDate: "2026-11-21" },
    { endDate: "2026-11-19" },
    { keyword: "Phú Quốc", status: "inactive", createdBy: account.id, endDate: "2026-11-20" }
  ]) {
    const response = await listing(query);
    assert.equal(response.status, 200);
    assert.match(response.data, /Hiển thị 0 - 0 của 0/);
  }
  const match = await listing({
    keyword: "Phú Quốc", status: "active", createdBy: account.id,
    startDate: "2026-11-20", endDate: "2026-11-20"
  });
  assert.match(match.data, /Hiển thị 1 - 1 của 1/);
  assert.match(match.data, /Tour Phú Quốc/);
});

it("keeps the effective page and handles malformed and out-of-range page numbers", async () => {
  for (let n = 1; n <= 12; n++) await category("Mục thử " + n, { position: n });
  assert.match((await listing({ page: "2" })).data, /Hiển thị 6 - 10 của 12/);
  for (const page of ["3", "99", "99999999999999999999999"]) {
    const response = await listing({ page });
    assert.match(response.data, /Hiển thị 11 - 12 của 12/);
    assert.match(response.data, /<option value="3" selected(?:="selected")?>Trang 3/);
  }
  for (const page of ["0", "-1", "2.5", "2xyz"]) {
    assert.match((await listing({ page })).data, /Hiển thị 1 - 5 của 12/);
  }
});

it("rejects malformed filters and treats search metacharacters as literal input", async () => {
  await category("Du lịch thử");
  for (const query of ["status[$ne]=inactive", "createdBy=bad", "startDate=2026-02-30", "startDate=2026-11-21&endDate=2026-11-20"]) {
    assert.equal((await request("/category/list?" + query)).status, 400, query);
  }
  assert.match((await listing({ keyword: ".*[" })).data, /Hiển thị 0 - 0 của 0/);
  assert.equal((await listing()).status, 200);
});

it("finds Vietnamese names with or without accents and punctuation in category names", async () => {
  await category("Chợ đêm");
  await category("Tour 100% thú vị");
  for (const [keyword, name] of [["chợ đêm", "Chợ đêm"], ["cho dem", "Chợ đêm"], ["Tour 100%", "Tour 100% thú vị"]]) {
    const response = await listing({ keyword });
    assert.match(response.data, /Hiển thị 1 - 1 của 1/);
    assert.ok(response.data.includes(name));
  }
});

it("validates positions on create and edit before saving any changes", async () => {
  const existing = await category("Cần giữ", { position: 7 });
  for (const position of ["-5", "0", "1.5", "abc", "12abc", "1e2", "9007199254740992", ["4"], null]) {
    const created = await create(form("Không được lưu", { position }));
    assert.equal(created.data.code, "error", String(position));
    assert.match(created.data.message, /số nguyên dương/);
    assert.equal((await edit(existing.id, form("Không được lưu", { position }))).data.code, "error");
  }
  assert.equal(await Category.countDocuments(), 1);
  assert.equal((await Category.findById(existing.id)).position, 7);
  assert.equal((await create(form("Mặc định"))).data.code, "success");
  assert.equal((await Category.findOne({ name: "Mặc định" })).position, 2);
  assert.equal((await edit(existing.id, form("Đã đổi", { position: "9", status: "inactive" }))).data.code, "success");
  const updated = await Category.findById(existing.id);
  assert.equal(updated.position, 9);
  assert.equal(updated.status, "inactive");
  assert.equal(updated.slug, "da-doi");
  assert.equal(updated.updatedBy, account.id);
  assert.equal((await edit(existing.id, form("Tự đặt vị trí"))).data.code, "success");
  assert.equal((await Category.findById(existing.id)).position, 3);
});

it("rejects self references, descendant parents and missing or deleted ancestors", async () => {
  const root = await category("Cha");
  assert.equal((await create(form("Con", { parent: root.id }))).data.code, "success");
  const child = await Category.findOne({ name: "Con" });
  const leaf = await category("Cháu", { parent: child.id });
  const deleted = await category("Đã xóa", { deleted: true });
  const orphan = await category("Con mồ côi", { parent: missingId });
  for (const parent of [root.id, child.id, leaf.id, deleted.id, orphan.id, missingId, "bad"]) {
    assert.equal((await edit(root.id, form("Cha", { parent }))).data.code, "error", parent);
  }
  for (const parent of [missingId, deleted.id, orphan.id]) {
    assert.equal((await create(form("Bị từ chối", { parent }))).data.code, "error");
  }
  const editPage = await request("/category/edit/" + root.id);
  assert.equal(editPage.status, 200);
  for (const blocked of [root, child, leaf, deleted]) assert.ok(!editPage.data.includes('option value="' + blocked.id + '"'));
  assert.equal((await Category.findById(root.id)).parent, "");
  assert.equal((await edit(leaf.id, form("Cháu", { parent: root.id }))).data.code, "success");
  assert.equal((await Category.findById(leaf.id)).parent, root.id);
  assert.equal((await edit(orphan.id, form("Con mồ côi"))).data.code, "success");
  for (const id of ["bad", missingId, deleted.id]) {
    assert.equal((await request("/category/edit/" + id)).status, 404);
    assert.equal((await edit(id, form("Bị từ chối"))).data.code, "error");
  }
});

it("reuses deletion rules for single and bulk requests and preserves soft-deletion audit", async () => {
  const root = await category("Cha");
  const child = await category("Con tạm dừng", { parent: root.id, status: "inactive" });
  const free = await category("Danh mục trống");
  const blockedByTour = await category("Danh mục có tour");
  const tour = await Tour.create({ name: "Tour tạm dừng", category: blockedByTour.id, status: "inactive" });
  assert.match((await remove(root.id)).data.message, /danh mục con/);
  assert.match((await multi("delete", [root.id, child.id, free.id])).data.message, /danh mục con/);
  assert.match((await remove(blockedByTour.id)).data.message, /tour/);
  assert.match((await multi("delete", [free.id, blockedByTour.id])).data.message, /tour/);
  assert.equal(await Category.countDocuments({ deleted: true }), 0);

  await Tour.updateOne({ _id: tour.id }, { status: "active", deleted: true });
  assert.equal((await remove(child.id)).data.code, "success");
  assert.equal((await multi("delete", [root.id, free.id, blockedByTour.id])).data.code, "success");
  const deleted = await Category.findById(root.id);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.deletedBy, account.id);
  assert.ok(deleted.deletedAt instanceof Date);
  assert.equal((await remove(root.id)).data.code, "error");
  assert.equal((await multi("active", [root.id])).data.code, "error");
  assert.equal((await Category.findById(root.id)).deletedAt.getTime(), deleted.deletedAt.getTime());
  assert.match((await listing()).data, /Hiển thị 0 - 0 của 0/);
});

it("rejects invalid bulk requests before mutating any selected category", async () => {
  const first = await category("Một");
  const second = await category("Hai");
  for (const [option, ids] of [["bad", [first.id]], ["inactive", []], ["inactive", first.id], ["inactive", [first.id, "bad"]], ["inactive", [first.id, missingId]]]) {
    assert.equal((await multi(option, ids)).data.code, "error");
  }
  assert.equal((await Category.findById(first.id)).status, "active");
  assert.equal((await multi("inactive", [first.id, first.id, second.id])).data.code, "success");
  assert.equal(await Category.countDocuments({ status: "inactive", updatedBy: account.id }), 2);
  assert.equal((await multi("active", [first.id, second.id])).data.code, "success");
  assert.equal(await Category.countDocuments({ status: "active" }), 2);
});

it("keeps missing admin records and legacy category links from preventing render", async () => {
  const item = await category("Dữ liệu cũ", { parent: "bad", createdBy: missingId, updatedBy: "bad" });
  assert.match((await listing()).data, /Dữ liệu cũ/);
  assert.equal((await request("/category/edit/" + item.id)).status, 200);

  const root = await category("Cha cũ");
  const child = await category("Con cũ", { parent: root.id.toUpperCase() });
  const childEdit = await request("/category/edit/" + child.id);
  assert.match(childEdit.data, new RegExp('<option value="' + root.id + '" selected'));

  const first = await category("Vòng cũ A");
  const second = await category("Vòng cũ B", { parent: first.id });
  await Category.updateOne({ _id: first.id }, { parent: second.id });
  assert.deepEqual(await getAllSubcategoryIds(first.id), [first.id, second.id]);
  assert.equal((await create(form("Nối vào vòng cũ", { parent: first.id }))).data.code, "error");
  assert.equal((await edit(first.id, form("Vòng đã sửa"))).data.code, "success");
});

it("uses existing category permissions for direct and bulk actions", async () => {
  const item = await category("Có quyền xem");
  await Role.updateOne({ _id: role.id }, { permissions: ["category-view"] });
  assert.equal((await listing()).status, 200);
  const denied = await Promise.all([
    create(form("Không có quyền")), edit(item.id, form("Không có quyền")), remove(item.id), multi("inactive", [item.id]), multi("delete", [item.id])
  ]);
  for (const response of denied) assert.equal(response.status, 403);
  assert.equal(await Category.countDocuments({ deleted: false }), 1);
  await Role.updateOne({ _id: role.id }, { permissions: [] });
  assert.equal((await listing()).status, 403);
});

it("serializes a child creation against parent deletion and concurrent reparenting", async () => {
  const first = await category("Cha");
  const second = await category("Khác");
  const results = await Promise.all([create(form("Con", { parent: first.id })), remove(first.id)]);
  assert.equal(results.filter(result => result.data.code === "success").length, 1);

  const third = await category("Thứ ba");
  const reparent = await Promise.all([
    edit(second.id, form("Khác", { parent: third.id })),
    edit(third.id, form("Thứ ba", { parent: second.id }))
  ]);
  assert.equal(reparent.filter(result => result.data.code === "success").length, 1);
});

it("cannot introduce a tour link after the category is deleted, including a restore", async () => {
  await Role.updateOne({ _id: role.id }, { $push: { permissions: { $each: ["tour-create", "tour-edit", "tour-trash"] } } });
  const item = await category("Danh mục dành cho tour");
  const [deletion, addition] = await Promise.all([
    remove(item.id),
    request("/tour/create", "POST", { name: "Tour song song", category: item.id, status: "active" })
  ]);
  assert.equal([deletion, addition].filter(result => result.data.code === "success").length, 1);
  const tour = await Tour.create({ name: "Tour chưa khôi phục", category: missingId, status: "active", deleted: true });
  assert.equal((await request("/tour/undo/" + tour.id, "PATCH")).data.code, "error");
  assert.equal((await request("/tour/trash/change-multi", "PATCH", { option: "undo", ids: [tour.id] })).data.code, "error");
  assert.equal((await Tour.findById(tour.id)).deleted, true);
  assert.equal((await request("/tour/edit/" + tour.id, "PATCH", { name: "Tour chưa khôi phục", category: missingId })).data.code, "error");

  const target = await category("Danh mục hợp lệ");
  assert.equal((await request("/tour/create", "POST", { name: "Tour hợp lệ", category: target.id.toUpperCase() })).data.code, "success");
  assert.equal((await Tour.findOne({ name: "Tour hợp lệ" })).category, target.id);
  assert.match((await remove(target.id)).data.message, /tour/);
  assert.equal((await request("/tour/create", "POST", { name: "Tour lịch lỗi", schedules: "invalid" })).data.code, "error");
});

it("returns an error for a rejected database operation and serves the next request", async t => {
  const item = await category("Mục đang hoạt động");
  const query = t.mock.method(Category, "countDocuments", async () => { throw new Error("Fixture database failure"); });
  assert.equal((await listing()).status, 500);
  assert.equal((await remove(item.id)).status, 500);
  query.mock.restore();
  assert.equal((await listing()).status, 200);
  assert.equal((await remove(item.id)).data.code, "success");
});

it("rejects invalid avatars, preserves the current URL and handles provider failures", async t => {
  const item = await category("Ảnh cũ", { avatar: "https://images.example.test/same.png" });
  const assetUrl = "https://images.example.test/new/same.png";
  let uploaded, providerError;
  const { Writable } = require("node:stream");
  t.mock.method(cloudinary.uploader, "upload_stream", (options, callback) => new Writable({
    write(chunk, encoding, next) {
      uploaded = Buffer.from(chunk);
      next();
    },
    final(next) {
      callback(providerError, providerError ? null : { secure_url: assetUrl, format: "png" });
      next();
    }
  }));
  const multipart = (bytes, type) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(form("Ảnh mới"))) body.set(key, value);
    body.set("avatar", new File([bytes], "same.png", { type }));
    return body;
  };

  assert.equal((await edit(item.id, form("Ảnh cũ sửa tên"))).data.code, "success");
  assert.equal((await Category.findById(item.id)).avatar, "https://images.example.test/same.png");
  assert.equal((await edit(item.id, multipart(Buffer.from("text"), "text/plain"))).data.code, "error");
  assert.equal((await edit(item.id, multipart(Buffer.from("text"), "image/png"))).data.code, "error");
  assert.equal((await create(multipart(Buffer.alloc(6 * 1024 * 1024), "image/png"))).status, 413);
  assert.equal(uploaded, undefined);

  providerError = new Error("Fixture provider failure");
  assert.equal((await edit(item.id, multipart(png, "image/png"))).status, 502);
  assert.equal((await Category.findById(item.id)).avatar, "https://images.example.test/same.png");
  providerError = undefined;
  assert.equal((await edit(item.id, multipart(png, "image/png"))).data.code, "success");
  assert.deepEqual(uploaded, png);
  assert.equal((await Category.findById(item.id)).avatar, assetUrl);
  assert.equal((await listing()).status, 200);
});
