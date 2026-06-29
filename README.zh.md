# that-sky-reverse-proxy

用于采集 Sky:CotL 请求数据。

这是一个基于 Node.js 的反向代理，支持按域名多站点路由，并内置结构化日志系统。

## 功能特性

- 按请求 `Host` 做多站点反向代理
- 流式转发请求与响应（支持 chunked body）
- 每个站点输出结构化请求日志（`JSON`）
- 系统事件日志（`NDJSON`，记录启动/关闭/路由未命中/错误）
- `maxBodyLogSize` 控制 body 采集上限，并记录截断信息
- 支持敏感请求头脱敏
- 零第三方依赖

## 环境要求

- Node.js >= 18.0.0

## 快速开始

```bash
node index.js
```

## 配置说明

编辑 `config.json`：

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

### 字段说明

| 字段 | 说明 |
|---|---|
| `server.port` | 监听端口 |
| `server.host` | 监听地址 |
| `server.requestTimeoutMs` | 上游请求超时（毫秒） |
| `server.allowInsecureTls` | `true` 时跳过 HTTPS 证书校验 |
| `server.trustProxyHeaders` | `true` 时使用 `x-forwarded-proto` 生成 `full_url` |
| `sites[].name` | 站点名，用于日志目录分区 |
| `sites[].hostname` | 要匹配的 Host |
| `sites[].target` | 上游地址（`http` 或 `https`） |
| `sites[].preserveHost` | `true` 时将转发请求的 `Host` 改为上游 host |
| `sites[].logging` | 是否记录该站点请求日志 |
| `logging.dir` | 日志根目录 |
| `logging.maxBodyLogSize` | 请求/响应 body 最大采集字节数 |
| `logging.prettyJson` | 请求日志是否格式化输出 |
| `logging.console` | 是否输出控制台事件日志 |
| `logging.redactHeaders` | 需要脱敏的请求头字段名 |

## 日志系统

请求日志路径：

```text
data/<site-name>/request_<path_slug>_<timestamp>_<request_id>.json
```

系统事件日志路径：

```text
data/_system/events_YYYYMMDD.ndjson
```

### 请求日志示例

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

### Body 类型

| type | 说明 |
|---|---|
| `empty` | 无 body |
| `json` | 解析后的 JSON |
| `text` | 文本 |
| `form` | URL 编码表单 |
| `multipart` | Multipart 表单（原始文本片段） |
| `binary` | Base64 编码二进制 |

## 使用方式

1. 启动代理服务。
2. 将客户端请求指向该代理（DNS/hosts）。
3. 在 `data/` 目录查看请求日志和 `_system` 事件日志。
