# that-sky-reverse-proxy

Used for collecting Sky:CotL request data.

基于 Node.js 的异步高性能反向代理，支持多站点配置，自动记录所有经过的请求与响应数据为结构化 JSON 文件。

## 功能特性

- **多站点反向代理** — 通过 `config.json` 配置多个站点，基于请求 `Host` 头自动路由
- **请求日志记录** — 每个请求自动生成结构化 JSON 文件，按站点名称分目录存储
- **智能 Body 解析** — 自动识别 JSON / Text / Form / Binary 等格式，即使响应 `Content-Type` 为 `text/plain` 也会尝试解析 JSON 内容
- **零外部依赖** — 仅使用 Node.js 内置模块，无需 `npm install`

## 环境要求

- Node.js >= 18.0.0

## 快速开始

```bash
# 启动代理
node index.js

# 开发模式（文件变更自动重启）
npm run dev
```

## 配置说明

编辑 `config.json`：

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
      "target": "https://live.radiance.thatgamecompany.com",
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

### 字段说明

| 字段 | 说明 |
|------|------|
| `server.port` | 代理服务监听端口 |
| `server.host` | 代理服务监听地址 |
| `sites[].name` | 站点标识，用于日志目录划分 |
| `sites[].hostname` | 匹配的请求 Host 头 |
| `sites[].target` | 上游目标地址 |
| `sites[].preserveHost` | `true` 时将 Host 头替换为上游地址的 host |
| `sites[].logging` | 是否记录该站点的请求日志 |
| `logging.dir` | 日志文件存储根目录 |
| `logging.maxBodyLogSize` | 单个 Body 最大记录字节数 |

### 多站点配置示例

```json
{
  "sites": [
    {
      "name": "skylive",
      "hostname": "sky.example.com",
      "target": "https://live.radiance.thatgamecompany.com",
      "preserveHost": true,
      "logging": true
    },
    {
      "name": "skyassets",
      "hostname": "assets.example.com",
      "target": "https://assets.radiance.thatgamecompany.com",
      "preserveHost": true,
      "logging": true
    }
  ]
}
```

## 日志格式

日志文件按站点分目录存储，路径格式为：

```
data/<site.name>/request_<path_slug>_<timestamp>.json
```

例如：

```
data/skylive/request_root_20260223_150130_126823.json
data/skylive/request_account_get_friends_20260223_120941_413967.json
data/skylive/request_account_get_motd_20260411_203347_649000.json
```

### 日志文件结构

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

### Body 类型说明

| type | 说明 |
|------|------|
| `empty` | 无请求/响应体 |
| `json` | JSON 格式，`data` 为解析后的对象 |
| `text` | 纯文本，`data` 为字符串 |
| `form` | URL 编码表单 |
| `multipart` | Multipart 表单 |
| `binary` | 二进制数据，`data` 为 Base64 编码字符串 |

> 当 `Content-Type` 为 `text/plain` 但内容为合法 JSON 时，会自动识别并按 `json` 类型解析。

## 项目结构

```
forte/
├── index.js              # 入口文件，启动 HTTP 服务器
├── config.json           # 代理配置
├── package.json
└── lib/
    ├── proxy.js          # 核心反向代理逻辑
    ├── router.js         # 基于 Host 头的站点路由
    ├── logger.js         # 请求日志写入
    ├── body-parser.js    # 请求/响应体解析
    └── utils.js          # 工具函数
```

## 使用方式

1. 启动代理服务器
2. 将客户端请求指向本代理（例如通过修改 DNS 或 hosts 将域名指向代理地址）
3. 代理会自动将请求转发到配置的上游地址，并将完整的请求/响应数据记录到 `data/` 目录
