// Menu Mobile
const buttonMenuMobile = document.querySelector(".header .inner-menu-mobile");
if (buttonMenuMobile) {
  const menu = document.querySelector(".header .inner-menu");
  const close = menu.querySelector("[data-nav-close]");
  const list = menu.firstElementChild;
  const more = list.querySelector("[data-nav-more]");
  const morePanel = more?.lastElementChild;
  const categories = Array.from(list.querySelectorAll(":scope > [data-nav-category]"));
  const fixed = Array.from(list.children).filter(item => item !== more &&
    !item.matches("[data-nav-category], .inner-mobile-close"));
  const mobile = matchMedia("(max-width: 991.98px)");
  const toggles = menu.querySelectorAll("[data-nav-toggle]");
  const panelFor = toggle => document.getElementById(toggle.getAttribute("aria-controls"));
  const setPanel = (toggle, open) => {
    if (!toggle) return;
    const panel = panelFor(toggle);
    toggle.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
    if (open) {
      panel.removeAttribute("data-align-end");
      if (panel.getBoundingClientRect().right > innerWidth - 8) panel.setAttribute("data-align-end", "");
    } else {
      panel.querySelectorAll('[data-nav-toggle][aria-expanded="true"]').forEach(child => {
        child.setAttribute("aria-expanded", "false");
        panelFor(child).hidden = true;
      });
    }
  };

  let frame;
  function fitCategories() {
    if (!more) return;
    const focused = document.activeElement;
    const focusedCategory = categories.find(item => item.contains(focused));
    const oldParents = categories.map(item => item.parentElement);
    const batch = new DocumentFragment();
    batch.append(...categories);
    list.insertBefore(batch, more);
    menu.toggleAttribute("data-nav-fit", !mobile.matches);

    let count = categories.length;
    if (!mobile.matches) {
      more.hidden = false;
      const gap = parseFloat(getComputedStyle(list).columnGap);
      const width = item => item.getBoundingClientRect().width + gap;
      const available = list.clientWidth - 1 + gap - fixed.reduce((sum, item) => sum + width(item), 0);
      const widths = categories.map(width);
      if (widths.reduce((sum, value) => sum + value, 0) > available) {
        let remaining = available - width(more);
        count = 0;
        while (count < widths.length && remaining >= widths[count]) remaining -= widths[count++];
      }
    }

    morePanel.append(...categories.slice(count));
    more.hidden = count === categories.length;
    const moreToggle = more.firstElementChild;
    if (more.hidden) setPanel(moreToggle, false);
    categories.forEach((item, index) => {
      if (item.parentElement !== oldParents[index]) {
        setPanel(item.querySelector(":scope > .inner-category-row > [data-nav-toggle]"), false);
      }
    });
    if (focusedCategory || more.contains(focused)) {
      let target = focused;
      if (focusedCategory && morePanel.contains(focusedCategory) && morePanel.hidden) target = moreToggle;
      else if (focusedCategory && focused.closest("[hidden]")) target = focusedCategory.querySelector("a");
      else if (more.hidden && focused === moreToggle) target = list.querySelector("a");
      if (!target.closest("[hidden]")) target.focus({ preventScroll: true });
    }
  }
  function requestFit() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fitCategories);
  }

  const setOpen = (open, restoreFocus = true) => {
    menu.classList.toggle("active", open);
    buttonMenuMobile.setAttribute("aria-expanded", String(open));
    if (open) close.focus();
    else {
      toggles.forEach(toggle => setPanel(toggle, false));
      if (restoreFocus) buttonMenuMobile.focus();
    }
  };
  buttonMenuMobile.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));
  menu.querySelector(".inner-overlay").addEventListener("click", () => setOpen(false));
  mobile.addEventListener("change", () => {
    setOpen(false, false);
    fitCategories();
  });
  toggles.forEach(toggle => {
    const item = toggle.closest("li");
    toggle.addEventListener("click", () => setPanel(toggle, panelFor(toggle).hidden));
    if (item.matches("[data-nav-category]")) {
      item.addEventListener("pointerenter", event => {
        if (event.pointerType === "mouse" && !mobile.matches && item.parentElement === list) setPanel(toggle, true);
      });
      item.addEventListener("pointerleave", () => {
        if (!mobile.matches && item.parentElement === list && !panelFor(toggle).contains(document.activeElement)) setPanel(toggle, false);
      });
    }
    item.addEventListener("focusout", event => {
      if (event.relatedTarget && !item.contains(event.relatedTarget)) setPanel(toggle, false);
    });
  });
  document.addEventListener("click", event => {
    toggles.forEach(toggle => {
      if (!toggle.closest("li").contains(event.target)) setPanel(toggle, false);
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const open = Array.from(menu.querySelectorAll('[data-nav-toggle][aria-expanded="true"]')).reverse();
    const toggle = open.find(item => item.closest("li").contains(event.target)) || open[0];
    if (toggle) {
      setPanel(toggle, false);
      toggle.focus();
    } else if (menu.classList.contains("active")) setOpen(false);
  });
  menu.querySelectorAll("a").forEach(link => {
    if (link.getAttribute("href") === location.pathname) link.setAttribute("aria-current", "page");
    link.addEventListener("click", () => {
      if (mobile.matches) setOpen(false, false);
    });
  });
  if (more) {
    fitCategories();
    const observer = new ResizeObserver(requestFit);
    observer.observe(menu);
    window.addEventListener("resize", requestFit);
    document.fonts?.ready.then(requestFit);
    document.fonts?.addEventListener("loadingdone", requestFit);
  }
}
// End Menu Mobile

// Box Address Section 1
const boxAddressSection1 = document.querySelector(".section-1 .inner-form .inner-box.inner-address");
if (boxAddressSection1) {
  // Ẩn/hiện box suggest
  const input = boxAddressSection1.querySelector(".inner-input");

  input.addEventListener("focus", () => {
    boxAddressSection1.classList.add("active");
  })

  input.addEventListener("blur", () => {
    boxAddressSection1.classList.remove("active");
  })

  // Sự kiện click vào từng item
  const listItem = boxAddressSection1.querySelectorAll(".inner-suggest-list .inner-item");
  listItem.forEach(item => {
    item.addEventListener("mousedown", () => {
      const title = item.querySelector(".inner-item-title").textContent.trim();
      if (title) {
        input.value = title;
      }
    })
  })
}
// End Box Address Section 1

// Box User Section 1
const boxUserSection1 = document.querySelector(".section-1 .inner-form .inner-box.inner-user");
if (boxUserSection1) {
  // Hiện box quantity
  const input = boxUserSection1.querySelector(".inner-input");

  input.addEventListener("focus", () => {
    boxUserSection1.classList.add("active");
  })

  // Ẩn box quantity
  document.addEventListener("click", (event) => {
    // Kiểm tra nếu click không nằm trong khối `.inner-box.inner-user`
    if (!boxUserSection1.contains(event.target)) {
      boxUserSection1.classList.remove("active");
    }
  });

  // Thêm số lượng vào ô input
  const updateQuantityInput = () => {
    const listBoxNumber = boxUserSection1.querySelectorAll(".inner-count .inner-number");
    const listNumber = [];
    listBoxNumber.forEach(boxNumber => {
      const number = parseInt(boxNumber.innerHTML.trim());
      listNumber.push(number);
    })
    const value = `NL: ${listNumber[0]}, TE: ${listNumber[1]}, EB: ${listNumber[2]}`;
    input.value = value;
  }

  // Bắt sự kiện click nút up
  const listButtonUp = boxUserSection1.querySelectorAll(".inner-count .inner-up");
  listButtonUp.forEach(button => {
    button.addEventListener("click", () => {
      const parent = button.parentNode;
      const boxNumber = parent.querySelector(".inner-number");
      const number = parseInt(boxNumber.innerHTML.trim());
      const numberUpdate = number + 1;
      boxNumber.innerHTML = numberUpdate;
      updateQuantityInput();
    })
  })

  // Bắt sự kiện click nút down
  const listButtonDown = boxUserSection1.querySelectorAll(".inner-count .inner-down");
  listButtonDown.forEach(button => {
    button.addEventListener("click", () => {
      const parent = button.parentNode;
      const boxNumber = parent.querySelector(".inner-number");
      const number = parseInt(boxNumber.innerHTML.trim());
      if (number > 0) {
        const numberUpdate = number - 1;
        boxNumber.innerHTML = numberUpdate;
        updateQuantityInput();
      }
    })
  })
}
// End Box User Section 1

// Clock Expire
const clockExpire = document.querySelector("[clock-expire]");
if (clockExpire) {
  const expireDateTimeString = clockExpire.getAttribute("clock-expire");

  // Chuyển đổi chuỗi thời gian thành đối tượng Date
  const expireDateTime = new Date(expireDateTimeString);

  // Hàm cập nhật đồng hồ
  const updateClock = () => {
    const now = new Date();
    const remainingTime = expireDateTime - now; // quy về đơn vị mili giây

    if (remainingTime > 0) {
      const days = Math.floor(remainingTime / (24 * 60 * 60 * 1000));
      // Tính số ngày, 24 * 60 * 60 * 1000 Tích của các số này = số mili giây trong 1 ngày

      const hours = Math.floor((remainingTime / (60 * 60 * 1000)) % 24);
      // Tính số giờ, 60 * 60 * 1000 Chia remainingTime cho giá trị này để nhận được tổng số giờ.
      // % 24 Lấy phần dư khi chia tổng số giờ cho 24 để chỉ lấy số giờ còn lại trong ngày.

      const minutes = Math.floor((remainingTime / (60 * 1000)) % 60);
      // Tính số phút, 60 * 1000 Chia remainingTime cho giá trị này để nhận được tổng số phút.
      // % 60 Lấy phần dư khi chia tổng số phút cho 60 để chỉ lấy số phút còn lại trong giờ.

      const seconds = Math.floor((remainingTime / 1000) % 60);
      // Tính số giây, 1000 Chia remainingTime cho giá trị này để nhận được tổng số giây.
      // % 60 Lấy phần dư khi chia tổng số giây cho 60 để chỉ lấy số giây còn lại trong phút.

      // Cập nhật giá trị vào thẻ span
      const listBoxNumber = clockExpire.querySelectorAll('.inner-number');
      listBoxNumber[0].innerHTML = `${days}`.padStart(2, '0');
      listBoxNumber[1].innerHTML = `${hours}`.padStart(2, '0');
      listBoxNumber[2].innerHTML = `${minutes}`.padStart(2, '0');
      listBoxNumber[3].innerHTML = `${seconds}`.padStart(2, '0');
    } else {
      // Khi hết thời gian, dừng đồng hồ
      clearInterval(intervalClock);
    }
  }

  // Gọi hàm cập nhật đồng hồ mỗi giây
  const intervalClock = setInterval(updateClock, 1000);
}
// End Clock Expire

// Box Filter
const buttonFilterMobile = document.querySelector(".section-9 .inner-filter-mobile");
if (buttonFilterMobile) {
  const boxLeft = document.querySelector(".section-9 .inner-left");
  buttonFilterMobile.addEventListener("click", () => {
    boxLeft.classList.add("active");
  })

  const overlay = document.querySelector(".section-9 .inner-left .inner-overlay");
  overlay.addEventListener("click", () => {
    boxLeft.classList.remove("active");
  })
}
// End Box Filter

// Box Tour Info
const boxTourInfo = document.querySelector(".box-tour-info");
if (boxTourInfo) {
  const buttonReadMore = boxTourInfo.querySelector(".inner-read-more button");
  buttonReadMore.addEventListener("click", () => {
    boxTourInfo.classList.add("active");
  })

  if (window.Viewer) new Viewer(boxTourInfo);
}
// End Box Tour Info

// Khởi tạo AOS
if (window.AOS) window.AOS.init();
else document.documentElement.classList.add("no-aos");
// Hết Khởi tạo AOS

// Swiper Section 2
function tourCarousel(selector, breakpoints) {
  const element = document.querySelector(selector);
  if (!element) return;
  const slideCount = element.querySelectorAll(".swiper-wrapper > .swiper-slide").length;
  if (!window.Swiper || slideCount < 2) {
    element.classList.add("swiper-static");
    return;
  }
  const maxVisible = Math.max(...Object.values(breakpoints).map(point => point.slidesPerView));
  const pagination = element.querySelector(".swiper-pagination");
  const loop = slideCount >= maxVisible + 1;
  return new window.Swiper(element, {
    slidesPerView: 1,
    spaceBetween: 20,
    autoplay: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { delay: 4000 },
    loop,
    rewind: !loop,
    watchOverflow: true,
    ...(pagination ? { pagination: { el: pagination, clickable: true } } : {}),
    breakpoints
  });
}
tourCarousel(".swiper-section-2", { 992: { slidesPerView: 2 }, 1200: { slidesPerView: 3 } });
tourCarousel(".swiper-section-3", { 576: { slidesPerView: 2 }, 992: { slidesPerView: 3 } });

// Swiper Box Images
const boxImages = document.querySelector(".box-images");
if (boxImages && window.Swiper) {
  const swiperBoxImagesThumb = new Swiper(".swiper-box-images-thumb", {
    spaceBetween: 5,
    slidesPerView: 4,
    breakpoints: {
      576: {
        spaceBetween: 10,
      },
    },
  });

  const swiperBoxImagesMain = new Swiper(".swiper-box-images-main", {
    spaceBetween: 0,
    thumbs: {
      swiper: swiperBoxImagesThumb,
    },
  });
}
// End Swiper Box Images

// Zoom Box Images Main
const boxImagesMain = document.querySelector(".box-images .inner-images-main");
if (boxImagesMain && window.Viewer) {
  new Viewer(boxImagesMain);
}
// End Zoom Box Images Main

// Box Tour Schedule
const boxTourSchedule = document.querySelector(".box-tour-schedule");
if (boxTourSchedule && window.Viewer) {
  new Viewer(boxTourSchedule);
}
// End Box Tour Schedule

// Newsletter
const emailForm = document.querySelector("#email-form");
if (emailForm) {
  emailForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = emailForm.querySelector('button[type="submit"]');
    if (button.disabled || !emailForm.reportValidity()) return;
    button.disabled = true;
    try {
      await travelRequest("/contact/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailForm.elements.email.value })
      });
      location.reload();
    } catch (error) {
      showTravelNotice(error.message || "Chưa nhận được kết quả đăng ký.", "error");
    } finally {
      button.disabled = false;
    }
  });
}

// Order Form
const orderForm = document.querySelector("#order-form");
if (orderForm) {
  const pendingKey = "vt.checkout.pending.v1";
  const feedback = orderForm.querySelector("[data-checkout-feedback]");
  const submitButton = orderForm.querySelector('button[type="submit"]');
  let submitting = false;
  const itemKey = item => JSON.stringify([
    item.tourId, item.locationFrom, item.quantityAdult, item.quantityChildren, item.quantityBaby
  ]);
  const readCart = () => JSON.parse(localStorage.getItem("cart") || "[]");

  function setBusy(value) {
    submitting = submitButton.disabled = value;
    orderForm.setAttribute("aria-busy", String(value));
  }

  function completeOrder(data, pending) {
    const booked = new Set(Array.isArray(data.bookedItems) ? data.bookedItems.map(itemKey) : pending.booked || []);
    localStorage.setItem("cart", JSON.stringify(readCart().filter(item => !booked.has(itemKey(item)))));
    sessionStorage.removeItem(pendingKey);
    const gateway = ["zalopay", "vnpay", "card"].includes(data.paymentMethod) &&
      data.paymentStatus === "unpaid" && data.orderStatus !== "cancel";
    const destination = gateway ? "payment-" + data.paymentMethod : "success";
    window.location.assign("/order/" + destination + "?orderId=" + encodeURIComponent(data.orderId));
  }

  async function checkoutSession() {
    const load = async () => {
      const response = await fetch("/order/checkout-session", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || data.code !== "success") throw new Error(data.message);
      return data;
    };
    const locks = window.navigator?.locks;
    return locks ? locks.request("vt.checkout.session", load) : load();
  }

  function readPending() {
    const value = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
    return typeof value?.intentId === "string" && typeof value.scopeTag === "string" ? value : null;
  }

  async function recoverOrder(pending) {
    feedback.textContent = "Đang kiểm tra kết quả lần đặt trước…";
    const response = await fetch("/order/checkout-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId: pending.intentId }), signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (response.ok && data.code === "success") {
      completeOrder(data, pending);
      return true;
    }
    if (["INTENT_CLOSED", "INTENT_EXPIRED_NOT_CREATED"].includes(data.errorCode)) sessionStorage.removeItem(pendingKey);
    feedback.textContent = data.errorCode === "INVALID_INTENT"
      ? "Phiên hiện tại chưa thể mở lần đặt trước. Hãy dùng cùng phiên khách hoặc đăng nhập bằng đúng thẻ đã dùng khi đặt. Nếu phiên khách đã hết hạn, hãy liên hệ hỗ trợ để đối soát."
      : data.message || "Chưa xác định được kết quả lần đặt trước.";
    return data.errorCode !== "ORDER_NOT_FOUND";
  }

  async function resumeCheckout() {
    if (submitting) return;
    try {
      const pending = readPending();
      if (!pending) return;
      setBusy(true);
      await recoverOrder(pending);
    } catch {
      feedback.textContent = "Chưa nhận được kết quả. Trang sẽ kiểm tra lại khi tải hoặc khi gửi tiếp lần đặt này.";
    } finally {
      setBusy(false);
    }
  }

  orderForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting) return;
    const phoneInput = orderForm.elements.phone;
    const phone = phoneInput.value.trim();
    if (!/^\+?[0-9 .()\-]+$/.test(phone) || phone.length > 25 || phone.replace(/\D/g, "").length < 7) {
      phoneInput.setCustomValidity("Số điện thoại không đúng định dạng.");
      phoneInput.reportValidity();
      return;
    }
    setBusy(true);
    let pending;
    try {
      pending = readPending();
      if (pending && await recoverOrder(pending)) return;
      const items = readCart().filter(item => item.checked && item.quantityAdult + item.quantityChildren + item.quantityBaby > 0)
        .map(({ tourId, locationFrom, quantityAdult, quantityChildren, quantityBaby }) =>
          ({ tourId, locationFrom, quantityAdult, quantityChildren, quantityBaby }));
      if (!items.length) {
        feedback.textContent = "Vui lòng chọn ít nhất một tour.";
        return;
      }
      if (!pending) {
        const checkout = await checkoutSession();
        pending = { intentId: checkout.intentId, scopeTag: checkout.scopeTag, booked: items.map(itemKey) };
      } else if (!pending.booked) {
        pending.booked = items.map(itemKey);
      }
      sessionStorage.setItem(pendingKey, JSON.stringify(pending));
      feedback.textContent = "Đang gửi đơn đặt tour…";
      const response = await fetch("/order/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          fullName: orderForm.elements.fullName.value, phone, note: orderForm.elements.note.value,
          paymentMethod: orderForm.elements.method.value, items, intentId: pending.intentId
        })
      });
      const data = await response.json();
      if (response.ok && data.code === "success") {
        completeOrder(data, { ...pending, booked: items.map(itemKey) });
        return;
      }
      if (["INTENT_CONFLICT", "INTENT_EXPIRED", "INTENT_CLOSED", "ORDER_CREATE_FAILED"].includes(data.errorCode)) {
        await recoverOrder(pending);
      } else if (data.errorCode === "INSUFFICIENT_BALANCE") {
        feedback.textContent = "";
        await showTravelNotice(data.message || "Hãy nạp thêm tiền hoặc chọn phương thức thanh toán khác.", "warning", {
          title: "Số dư ví không đủ", fallbackTarget: feedback
        });
      } else {
        feedback.textContent = data.message || "Không thể hoàn tất lần đặt tour này.";
        if (data.errorCode === "OUT_OF_STOCK") drawCart();
      }
    } catch {
      try {
        if (pending && await recoverOrder(pending)) return;
      } catch {
        // The same intent is kept for a later request.
      }
      feedback.textContent = "Chưa xác định được kết quả đặt tour. Tải lại trang hoặc gửi lại trong cùng phiên để tiếp tục.";
    } finally {
      setBusy(false);
    }
  });
  void resumeCheckout();
  window.addEventListener("pageshow", event => { if (event.persisted) void resumeCheckout(); });
  orderForm.elements.phone.addEventListener("input", event => event.target.setCustomValidity(""));

  // List Input Method
  const listInputMethod = orderForm.querySelectorAll("input[name='method']");
  const elementInfoBank = orderForm.querySelector(".inner-info-bank");

  listInputMethod.forEach(inputMethod => {
    inputMethod.addEventListener("change", () => {
      if (feedback.textContent.startsWith("Số dư ví không đủ.")) feedback.textContent = "";
      if (inputMethod.value == "bank") {
        elementInfoBank.classList.add("active");
      } else {
        elementInfoBank.classList.remove("active");
      }
    })
  })
  // End List Input Method
}
// End Order Form

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

// Box Filter
const boxFilter = document.querySelector(".box-filter");
if (boxFilter) {
  const url = new URL(`${window.location.origin}/search`);

  const buttonApply = boxFilter.querySelector(".inner-button");

  const filterList = [
    "locationFrom",
    "locationTo",
    "departureDate",
    "stockAdult",
    "stockChildren",
    "stockBaby",
    "price"
  ];

  buttonApply.addEventListener("click", () => {
    filterList.forEach(name => {
      const value = boxFilter.querySelector(`[name="${name}"]`).value;
      if (value) {
        url.searchParams.set(name, value);
      } else {
        url.searchParams.delete(name);
      }
    })

    window.location.href = url.href;
  })
}
// End Box Filter

// Form Search
const formSearch = document.querySelector("[form-search]");
if (formSearch) {
  const url = new URL(`${window.location.origin}/search`);

  formSearch.addEventListener("submit", (event) => {
    event.preventDefault();

    // Điểm đến
    const locationTo = formSearch.locationTo.value;
    if (locationTo) {
      url.searchParams.set("locationTo", locationTo);
    } else {
      url.searchParams.delete("locationTo");
    }

    // Số lượng
    const stockAdult = parseInt(formSearch.querySelector("[stock-adult]").innerHTML);
    if (stockAdult > 0) {
      url.searchParams.set("stockAdult", stockAdult);
    } else {
      url.searchParams.delete("stockAdult");
    }

    const stockChildren = parseInt(formSearch.querySelector("[stock-children]").innerHTML);
    if (stockChildren > 0) {
      url.searchParams.set("stockChildren", stockChildren);
    } else {
      url.searchParams.delete("stockChildren");
    }

    const stockBaby = parseInt(formSearch.querySelector("[stock-baby]").innerHTML);
    if (stockBaby > 0) {
      url.searchParams.set("stockBaby", stockBaby);
    } else {
      url.searchParams.delete("stockBaby");
    }

    // Ngày khởi hành
    const departureDate = formSearch.departureDate.value;
    if (departureDate) {
      url.searchParams.set("departureDate", departureDate);
    } else {
      url.searchParams.delete("departureDate");
    }

    window.location.href = url.href;
  })
}
// End Form Search

const readPassengerQuantity = (value, maximum) => {
  const raw = String(value).trim();
  const limit = Number(maximum);

  if (!/^\d+$/.test(raw)) return null;

  const quantity = Number(raw);

  if (
    !Number.isSafeInteger(quantity) ||
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    quantity > limit
  ) {
    return null;
  }

  return quantity;
};
// End Validation số lượng hành khách

// Box Tour Detail
const boxTourDetail = document.querySelector(".box-tour-detail");
if (boxTourDetail) {
  // Bước 1
  const inputStockAdult = document.querySelector("[input-stock-adult]");
  const inputStockChildren = document.querySelector("[input-stock-children]");
  const inputStockBaby = document.querySelector("[input-stock-baby]");

  // Bước 3
  const drawBoxDetail = () => {
    const quantityAdult = readPassengerQuantity(
      inputStockAdult.value, inputStockAdult.max
    );
    const quantityChildren = readPassengerQuantity(
      inputStockChildren.value, inputStockChildren.max
    );
    const quantityBaby = readPassengerQuantity(
      inputStockBaby.value, inputStockBaby.max
    );

    if ([quantityAdult, quantityChildren, quantityBaby].includes(null)) {
      return;
    }

    const stockAdult = document.querySelector("[stock-adult]");
    const stockChildren = document.querySelector("[stock-children]");
    const stockBaby = document.querySelector("[stock-baby]");

    stockAdult.innerHTML = quantityAdult;
    stockChildren.innerHTML = quantityChildren;
    stockBaby.innerHTML = quantityBaby;

    const priceAdult = parseInt(inputStockAdult.getAttribute("price"));
    const priceChildren = parseInt(inputStockChildren.getAttribute("price"));
    const priceBaby = parseInt(inputStockBaby.getAttribute("price"));
    const totalPrice = (quantityAdult * priceAdult) + (quantityChildren * priceChildren) + (quantityBaby * priceBaby);
    const elementTotalPrice = document.querySelector("[total-price]");
    elementTotalPrice.innerHTML = totalPrice.toLocaleString("vi-VN");
  }

  // Bước 2

  const passengerInputs = [
    inputStockAdult,
    inputStockChildren,
    inputStockBaby
  ];

  passengerInputs.forEach(input => {
    input.dataset.lastValid =
      readPassengerQuantity(input.value, input.max) ?? 0;

    input.addEventListener("change", () => {
      const quantity = readPassengerQuantity(
        input.value,
        input.max
      );

      if (quantity === null) {
        showTravelNotice(
          `Số khách không hợp lệ. ` +
          `Số chỗ còn tối đa: ${input.max}`
        );

        input.value = input.dataset.lastValid;
      } else {
        input.dataset.lastValid = quantity;
      }

      drawBoxDetail();
    });
  });


  // Bước 4
  const buttonAddToCart = boxTourDetail.querySelector(".inner-button-add-cart");
  buttonAddToCart.addEventListener("click", () => {
    const tourId = buttonAddToCart.getAttribute("tour-id");

    const quantityAdult = readPassengerQuantity(
      inputStockAdult.value, inputStockAdult.max
    );
    const quantityChildren = readPassengerQuantity(
      inputStockChildren.value, inputStockChildren.max
    );
    const quantityBaby = readPassengerQuantity(
      inputStockBaby.value, inputStockBaby.max
    );

    if ([quantityAdult, quantityChildren, quantityBaby].includes(null)) {
      showTravelNotice("Số lượng hành khách không hợp lệ hoặc vượt số chỗ còn lại!");
      return;
    }

    if (quantityAdult + quantityChildren + quantityBaby === 0) {
      showTravelNotice("Vui lòng chọn ít nhất một hành khách!");
      return;
    }

    const locationFrom = boxTourDetail.querySelector("[location-from]").value;

    if (quantityAdult > 0 || quantityChildren > 0 || quantityBaby > 0) {
      const cartItem = {
        tourId: tourId,
        quantityAdult: quantityAdult,
        quantityChildren: quantityChildren,
        quantityBaby: quantityBaby,
        locationFrom: locationFrom,
        checked: true
      };

      const cart = JSON.parse(localStorage.getItem("cart"));

      const indexItemExist = cart.findIndex(item => item.tourId == tourId);
      if (indexItemExist != -1) {
        cart[indexItemExist] = cartItem;
      } else {
        cart.push(cartItem);
      }

      localStorage.setItem("cart", JSON.stringify(cart));
      window.location.href = "/cart";
    }
  })
}
// End Box Tour Detail

// Initial Cart
const cart = localStorage.getItem("cart");
if (!cart) {
  localStorage.setItem("cart", JSON.stringify([]));
}
// End Initial Cart

// Mini Cart
const miniCart = document.querySelector("[mini-cart]");
if (miniCart) {
  const cart = JSON.parse(localStorage.getItem("cart"));
  miniCart.innerHTML = cart.length;
}
// End Mini Cart

// Page Cart
const drawCart = () => {
  const cart = localStorage.getItem("cart");

  fetch(`/cart/detail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: cart
  })
    .then(res => res.json())
    .then(data => {
      if (localStorage.getItem("cart") !== cart) return;
      if (data.code == "success") {
        // Hiển thị các item
        const htmlCart = data.cart.map(item => `
          <div class="inner-tour-item">
            <div class="inner-actions">
              <button class="inner-delete" button-delete tour-id="${item.tourId}" aria-label="Bỏ tour khỏi giỏ">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
              <input 
                class="inner-check" 
                type="checkbox" aria-label="Chọn tour để đặt" ${item.checked ? 'checked' : ''}
                input-check
                tour-id="${item.tourId}"
              >
            </div>
            <div class="inner-product">
              <div class="inner-image">
                <a href="/tour/detail/${item.slug}">
                  <img alt="" src="${item.avatar}">
                </a>
              </div>
              <div class="inner-content">
                <div class="inner-title">
                  <a href="/tour/detail/${item.slug}">
                    ${item.name}
                  </a>
                </div>
                <div class="inner-meta">
                  <div class="inner-meta-item">Ngày Khởi Hành: <b>${item.departureDateFormat}</b>
                  </div>
                  <div class="inner-meta-item">Khởi Hành Tại: <b>${item.locationFromName}</b>
                  </div>
                  <div class="inner-meta-item">
                    Chỗ còn hiện tại:
                    <b>
                      Người lớn ${item.stockAdult},
                      Trẻ em ${item.stockChildren},
                      Em bé ${item.stockBaby}
                    </b>
                  </div>

                  ${item.quantityAdult > item.stockAdult ||
            item.quantityChildren > item.stockChildren ||
            item.quantityBaby > item.stockBaby
            ? `<div style="color:#dc2626;font-weight:600">
                          Số khách đã chọn vượt số chỗ còn lại.
                          Vui lòng điều chỉnh số lượng.
                        </div>`
            : ""}
                </div>
              </div>
            </div>
            <div class="inner-quantity">
              <label class="inner-label">Số Lượng Hành Khách</label>
              <div class="inner-list">
                <div class="inner-item">
                  <div class="inner-item-label">Người lớn:</div>
                  <div class="inner-item-input">
                    <input 
                      value="${item.quantityAdult}" 
                      min="0"
                      max="${item.stockAdult}" step="1"
                      type="number"
                      input-quantity="quantityAdult"
                      tour-id="${item.tourId}"
                    >
                  </div>
                  <div class="inner-item-price">
                    <span>${item.quantityAdult}</span>
                    <span>x</span>
                    <span class="inner-highlight">
                      ${item.priceNewAdult.toLocaleString("vi-VN")}
                    </span>
                  </div>
                </div>
                <div class="inner-item">
                  <div class="inner-item-label">Trẻ em:</div>
                  <div class="inner-item-input">
                    <input 
                      value="${item.quantityChildren}" 
                      min="0"
                      max="${item.stockChildren}" step="1"
                      type="number"
                      input-quantity="quantityChildren"
                      tour-id="${item.tourId}"
                    >
                  </div>
                  <div class="inner-item-price">
                    <span>${item.quantityChildren}</span>
                    <span>x</span>
                    <span class="inner-highlight">
                      ${item.priceNewChildren.toLocaleString("vi-VN")}
                    </span>
                  </div>
                </div>
                <div class="inner-item">
                  <div class="inner-item-label">Em bé:</div>
                  <div class="inner-item-input">
                    <input 
                      value="${item.quantityBaby}" 
                      min="0"
                      max="${item.stockBaby}" step="1"
                      type="number"
                      input-quantity="quantityBaby"
                      tour-id="${item.tourId}"
                    >
                  </div>
                  <div class="inner-item-price">
                    <span>${item.quantityBaby}</span>
                    <span>x</span>
                    <span class="inner-highlight">
                      ${item.priceNewBaby.toLocaleString("vi-VN")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `);

        const cartList = document.querySelector("[cart-list]");
        cartList.innerHTML = htmlCart.join("");
        // Hết Hiển thị các item

        // Cập nhật lại giỏ hàng
        localStorage.setItem("cart", JSON.stringify(data.cart));
        miniCart.innerHTML = data.cart.length;
        // Hết Cập nhật lại giỏ hàng

        // Tính tổng tiền
        const subTotalPrice = data.cart.reduce((sum, item) => {
          if (item.checked) {
            return sum + ((item.priceNewAdult * item.quantityAdult) + (item.priceNewChildren * item.quantityChildren) + (item.priceNewBaby * item.quantityBaby));
          } else {
            return sum;
          }
        }, 0);
        // Giảm theo hạng thành viên (máy chủ vẫn tính lại khi tạo đơn)
        const discountPercent = parseInt(document.querySelector("[page-cart]")?.getAttribute("data-discount-percent")) || 0;
        const discount = Math.round(subTotalPrice * discountPercent / 100);
        const totalPrice = subTotalPrice - discount;

        const cartSubTotal = document.querySelector("[cart-sub-total]");
        cartSubTotal.innerHTML = subTotalPrice.toLocaleString("vi-VN");

        const cartTotal = document.querySelector("[cart-total]");
        cartTotal.innerHTML = totalPrice.toLocaleString("vi-VN");

        const cartDiscount = document.querySelector("[cart-discount]");
        if (cartDiscount) cartDiscount.innerHTML = discount.toLocaleString("vi-VN");
        // Hết Tính tổng tiền

        // Sự kiện cập nhật số lượng
        const listInputQuantity = document.querySelectorAll(
          "[input-quantity]"
        );

        listInputQuantity.forEach(input => {
          input.addEventListener("change", () => {
            const tourId = input.getAttribute("tour-id");
            const name = input.getAttribute("input-quantity");

            const quantity = readPassengerQuantity(
              input.value,
              input.max
            );

            if (quantity === null) {
              showTravelNotice(
                `Số lượng không hợp lệ hoặc vượt tồn kho. ` +
                `Tối đa: ${input.max} chỗ.`
              );
              drawCart();
              return;
            }

            const cart = JSON.parse(
              localStorage.getItem("cart") || "[]"
            );

            const itemUpdate = cart.find(
              item => item.tourId === tourId
            );

            if (!itemUpdate) {
              drawCart();
              return;
            }

            const updated = {
              ...itemUpdate,
              [name]: quantity
            };

            const totalPassengers =
              updated.quantityAdult +
              updated.quantityChildren +
              updated.quantityBaby;

            if (totalPassengers === 0) {
              showTravelNotice("Mỗi tour phải có ít nhất một hành khách!");
              drawCart();
              return;
            }

            itemUpdate[name] = quantity;

            localStorage.setItem(
              "cart",
              JSON.stringify(cart)
            );

            drawCart();
          });
        });
        // Hết Sự kiện cập nhật số lượng

        // Sự kiện xóa item
        const listButtonDelete = document.querySelectorAll("[button-delete]");
        listButtonDelete.forEach(button => {
          button.addEventListener("click", async () => {
            const tourId = button.getAttribute("tour-id");
            if (button.disabled) return;
            button.disabled = true;
            try {
              if (!await confirmTravelAction({
                title: "Bỏ tour khỏi giỏ?",
                message: "Bạn có thể thêm lại tour từ trang chi tiết.",
                confirmText: "Bỏ tour"
              })) return;
              const cart = JSON.parse(localStorage.getItem("cart") || "[]");
              localStorage.setItem("cart", JSON.stringify(cart.filter(tour => tour.tourId !== tourId)));
              drawCart();
            } catch {
              showTravelNotice("Không thể cập nhật giỏ hàng.", "error");
            } finally {
              button.disabled = false;
            }
          })
        })
        // Hết Sự kiện xóa item

        // Sự kiện check item
        const listInputCheck = document.querySelectorAll("[input-check]");
        listInputCheck.forEach(input => {
          input.addEventListener("change", () => {
            const checked = input.checked;
            const tourId = input.getAttribute("tour-id");

            const cart = JSON.parse(localStorage.getItem("cart"));
            const itemUpdate = cart.find(item => item.tourId == tourId);
            itemUpdate.checked = checked;
            localStorage.setItem("cart", JSON.stringify(cart));
            drawCart();
          })
        })
        // Hết Sự kiện check item
      }
    })
}

const pageCart = document.querySelector("[page-cart]");
if (pageCart) {
  drawCart();
}
// End Page Cart


// Sắp xếp và phân trang tour
const tourListPage = document.querySelector(".section-9");

if (tourListPage) {
  const navigate = (key, value) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);

    if (key === "sort") {
      url.searchParams.set("page", "1");
    }

    window.location.href = url.toString();
  };

  tourListPage.querySelectorAll("[data-sort]")
    .forEach(button => {
      button.addEventListener("click", () => {
        navigate("sort", button.dataset.sort);
      });
    });

  tourListPage.querySelectorAll("[data-page]")
    .forEach(button => {
      button.addEventListener("click", () => {
        navigate("page", button.dataset.page);
      });
    });
}
