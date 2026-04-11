const http = require('http');
const fs = require('fs');
const path = require('path');
const Router = require('./lib/router');
const ProxyHandler = require('./lib/proxy');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

function startServer() {
  const config = loadConfig();
  const { server: serverConfig, sites } = config;

  if (!sites || sites.length === 0) {
    console.error('no sites configured in config.json');
    process.exit(1);
  }

  const router = new Router(sites);
  const proxy = new ProxyHandler(config);

  const server = http.createServer(async (req, res) => {
    const host = req.headers['host'];
    const site = router.resolve(host);

    if (!site) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`No proxy configured for host: ${host}`);
      return;
    }

    try {
      await proxy.handle(req, res, site);
    } catch (err) {
      console.error(`unhandled error for ${host}:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end('Internal Server Error');
    }
  });

  server.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`reverse proxy server started on ${serverConfig.host}:${serverConfig.port}`);
    console.log('configured sites:');
    for (const site of router.all()) {
      console.log(`  - ${site.hostname} -> ${site.target} (logging: ${site.logging !== false})`);
    }
  });

  server.on('error', (err) => {
    console.error('server error:', err.message);
    process.exit(1);
  });

  const shutdown = () => {
    console.log('\nshutting down...');
    server.close(() => {
      console.log('server closed');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('forced shutdown');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
