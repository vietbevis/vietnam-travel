function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
}

function requireObjectId(req, res, next) {
  if (/^[a-f0-9]{24}$/i.test(req.params.id || '')) return next();
  const message = 'Mã bản ghi không hợp lệ!';
  if (req.method === 'GET' && req.accepts(['html', 'json']) === 'html') {
    return res.status(400).send(message);
  }
  return res.status(400).json({ code: 'error', message });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const tooLarge = error.type === 'entity.too.large' || error.code === 'LIMIT_FILE_SIZE';
  const unsupported = ['charset.unsupported', 'encoding.unsupported'].includes(error.type);
  const invalid = ['entity.parse.failed', 'request.aborted', 'request.size.invalid'].includes(error.type) ||
    error.name === 'CastError' || error.name === 'ValidationError' || error.name === 'MulterError';
  const status = tooLarge ? 413 : unsupported ? 415 : invalid ? 400 : 500;
  const message = tooLarge ? 'Dữ liệu gửi lên vượt quá dung lượng cho phép.' :
    unsupported ? 'Định dạng nội dung không được hỗ trợ.' :
      invalid ? 'Dữ liệu yêu cầu không hợp lệ.' : 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
  if (status === 500) console.error('Không thể xử lý yêu cầu HTTP.', req.method);
  if (req.method === 'GET' && req.accepts(['html', 'json']) === 'html') return res.status(status).send(message);
  return res.status(status).json({ code: 'error', message });
}

module.exports = { asyncRoute, requireObjectId, errorHandler };
