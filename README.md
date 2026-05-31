# 字幕组协作平台

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
