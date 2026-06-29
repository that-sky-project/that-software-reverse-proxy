const crypto = require('crypto');
const fs = require('fs/promises');

function sanitizePathSegment(value, fallback = 'unknown') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim().replace(/[\\/]+/g, '_');
  const cleaned = normalized.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned || fallback;
}

function getPathSlug(urlPath) {
  if (!urlPath || urlPath === '/') {
    return 'root';
  }
  let slug = urlPath
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\//g, '_');
  slug = slug.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return slug || 'root';
}

function getTimestampFilename(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const parts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '_',
    pad(date.getMilliseconds(), 3),
  ];
  return parts.join('');
}

function createRequestId() {
  const now = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `${now}-${rand}`;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
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

function tryParseJson(text) {
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
      const parsed = tryParseJson(text);
      if (parsed !== null) return { type: 'json', data: parsed, size };
      return { type: 'text', data: text, size };
    }
    case 'text':
    case 'xml': {
      const parsed = tryParseJson(text);
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

function buildRequestFilename(urlPath, requestId = '') {
  const slug = getPathSlug(urlPath);
  const ts = getTimestampFilename();
  const rid = sanitizePathSegment(requestId, 'rid');
  return `request_${slug}_${ts}_${rid}.json`;
}

module.exports = {
  sanitizePathSegment,
  getPathSlug,
  getTimestampFilename,
  createRequestId,
  ensureDir,
  parseBodyType,
  parseBodyData,
  buildRequestFilename,
};
