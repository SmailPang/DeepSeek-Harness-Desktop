const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, consumeLines, findLocalUrl, isSameOrigin, parseHttpUrl } = require('../lib/runtime-utils');

test('origin comparison does not accept a port-prefix lookalike', () => {
  assert.equal(isSameOrigin('http://127.0.0.1:12345/path', 'http://127.0.0.1:1234'), false);
  assert.equal(isSameOrigin('http://127.0.0.1:1234/other', 'http://127.0.0.1:1234/token'), true);
});

test('only HTTP(S) URLs are accepted', () => {
  assert.equal(parseHttpUrl('file:///C:/Windows/System32/calc.exe'), null);
  assert.equal(parseHttpUrl('javascript:alert(1)'), null);
});

test('local service URL selection ignores unrelated and wrong-port URLs', () => {
  const value = findLocalUrl('Docs https://example.com then http://127.0.0.1:4321/?token=ok', 4321);
  assert.equal(value.href, 'http://127.0.0.1:4321/?token=ok');
  assert.equal(findLocalUrl('http://127.0.0.1:43210/?token=bad', 4321), null);
});

test('split process output is reassembled before URL parsing', () => {
  const first = consumeLines('', 'Ready at http://127.0.0.1:4321/?tok');
  assert.deepEqual(first.lines, []);
  const second = consumeLines(first.remainder, 'en=ok\n');
  assert.equal(findLocalUrl(second.lines[0], 4321).searchParams.get('token'), 'ok');
});

test('release versions are compared numerically', () => {
  assert.equal(compareVersions('v1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.5.0', 'v1.5.0'), 0);
  assert.equal(compareVersions('1.4.9', '1.5.0'), -1);
  assert.equal(compareVersions('0.1.5-rc.2', '0.1.5-rc.1'), 1);
  assert.equal(compareVersions('0.1.5', '0.1.5-rc.2'), 1);
});
