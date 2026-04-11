const fs = require('fs/promises');
const path = require('path');

function getPathSlug(urlPath) {
  if (!urlPath || urlPath === '/') {
    return 'root';
  }
  let slug = urlPath
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\//g, '_');
  slug = slug.replace(/[^a-zA-Z0-9_\-]/g, '');
  return slug || 'root';
}

function getTimestampFilename() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const parts = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    '_',
    pad(now.getMilliseconds(), 6),
  ];
  return parts.join('');
}

async function ensureDir(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

function parseBodyType(contentType) {
  if (!contentType) return 'empty';
  const ct = contentType.toLowerCase();
  if (ct.includes('application/json')) return 'json';
  if (ct.includes('text/')) return 'text';
  if (ct.includes('application/x-www-form-urlencoded')) return 'form';
  if (ct.includes('multipart/form-data')) return 'multipart';
  if (ct.includes('application/xml') || ct.includes('text/xml')) return 'xml';
  return 'binary';
}

function _tryParseJson(text) {
  const trimmed = text.trim();
  if (trimmed.length > 0 && (trimmed[0] === '{' || trimmed[0] === '[')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }
  return null;
}

function parseBodyData(bodyType, rawBuffer) {
  if (!rawBuffer || rawBuffer.length === 0) {
    return { type: 'empty', data: null, size: 0 };
  }
  const size = rawBuffer.length;
  const text = rawBuffer.toString('utf-8');
  switch (bodyType) {
    case 'json': {
      const parsed = _tryParseJson(text);
      if (parsed !== null) return { type: 'json', data: parsed, size };
      return { type: 'text', data: text, size };
    }
    case 'text':
    case 'xml': {
      const parsed = _tryParseJson(text);
      if (parsed !== null) return { type: 'json', data: parsed, size };
      return { type: 'text', data: text, size };
    }
    case 'form':
      return { type: 'form', data: text, size };
    case 'multipart':
      return { type: 'multipart', data: text, size };
    default:
      return { type: 'binary', data: rawBuffer.toString('base64'), size };
  }
}

function buildRequestFilename(urlPath) {
  const slug = getPathSlug(urlPath);
  const ts = getTimestampFilename();
  return `request_${slug}_${ts}.json`;
}

module.exports = {
  getPathSlug,
  getTimestampFilename,
  ensureDir,
  parseBodyType,
  parseBodyData,
  buildRequestFilename,
};
