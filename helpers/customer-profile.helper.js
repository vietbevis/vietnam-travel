const { createHash } = require('node:crypto');

const chipEditableFields = ['phone', 'gender', 'emergencyName', 'emergencyPhone'];
const contactRevision = customer => createHash('sha256')
  .update(JSON.stringify(chipEditableFields.map(field => customer[field] || '')))
  .digest('hex');

module.exports = { chipEditableFields, contactRevision };
