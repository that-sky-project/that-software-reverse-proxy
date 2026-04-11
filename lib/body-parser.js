const { parseBodyType, parseBodyData } = require('./utils');

function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function parseRequestBody(req) {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (req.method === 'GET' || req.method === 'HEAD' || contentLength === 0) {
    return { type: 'empty', data: null, size: 0, _raw: null };
  }
  const raw = await collectStream(req);
  if (raw.length === 0) {
    return { type: 'empty', data: null, size: 0, _raw: null };
  }
  const bodyType = parseBodyType(req.headers['content-type']);
  const parsed = parseBodyData(bodyType, raw);
  parsed._raw = raw;
  return parsed;
}

function parseResponseBody(headers, rawBuffer) {
  if (!rawBuffer || rawBuffer.length === 0) {
    return { type: 'empty', data: null, size: 0 };
  }
  const bodyType = parseBodyType(headers['content-type']);
  return parseBodyData(bodyType, rawBuffer);
}

module.exports = {
  collectStream,
  parseRequestBody,
  parseResponseBody,
};
