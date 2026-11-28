// Menu Mobile
const buttonMenuMobile = document.querySelector(".header .inner-button-menu");
if (buttonMenuMobile) {
  const sider = document.querySelector(".sider");
  const siderOverlay = document.querySelector(".sider-overlay");

  const setOpen = open => {
    sider.classList.toggle("active", open);
    siderOverlay.classList.toggle("active", open);
    buttonMenuMobile.setAttribute("aria-expanded", String(open));
    if (open) sider.querySelector("a")?.focus();
    else buttonMenuMobile.focus();
  };
  buttonMenuMobile.addEventListener("click", () => setOpen(!sider.classList.contains("active")));
  siderOverlay.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sider.classList.contains("active")) setOpen(false);
  });
}
// End Menu Mobile

const scheduleSection = document.querySelector('.section-8 .inner-schedule');
if (scheduleSection) {
  const list = scheduleSection.querySelector('.inner-schedule-list');
  const template = list.firstElementChild.cloneNode(true);
  template.querySelector('[data-editor-status]')?.remove();
  template.querySelector('textarea').removeAttribute('id');
  scheduleSection.querySelector('.inner-schedule-create').addEventListener('click', () => {
    const item = template.cloneNode(true);
    item.querySelector('input').value = '';
    const textarea = item.querySelector('textarea');
    textarea.value = '';
    textarea.hidden = false;
    item.classList.remove('hidden');
    list.append(item);
    window.AdminEditor?.initialize(textarea);
    item.querySelector('input').focus();
  });
  list.addEventListener('click', event => {
    const item = event.target.closest('.inner-schedule-item');
    if (!item) return;
    if (event.target.closest('.inner-more')) item.classList.toggle('hidden');
    if (event.target.closest('.inner-remove') && list.children.length > 1) {
      window.AdminEditor?.remove(item.querySelector('textarea'));
      item.remove();
    }
  });
  if (window.Sortable) new Sortable(list, { animation: 150, handle: '.inner-move' });
}

// Biểu đồ doanh thu
const revenueChart = document.querySelector("#revenue-chart");
if (revenueChart) {
  const section = revenueChart.closest("[data-dashboard-finance]");
  const form = section.querySelector("form");
  const input = form.elements.month;
  const status = section.querySelector("[data-revenue-status]");
  const money = value => value.toLocaleString("vi-VN") + " đ";
  const financeNodes = document.querySelectorAll("[data-finance], [data-finance-count]");
  let chart;
  let requestNumber = 0;
  let inFlight;

  function setStatus(message) {
    status.hidden = !message;
    status.textContent = message;
  }

  function resetPeriod() {
    chart?.destroy();
    chart = undefined;
    revenueChart.hidden = true;
    for (const node of financeNodes) {
      node.textContent = "—";
      node.classList.remove("is-zero");
    }
  }

  function showPeriod(data) {
    const { period, previous, wallet, reconciliation } = data;
    const totals = {
      ...period.methods, ...period, ...wallet, ...reconciliation,
      salesMissingTimeCount: reconciliation.salesMissingTime.count,
      salesUndatedAmount: reconciliation.salesMissingTime.amount,
      salesSnapshotAmount: reconciliation.salesMissingTime.snapshotAmount,
      unresolvedDebitCount: wallet?.unresolvedDebit.count,
      unresolvedDebitAmount: wallet?.unresolvedDebit.amount,
      unlinkedDebitCount: wallet?.unlinkedDebit.count,
      unlinkedDebitAmount: wallet?.unlinkedDebit.amount,
      lateDebitCount: wallet?.lateDebit.count,
      lateDebitAmount: wallet?.lateDebit.amount
    };
    for (const node of financeNodes) {
      const amountKey = node.dataset.finance;
      const value = totals[amountKey || node.dataset.financeCount];
      node.textContent = Number.isFinite(value) ? (amountKey ? money(value) : value.toLocaleString("vi-VN")) : "—";
      if (node.classList.contains("finance-value")) node.classList.toggle("is-zero", value === 0);
    }
    if (!window.Chart) {
      revenueChart.hidden = true;
      setStatus("Chưa tải được biểu đồ doanh thu. Các số tổng vẫn hiển thị.");
      return;
    }
    revenueChart.hidden = false;
    const labels = Array.from({ length: Math.max(period.days.length, previous.days.length) }, (_, index) => index + 1);
    chart = new Chart(revenueChart, {
      type: "line",
      data: {
        labels,
        datasets: [period, previous].map((month, index) => ({
          label: `Tháng ${month.month}/${month.year}`,
          data: labels.map(day => month.days[day - 1]?.net ?? null),
          borderColor: ["#4379EE", "#EF3826"][index],
          borderWidth: 1.5
        }))
      },
      options: {
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: context => context.dataset.label + " · " + money(context.parsed.y) } }
        },
        scales: {
          x: { title: { display: true, text: "Ngày" } },
          y: { title: { display: true, text: "Doanh thu ròng (VND)" }, ticks: { callback: value => money(value) } }
        },
        maintainAspectRatio: false
      }
    });
    setStatus(period.gross || period.refunded ? "" : "Tháng đã chọn chưa có thu hoặc hoàn đã xác minh.");
  }

  async function refreshPeriod() {
    const sequence = ++requestNumber;
    inFlight?.abort();
    resetPeriod();
    if (!input.checkValidity() || !/^\d{4}-\d{2}$/.test(input.value)) {
      setStatus("Hãy chọn tháng và năm hợp lệ.");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("month", input.value);
    history.replaceState(history.state, "", url.href);
    setStatus("Đang tải số liệu…");
    const [currentYear, currentMonth] = input.value.split("-").map(Number);
    inFlight = new AbortController();
    try {
      const data = await travelRequest(`/${pathAdmin}/dashboard/revenue-chart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([inFlight.signal, AbortSignal.timeout(15000)]),
        body: JSON.stringify({ currentMonth, currentYear })
      });
      if (sequence === requestNumber) showPeriod(data);
    } catch (error) {
      if (sequence === requestNumber) setStatus("Chưa tải được số liệu. " + error.message);
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    refreshPeriod();
  });
  input.addEventListener("change", refreshPeriod);
  showPeriod(JSON.parse(section.dataset.dashboardFinance));
}
// Hết Biểu đồ doanh thu

// Category management
const categoryForm = document.querySelector("#category-create-form, #category-edit-form");

async function submitCategoryRequest(button, url, options, onSuccess) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const request = typeof options === 'function' ? await options() : options;
    const response = await fetch(url, request);
    if (response.redirected) {
      window.location.assign(response.url);
      return;
    }

    const data = await response.json();
    if (!response.ok || data.code !== "success") {
      await showTravelNotice(data.message || "Không thể thực hiện thao tác danh mục!", "error");
      return;
    }
    onSuccess();
  } catch (error) {
    await showTravelNotice(error instanceof TypeError
      ? "Không thể xử lý yêu cầu danh mục. Vui lòng thử lại!"
      : error.message || "Không thể xử lý yêu cầu danh mục. Vui lòng thử lại!", "error");
  } finally {
    button.disabled = false;
    button.focus();
  }
}

if (categoryForm) {
  const button = categoryForm.querySelector("button[type=submit]");
  const listUrl = categoryForm.dataset.list;


  categoryForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (button.disabled) return;
    const { name, parent, position, status, description } = categoryForm.elements;
    if (!name.value.trim()) {
      await showTravelNotice("Vui lòng nhập tên danh mục!", "error");
      name.focus();
      return;
    }
    const rawPosition = position.value.trim();
    if (rawPosition &&
        (!/^\d+$/.test(rawPosition) || !Number.isSafeInteger(Number(rawPosition)) || Number(rawPosition) < 1)) {
      await showTravelNotice("Vị trí phải là số nguyên dương!", "error");
      position.focus();
      return;
    }

    await submitCategoryRequest(button, categoryForm.dataset.api, async () => {
      const data = new FormData();
      data.append("name", name.value.trim());
      data.append("parent", parent.value);
      data.append("position", rawPosition);
      data.append("status", status.value);
      data.append("description", await (window.AdminEditor?.value(description) ?? description.value));
      appendAdminImages(categoryForm, data, ['avatar']);
      return { method: listUrl ? "POST" : "PATCH", body: data };
    }, () => {
      if (listUrl) window.location.assign(listReturnUrl(listUrl));
      else window.location.reload();
    });
  });
}

// End Category management

const tourForm = document.querySelector('#tour-create-form, #tour-edit-form');
if (tourForm) {
  const editing = tourForm.matches('#tour-edit-form');
  const fields = ['name', 'category', 'position', 'status', 'time', 'vehicle', 'departureDate'];
  const stockFields = ['stockAdult', 'stockChildren', 'stockBaby'];
  const priceGroups = [['priceAdult', 'priceNewAdult'], ['priceChildren', 'priceNewChildren'], ['priceBaby', 'priceNewBaby']];
  const originalStock = Object.fromEntries(stockFields.map(name => [name, tourForm.elements[name].value]));
  const originalFields = Object.fromEntries(fields.map(name => [name, tourForm.elements[name].value]));
  const originalPrices = Object.fromEntries(priceGroups.flat().map(name => [name, TravelMoney.value(tourForm.elements[name])]));

  submitAdminForm(tourForm, async () => {
    const data = new FormData();
    for (const name of fields) {
      const value = tourForm.elements[name].value;
      if (!editing || name === 'name' || value !== originalFields[name]) data.append(name, value);
    }
    const stockBaseline = {};
    for (const name of stockFields) {
      const current = tourForm.elements[name].value;
      if (!editing || originalStock[name] !== current) {
        data.append(name, current);
        stockBaseline[name] = originalStock[name] === '' ? null : Number(originalStock[name]);
      }
    }
    if (editing && Object.keys(stockBaseline).length) data.append('stockBaseline', JSON.stringify(stockBaseline));
    for (const names of priceGroups) {
      const values = names.map(name => TravelMoney.value(tourForm.elements[name]));
      if (editing && names.every((name, index) => Object.is(originalPrices[name], values[index]))) continue;
      if (values.some(Number.isNaN)) throw new Error('Vui lòng kiểm tra số tiền trong biểu mẫu.');
      for (const [index, name] of names.entries()) data.append(name, values[index] ?? '');
    }
    const locations = Array.from(tourForm.querySelectorAll('input[name="locations"]:checked'), input => input.value);
    data.append('locations', JSON.stringify(locations));
    data.append('information', await (window.AdminEditor?.value(tourForm.elements.information) ?? tourForm.elements.information.value));
    const schedules = await Promise.all(Array.from(tourForm.querySelectorAll('.inner-schedule-item'), async item => {
      const textarea = item.querySelector('textarea');
      return {
        title: item.querySelector('input').value,
        description: await (window.AdminEditor?.value(textarea) ?? textarea.value)
      };
    }));
    data.append('schedules', JSON.stringify(schedules));

    const avatar = adminImageFiles(tourForm, 'avatar')[0];
    if (avatar) data.append('avatar', avatar);
    const removeAvatar = tourForm.elements.removeAvatar?.checked;
    if (removeAvatar && avatar) throw new Error('Chọn xóa hoặc thay ảnh đại diện.');
    if (removeAvatar) data.append('removeAvatar', 'true');
    const saved = Array.from(tourForm.querySelectorAll('[data-saved-index]'));
    const kept = saved.filter(image => image.dataset.removed !== 'true').map(image => Number(image.dataset.savedIndex));
    const newImages = adminImageFiles(tourForm, 'images');
    if (newImages.length) newImages.forEach(file => data.append('images', file));
    const galleryChanged = newImages.length > 0 || kept.length !== saved.length || kept.some((index, position) => index !== position);
    if (editing && galleryChanged) data.append('savedImages', JSON.stringify(kept));
    if (editing && (galleryChanged || avatar || removeAvatar)) data.append('imageRevision', tourForm.dataset.imageRevision);

    const url = editing ? '/' + pathAdmin + '/tour/edit/' + tourForm.elements.id.value : '/' + pathAdmin + '/tour/create';
    return { url, method: editing ? 'PATCH' : 'POST', body: data };
  }, () => {
    if (editing) window.location.reload();
    else window.location.assign(listReturnUrl('/' + pathAdmin + '/tour/list'));
  });
}

// Order Edit Form
const orderEditForm = document.querySelector("#order-edit-form");
const orderEditButton = orderEditForm?.querySelector('button[type="submit"]');
if (orderEditButton) {
  const feedback = orderEditForm.querySelector('[data-form-status]');
  const fields = orderEditForm.elements;
  const editableNames = ["fullName", "phone", "note", "status", "paymentMethod", "paymentStatus"];
  const initial = Object.fromEntries(editableNames.map(name => [name, fields[name].value]));
  orderEditForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (orderEditButton.disabled || !orderEditForm.reportValidity()) return;
    orderEditButton.disabled = true;
    const status = fields.status.value;
    const dataFinal = Object.fromEntries(editableNames.filter(name => !fields[name].disabled && fields[name].value !== initial[name])
      .map(name => [name, fields[name].value]));
    if (!Object.keys(dataFinal).length) {
      feedback.textContent = "Chưa có thay đổi.";
      orderEditButton.disabled = false;
      return;
    }
    const refundAmount = Number(orderEditForm.dataset.cardRefund);
    feedback.textContent = '';
    feedback.classList.remove('form-status-error');
    try {
      if (status === "cancel" && orderEditForm.dataset.orderStatus !== "cancel") {
        const hasRefund = Number.isSafeInteger(refundAmount) && refundAmount > 0;
        const message = hasRefund
          ? "Đơn sẽ hoàn " + refundAmount.toLocaleString("vi-VN") + " đ vào ví thẻ của khách. Khoản hoàn chờ ghi lên thẻ."
          : "Đơn sẽ chuyển sang trạng thái đã hủy. Hệ thống kiểm tra điều kiện hoàn chỗ và thanh toán.";
        const confirmed = await confirmTravelAction({
          title: hasRefund ? "Hủy đơn và hoàn tiền ví thẻ?" : "Hủy đơn hàng?",
          message,
          confirmText: hasRefund ? "Hủy đơn và hoàn tiền" : "Hủy đơn"
        });
        if (!confirmed) return;
      } else if (dataFinal.status || dataFinal.paymentMethod || dataFinal.paymentStatus) {
        const paid = dataFinal.paymentStatus === "paid";
        const confirmed = await confirmTravelAction({
          title: paid ? "Xác nhận đã nhận thanh toán?" : "Xác nhận cập nhật đơn hàng?",
          message: paid ? "Chỉ xác nhận sau khi đã kiểm tra số tiền thực nhận." : "Phương thức hoặc trạng thái đã chọn sẽ được lưu vào đơn.",
          confirmText: "Xác nhận"
        });
        if (!confirmed) return;
      }
      feedback.textContent = 'Đang cập nhật đơn hàng…';
      const data = await travelRequest(orderEditForm.dataset.api, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataFinal)
      });
      if (data.refund && data.message) await showTravelNotice(data.message, "success");
      window.location.reload();
    } catch (error) {
      feedback.textContent = error instanceof TypeError || ['AbortError', 'TimeoutError'].includes(error.name)
        ? 'Chưa nhận được kết quả. Vui lòng tải lại đơn để kiểm tra trước khi gửi lại.'
        : error.message || 'Không thể cập nhật đơn hàng.';
      feedback.classList.add('form-status-error');
    } finally {
      orderEditButton.disabled = false;
    }
  });
}
// End Order Edit Form

const accountForm = document.querySelector('#setting-account-admin-create-form, #setting-account-admin-edit-form');
if (accountForm && accountForm.querySelector('button[type=submit]')) {
  const editing = accountForm.matches('#setting-account-admin-edit-form');
  const fields = ['fullName', 'email', 'phone', 'role', 'positionCompany', 'status', 'password'];
  const original = new Map(fields.map(name => [name, accountForm.elements[name].value]));
  const base = '/' + pathAdmin + '/setting/account-admin/';
  submitAdminForm(accountForm, () => {
    const data = new FormData();
    for (const name of fields) {
      const input = accountForm.elements[name];
      if (!input.disabled && (!editing || original.get(name) !== input.value)) data.append(name, input.value);
    }
    appendAdminImages(accountForm, data, ['avatar']);
    return {
      url: editing ? base + 'edit/' + accountForm.elements.id.value : base + 'create',
      method: editing ? 'PATCH' : 'POST', body: data
    };
  }, () => editing ? window.location.reload() : window.location.assign(base + 'list'));
}

const roleForm = document.querySelector('#setting-role-create-form, #setting-role-edit-form');
if (roleForm && roleForm.querySelector('button[type=submit]')) {
  const editing = roleForm.matches('#setting-role-edit-form');
  const base = '/' + pathAdmin + '/setting/role/';
  submitAdminForm(roleForm, () => ({
    url: editing ? base + 'edit/' + roleForm.elements.id.value : base + 'create',
    method: editing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: roleForm.elements.name.value,
      description: roleForm.elements.description.value,
      permissions: Array.from(roleForm.querySelectorAll('input[name="permissions"]:checked'), input => input.value)
    })
  }), () => editing ? window.location.reload() : window.location.assign(base + 'list'));
}

const websiteForm = document.querySelector('#setting-website-info-form');
if (websiteForm && websiteForm.querySelector('button[type=submit]')) {
  submitAdminForm(websiteForm, () => {
    const data = new FormData();
    for (const name of ['websiteName', 'phone', 'email', 'address']) data.append(name, websiteForm.elements[name].value);
    appendAdminImages(websiteForm, data, ['logo', 'favicon']);
    return { url: '/' + pathAdmin + '/setting/website-info', method: 'PATCH', body: data };
  }, () => window.location.reload());
}

const profileForm = document.querySelector('#profile-edit-form');
if (profileForm) {
  const fields = ['fullName', 'phone'];
  const original = new Map(fields.map(name => [name, profileForm.elements[name].value]));
  submitAdminForm(profileForm, () => {
    const data = new FormData();
    for (const name of fields) {
      const { value } = profileForm.elements[name];
      if (value !== original.get(name)) data.append(name, value);
    }
    appendAdminImages(profileForm, data, ['avatar']);
    return { url: '/' + pathAdmin + '/profile/edit', method: 'PATCH', body: data };
  }, () => window.location.reload());
}

const profileChangePasswordForm = document.querySelector('#profile-change-password-form');
if (profileChangePasswordForm) {
  submitAdminForm(profileChangePasswordForm, () => {
    const fields = profileChangePasswordForm.elements;
    const currentPassword = fields.currentPassword.value;
    const password = fields.password.value;
    const confirmPassword = fields.confirmPassword.value;
    validateAdminNewPassword(password);
    if (password !== confirmPassword) throw new Error('Mật khẩu xác nhận không khớp.');
    return {
      url: '/' + pathAdmin + '/profile/change-password', method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, password, confirmPassword })
    };
  }, () => window.location.assign('/' + pathAdmin + '/account/login'));
}

// Sider
const sider = document.querySelector(".sider");
if (sider) {
  const pathNameCurrent = window.location.pathname;
  const splitPathNameCurrent = pathNameCurrent.split("/");
  const menuList = [...sider.querySelectorAll("a")];
  // Cùng module (vd. /admin/card/...) có thể có nhiều mục menu: ưu tiên mục khớp đúng trang,
  // nếu không (trang con như /card/detail/...) thì chọn mục ".../list" của module đó.
  const sameModule = menuList.filter(item => {
    const splitPathName = new URL(item.href).pathname.split("/");
    return splitPathNameCurrent[1] == splitPathName[1] && splitPathNameCurrent[2] == splitPathName[2];
  });
  const segment3 = item => new URL(item.href).pathname.split("/")[3];
  const activeItem = sameModule.length <= 1
    ? sameModule[0]
    : (sameModule.find(item => segment3(item) == splitPathNameCurrent[3])
      || sameModule.find(item => segment3(item) == "list")
      || sameModule[0]);
  if (activeItem) activeItem.classList.add("active");
}
// End Sider

// Logout
const buttonLogout = document.querySelector(".sider .inner-logout");
if (buttonLogout) {
  buttonLogout.addEventListener("click", () => {
    fetch(`/${pathAdmin}/account/logout`, {
      method: "POST"
    })
      .then(res => res.json())
      .then(data => {
        if (data.code == "success") {
          window.location.href = `/${pathAdmin}/account/login`;
        }
      })
  })
}
// End Logout

// Alert
const alertTime = document.querySelector("[alert-time]");
if (alertTime) {
  let time = alertTime.getAttribute("alert-time");
  time = time ? parseInt(time) : 4000;
  setTimeout(() => {
    alertTime.remove(); // Xóa phần tử khỏi giao diện
  }, time);
}
// End Alert

// Mutations from list actions
async function runListAction(button, url, options, confirmation) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (confirmation && !await confirmTravelAction(confirmation)) return;
    await travelRequest(url, { method: "PATCH", ...options });
    window.location.reload();
  } catch (error) {
    showTravelNotice(error.message || "Chưa nhận được xác nhận. Hãy tải lại để kiểm tra trạng thái.", "error");
  } finally {
    button.disabled = false;
  }
}

const adminList = document.querySelector("[data-admin-list]");
const customerListReturn = document.querySelector("[data-customer-list-return]");
const customerReturnKey = "admin-customer-return:" + window.location.pathname;

function listReturnUrl(destination, customerDetail = false) {
  const url = new URL(destination, window.location.origin);
  try {
    const previous = document.referrer && new URL(document.referrer);
    if (previous && previous.origin === url.origin && previous.pathname === url.pathname) {
      window.history.replaceState({ ...window.history.state, adminListReturn: previous.href }, "");
      return previous.href;
    }
    // Reload do form vừa lưu có thể dùng trang hiện tại làm referrer. Giữ URL cũ trong history của tab.
    const returnTo = window.history.state?.adminListReturn;
    if (typeof returnTo === "string") {
      const saved = new URL(returnTo);
      if (saved.origin === url.origin && saved.pathname === url.pathname) return saved.href;
    }
    if (customerDetail && previous?.origin === url.origin && previous.pathname === window.location.pathname) {
      const storedQuery = sessionStorage.getItem(customerReturnKey);
      if (storedQuery !== null) {
        url.search = storedQuery;
        window.history.replaceState({ ...window.history.state, adminListReturn: url.href }, "");
      }
    }
    if (/\/(category|tour)\/(list|trash)$/.test(url.pathname)) {
      url.search = sessionStorage.getItem("admin-list:" + url.pathname) || "";
    }
  } catch {}
  return url.href;
}

if (adminList) {
  const size = document.querySelector("[page-size]");
  const page = document.querySelector("[pagination]");
  const current = new URL(window.location.href);
  function listUrl(pageSize) {
    const url = new URL(adminList.action);
    for (const [key, value] of new FormData(adminList)) {
      if (value.trim()) url.searchParams.set(key, value.trim());
    }
    if (pageSize && pageSize !== "10") url.searchParams.set("pageSize", pageSize);
    else url.searchParams.delete("pageSize");
    return url;
  }
  if (["category", "tour"].includes(adminList.dataset.resource)) {
    const saved = listUrl(size?.value);
    if (page?.value && page.value !== "1") saved.searchParams.set("page", page.value);
    try { sessionStorage.setItem("admin-list:" + saved.pathname, saved.search); } catch {}
  }
  adminList.addEventListener("submit", event => {
    event.preventDefault();
    window.location.assign(listUrl(size?.value).href);
  });
  adminList.querySelectorAll("[data-list-filter]").forEach(control => {
    control.addEventListener("change", () => adminList.requestSubmit());
  });
  size?.addEventListener("change", () => window.location.assign(listUrl(size.value).href));
  page?.addEventListener("change", () => {
    const url = listUrl(size?.value);
    // Từ khóa đang gõ chỉ áp dụng khi người dùng gửi form tìm kiếm.
    const search = adminList.querySelector('input[type="search"]');
    url.searchParams.delete(search.name);
    if (current.searchParams.get(search.name)) url.searchParams.set(search.name, current.searchParams.get(search.name));
    url.searchParams.set("page", page.value);
    window.location.assign(url.href);
  });
}

for (const link of document.querySelectorAll("[data-list-return]")) {
  link.href = listReturnUrl(link.href, link === customerListReturn);
}

if (customerListReturn) {
  function saveCustomerListQuery() {
    const url = new URL(customerListReturn.href);
    if (url.origin === window.location.origin && url.pathname === `/${pathAdmin}/user/list`) {
      try { sessionStorage.setItem(customerReturnKey, url.search); } catch {}
    }
  }
  saveCustomerListQuery();
  // Back/Forward can restore this page without rerunning the script.
  window.addEventListener("pageshow", saveCustomerListQuery);
}

const customerTabs = document.querySelector(".customer-tabs");
const currentCustomerTab = customerTabs?.querySelector('[aria-current="page"]');
if (currentCustomerTab) {
  function revealCurrentTab() {
    const viewport = customerTabs.getBoundingClientRect();
    const current = currentCustomerTab.getBoundingClientRect();
    if (current.left < viewport.left) customerTabs.scrollLeft += current.left - viewport.left - 4;
    if (current.right > viewport.right) customerTabs.scrollLeft += current.right - viewport.right + 4;
  }
  revealCurrentTab();
  window.addEventListener("resize", revealCurrentTab);
}

if (adminList) {
  const bulk = adminList.querySelector("[data-list-bulk]");
  const selectAll = document.querySelector("[data-list-check-all]");
  const checkboxes = Array.from(document.querySelectorAll("[data-list-check]:not(:disabled)"));
  const listActions = Array.from(document.querySelectorAll("[data-list-action]"));
  let busy = false;

  function updateSelection() {
    if (!selectAll) return;
    const selected = checkboxes.filter(item => item.checked).length;
    selectAll.checked = selected > 0 && selected === checkboxes.length;
    selectAll.indeterminate = selected > 0 && selected < checkboxes.length;
  }

  function clearSelection() {
    for (const checkbox of checkboxes) checkbox.checked = false;
    updateSelection();
  }
  window.addEventListener("pageshow", clearSelection);
  selectAll?.addEventListener("change", () => {
    for (const checkbox of checkboxes) checkbox.checked = selectAll.checked;
    updateSelection();
  });
  for (const checkbox of checkboxes) checkbox.addEventListener("change", updateSelection);

  const resource = { category: "danh mục", tour: "tour", order: "đơn hàng" }[adminList.dataset.resource];
  const confirmations = {
    delete: { title: "Chuyển " + resource + " vào thùng rác?", message: "Các mục đã chọn sẽ được ẩn khỏi danh sách đang quản lý.", confirmText: "Chuyển vào thùng rác" },
    undo: { title: "Khôi phục " + resource + "?", message: "Các mục đủ điều kiện sẽ xuất hiện lại trong danh sách.", confirmText: "Khôi phục" },
    "delete-destroy": {
      title: "Xóa vĩnh viễn " + resource + "?",
      message: adminList.dataset.resource === "category"
        ? "Thao tác này không thể khôi phục. Chỉ có thể xóa danh mục trong thùng rác khi không còn danh mục con và tour tham chiếu."
        : "Thao tác này không thể khôi phục. Hệ thống sẽ kiểm tra lịch sử đặt tour.",
      confirmText: "Xóa vĩnh viễn"
    },
    active: { title: "Cho phép hoạt động?", message: "Các mục đã chọn sẽ được chuyển sang hoạt động.", confirmText: "Cho phép hoạt động" },
    inactive: { title: "Tạm dừng hoạt động?", message: "Các mục đã chọn sẽ được chuyển sang tạm dừng.", confirmText: "Tạm dừng" }
  };
  async function act(button, endpoint, action, ids) {
    if (busy || !confirmations[action]) return;
    busy = true;
    try {
      const options = ids ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ option: action, ids }) } : {};
      await runListAction(button, endpoint, options, confirmations[action]);
    } finally {
      busy = false;
    }
  }
  for (const button of listActions) {
    button.addEventListener("click", () => act(button, button.dataset.api, button.dataset.listAction));
  }
  const bulkButton = bulk?.querySelector("button");
  bulkButton?.addEventListener("click", () => {
    const action = bulk.querySelector("select").value;
    const ids = checkboxes.filter(item => item.checked).map(item => item.getAttribute("check-item"));
    if (!action || !ids.length) return showTravelNotice("Vui lòng chọn hành động và ít nhất một mục.", "error");
    act(bulkButton, bulk.dataset.api, action, ids);
  });
}

document.querySelectorAll("[button-delete]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.dataset.confirm;
    const confirmation = {
      trash: { title: "Chuyển tour vào thùng rác?", message: "Tour sẽ ẩn khỏi danh sách bán và có thể được khôi phục.", confirmText: "Chuyển vào thùng rác" },
      destroy: { title: "Xóa vĩnh viễn tour?", message: "Tour sẽ bị xóa khỏi thùng rác. Thao tác này không thể khôi phục.", confirmText: "Xóa vĩnh viễn" },
      contact: { title: "Xóa liên hệ?", message: "Liên hệ sẽ bị ẩn khỏi danh sách quản lý.", confirmText: "Xóa liên hệ" },
      account: { title: "Xóa tài khoản?", message: "Tài khoản sẽ mất quyền truy cập vào trang quản trị.", confirmText: "Xóa tài khoản" },
      role: { title: "Xóa nhóm quyền?", message: "Nhóm quyền sẽ bị xóa nếu đáp ứng các điều kiện của hệ thống.", confirmText: "Xóa nhóm quyền" }
    }[action];
    if (action && !confirmation) return;
    if (!action && !button.dataset.api.includes("/tour/undo/")) return;
    runListAction(button, button.dataset.api, {}, confirmation);
  });
});

// Filter Status
const filterStatus = document.querySelector("[filter-status]:not([data-list-filter])");
if (filterStatus) {
  const url = new URL(window.location.href);

  // Lắng nghe thay đổi lựa chọn
  filterStatus.addEventListener("change", () => {
    const value = filterStatus.value;
    if (value) {
      url.searchParams.set("status", value);
    } else {
      url.searchParams.delete("status");
    }

    window.location.href = url.href;
  })

  // Hiển thị lựa chọn mặc định
  const valueCurrent = url.searchParams.get("status");
  if (valueCurrent) {
    filterStatus.value = valueCurrent;
  }
}
// End Filter Status

// Filter Created By
const filterCreatedBy = document.querySelector("[filter-created-by]:not([data-list-filter])");
if (filterCreatedBy) {
  const url = new URL(window.location.href);

  // Lắng nghe thay đổi lựa chọn
  filterCreatedBy.addEventListener("change", () => {
    const value = filterCreatedBy.value;
    if (value) {
      url.searchParams.set("createdBy", value);
    } else {
      url.searchParams.delete("createdBy");
    }

    window.location.href = url.href;
  })

  // Hiển thị lựa chọn mặc định
  const valueCurrent = url.searchParams.get("createdBy");
  if (valueCurrent) {
    filterCreatedBy.value = valueCurrent;
  }
}
// End Filter Created By

// Filter Start Date
const filterStartDate = document.querySelector("[filter-start-date]:not([data-list-filter])");
if (filterStartDate) {
  const url = new URL(window.location.href);

  // Lắng nghe thay đổi lựa chọn
  filterStartDate.addEventListener("change", () => {
    const value = filterStartDate.value;
    if (value) {
      url.searchParams.set("startDate", value);
    } else {
      url.searchParams.delete("startDate");
    }

    window.location.href = url.href;
  })

  // Hiển thị lựa chọn mặc định
  const valueCurrent = url.searchParams.get("startDate");
  if (valueCurrent) {
    filterStartDate.value = valueCurrent;
  }
}
// End Filter Start Date

// Filter End Date
const filterEndDate = document.querySelector("[filter-end-date]:not([data-list-filter])");
if (filterEndDate) {
  const url = new URL(window.location.href);

  // Lắng nghe thay đổi lựa chọn
  filterEndDate.addEventListener("change", () => {
    const value = filterEndDate.value;
    if (value) {
      url.searchParams.set("endDate", value);
    } else {
      url.searchParams.delete("endDate");
    }

    window.location.href = url.href;
  })

  // Hiển thị lựa chọn mặc định
  const valueCurrent = url.searchParams.get("endDate");
  if (valueCurrent) {
    filterEndDate.value = valueCurrent;
  }
}
// End Filter End Date

// Filter Reset
const filterReset = document.querySelector("[filter-reset]");
if (filterReset) {
  const url = new URL(window.location.href);

  filterReset.addEventListener("click", () => {
    url.search = "";
    window.location.href = url.href;
  })
}
// End Filter Reset

// Check All
const checkAll = document.querySelector("[check-all]:not([data-list-check-all])");
if (checkAll) {
  checkAll.addEventListener("click", () => {
    const listCheckItem = document.querySelectorAll("[check-item]");
    listCheckItem.forEach(item => {
      item.checked = checkAll.checked;
    })
  })
}
// End Check All

// Change Multi
const changeMulti = document.querySelector("[change-multi]");
if (changeMulti) {
  const select = changeMulti.querySelector("select");
  const button = changeMulti.querySelector("button");

  button.addEventListener("click", () => {
    const option = select.value;
    const ids = Array.from(document.querySelectorAll("[check-item]:checked"), input => input.getAttribute("check-item"));
    if (!option || !ids.length) {
      showTravelNotice("Hãy chọn thao tác và ít nhất một bản ghi.");
      return;
    }
    const confirmation = option === "delete-destroy" ? {
      title: "Xóa vĩnh viễn " + ids.length + " tour?",
      message: "Các tour đã chọn sẽ bị xóa khỏi thùng rác. Thao tác này không thể khôi phục.",
      confirmText: "Xóa vĩnh viễn"
    } : null;
    runListAction(button, changeMulti.dataset.api, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ option, ids })
    }, confirmation);
  });
}
// End Change Multi

// Search
const search = document.querySelector("[search]:not([data-admin-list] [search])");
if (search) {
  const url = new URL(window.location.href);

  // Lắng nghe phím đang gõ
  search.addEventListener("keyup", (event) => {
    if (event.key === "Enter") {
      const value = search.value;
      if (value) {
        url.searchParams.set("keyword", value.trim());
      } else {
        url.searchParams.delete("keyword");
      }

        window.location.href = url.href;
    }
  })

  // Hiển thị lựa chọn mặc định
  const valueCurrent = url.searchParams.get("keyword");
  if (valueCurrent) {
    search.value = valueCurrent;
  }
}
// End Search

// Pagination
const pagination = document.querySelector("[pagination]");
if (pagination && !adminList) {
  const url = new URL(window.location.href);

  // Lắng nghe thay đổi lựa chọn
  pagination.addEventListener("change", () => {
    const value = pagination.value;
    if (value) {
      url.searchParams.set("page", value);
    } else {
      url.searchParams.delete("page");
    }

    window.location.href = url.href;
  })

  // Hiển thị lựa chọn mặc định
  const valueCurrent = url.searchParams.get("page");
  if (valueCurrent && !document.querySelector("[data-customer-history]")) {
    pagination.value = valueCurrent;
  }
}
const pageSize = document.querySelector("[page-size]");
if (pageSize && !adminList) {
  pageSize.addEventListener("change", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("pageSize", pageSize.value);
    url.searchParams.delete("page");
    window.location.href = url.href;
  });
}

document.querySelectorAll("[data-order-soft-delete]").forEach(button => {
  button.addEventListener("click", () => {
    const id = encodeURIComponent(button.dataset.orderSoftDelete);
    runListAction(button, "/" + pathAdmin + "/order/delete/" + id, {}, {
      title: "Ẩn đơn hàng này?",
      message: "Đơn đã hủy và chưa thanh toán sẽ được ẩn khỏi danh sách quản lý.",
      confirmText: "Ẩn đơn hàng"
    });
  });
});
