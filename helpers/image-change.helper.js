const Joi = require('joi');

const change = Joi.object({
  before: Joi.string().max(4096).allow('').required(),
  clear: Joi.boolean().strict().required()
}).required().unknown(false);

function parseImageChanges(raw, names) {
  if (raw === undefined) return {};
  if (typeof raw !== 'string' || raw.length > 16000) return null;
  try {
    const schema = Joi.object(Object.fromEntries(names.map(name => [name, change.optional()]))).required().unknown(false);
    const { value, error } = schema.validate(JSON.parse(raw));
    return error ? null : value;
  } catch {
    return null;
  }
}

function applyImageChange({ name, changes, file, current, filter, update }) {
  const intent = changes[name];
  if (!file && !intent?.clear) return true;
  const previous = current?.[name] || '';
  if (intent && (intent.before !== previous || (intent.clear && file))) return false;
  filter[name] = previous || { $in: ['', null] };
  update[name] = file ? file.path : '';
  return true;
}

module.exports = { parseImageChanges, applyImageChange };
