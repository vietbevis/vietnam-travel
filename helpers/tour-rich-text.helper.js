const parse5 = require('parse5');

const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const tags = new Set([
  'p','br','hr','div','span','strong','b','em','i','u','s','del','sub','sup','blockquote','pre','code',
  'h1','h2','h3','h4','h5','h6','ul','ol','li','a','img','figure','figcaption',
  'table','caption','colgroup','col','thead','tbody','tfoot','tr','th','td'
]);
const dimensions = new Set(['width','height','colspan','rowspan','span','start']);

function safeUrl(value, image) {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (!image && value.startsWith('#')) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ||
      (!image && url.protocol === 'mailto:' && !url.search);
  } catch {
    return false;
  }
}

function safeStyle(value) {
  return value.split(';').map(rule => rule.trim()).filter(rule =>
    /^text-align\s*:\s*(?:left|center|right|justify)$/i.test(rule) ||
    /^(?:width|height)\s*:\s*[1-9]\d{0,3}(?:px|%)$/i.test(rule) ||
    /^(?:color|background-color)\s*:\s*(?:#[\da-f]{3,8}|[a-z]{3,16})$/i.test(rule)
  ).join('; ');
}

function cleanAttributes(tag, attrs) {
  const allowed = [];
  for (const { name, value } of attrs) {
    if ((tag === 'a' && name === 'href' && safeUrl(value, false)) ||
        (tag === 'img' && name === 'src' && safeUrl(value, true)) ||
        name === 'title' || (tag === 'img' && name === 'alt') ||
        (dimensions.has(name) && /^[1-9]\d{0,3}%?$/.test(value)) ||
        (tag === 'th' && name === 'scope' && ['row', 'col', 'rowgroup', 'colgroup'].includes(value))) {
      allowed.push({ name, value });
    } else if (name === 'style') {
      const style = safeStyle(value);
      if (style) allowed.push({ name, value: style });
    }
  }
  return allowed;
}

function sanitizeChildren(parent, depth = 0) {
  if (depth >= 64) {
    parent.childNodes = [];
    return;
  }
  parent.childNodes = parent.childNodes.filter(node => node.nodeName === '#text' ||
    (node.namespaceURI === htmlNamespace && tags.has(node.tagName)));
  for (const node of parent.childNodes) {
    if (node.nodeName === '#text') continue;
    node.attrs = cleanAttributes(node.tagName, node.attrs);
    sanitizeChildren(node, depth + 1);
  }
}

function sanitizeTourHtml(value) {
  if (typeof value !== 'string' || value === '') return '';
  const fragment = parse5.parseFragment(value);
  sanitizeChildren(fragment);
  return parse5.serialize(fragment);
}

module.exports = { sanitizeTourHtml };
