const { hasPermission } = require('../../config/permission');

function requirePermission(permission, message = 'Không có quyền sử dụng tính năng này!') {
  return (req, res, next) => {
    if ([permission].flat().some(value => hasPermission(req.permissions, value))) return next();
    if (req.method !== 'GET' || req.accepts(['html', 'json']) === 'json') {
      return res.status(403).json({ code: 'error', message });
    }
    return res.status(403).render('admin/pages/no-permission', { pageTitle: 'Không có quyền truy cập', message });
  };
}

module.exports = { requirePermission };
