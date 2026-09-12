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

function compareVersions(left, right) {
  const parse = (value) => {
    const [core, prerelease = ''] = String(value).replace(/^v/i, '').split('-', 2);
    return {
      core: core.split('.').map((part) => Number(part) || 0),
      prerelease: prerelease ? prerelease.split('.') : []
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index += 1) {
    const difference = (a.core[index] || 0) - (b.core[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

module.exports = { compareVersions, consumeLines, findLocalUrl, isSameOrigin, parseHttpUrl };
