# Fetcher MCP 开发实战指南

## 项目概述

基于 Playwright 的 MCP 服务器，用于抓取网页内容。本项目在原版基础上增加了环境变量配置支持和代理功能。

---

## 一、功能增强记录

### 1.1 新增功能

| 功能 | 说明 | 实现文件 |
|------|------|----------|
| 代理支持 | 支持 HTTP/HTTPS/SOCKS5 代理 | `src/services/browserService.ts` |
| 环境变量配置 | 所有参数支持从环境变量读取 | `src/utils/config.ts` |
| 跨平台构建 | 修复 Windows 构建问题 | `package.json` |

### 1.2 环境变量列表

所有环境变量以 `FETCHER_` 为前缀：

```bash
FETCHER_TIMEOUT=30000              # 页面加载超时时间（毫秒）
FETCHER_WAIT_UNTIL=load            # 导航完成条件
FETCHER_EXTRACT_CONTENT=true       # 是否智能提取主要内容
FETCHER_MAX_LENGTH=0               # 返回内容最大长度
FETCHER_RETURN_HTML=false          # 是否返回HTML内容
FETCHER_WAIT_FOR_NAVIGATION=false  # 是否等待额外导航
FETCHER_NAVIGATION_TIMEOUT=10000   # 额外导航超时时间（毫秒）
FETCHER_DISABLE_MEDIA=true         # 是否禁用媒体资源
FETCHER_DEBUG=false                # 是否启用调试模式
FETCHER_PROXY=                     # 代理服务器URL
```

---

## 二、踩坑记录与解决方案

### 2.1 Windows 构建问题

**问题现象：**
```bash
'rm' 不是内部或外部命令，也不是可运行的程序
或批处理文件。
```

**原因分析：**
- `package.json` 中的 `build` 脚本使用了 Linux 命令 `rm -rf`
- Windows 系统不支持 `rm` 命令

**解决方案：**
```json
// 修改前
"build": "rm -rf build && tsc && node -e \"require('fs').chmodSync('build/index.js', '755')\""

// 修改后
"build": "rimraf build && tsc && node -e \"require('fs').chmodSync('build/index.js', '755')\""
```

**步骤：**
1. 安装 rimraf：`npm install --save-dev rimraf`
2. 修改 `package.json` 中的 build 脚本
3. `rimraf` 是跨平台的删除工具，支持 Windows/Linux/macOS

---

### 2.2 Docker 构建网络问题

**问题现象：**
```bash
ERROR: failed to solve: failed to fetch oauth token: Post "https://auth.docker.io/token": 
dial tcp [2a03:2880:f11a:83:face:b00c:0:25de]:443: connectex: 
A connection attempt failed because the connected party did not properly respond after a period of time
```

**原因分析：**
- 无法连接到 Docker Hub（`docker.io`）
- 网络问题导致无法下载基础镜像

**解决方案：**

#### 配置 Docker 镜像加速器（成功解决）

1. 打开 **Docker Desktop**
2. 点击 **Settings**（齿轮图标）
3. 选择 **Docker Engine**
4. 在右侧 JSON 配置中添加镜像加速器：

```json
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com"
  ]
}
```

5. 点击 **Apply & Restart**

配置完成后，Docker 会从国内镜像站下载镜像，解决网络连接问题。

---

### 2.3 浏览器窗口弹出（非无头模式）

**问题现象：**
运行时会弹出浏览器窗口，而不是在后台运行。

**原因分析：**
- 启用了 Debug 模式
- `browserService.ts` 中 `headless: !this.isDebugMode`
- 当 `debug` 为 `true` 时，浏览器会显示窗口

**解决方案：**
1. 检查 MCP 配置，确保 `FETCHER_DEBUG` 为 `false`：
```json
{
  "mcpServers": {
    "fetcher-mcp": {
      "command": "node",
      "args": ["build/index.js"],
      "env": {
        "FETCHER_DEBUG": "false"
      }
    }
  }
}
```

2. 调用工具时不传 `debug: true`

---

### 2.4 MCP 本地开发配置问题

**问题现象：**
```bash
npm error Cannot read properties of undefined (reading 'replace')
```

**原因分析：**
- 使用 `npx -y file:.` 或 `npx -y ./` 方式调用本地包时出错
- npx 对本地文件路径支持不完善

**解决方案：**

#### 方案 1：直接使用 node 运行（推荐）
```json
{
  "mcpServers": {
    "fetcher-mcp-local": {
      "command": "node",
      "args": ["C:/Users/xxx/project/fetcher-mcp/build/index.js"],
      "env": {
        "FETCHER_TIMEOUT": "30000",
        "FETCHER_EXTRACT_CONTENT": "true"
      }
    }
  }
}
```

#### 方案 2：使用 npm link
```bash
npm link
```
然后配置使用包名。

---

### 2.5 NPM 发布 2FA 认证问题

**问题现象：**
```bash
npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@531014023%2ffetcher-mcp
npm error 403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

**原因分析：**
- NPM 在 2022-2023 年期间逐步强制要求 2FA（双因素认证）
- 直接使用 `npm login` 输入用户名密码已无法发布包
- 需要使用 Granular Access Token 并启用 "Bypass 2FA" 选项

**解决方案：**

详见【五、构建和发布流程】→【5.2 发布到 NPM】部分的详细步骤。

**核心要点：**
1. 在 npmjs.com 创建 **Granular Access Token**（不是 Legacy Token）
2. 必须勾选 **"Bypass 2FA"** 选项
3. Token 格式为 `npm_xxxxxx`
4. 使用 Token 替代密码登录，或写入 `.npmrc` 文件

---

### 2.6 包名和版本管理

**问题：**
- 原仓库包名为 `fetcher-mcp`
- 需要发布自己的版本，避免与原版冲突

**解决方案：**

#### 1. 修改包名为 scoped package
```json
{
  "name": "@dy531014023/fetcher-mcp",
  "version": "0.4.1"
}
```

#### 2. 更新所有相关文件
- `package.json`：包名和版本号
- `docker-compose.yml`：镜像名称
- `docker-compose.local.yml`：镜像名称

#### 3. 发布到 NPM

**注意**：NPM 已强制要求 2FA（双因素认证），直接使用 `npm login` 会遇到 E403 错误。

**错误现象：**
```bash
npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@531014023%2ffetcher-mcp
npm error 403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

**解决方案：使用 Granular Access Token（推荐）**

这是目前最安全的发布方式，无需在本地配置 2FA。

**步骤：**

1. **创建 Granular Access Token**
   - 登录 [npmjs.com](https://www.npmjs.com/)
   - 右上角头像 → **Access Tokens** → **Generate New Token** → **Granular Access Token**
   - 填写 Token Name（如 `publish-fetcher-mcp`）
   - **Package 权限**：选择 **Read and Write**
   - **Package 范围**：选择你的 scope（如 `@531014023`）
   - **启用 "Bypass 2FA"**（⚠️ 关键！这个选项允许你用此 token 发布）
   - 生成后复制 token（只显示一次，格式为 `npm_xxxxxx`）

2. **配置本地 npm 使用 Token**

   方法 A：通过命令行登录
   ```bash
   npm logout
   npm login --registry=https://registry.npmjs.org/
   # 输入用户名、密码时，密码处粘贴你的 Granular Access Token
   ```

   方法 B：直接编辑 `.npmrc` 文件（如果方法 A 跳转浏览器失败）
   
   Windows 路径：`C:\Users\%USERNAME%\.npmrc`
   
   内容：
   ```ini
   //registry.npmjs.org/:_authToken=npm_你的GranularAccessToken
   ```

3. **验证并发布**
   ```bash
   npm whoami  # 确认登录成功
   npm run build
   npm publish --access public
   ```

**关键检查点：**
- ✅ Granular Token 必须勾选 **"Bypass 2FA"**（在创建 Token 的页面底部）
- ✅ Token 必须以 `npm_` 开头（这是 Granular Token 的格式）
- ✅ 发布命令必须加 `--access public`（因为 scoped package 默认是私有的）
- ✅ 如果之前登录过，先执行 `npm logout` 清除旧凭证

#### 4. 发布到 Docker Hub
```bash
docker build -t 531014023/fetcher-mcp:0.4.1
docker login
docker push 531014023/fetcher-mcp:0.4.1
```

---

## 三、配置文件参考

### 3.1 MCP 客户端配置（Claude Desktop）

```json
{
  "mcpServers": {
    "fetcher-mcp": {
      "command": "npx",
      "args": ["-y", "@dy531014023/fetcher-mcp"],
      "env": {
        "FETCHER_TIMEOUT": "30000",
        "FETCHER_EXTRACT_CONTENT": "true",
        "FETCHER_DISABLE_MEDIA": "true",
        "FETCHER_DEBUG": "false",
        "FETCHER_PROXY": "http://proxy-server:8080"
      }
    }
  }
}
```

### 3.2 Docker Compose 配置

```yaml
version: "3.8"

services:
  fetcher-mcp:
    image: 531014023/fetcher-mcp:0.4.1
    container_name: fetcher-mcp
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - FETCHER_TIMEOUT=30000
      - FETCHER_EXTRACT_CONTENT=true
      - FETCHER_DISABLE_MEDIA=true
      - FETCHER_DEBUG=false
      # - FETCHER_PROXY=http://proxy-server:8080
    volumes:
      - /tmp:/tmp
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 3.3 本地开发配置

```json
{
  "mcpServers": {
    "fetcher-mcp-dev": {
      "command": "node",
      "args": ["C:/Users/53101/Desktop/project/work/fetcher-mcp/build/index.js"],
      "env": {
        "FETCHER_TIMEOUT": "30000",
        "FETCHER_EXTRACT_CONTENT": "true",
        "FETCHER_DISABLE_MEDIA": "true",
        "FETCHER_DEBUG": "false"
      }
    }
  }
}
```

---

## 四、关键代码实现

### 4.1 环境变量配置管理

```typescript
// src/utils/config.ts
const ENV_PREFIX = "FETCHER_";

export function mergeConfig(toolArgs: any): FetchOptions {
  const defaults = getDefaultConfig();
  
  // 优先级：工具参数 > 环境变量 > 默认值
  return {
    timeout: Number(toolArgs?.timeout) || defaults.timeout || 30000,
    // ... 其他配置
    proxy: toolArgs?.proxy !== undefined ? toolArgs.proxy : defaults.proxy,
  };
}
```

### 4.2 代理配置

```typescript
// src/services/browserService.ts
if (this.options.proxy) {
  contextOptions.proxy = {
    server: this.options.proxy
  };
}
```

---

## 五、构建和发布流程

### 5.1 本地构建

```bash
# 1. 安装依赖
npm install

# 2. 构建项目
npm run build

# 3. 本地测试
node build/index.js --log --transport=http --host=0.0.0.0 --port=3000
```

### 5.2 发布到 NPM

```bash
# 1. 构建
npm run build

# 2. 登录
npm login

# 3. 发布（scoped package 需要 --access public）
npm publish --access public
```

### 5.3 构建 Docker 镜像

```bash
# 构建
docker build -t 531014023/fetcher-mcp:0.4.1 -t 531014023/fetcher-mcp:latest .

# 运行
docker run -d -p 3000:3000 --name fetcher-mcp 531014023/fetcher-mcp:latest

# 推送
docker push 531014023/fetcher-mcp:0.4.1
docker push 531014023/fetcher-mcp:latest
```

---

## 六、总结

### 核心经验

1. **跨平台兼容性**：Windows 开发时注意命令兼容性，使用 `rimraf` 替代 `rm -rf`

2. **网络环境问题**：Docker 构建时遇到网络问题，配置镜像加速器是最有效的解决方案：
   - 中科大镜像：`https://docker.mirrors.ustc.edu.cn`
   - 网易云镜像：`https://hub-mirror.c.163.com`
   - 百度云镜像：`https://mirror.baidubce.com`

3. **配置管理**：环境变量配置是很好的功能，可以让部署更灵活

4. **版本管理**：发布自己的版本时，使用 scoped package 避免冲突

5. **调试技巧**：
   - 使用 `FETCHER_DEBUG=true` 查看浏览器窗口
   - 使用 `node` 直接运行便于调试
   - 构建失败时检查网络连接和镜像加速器配置

---

## 七、相关文件清单

| 文件 | 说明 |
|------|------|
| `src/utils/config.ts` | 环境变量配置管理 |
| `src/services/browserService.ts` | 浏览器服务（含代理配置） |
| `src/tools/fetchUrl.ts` | fetch_url 工具实现 |
| `src/tools/fetchUrls.ts` | fetch_urls 工具实现 |
| `Dockerfile` | Docker 构建文件 |
| `docker-compose.yml` | Docker Compose 配置 |
| `package.json` | 包配置 |
| `BUILD.md` | Docker 构建说明 |

---

*文档版本：0.4.1*  
*最后更新：2026-03-14*
