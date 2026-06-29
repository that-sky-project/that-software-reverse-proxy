const http = require('http');
const https = require('https');
const { URL } = require('url');
const { createBodyCapture } = require('./body-parser');
const Logger = require('./logger');
const { createRequestId } = require('./utils');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
]);

class ProxyHandler {
  constructor(config, sharedLogger = null) {
    this.logger = sharedLogger || new Logger(config.logging || {});
    this.requestTimeoutMs = Number.isFinite(config?.server?.requestTimeoutMs)
      ? Math.max(1000, Math.floor(config.server.requestTimeoutMs))
      : 30000;
    this.allowInsecureTls = config?.server?.allowInsecureTls === true;
    this.trustProxyHeaders = config?.server?.trustProxyHeaders === true;
    this.redactedHeaders = new Set(
      (config?.logging?.redactHeaders || ['authorization', 'cookie', 'set-cookie']).map((h) =>
        String(h).toLowerCase()
      )
    );
  }

  async handle(req, res, site) {
    const requestId = createRequestId();
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    const clientIp = req.socket.remoteAddress || 'unknown';
    const requestCapture = createBodyCapture(this.logger.getMaxBodyLogSize());

    try {
      req.on('data', (chunk) => requestCapture.push(chunk));

      const targetUrl = new URL(site.target);
      const isHttps = targetUrl.protocol === 'https:';

      const reqPath = req.url || '/';
      const outgoingPath = reqPath;
      const outgoingHeaders = this._buildOutgoingHeaders(req.headers, targetUrl, site);

      if (!outgoingHeaders.host) {
        outgoingHeaders.host = targetUrl.host;
      }

      const proxyOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: outgoingPath,
        method: req.method,
        headers: outgoingHeaders,
      };
      if (isHttps) {
        proxyOptions.rejectUnauthorized = !this.allowInsecureTls;
      }

      const transport = isHttps ? https : http;

      const forwardResult = await this._forwardAndRelay({
        req,
        res,
        transport,
        proxyOptions,
      });

      const requestBody = requestCapture.summary(req.headers['content-type']);
      const durationMs = Date.now() - startTime;
      const logData = this._buildLogEntry({
        requestId,
        timestamp,
        durationMs,
        clientIp,
        site,
        req,
        requestBody,
        statusCode: forwardResult.statusCode,
        statusMessage: forwardResult.statusMessage,
        responseHeaders: forwardResult.responseHeaders,
        responseBody: forwardResult.responseBody,
        targetUrl,
      });

      if (site.logging !== false) {
        this.logger.logRequest(site.name, requestId, logData).catch((err) => {
          this.logger
            .logEvent('error', 'request_log_write_failed', {
              request_id: requestId,
              site: site.name,
              message: err.message,
            })
            .catch(() => {});
        });
      }

    } catch (err) {
      const requestBody = requestCapture.summary(req.headers['content-type']);
      const durationMs = Date.now() - startTime;

      const logData = this._buildLogEntry({
        requestId,
        timestamp,
        durationMs,
        clientIp,
        site,
        req,
        requestBody,
        statusCode: 502,
        statusMessage: 'Bad Gateway',
        responseHeaders: {},
        responseBody: {
          type: 'text',
          data: err.message || 'Upstream error',
          size: (err.message || 'Upstream error').length,
          logged_size: (err.message || 'Upstream error').length,
          truncated: false,
          omitted_size: 0,
        },
        targetUrl: null,
        error: {
          name: err.name || 'Error',
          message: err.message || 'Upstream error',
        },
      });

      if (site.logging !== false) {
        this.logger.logRequest(site.name, requestId, logData).catch(() => {});
      }

      this.logger
        .logEvent('error', 'proxy_forward_failed', {
          request_id: requestId,
          site: site.name,
          host: req.headers.host || 'unknown',
          method: req.method,
          path: req.url || '/',
          message: err.message || 'Upstream request failed',
        })
        .catch(() => {});

      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      if (!res.writableEnded) {
        res.end('Bad Gateway: upstream request failed');
      }
    }
  }

  _buildOutgoingHeaders(incomingHeaders, targetUrl, site) {
    const outgoingHeaders = {};
    for (const [key, value] of Object.entries(incomingHeaders || {})) {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower === 'host') {
        outgoingHeaders.host = site.preserveHost ? targetUrl.host : value;
        continue;
      }
      outgoingHeaders[key] = value;
    }
    return outgoingHeaders;
  }

  _forwardAndRelay({ req, res, transport, proxyOptions }) {
    return new Promise((resolve, reject) => {
      const responseCapture = createBodyCapture(this.logger.getMaxBodyLogSize());
      let settled = false;

      const done = (fn) => (value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      const succeed = done(resolve);
      const fail = done(reject);

      const proxyReq = transport.request(proxyOptions, (proxyRes) => {
        const responseHeaders = proxyRes.headers || {};

        for (const [key, value] of Object.entries(responseHeaders)) {
          if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
          try {
            res.setHeader(key, value);
          } catch {}
        }

        if (!res.headersSent) {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage || 'Bad Gateway');
        }

        proxyRes.on('data', (chunk) => responseCapture.push(chunk));
        proxyRes.on('error', fail);
        proxyRes.on('end', () => {
          const responseBody = responseCapture.summary(responseHeaders['content-type']);
          succeed({
            statusCode: proxyRes.statusCode || 502,
            statusMessage: proxyRes.statusMessage || 'Bad Gateway',
            responseHeaders,
            responseBody,
          });
        });

        proxyRes.pipe(res);
      });

      proxyReq.on('error', fail);
      proxyReq.setTimeout(this.requestTimeoutMs, () => {
        proxyReq.destroy(new Error(`Upstream request timeout (${this.requestTimeoutMs}ms)`));
      });

      req.on('aborted', () => proxyReq.destroy(new Error('Client request aborted')));
      req.on('error', (err) => proxyReq.destroy(err));

      if (req.method === 'GET' || req.method === 'HEAD') {
        proxyReq.end();
      } else {
        req.pipe(proxyReq);
      }
    });
  }

  _buildLogEntry({
    requestId,
    timestamp,
    durationMs,
    clientIp,
    site,
    req,
    requestBody,
    statusCode,
    statusMessage,
    responseHeaders,
    responseBody,
    targetUrl,
    error,
  }) {
    const queryObj = this._parseQueryString(req.url);
    const reqHeaders = this._redactHeaders(req.headers);
    const resHeaders = this._redactHeaders(responseHeaders);
    const fullUrl = this._buildFullUrl(req);

    return {
      request_id: requestId,
      timestamp,
      duration_ms: durationMs,
      client_ip: clientIp,
      site: {
        host: req.headers.host || 'unknown',
        route_name: site?.name || 'unknown',
      },
      upstream: targetUrl
        ? {
            protocol: targetUrl.protocol.replace(':', ''),
            hostname: targetUrl.hostname,
            port: targetUrl.port
              ? Number(targetUrl.port)
              : targetUrl.protocol === 'https:'
              ? 443
              : 80,
            target: targetUrl.toString(),
            tls_insecure_skip_verify: targetUrl.protocol === 'https:' ? this.allowInsecureTls : false,
          }
        : null,
      request: {
        method: req.method,
        path: this._extractPath(req.url),
        full_url: fullUrl,
        query_params: queryObj,
        headers: reqHeaders,
        body: requestBody,
      },
      response: {
        status_code: statusCode,
        status_text: statusMessage,
        headers: resHeaders,
        body: responseBody,
      },
      traffic: {
        request_bytes: requestBody?.size || 0,
        response_bytes: responseBody?.size || 0,
      },
      error: error || null,
    };
  }

  _buildFullUrl(req) {
    const scheme = this._resolveScheme(req);
    const host = req.headers.host || 'unknown';
    const path = req.url || '/';
    return `${scheme}://${host}${path}`;
  }

  _resolveScheme(req) {
    const defaultScheme = req.socket && req.socket.encrypted ? 'https' : 'http';
    if (!this.trustProxyHeaders) {
      return defaultScheme;
    }
    const headerValue = req.headers['x-forwarded-proto'];
    if (!headerValue) return defaultScheme;
    return String(headerValue).split(',')[0].trim() || defaultScheme;
  }

  _redactHeaders(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (this.redactedHeaders.has(key.toLowerCase())) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = value;
    }
    return out;
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
        if (!(key in params)) {
          params[key] = value;
          return;
        }
        if (Array.isArray(params[key])) {
          params[key].push(value);
          return;
        }
        params[key] = [params[key], value];
      });
      return params;
    } catch {
      return {};
    }
  }
}

module.exports = ProxyHandler;
