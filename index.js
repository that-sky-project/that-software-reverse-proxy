const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const Router = require('./lib/router');
const ProxyHandler = require('./lib/proxy');
const Logger = require('./lib/logger');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to load config.json: ${err.message}`);
  }
}

function normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') {
    throw new Error('config root must be an object');
  }

  const server = rawConfig.server || {};
  const host = typeof server.host === 'string' && server.host.trim() ? server.host.trim() : '0.0.0.0';
  const port = Number.isInteger(server.port) ? server.port : 2333;
  if (port < 1 || port > 65535) {
    throw new Error(`server.port must be an integer in range 1..65535, got: ${server.port}`);
  }

  const requestTimeoutMs = Number.isFinite(server.requestTimeoutMs)
    ? Math.max(1000, Math.floor(server.requestTimeoutMs))
    : 30000;

  const sites = Array.isArray(rawConfig.sites) ? rawConfig.sites : [];
  if (sites.length === 0) {
    throw new Error('no sites configured in config.json');
  }

  const seenHosts = new Set();
  const normalizedSites = sites.map((site, index) => {
    if (!site || typeof site !== 'object') {
      throw new Error(`sites[${index}] must be an object`);
    }

    const name = typeof site.name === 'string' && site.name.trim() ? site.name.trim() : `site_${index + 1}`;
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error(`sites[${index}].name contains invalid path characters`);
    }

    if (typeof site.hostname !== 'string' || !site.hostname.trim()) {
      throw new Error(`sites[${index}].hostname is required`);
    }
    const hostname = site.hostname.trim().toLowerCase();
    if (seenHosts.has(hostname)) {
      throw new Error(`duplicate hostname found: ${hostname}`);
    }
    seenHosts.add(hostname);

    if (typeof site.target !== 'string' || !site.target.trim()) {
      throw new Error(`sites[${index}].target is required`);
    }
    let target;
    try {
      target = new URL(site.target.trim());
    } catch {
      throw new Error(`sites[${index}].target is not a valid URL: ${site.target}`);
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error(`sites[${index}].target protocol must be http or https`);
    }

    return {
      name,
      hostname,
      target: target.toString(),
      preserveHost: site.preserveHost === true,
      logging: site.logging !== false,
    };
  });

  const logging = rawConfig.logging || {};
  const maxBodyLogSize = Number.isFinite(logging.maxBodyLogSize)
    ? Math.max(0, Math.floor(logging.maxBodyLogSize))
    : 1024 * 1024;
  const redactHeaders = Array.isArray(logging.redactHeaders)
    ? logging.redactHeaders.map((h) => String(h).toLowerCase())
    : ['authorization', 'cookie', 'set-cookie'];

  return {
    server: {
      host,
      port,
      requestTimeoutMs,
      allowInsecureTls: server.allowInsecureTls === true,
      trustProxyHeaders: server.trustProxyHeaders === true,
    },
    sites: normalizedSites,
    logging: {
      dir: typeof logging.dir === 'string' && logging.dir.trim() ? logging.dir.trim() : './data',
      maxBodyLogSize,
      prettyJson: logging.prettyJson !== false,
      console: logging.console !== false,
      redactHeaders,
    },
  };
}

function startServer() {
  const config = normalizeConfig(loadConfig());
  const { server: serverConfig, sites } = config;
  const logger = new Logger(config.logging);

  const router = new Router(sites);
  const proxy = new ProxyHandler(config, logger);

  const server = http.createServer(async (req, res) => {
    const host = req.headers['host'];
    const site = router.resolve(host);

    if (!site) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`No proxy configured for host: ${host}`);
      logger
        .logEvent('warn', 'route_not_found', {
          host: host || 'unknown',
          method: req.method,
          path: req.url || '/',
        })
        .catch(() => {});
      return;
    }

    try {
      await proxy.handle(req, res, site);
    } catch (err) {
      console.error(`unhandled error for ${host}:`, err);
      logger
        .logEvent('error', 'unhandled_proxy_error', {
          host: host || 'unknown',
          method: req.method,
          path: req.url || '/',
          message: err.message,
        })
        .catch(() => {});
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      if (!res.writableEnded) {
        res.end('Internal Server Error');
      }
    }
  });

  server.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`reverse proxy server started on ${serverConfig.host}:${serverConfig.port}`);
    console.log('configured sites:');
    for (const site of router.all()) {
      console.log(`  - ${site.hostname} -> ${site.target} (logging: ${site.logging !== false})`);
    }

    logger
      .logEvent('info', 'server_started', {
        host: serverConfig.host,
        port: serverConfig.port,
        site_count: sites.length,
        request_timeout_ms: serverConfig.requestTimeoutMs,
      })
      .catch(() => {});
  });

  server.on('error', (err) => {
    console.error('server error:', err.message);
    logger.logEvent('error', 'server_error', { message: err.message }).catch(() => {});
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log('\nshutting down...');
    logger.logEvent('info', 'server_shutdown_begin').catch(() => {});

    const forceTimer = setTimeout(() => {
      console.error('forced shutdown');
      logger.logEvent('error', 'server_shutdown_forced').catch(() => {});
      process.exit(1);
    }, 5000);
    forceTimer.unref();

    server.close(() => {
      clearTimeout(forceTimer);
      console.log('server closed');
      logger.logEvent('info', 'server_shutdown_complete').catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
  startServer();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
