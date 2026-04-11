# that-sky-reverse-proxy

Used for collecting Sky:CotL request data.

An async, high-performance reverse proxy built on Node.js with multi-site support. Automatically logs all proxied requests and responses as structured JSON files.

## Features

- **Multi-site Reverse Proxy** — Configure multiple sites via `config.json`, auto-routed by request `Host` header
- **Request Logging** — Each request generates a structured JSON file, organized by site name
- **Smart Body Parsing** — Auto-detects JSON / Text / Form / Binary formats; attempts JSON parsing even when `Content-Type` is `text/plain`
- **Zero Dependencies** — Uses only Node.js built-in modules, no `npm install` required

## Requirements

- Node.js >= 18.0.0

## Quick Start

```bash
# Start the proxy
node index.js

# Development mode (auto-restart on file change)
npm run dev
```

## Configuration

Edit `config.json`:

```json
{
  "server": {
    "port": 2333,
    "host": "0.0.0.0"
  },
  "sites": [
    {
      "name": "skylive",
      "hostname": "sky.example.com",
      "target": "https://live.example.com",
      "preserveHost": true,
      "logging": true
    }
  ],
  "logging": {
    "dir": "./data",
    "maxBodyLogSize": 1048576
  }
}
```

### Field Reference

| Field | Description |
|-------|-------------|
| `server.port` | Port the proxy server listens on |
| `server.host` | Address the proxy server binds to |
| `sites[].name` | Site identifier, used for log directory partitioning |
| `sites[].hostname` | Request Host header to match |
| `sites[].target` | Upstream target URL |
| `sites[].preserveHost` | When `true`, replaces the Host header with the upstream host |
| `sites[].logging` | Whether to log requests for this site |
| `logging.dir` | Root directory for log file storage |
| `logging.maxBodyLogSize` | Maximum body size to log (bytes) |

### Multi-site Example

```json
{
  "sites": [
    {
      "name": "skylive",
      "hostname": "sky.example.com",
      "target": "https://live.example.com",
      "preserveHost": true,
      "logging": true
    },
    {
      "name": "skyassets",
      "hostname": "assets.example.com",
      "target": "https://assets.example.com",
      "preserveHost": true,
      "logging": true
    }
  ]
}
```

## Log Format

Log files are stored per-site with the following path pattern:

```
data/<site.name>/request_<path_slug>_<timestamp>.json
```

Examples:

```
data/skylive/request_root_20260223_150130_126823.json
data/skylive/request_account_get_friends_20260223_120941_413967.json
data/skylive/request_account_get_motd_20260411_203347_649000.json
```

### Log File Structure

```json
{
  "timestamp": "2026-02-23T12:09:41.414115",
  "client_ip": "172.18.0.1",
  "request": {
    "method": "POST",
    "path": "/account/get_friends",
    "full_url": "https://sky.example.com/account/get_friends",
    "query_params": {},
    "headers": { "...": "..." },
    "body": {
      "type": "json",
      "data": { "...": "..." },
      "size": 348
    }
  },
  "response": {
    "status_code": 200,
    "status_text": "OK",
    "headers": { "...": "..." },
    "body": {
      "type": "json",
      "data": { "...": "..." },
      "size": 19
    }
  }
}
```

### Body Types

| type | Description |
|------|-------------|
| `empty` | No request/response body |
| `json` | JSON format, `data` is a parsed object |
| `text` | Plain text, `data` is a string |
| `form` | URL-encoded form |
| `multipart` | Multipart form |
| `binary` | Binary data, `data` is a Base64-encoded string |

> When `Content-Type` is `text/plain` but the content is valid JSON, it will be auto-detected and parsed as `json` type.

## Project Structure

```
forte/
├── index.js              # Entry point, starts the HTTP server
├── config.json           # Proxy configuration
├── package.json
└── lib/
    ├── proxy.js          # Core reverse proxy logic
    ├── router.js         # Host-header-based site routing
    ├── logger.js         # Request log writer
    ├── body-parser.js    # Request/response body parsing
    └── utils.js          # Utility functions
```

## Usage

1. Start the proxy server
2. Point client requests to this proxy (e.g., by modifying DNS or hosts to resolve the domain to the proxy address)
3. The proxy forwards requests to the configured upstream and logs complete request/response data to the `data/` directory
