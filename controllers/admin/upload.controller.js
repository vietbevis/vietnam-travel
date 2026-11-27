module.exports.imagePost = async (req, res) => {
  if (!req.file) return res.status(400).json({ code: 'error', message: 'Vui lòng chọn ảnh.' });
  res.json({
    code: 'success',
    location: req.file.path
  })
}
