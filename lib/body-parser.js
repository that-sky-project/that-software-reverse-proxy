const { parseBodyType, parseBodyData } = require('./utils');

function createBodyCapture(maxCaptureBytes) {
  const limit = Number.isFinite(maxCaptureBytes) ? Math.max(0, Math.floor(maxCaptureBytes)) : 0;

  let totalBytes = 0;
  let capturedBytes = 0;
  let truncated = false;
  const chunks = [];

  return {
    push(chunk) {
      if (!chunk || chunk.length === 0) return;
      totalBytes += chunk.length;

      if (capturedBytes >= limit) {
        truncated = true;
        return;
      }

      const remaining = limit - capturedBytes;
      if (chunk.length <= remaining) {
        chunks.push(chunk);
        capturedBytes += chunk.length;
        return;
      }

      chunks.push(chunk.subarray(0, remaining));
      capturedBytes += remaining;
      truncated = true;
    },

    summary(contentType) {
      if (totalBytes === 0) {
        return {
          type: 'empty',
          data: null,
          size: 0,
          logged_size: 0,
          truncated: false,
          omitted_size: 0,
        };
      }

      const capturedBuffer = capturedBytes > 0 ? Buffer.concat(chunks, capturedBytes) : Buffer.alloc(0);
      const bodyType = parseBodyType(contentType);
      const parsed = parseBodyData(bodyType, capturedBuffer);

      const omittedSize = Math.max(0, totalBytes - capturedBytes);
      return {
        type: parsed.type,
        data: parsed.data,
        size: totalBytes,
        logged_size: capturedBytes,
        truncated: truncated || omittedSize > 0,
        omitted_size: omittedSize,
      };
    },
  };
}

module.exports = {
  createBodyCapture,
};
