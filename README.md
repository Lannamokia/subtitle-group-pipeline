# 字幕组协作平台

## 工作流排序与任务联动

平台的项目工作流按分集推进。项目创建后会生成项目和分集结构，每一集下的任务按固定流水线串行流转，默认顺序为：

```text
片源 source
  -> 时轴 timing
  -> 翻译 translation
  -> 后期 post_production
  -> 压制 encoding
  -> 发布 release
```

核心规则：

- 每个项目可以有多集，项目页先进入集列表，再进入指定分集的任务流水线。
- 开项时不自动创建大量默认任务，监制或更高权限用户按需要手动创建每一步任务。
- 非翻译岗位按严格串行依赖执行：上游任务未完成并通过审核时，下游任务不能开始。
- 翻译岗位支持多人竞争式认领时间片段，但实际翻译执行按片段开始时间串行推进。
- 第一位译者从时轴成品开始填充字幕；第一段审核通过后，系统再通知下一段译者开始，并要求其基于上一段已通过成品继续翻译。
- 翻译全部片段完成并通过后，才解锁后期任务。
- 翻译、后期、压制、发布提交后都需要监制审核，通过后才会推进到下一阶段。
- 监制及以上权限可以重置进行中或已完成任务状态，也可以删除任务；后端会按依赖关系处理下游联动。
- 当上游任务被修改、重置或重新进入进行中状态时，已完成或已提交的下游任务会被级联重置并通知相关成员。
- 非发布岗位被级联重置时会保留历史文件版本；发布岗位被上游变更影响时会重置为待处理并丢弃已上传的发布产物，避免旧种子、旧网盘链接继续流转。
- 任务取消会冻结尚未开始的下游任务；已经进行中的任务不会被自动回收，但会产生提醒和审计记录。
- 成员可以主动把已领取任务退回可认领池，该操作会写入审计日志。
- 超期任务会被定时标记为超期并触发通知升级，但不会被系统自动回收。
- 文件上传和网盘链接都按任务、岗位、分集和版本记录。字幕、视频、发布文件等会遵守项目或模板中的上传策略。
- 字幕合并采用接近 git diff/patch 的文本补丁思路：只合并字幕文本变更，保留 ASS 结构和 Aegisub 私有 section；出现文本或结构冲突时不会强行合并，而是进入监制冲突处理流程。

这是一个面向字幕组协作流程的前后端项目，覆盖账号注册验证、项目开项、分集任务、任务认领、文件版本管理、字幕合并、公告、通知渠道、系统设置和 QQ 机器人桥接等功能。

## 技术栈

### 后端

- Node.js + TypeScript
- Express
- Prisma ORM
- SQLite / MySQL 或 MariaDB / PostgreSQL
- Zod 参数校验
- JWT 鉴权
- Multer 与 S3 预签名分片直传
- AWS SDK S3 Client，支持 S3 兼容对象存储
- Nodemailer 邮件通知
- node-cron 定时任务
- Jest + ts-jest 后端测试

后端目录：

```text
backend/
  src/                 # Express 模块源码
  prisma/              # Prisma schema 和迁移
  scripts/             # Prisma Client 动态生成脚本
  uploads/             # 本地存储后端默认目录
```

### 前端

- React 19
- TypeScript
- Vite
- Tailwind CSS v3
- shadcn/ui 风格组件
- Radix UI primitives
- React Router
- React Hook Form + Zod
- Zustand
- Sonner toast
- Lucide React 图标

前端目录：

```text
frontend/app/
  src/                 # 页面、组件、API 封装、类型定义
  public/              # 静态资源目录，如后续添加可放这里
  dist/                # 构建产物
```

### QQ 机器人桥接器

- Python 3.10+
- NoneBot2
- nonebot-adapter-onebot
- FastAPI / httpx driver
- OneBot V11 反向 WebSocket

桥接器目录：

```text
nonebot-bridge/
  bot.py
  pyproject.toml
  plugins/qq_bridge.py
```

完整运行说明见 [nonebot-bridge/README.md](nonebot-bridge/README.md)。

## 运行前准备

需要安装：

- Node.js 20 或更高版本。
- npm。
- Python 3.10 或更高版本，仅 QQ 桥接器需要。
- 可选数据库：
  - SQLite，适合本机开发和轻量部署。
  - MySQL / MariaDB。
  - PostgreSQL。
- 可选对象存储：
  - 本地文件存储。
  - S3 或 S3 兼容服务，例如 MinIO、Cloudflare R2、阿里云 OSS S3 兼容端点等。
- 可选 OneBot V11 QQ 协议端，用于 QQ 验证和 QQ 通知。

## 安装依赖

根目录只有少量辅助依赖，主要依赖在后端和前端各自目录中。

```bash
npm install

cd backend
npm install

cd ../frontend/app
npm install
```

QQ 桥接器依赖：

```bash
cd nonebot-bridge
python3 -m venv .venv
./.venv/bin/python -m pip install -U pip
./.venv/bin/pip install -e .
cp .env.example .env
```

Windows PowerShell：

```powershell
cd nonebot-bridge
python -m venv .venv
.\.venv\Scripts\python -m pip install -U pip
.\.venv\Scripts\pip install -e .
Copy-Item .env.example .env
```

## 初始化方式

后端允许在数据库未连接或未初始化时启动。第一次打开前端时会进入初始化页面。

默认地址：

```text
前端：http://localhost:5173
后端：http://localhost:3000
初始化页面：http://localhost:5173/setup
```

初始化页面需要填写：

- 数据库类型和连接串。
- JWT Secret，页面提供随机生成按钮。
- 初始超级管理员账号。
- 默认存储后端，用于头像、logo、项目文件等基础数据。

数据库连接串示例：

```text
SQLite:      file:./dev.db
MySQL:       mysql://user:password@127.0.0.1:3306/subtitle_group
MariaDB:     mariadb://user:password@127.0.0.1:3306/subtitle_group
PostgreSQL:  postgresql://user:password@127.0.0.1:5432/subtitle_group?schema=public
```

注意：

- 初始化时选择数据库类型，不要求同一个运行进程同时连接多种数据库。
- MySQL 和 MariaDB 走 Prisma 的 MySQL provider。
- PostgreSQL 用户必须有建表权限；如果使用 `public` schema，需要具备 `USAGE` 和 `CREATE` 权限。
- 初始化完成后，非 SQLite provider 会自动重启后端进程以加载对应的 Prisma Client provider。

## 后端环境变量

后端示例文件在 `backend/.env.example`。常用字段：

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=file:./dev.db
DATABASE_AUTO_UPGRADE=true
JWT_SECRET=please-generate-a-long-random-secret
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_ROUNDS=12
CORS_ORIGIN=http://localhost:5173
UPLOAD_MAX_SIZE=536870912000
UPLOAD_DIR=./uploads
API_PREFIX=/api/v1

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

NONEBOT_HTTP_API=http://127.0.0.1:8095
QQ_BRIDGE_TOKEN=
```

`DATABASE_AUTO_UPGRADE=true` 时，后端启动会尝试把已配置数据库同步到当前 schema。生产环境升级前仍建议先备份数据库。

## 开发环境启动

启动后端：

```bash
cd backend
npm run dev
```

启动前端：

```bash
cd frontend/app
npm run dev
```

启动 QQ 桥接器：

```bash
cd nonebot-bridge
./.venv/bin/python bot.py
```

Windows PowerShell：

```powershell
cd nonebot-bridge
.\.venv\Scripts\python bot.py
```

开发时推荐三个终端分别运行后端、前端、QQ 桥接器。前端 Vite 默认端口是 `5173`，后端默认端口是 `3000`，桥接器默认端口是 `8095`。

## 构建

后端类型检查：

```bash
cd backend
npm run typecheck
```

后端构建：

```bash
cd backend
npm run build
```

前端构建：

```bash
cd frontend/app
npm run build
```

前端本地预览：

```bash
cd frontend/app
npm run preview
```

## Docker Compose 部署

当前仓库提供一套两镜像应用拆分方式：

```text
subtitle-platform-app     # 前端静态资源 + 后端 API + Caddy 反向代理
subtitle-platform-qqbot   # NoneBot QQ 桥接器
postgres/mysql 可选       # 数据库服务，可以使用 compose 内置 postgres profile，也可以连接外部数据库
onebot 协议端可选         # NapCat / Lagrange 等协议端，需要自行部署并连接 QQ 桥接器
```

对应文件：

```text
Dockerfile                    # app 镜像，构建前端和后端，并内置 Caddy
docker/Caddyfile              # Caddy 静态托管和 API 反代规则
docker/entrypoint.sh          # 写入前端运行时配置并启动后端 + Caddy
nonebot-bridge/Dockerfile     # QQ 桥接器镜像
compose.yml                   # Compose 编排
.env.compose.example          # Compose 环境变量模板
```

### 快速启动

```bash
cp .env.compose.example .env
docker compose up -d --build
```

默认访问：

```text
平台入口：http://localhost:8080
后端健康检查：http://localhost:8080/health
QQ 桥接器：http://localhost:8095
OneBot 反向 WebSocket：ws://localhost:8095/onebot/v11/ws
```

第一次进入平台时仍然走图形化初始化页。Compose 不强制预置数据库连接串；初始化页会把数据库连接参数和 JWT Secret 写入 `app-config` volume 中的 `/app/config/backend.env`，容器重启后继续使用。

### 使用内置 PostgreSQL

如果希望 Compose 同时启动 PostgreSQL：

```bash
cp .env.compose.example .env
docker compose --profile postgres up -d --build
```

初始化页面中的 PostgreSQL 连接串填写：

```text
postgresql://subtitle:subtitle@postgres:5432/subtitle?schema=public
```

这里的 `postgres` 是 Compose 网络里的服务名，不是宿主机地址。如果改了 `.env` 里的 `POSTGRES_DB`、`POSTGRES_USER` 或 `POSTGRES_PASSWORD`，连接串也要同步修改。

### 使用内置 MySQL

如果希望 Compose 同时启动 MySQL：

```bash
cp .env.compose.example .env
docker compose --profile mysql up -d --build
```

初始化页面中的 MySQL 连接串填写：

```text
mysql://subtitle:subtitle@mysql:3306/subtitle
```

这里的 `mysql` 是 Compose 网络里的服务名。如果改了 `.env` 里的 `MYSQL_DATABASE`、`MYSQL_USER` 或 `MYSQL_PASSWORD`，连接串也要同步修改。

### 使用外部数据库

外部 PostgreSQL / MySQL / MariaDB 不需要启用 `postgres` profile。直接启动应用和 QQ 桥接器：

```bash
docker compose up -d --build
```

然后在初始化页面填写外部数据库连接串。容器内访问宿主机数据库时，Docker Desktop 可以用 `host.docker.internal`；Linux 服务器建议直接使用数据库服务器的内网 IP 或同一 Docker 网络中的服务名。

### 域名和 Caddy

默认 `APP_HTTP_PORT=8080`，适合本地测试。如果域名是 `1.xyz`，希望公网直接访问：

1. 修改 `.env`：

```env
CADDY_SITE_ADDRESS=1.xyz
CORS_ORIGIN=https://1.xyz
FRONTEND_API_BASE_URL=/api/v1
```

2. 在 `compose.yml` 中开放 80/443：

```yaml
ports:
  - "80:80"
  - "443:443"
```

这样 `https://1.xyz/api/v1/*` 会被 Caddy 反向代理到 app 容器内部的 `127.0.0.1:3000/api/v1/*`，前端路由由 Caddy 从 `/srv/frontend` 托管。

### 环境变量注入

Compose 会读取项目根目录的 `.env` 做变量注入。推荐先复制模板：

```bash
cp .env.compose.example .env
```

#### 对外访问与 Caddy

| 变量名 | 注入位置 | 默认值 | 示例 | 说明 |
|---|---|---:|---|---|
| `APP_HTTP_PORT` | Compose 端口映射 | `8080` | `18080` | 宿主机 HTTP 端口，映射到 app 容器的 `80`。本地访问地址就是 `http://localhost:<APP_HTTP_PORT>`。 |
| `APP_HTTPS_PORT` | Compose 端口映射 | `443` | `443` | HTTPS 端口。默认在 `compose.yml` 中注释，需要开启公网 HTTPS 时手动取消 `443:443` 映射。 |
| `CADDY_SITE_ADDRESS` | app / Caddy | `:80` | `1.xyz` | Caddy 站点地址。本地测试用 `:80`；绑定域名并开放 80/443 后可填域名以启用 Caddy 自动 HTTPS。 |
| `BACKEND_UPSTREAM` | app / Caddy | `127.0.0.1:3000` | `127.0.0.1:3000` | Caddy 反代目标。二合一镜像里 Caddy 和后端在同一容器内，通常不需要改。 |
| `CORS_ORIGIN` | app / 后端 | `http://localhost:8080` | `https://1.xyz` | 后端允许的前端来源。二合一部署通常填实际访问来源；不要传空字符串，临时不配置时直接不传。 |

#### 前端运行时

| 变量名 | 注入位置 | 默认值 | 示例 | 说明 |
|---|---|---:|---|---|
| `FRONTEND_API_BASE_URL` | app / 前端运行时 | `/api/v1` | `/api/v1` | 容器启动时写入 `/srv/frontend/config.js`，不需要重建镜像即可修改前端 API 地址。二合一部署保持 `/api/v1`。 |
| `FRONTEND_BACKEND_PORT` | app / 前端运行时 | 未设置 | `3000` | 仅当前端需要按当前 host 推断后端端口时使用；二合一 Caddy 部署一般不需要。 |
| `VITE_API_BASE_URL` | app 镜像构建参数 | `/api/v1` | `/api/v1` | 前端构建时默认 API 地址。运行时优先使用 `FRONTEND_API_BASE_URL` 写入的 `/config.js`。 |

#### 后端核心配置

| 变量名 | 注入位置 | 默认值 | 示例 | 说明 |
|---|---|---:|---|---|
| `DATABASE_URL` | app / 后端 | 空 | `postgresql://subtitle:subtitle@postgres:5432/subtitle?schema=public` | 数据库连接串。留空时走图形化初始化页，初始化结果会写入 `/app/config/backend.env`；填非空值时优先生效。 |
| `DATABASE_AUTO_UPGRADE` | app / 后端 | `true` | `true` | 启动时是否尝试同步当前 Prisma schema。生产库升级前仍建议先备份。 |
| `JWT_SECRET` | app / 后端 | 空 | `please-change-to-long-random-secret` | JWT 签名密钥。已有初始化库应注入当初使用的同一值，否则旧 token 会失效。留空时不覆盖 `/app/config/backend.env`。 |
| `JWT_EXPIRES_IN` | app / 后端 | `24h` | `7d` | 访问 token 有效期。 |
| `JWT_REFRESH_EXPIRES_IN` | app / 后端 | `7d` | `30d` | 刷新 token 有效期。 |
| `BCRYPT_ROUNDS` | app / 后端 | `12` | `12` | 密码哈希成本。数值越高越慢。 |
| `UPLOAD_MAX_SIZE` | app / 后端 | `536870912000` | `536870912000` | 后端允许的单文件大小上限，单位字节。默认约 500GB。 |
| `UPLOAD_DIR` | app / 后端 | `/app/uploads` | `/app/uploads` | 本地存储后端目录。Compose 默认挂载到 `app-uploads` volume。 |
| `ENV_FILE_PATH` | app / 后端 | `/app/config/backend.env` | `/app/config/backend.env` | 后端持久化环境配置文件路径。Compose 默认挂载到 `app-config` volume。通常不需要改。 |
| `API_PREFIX` | app / 后端 | `/api/v1` | `/api/v1` | 后端 API 前缀。改动后需要同步 Caddy 和前端配置。 |
| `PORT` | app / 后端 | `3000` | `3000` | 后端在容器内监听端口。二合一镜像里 Caddy 默认反代到这个端口。 |
| `NODE_ENV` | app / 后端 | `production` | `production` | Node 运行环境。容器部署保持 `production`。 |

#### 初始化后端重启

| 变量名 | 注入位置 | 默认值 | 示例 | 说明 |
|---|---|---:|---|---|
| `SETUP_RESTART_DELAY_MS` | app / 后端 | `1500` | `1500` | 初始化完成后主进程退出重启前的等待时间，单位毫秒。 |
| `SETUP_RESTART_CHILD_DELAY_MS` | app / 后端 | `1500` | `1500` | 非托管进程模式下派生重启 helper 的等待时间，单位毫秒。容器中主要依赖 Docker restart policy。 |

#### QQ 机器人桥接器

| 变量名 | 注入位置 | 默认值 | 示例 | 说明 |
|---|---|---:|---|---|
| `QQ_BRIDGE_TOKEN` | app + qqbot | 空 | `change-this-to-a-long-random-secret` | 后端和 QQ 桥接器共享 secret。系统设置里的 QQ bot secret 也应保持一致。 |
| `NONEBOT_HTTP_API` | app / 后端 | `http://qqbot:8095` | `http://qqbot:8095` | 后端调用 QQ 桥接器的 HTTP 地址。Compose 网络内使用服务名 `qqbot`。 |
| `QQ_BRIDGE_PORT` | qqbot 端口映射 | `8095` | `8095` | 宿主机暴露的 QQ 桥接器端口，也是 OneBot 反向 WebSocket 默认端口。 |
| `HEARTBEAT_INTERVAL_SECONDS` | qqbot | `30` | `30` | QQ 桥接器向后端上报心跳的间隔，单位秒。 |
| `QQBOT_LOG_LEVEL` | qqbot | `INFO` | `DEBUG` | QQ 桥接器日志级别。 |

#### 邮件通知

| 变量名 | 注入位置 | 默认值 | 示例 | 说明 |
|---|---|---:|---|---|
| `SMTP_HOST` | app / 后端 | 空 | `smtp.example.com` | SMTP 服务器地址。留空表示不通过环境变量配置邮件服务。 |
| `SMTP_PORT` | app / 后端 | `587` | `465` | SMTP 端口。 |
| `SMTP_USER` | app / 后端 | 空 | `notice@example.com` | SMTP 用户名。 |
| `SMTP_PASS` | app / 后端 | 空 | `app-password` | SMTP 密码或授权码。 |
| `SMTP_FROM` | app / 后端 | 空 | `SubtitleSync <notice@example.com>` | 邮件发件人。 |

#### 可选数据库服务 profile

| 变量名 | 注入位置 | 默认值 | 示例 | 说明 |
|---|---|---:|---|---|
| `POSTGRES_DB` | `postgres` profile | `subtitle` | `subtitle` | 内置 PostgreSQL 数据库名。 |
| `POSTGRES_USER` | `postgres` profile | `subtitle` | `subtitle` | 内置 PostgreSQL 用户名。 |
| `POSTGRES_PASSWORD` | `postgres` profile | `subtitle` | `strong-password` | 内置 PostgreSQL 密码。 |
| `MYSQL_DATABASE` | `mysql` profile | `subtitle` | `subtitle` | 内置 MySQL 数据库名。 |
| `MYSQL_USER` | `mysql` profile | `subtitle` | `subtitle` | 内置 MySQL 用户名。 |
| `MYSQL_PASSWORD` | `mysql` profile | `subtitle` | `strong-password` | 内置 MySQL 用户密码。 |
| `MYSQL_ROOT_PASSWORD` | `mysql` profile | `subtitle-root` | `strong-root-password` | 内置 MySQL root 密码。 |

常用连接串示例：

```text
Compose PostgreSQL:
postgresql://subtitle:subtitle@postgres:5432/subtitle?schema=public

Compose MySQL:
mysql://subtitle:subtitle@mysql:3306/subtitle

宿主机 PostgreSQL:
postgresql://user:password@host.docker.internal:5432/subtitle?schema=public

宿主机 MySQL:
mysql://user:password@host.docker.internal:3306/subtitle

容器内 SQLite:
file:/app/config/subtitle.db
```

留空处理规则：

- `DATABASE_URL`、`JWT_SECRET`、`QQ_BRIDGE_TOKEN`、`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM` 为空时，entrypoint 会在启动后端前取消这些空环境变量，避免覆盖 `/app/config/backend.env` 中的持久化配置。
- 其他变量如果传了空字符串，通常会被后端当成实际配置值读取；不确定时应直接不传，而不是传 `KEY=`。

### OneBot 协议端连接

`subtitle-platform-qqbot` 只负责 NoneBot 桥接，不包含 QQ 协议端。NapCat / Lagrange 等 OneBot V11 协议端需要连接到：

```text
ws://<服务器地址>:8095/onebot/v11/ws
```

如果协议端也在同一个 Compose 网络里，可以使用：

```text
ws://qqbot:8095/onebot/v11/ws
```

## 生产部署

一种常见部署方式：

1. 准备数据库。
2. 准备对象存储或本地存储目录。
3. 在服务器上安装 Node.js 和 npm。
4. 安装依赖：

```bash
cd backend
npm ci

cd ../frontend/app
npm ci
```

5. 构建：

```bash
cd backend
npm run build

cd ../frontend/app
npm run build
```

6. 启动后端：

```bash
cd backend
npm start
```

7. 用 Nginx、Caddy 或其他 Web 服务托管 `frontend/app/dist`，并把 `/api` 反向代理到后端。

Nginx 反向代理示例：

```nginx
server {
  listen 80;
  server_name example.com;

  root /opt/subtitle-group-pipeline/frontend/app/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

如果需要 QQ 通知，再按 [nonebot-bridge/README.md](nonebot-bridge/README.md) 部署桥接器，并在系统设置的通知渠道页面填写桥接器地址和 secret。

## 数据库升级

后端启动时会调用数据库自动升级逻辑：

```bash
cd backend
npm start
```

如果 `.env` 中有 `DATABASE_URL` 且 `DATABASE_AUTO_UPGRADE` 没有关闭，服务会尝试同步 schema。

手动同步 Prisma Client：

```bash
cd backend
npm run db:generate:auto
```

开发环境也可以使用：

```bash
cd backend
npm run db:push
```

生产数据库升级前建议：

- 备份数据库。
- 确认数据库用户拥有建表、改表权限。
- 在测试库先跑一次同版本升级。

## 测试

后端测试：

```bash
cd backend
npm test
```

后端覆盖率：

```bash
cd backend
npm run test:coverage
```

前端需求检查脚本：

```bash
cd frontend/app
npm run test:requirements
```

前端 lint：

```bash
cd frontend/app
npm run lint
```

当前测试环境会根据 Prisma Client provider 和测试数据库配置运行。如果切换过数据库 provider，建议先重新生成 Prisma Client，再跑测试。

## 主要运行端口

```text
后端 API:          http://localhost:3000/api/v1
前端开发服务:      http://localhost:5173
QQ 桥接器 HTTP:    http://localhost:8095
OneBot 反向 WS:    ws://localhost:8095/onebot/v11/ws
```

## 常见问题

### 打开首页进入初始化页

说明后端判断系统未初始化，通常是数据库不可连接、没有超级管理员账号，或没有默认启用的存储后端。进入 `/setup` 完成初始化。

### 前端 toast 提示数据库连接异常

说明后端已有数据库配置，但当前无法连接数据库。检查数据库服务、连接串、账号权限和网络。

### PostgreSQL 初始化提示 schema 权限不足

给数据库用户授予 schema 权限，例如：

```sql
GRANT USAGE, CREATE ON SCHEMA public TO your_user;
```

也可以创建专用 schema，并在连接串添加：

```text
?schema=your_schema
```

### S3 上传失败

检查：

- 存储后端配置里的 endpoint、region、bucket、access key、secret key 是否正确。
- bucket CORS 是否允许浏览器直传。
- 后端和浏览器是否都能访问对象存储 endpoint。
- 项目是否绑定了启用中的存储后端。

### QQ 桥接器离线

检查：

- `nonebot-bridge` 是否运行。
- OneBot 协议端是否连接了 `ws://<桥接器地址>:8095/onebot/v11/ws`。
- 系统设置中的 QQ 桥接器地址和 secret 是否与 `.env` 一致。
- 后端是否能访问桥接器 HTTP 地址。
