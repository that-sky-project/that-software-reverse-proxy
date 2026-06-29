# that-sky-reverse-proxy

Used for collecting Sky:CotL request data.

An async reverse proxy built on Node.js with multi-site routing and structured logging.

## Features

- Multi-site reverse proxy by request `Host`
- Streaming request/response forwarding (works with chunked bodies)
- Structured request logs per site (`JSON`)
- System event logs (`NDJSON`) for startup, shutdown, routing misses, and errors
- Body capture limit (`maxBodyLogSize`) with truncation metadata
- Header redaction for sensitive fields
- Zero external dependencies

## Requirements

- Node.js >= 18.0.0

## Quick Start

```bash
node index.js
```

## Configuration

Edit `config.json`:

```json
{
  "server": {
    "port": 2333,
    "host": "0.0.0.0",
    "requestTimeoutMs": 30000,
    "allowInsecureTls": false,
    "trustProxyHeaders": false
  },
  "sites": [
    {
      "name": "skylive",
      "hostname": "sky.example.com",
      "target": "https://live.radiance.thatgamecompany.com",
      "preserveHost": true,
      "logging": true
    }
  ],
  "logging": {
    "dir": "./data",
    "maxBodyLogSize": 1048576,
    "prettyJson": true,
    "console": true,
    "redactHeaders": ["authorization", "cookie", "set-cookie"]
  }
}
```

### Field Reference

| Field | Description |
|---|---|
| `server.port` | Listening port |
| `server.host` | Listening host |
| `server.requestTimeoutMs` | Upstream request timeout in ms |
| `server.allowInsecureTls` | If `true`, skip TLS certificate verification for HTTPS upstream |
| `server.trustProxyHeaders` | If `true`, use `x-forwarded-proto` to build `full_url` |
| `sites[].name` | Site name, used as log directory key |
| `sites[].hostname` | Host header to match |
| `sites[].target` | Upstream URL (`http` or `https`) |
| `sites[].preserveHost` | If `true`, replace outgoing `Host` with upstream host |
| `sites[].logging` | Enable or disable request logs for this site |
| `logging.dir` | Log root directory |
| `logging.maxBodyLogSize` | Max captured bytes for request/response body logging |
| `logging.prettyJson` | Pretty-print request log files |
| `logging.console` | Enable console event output |
| `logging.redactHeaders` | Header names to redact in logs |

## Logging

Request logs:

```text
data/<site-name>/request_<path_slug>_<timestamp>_<request_id>.json
```

System event logs:

```text
data/_system/events_YYYYMMDD.ndjson
```

### Request Log Example

```json
{
  "request_id": "ma7vv8w0-7e3d9f2a",
  "timestamp": "2026-04-25T05:13:24.212Z",
  "duration_ms": 149,
  "client_ip": "127.0.0.1",
  "site": {
    "host": "sky.example.com",
    "route_name": "skylive"
  },
  "upstream": {
    "protocol": "https",
    "hostname": "live.radiance.thatgamecompany.com",
    "port": 443,
    "target": "https://live.radiance.thatgamecompany.com/",
    "tls_insecure_skip_verify": false
  },
  "request": {
    "method": "POST",
    "path": "/account/get_friends",
    "full_url": "http://sky.example.com/account/get_friends",
    "query_params": {},
    "headers": {
      "authorization": "[REDACTED]"
    },
    "body": {
      "type": "json",
      "data": {
        "id": "..."
      },
      "size": 4096,
      "logged_size": 1024,
      "truncated": true,
      "omitted_size": 3072
    }
  },
  "response": {
    "status_code": 200,
    "status_text": "OK",
    "headers": {},
    "body": {
      "type": "json",
      "data": {
        "ok": true
      },
      "size": 26,
      "logged_size": 26,
      "truncated": false,
      "omitted_size": 0
    }
  },
  "traffic": {
    "request_bytes": 4096,
    "response_bytes": 26
  },
  "error": null
}
```

### Body Types

| type | Description |
|---|---|
| `empty` | No body |
| `json` | Parsed JSON |
| `text` | Plain text |
| `form` | URL-encoded form |
| `multipart` | Multipart form data (captured raw text segment) |
| `binary` | Base64 encoded binary |

## Usage

1. Start the proxy server.
2. Point client requests to this proxy (DNS/hosts).
3. Inspect `data/` for request logs and `_system` events.
