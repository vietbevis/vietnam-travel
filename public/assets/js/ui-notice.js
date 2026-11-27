(function (root) {
  const color = () => document.querySelector('.sider') ? '#2b5ac6' : '#4502c7';

  root.showTravelNotice = function (message, icon = 'warning', { title, fallbackTarget } = {}) {
    if (typeof root.Swal?.fire === 'function') {
      return root.Swal.fire({
        icon,
        titleText: title || { error: 'Chưa thực hiện được', success: 'Thành công' }[icon] || 'Thông báo',
        text: message,
        confirmButtonText: 'Đã hiểu',
        confirmButtonColor: color(),
        heightAuto: false
      });
    }
    const fallback = title ? title + '. ' + message : message;
    if (fallbackTarget) {
      fallbackTarget.textContent = fallback;
      return;
    }
    let notice = document.querySelector('[data-travel-notice]');
    if (!notice) {
      notice = document.createElement('p');
      notice.dataset.travelNotice = '';
      notice.className = 'travel-inline-notice';
      notice.setAttribute('role', 'alert');
      document.body.append(notice);
    }
    notice.textContent = fallback;
  };

  root.confirmTravelAction = async function ({ title, message, confirmText = 'Xác nhận', destructive = true }) {
    if (!root.Swal) {
      root.showTravelNotice('Hộp xác nhận chưa tải được. Hãy tải lại trang rồi thử lại.');
      return false;
    }
    const result = await root.Swal.fire({
      icon: destructive ? 'warning' : 'question',
      titleText: title,
      text: message,
      showCancelButton: true,
      confirmButtonText: confirmText,
      cancelButtonText: 'Quay lại',
      confirmButtonColor: destructive ? '#b42318' : color(),
      focusCancel: true,
      heightAuto: false
    });
    return result.isConfirmed === true;
  };

  root.travelRequest = async function (url, options = {}) {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', ...options.headers }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.code !== 'success') {
      const fallback = {
        400: 'Thông tin gửi lên chưa hợp lệ.',
        401: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
        403: 'Bạn không có quyền thực hiện thao tác này.',
        404: 'Không tìm thấy bản ghi.',
        409: 'Dữ liệu đã thay đổi. Hãy tải lại trang để kiểm tra.',
        422: 'Không thể xử lý dữ liệu đã nhập.',
        429: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.'
      };
      throw new Error(data?.message || fallback[response.status] ||
        'Chưa nhận được kết quả xác nhận. Hãy kiểm tra trạng thái trước khi thử lại.');
    }
    return data;
  };
}(window));
