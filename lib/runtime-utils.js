function parseHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function isSameOrigin(value, expectedValue) {
  const candidate = parseHttpUrl(value);
  const expected = parseHttpUrl(expectedValue);
  return Boolean(candidate && expected && candidate.origin === expected.origin);
}

function findLocalUrl(line, fixedPort = 0) {
  const matches = line.match(/https?:\/\/[^\s"'<>]+/g) || [];
  for (const value of matches) {
    const parsed = parseHttpUrl(value);
    if (!parsed || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) continue;
    if (fixedPort && Number(parsed.port) !== fixedPort) continue;
    return parsed;
  }
  return null;
}

function consumeLines(previous, chunk) {
  const parts = `${previous}${chunk}`.split(/\r?\n/);
  return { lines: parts.slice(0, -1), remainder: parts.at(-1).slice(-4000) };
}

module.exports = { consumeLines, findLocalUrl, isSameOrigin, parseHttpUrl };
