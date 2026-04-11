const http = require('http');
const https = require('https');
const { URL } = require('url');
const { parseRequestBody, parseResponseBody, collectStream } = require('./body-parser');
const Logger = require('./logger');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

class ProxyHandler {
  constructor(config) {
    this.logger = new Logger(config.logging || {});
  }

  async handle(req, res, site) {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    const clientIp = req.socket.remoteAddress || 'unknown';

    let requestBody;
    try {
      requestBody = await parseRequestBody(req);
    } catch (err) {
      requestBody = { type: 'error', data: err.message, size: 0 };
    }

    const targetUrl = new URL(site.target);
    const isHttps = targetUrl.protocol === 'https:';

    const reqPath = req.url || '/';
    const outgoingPath = reqPath;

    const outgoingHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower === 'host') {
        if (site.preserveHost) {
          outgoingHeaders['host'] = targetUrl.host;
        } else {
          outgoingHeaders['host'] = value;
        }
        continue;
      }
      outgoingHeaders[key] = value;
    }

    if (!outgoingHeaders['host']) {
      outgoingHeaders['host'] = targetUrl.host;
    }

    const proxyOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: outgoingPath,
      method: req.method,
      headers: outgoingHeaders,
      rejectUnauthorized: false,
    };

    const transport = isHttps ? https : http;

    try {
      const { statusCode, statusMessage, responseHeaders, responseBody } =
        await this._forwardRequest(transport, proxyOptions, req, requestBody);

      const logData = this._buildLogEntry({
        timestamp,
        clientIp,
        req,
        requestBody,
        statusCode,
        statusMessage,
        responseHeaders,
        responseBody,
      });

      if (site.logging !== false) {
        this.logger.logRequest(site.name, logData).catch((err) => {
          console.error(`[proxy] log write failed for ${site.name}:`, err.message);
        });
      }

      for (const [key, value] of Object.entries(responseHeaders)) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lower)) continue;
        try {
          res.setHeader(key, value);
        } catch {}
      }
      res.writeHead(statusCode || 502, statusMessage || 'Bad Gateway');
      res.end(responseBody);
    } catch (err) {
      console.error(`[proxy] forward error for ${site.name}:`, err.message);

      const logData = this._buildLogEntry({
        timestamp,
        clientIp,
        req,
        requestBody,
        statusCode: 502,
        statusMessage: 'Bad Gateway',
        responseHeaders: {},
        responseBody: Buffer.from(err.message || 'Upstream error'),
      });

      if (site.logging !== false) {
        this.logger.logRequest(site.name, logData).catch(() => {});
      }

      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway: upstream request failed');
    }
  }

  _forwardRequest(transport, options, originalReq, requestBody) {
    return new Promise((resolve, reject) => {
      const proxyReq = transport.request(options, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const responseBody = Buffer.concat(chunks);
          resolve({
            statusCode: proxyRes.statusCode,
            statusMessage: proxyRes.statusMessage,
            responseHeaders: proxyRes.headers,
            responseBody,
          });
        });
        proxyRes.on('error', reject);
      });

      proxyReq.on('error', reject);
      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        reject(new Error('Upstream request timeout'));
      });

      if (
        requestBody &&
        requestBody.type !== 'empty' &&
        originalReq.method !== 'GET' &&
        originalReq.method !== 'HEAD'
      ) {
        if (Buffer.isBuffer(requestBody._raw)) {
          proxyReq.end(requestBody._raw);
        } else {
          proxyReq.end(JSON.stringify(requestBody.data));
        }
      } else {
        proxyReq.end();
      }
    });
  }

  _buildLogEntry({
    timestamp,
    clientIp,
    req,
    requestBody,
    statusCode,
    statusMessage,
    responseHeaders,
    responseBody,
  }) {
    const queryObj = this._parseQueryString(req.url);

    const parsedResponseBody = parseResponseBody(responseHeaders, responseBody);

    const reqHeaders = { ...req.headers };

    const fullUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || 'unknown'}${req.url}`;

    const logRequestBody = { type: requestBody.type, data: requestBody.data, size: requestBody.size };

    return {
      timestamp,
      client_ip: clientIp,
      request: {
        method: req.method,
        path: this._extractPath(req.url),
        full_url: fullUrl,
        query_params: queryObj,
        headers: reqHeaders,
        body: logRequestBody,
      },
      response: {
        status_code: statusCode,
        status_text: statusMessage,
        headers: responseHeaders,
        body: parsedResponseBody,
      },
    };
  }

  _extractPath(urlStr) {
    if (!urlStr) return '/';
    try {
      const parsed = new URL(urlStr, 'http://dummy');
      return parsed.pathname;
    } catch {
      return urlStr.split('?')[0] || '/';
    }
  }

  _parseQueryString(urlStr) {
    if (!urlStr) return {};
    try {
      const parsed = new URL(urlStr, 'http://dummy');
      const params = {};
      parsed.searchParams.forEach((value, key) => {
        params[key] = value;
      });
      return params;
    } catch {
      return {};
    }
  }
}

module.exports = ProxyHandler;
