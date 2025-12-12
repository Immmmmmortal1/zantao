# ZenTao MCP Server

一个基于 MCP 的 ZenTao RESTful API v1 适配器，自动处理 token，提供通用调用工具和资源索引。

## 安装

```bash
# 全局安装（推荐直接使用命令行）
npm install -g @makun111/zentao-mcp-server

# 或作为项目依赖
npm install @makun111/zentao-mcp-server
```

> 如果是本地开发环境，请先 `npm install` 安装依赖；如需使用环境文件，可复制 `.env.example` 为 `.env` 并填写参数。

## 环境变量

- `ZENTAO_BASE_URL`：禅道服务地址，形如 `https://xxx.com`
- `ZENTAO_ACCOUNT`：登录账号
- `ZENTAO_PASSWORD`：登录密码
- `ZENTAO_TOKEN`：可选，已有 token；如果未提供会自动通过 `/tokens` 获取

## 运行

```bash
npm start
```

服务器通过 stdio 运行，适用于 MCP 客户端。

## 提供的工具

- `get_token(forceRefresh?)`：调用 `POST /api.php/v1/tokens` 获取 token，默认缓存。
- `call(path, method?, query?, body?, forceTokenRefresh?)`：调用任意 RESTful 接口，自动注入 `Token` 头。`path` 可写 `/projects` 或 `projects/1`。

## 资源

- `zentao://endpoints`：RESTful v1 主要接口概览。
- `zentao://config`：当前环境变量是否已设置（不包含敏感值）。

## 示例

```json
// 获取 token
{ "tool": "get_token" }

// 列出部门
{
  "tool": "call",
  "arguments": { "path": "/departments", "method": "GET" }
}

// 创建项目
{
  "tool": "call",
  "arguments": {
    "path": "/projects",
    "method": "POST",
    "body": { "name": "Demo Project", "code": "DEMO" }
  }
}
```
