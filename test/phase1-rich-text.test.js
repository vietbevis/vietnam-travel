const assert = require('node:assert/strict');
const test = require('node:test');
const { sanitizeTourHtml } = require('../helpers/tour-rich-text.helper');

test('tour content keeps safe text formatting, links, photos and tables', () => {
  const result = sanitizeTourHtml('<p style="text-align: center"><strong>Fixture</strong><a href="/category/sample">Link</a></p><img src="https://example.com/photo.png" alt="Fixture"><table><tr><td colspan="2">Tour</td></tr></table>');
  assert.match(result, /style="text-align: center"/);
  assert.match(result, /<strong>Fixture<\/strong>/);
  assert.match(result, /href="\/category\/sample"/);
  assert.match(result, /src="https:\/\/example\.com\/photo\.png"/);
  assert.match(result, /<td colspan="2">Tour<\/td>/);
  assert.equal(sanitizeTourHtml(result), result);
});

test('tour content removes unsupported markup, unsafe URL schemes and unsupported attributes', () => {
  const result = sanitizeTourHtml('<p id="fixture">Offer</p><form action="/fixture"><input></form><svg></svg><a href="ftp://example.com/download" target="preview">Download</a>');
  assert.equal(result, '<p>Offer</p><a>Download</a>');
});
