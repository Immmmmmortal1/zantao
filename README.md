# ZenTao MCP Server

一个基于 MCP 的 ZenTao RESTful API v1 适配器，自动处理 token，提供通用调用工具和资源索引。

## 功能列表（支持的禅道能力）

- Token 自动获取/缓存：自动登录获取 Token，支持强制刷新，所有请求自动带 `Token` 头。
- 通用调用：直接调用禅道 RESTful v1 任意接口（`GET/POST/PUT/DELETE/PATCH`）。
- 项目与产品：列出与当前账号相关的项目；按关键字搜索产品。
- 缺陷处理：
  - 查询分配给我的缺陷（支持按产品、关键字、状态过滤，获取下一个待处理项）。
  - 查看缺陷详情（附带步骤中的图片链接提取）。
  - 统计缺陷数量（总数/活跃）。
  - 将缺陷标记为已解决（`resolve`，默认 resolution=fixed）。
- 资源索引：`zentao://endpoints`（接口概览）、`zentao://config`（环境配置检查）、`zentao://projects`（我的项目）。

## 安装

### 方式一：快速使用（npm）

```bash
# 全局安装
npm install -g @makun111/zentao-mcp-server
```

> 安装后由 MCP 客户端通过 API/stdio 调用，无需手动启动。

### 方式二：下载源码本地安装

```bash
git clone git@github.com:Immmmmmortal1/zantao.git
cd zantao
npm install
```

> 用于本地开发/调试。如需环境文件，可将 `.env.example` 复制为 `.env` 并填写参数。需要手动验证时可运行 `npm start`。

## 环境变量

- `ZENTAO_BASE_URL`：禅道服务地址，形如 `https://xxx.com`
- `ZENTAO_ACCOUNT`：登录账号
- `ZENTAO_PASSWORD`：登录密码
- `ZENTAO_TOKEN`：可选，已有 token；如果未提供会自动通过 `/tokens` 获取

在 zsh 中配置环境变量示例：

```bash
echo 'export ZENTAO_BASE_URL="https://example.com/zentao/"' >> ~/.zshrc
echo 'export ZENTAO_ACCOUNT="你的账号"' >> ~/.zshrc
echo 'export ZENTAO_PASSWORD="你的密码"' >> ~/.zshrc
source ~/.zshrc
```

## 提供的工具

- `get_token(forceRefresh?)`：调用 `POST /api.php/v1/tokens` 获取 token，默认缓存。
- `call(path, method?, query?, body?, forceTokenRefresh?)`：调用任意 RESTful 接口，自动注入 `Token` 头。`path` 可写 `/projects` 或 `projects/1`。

## 资源

- `zentao://endpoints`：RESTful v1 主要接口概览。
- `zentao://config`：当前环境变量是否已设置（不包含敏感值）。

## 使用示例

在任意支持 MCP 的客户端中调用对应工具：

- 获取 token：`{ "tool": "get_token" }`
- 列出部门：`{ "tool": "call", "arguments": { "path": "/departments", "method": "GET" } }`
- 创建项目：`{ "tool": "call", "arguments": { "path": "/projects", "method": "POST", "body": { "name": "Demo Project", "code": "DEMO" } } }`
- 查询分配给我的缺陷：`{ "tool": "getMyBugs", "arguments": { "productId": 1, "status": "active" } }`
