# QQ 机器人桥接器运行说明

这个目录是字幕组协作平台的 NoneBot2 QQ 桥接器。它不直接保存业务数据，只负责把 QQ / OneBot V11 的消息事件转发给后端，并把后端的 QQ 通知请求发送到指定群或私聊。

## 功能范围

桥接器当前提供这些能力：

- 接入 OneBot V11 适配器，等待 QQ 协议端通过反向 WebSocket 连接。
- 接收 QQ 群或私聊中的验证命令，并转发给后端：
  - `/verify <验证码>` 或 `验证 <验证码>`
  - `/resetpass <验证码>` 或 `重置密码 <验证码>`
  - `/rebindqq-old <验证码>` 或 `换绑旧QQ <验证码>`
  - `/rebindqq-new <验证码>` 或 `换绑新QQ <验证码>`
- 向后端上报心跳，让系统健康检查页判断桥接器是否在线。
- 提供后端调用的 HTTP 发送接口：
  - `POST /send_group_msg`
  - `POST /send_private_msg`
  - `POST /bridge/send_group`

## 目录结构

```text
nonebot-bridge/
  bot.py                  # NoneBot 启动入口
  pyproject.toml          # Python 包和 NoneBot 插件配置
  .env.example            # 环境变量示例
  plugins/
    qq_bridge.py          # QQ 命令、心跳、消息发送接口
```

运行时生成的 `.venv/`、`__pycache__/`、日志文件不属于源码，不需要提交。

## 前置要求

运行桥接器需要：

- Python 3.10 或更高版本。
- 一个支持 OneBot V11 反向 WebSocket 的 QQ 协议端，例如 NapCat、Lagrange.OneBot 等。
- 后端服务已经启动，默认地址为 `http://127.0.0.1:3000/api/v1`。
- 系统设置里的通知渠道已经配置 QQ 桥接器地址和 secret。

桥接器监听的是 HTTP 和 WebSocket 服务。默认地址：

```text
http://127.0.0.1:8095
ws://127.0.0.1:8095/onebot/v11/ws
```

## 安装依赖

Windows PowerShell：

```powershell
cd nonebot-bridge
python -m venv .venv
.\.venv\Scripts\python -m pip install -U pip
.\.venv\Scripts\pip install -e .
Copy-Item .env.example .env
```

macOS / Linux：

```bash
cd nonebot-bridge
python3 -m venv .venv
./.venv/bin/python -m pip install -U pip
./.venv/bin/pip install -e .
cp .env.example .env
```

## 配置 `.env`

复制 `.env.example` 后，至少确认这些配置：

```env
DRIVER=~fastapi+~httpx
HOST=127.0.0.1
PORT=8095
LOG_LEVEL=INFO

BACKEND_API_BASE=http://127.0.0.1:3000/api/v1
QQ_BRIDGE_TOKEN=change-me
HEARTBEAT_INTERVAL_SECONDS=30
```

字段说明：

- `DRIVER`：NoneBot 驱动，当前桥接器需要 FastAPI 和 httpx。
- `HOST`：桥接器监听地址。只给本机后端和本机 OneBot 连接时用 `127.0.0.1`；跨机器部署时改成 `0.0.0.0` 并注意防火墙。
- `PORT`：桥接器监听端口，默认 `8095`。
- `BACKEND_API_BASE`：后端 API 基础地址，必须包含 `/api/v1`。
- `QQ_BRIDGE_TOKEN`：桥接器和后端共享密钥。建议填写长随机字符串，并和后端系统设置里的 QQ bot secret 保持一致。
- `HEARTBEAT_INTERVAL_SECONDS`：心跳上报间隔，最低会按 10 秒处理。

桥接器会从 `bot.py` 所在目录显式读取 `.env`，所以无论你在项目根目录执行 `python nonebot-bridge/bot.py`，还是进入 `nonebot-bridge` 后执行 `python bot.py`，都会读取 `nonebot-bridge/.env`。

## 后端配置

后端有两处和桥接器相关：

1. 后端环境变量可设置默认值：

```env
NONEBOT_HTTP_API=http://127.0.0.1:8095
QQ_BRIDGE_TOKEN=change-me
```

2. 系统设置页面的“通知渠道”里配置 QQ 桥接器：

- 桥接器地址：`http://127.0.0.1:8095`
- QQ bot secret：和桥接器 `.env` 里的 `QQ_BRIDGE_TOKEN` 一致

如果没有配置，健康检查页应显示 QQ 桥接器未配置；如果配置了但桥接器没有心跳或 OneBot 没连上，应显示未连接。

## 启动桥接器

Windows PowerShell：

```powershell
cd nonebot-bridge
.\.venv\Scripts\python bot.py
```

macOS / Linux：

```bash
cd nonebot-bridge
./.venv/bin/python bot.py
```

启动后日志里会出现类似内容：

```text
OneBot V11 reverse WebSocket endpoint: ws://127.0.0.1:8095/onebot/v11/ws
QQ bridge heartbeat interval: 30s
```

## 配置 OneBot 协议端

在 QQ 协议端中配置 OneBot V11 反向 WebSocket，地址填写：

```text
ws://127.0.0.1:8095/onebot/v11/ws
```

如果协议端和桥接器不在同一台机器，把 `127.0.0.1` 换成桥接器所在机器的局域网或公网地址，并确保 `HOST=0.0.0.0`、端口放行。

连接成功后，桥接器会从 OneBot 返回的 `self_id` 读取机器人 QQ 号，并通过心跳上报给后端。

## 验证流程

注册策略开启 QQ 群验证后：

1. 用户注册账号。
2. 后端返回需要发送的命令，例如 `/verify ABCD1234`。
3. 用户在配置好的 QQ 群发送该命令。
4. 桥接器收到群消息后调用：

```text
POST {BACKEND_API_BASE}/qq/verify
```

请求体包含验证码、发送者 QQ 号、QQ群号。

5. 后端校验群号和验证码，通过后激活账号。

## 密码自助重置流程

1. 用户在登录页点击忘记密码。
2. 后端生成验证码并提示用户发送：

```text
/resetpass <验证码>
```

3. 用户用已绑定 QQ 发送命令，群聊或私聊均可。
4. 桥接器把消息转发给 `POST /api/v1/qq/verify`。
5. 后端确认发送 QQ 与账号绑定关系后，允许用户回到网页设置新密码。

## QQ 换绑流程

换绑需要老 QQ 和新 QQ 双重验证：

1. 用户在个人设置页发起 QQ 换绑。
2. 后端生成两个命令：
   - `/rebindqq-old <验证码>`
   - `/rebindqq-new <验证码>`
3. 用户先用旧 QQ 发送旧 QQ 命令。
4. 用户再用新 QQ 发送新 QQ 命令。
5. 后端确认顺序正确、旧 QQ 归属正确、新 QQ 未被占用后完成换绑。

## 通知发送流程

后端发送 QQ 通知时会调用桥接器：

```text
POST http://127.0.0.1:8095/send_group_msg
POST http://127.0.0.1:8095/send_private_msg
```

群消息请求示例：

```json
{
  "group_id": "123456789",
  "message": "[CQ:at,qq=10001]\n任务需要处理",
  "auto_escape": false
}
```

带 `@` 的项目通知应该发到项目配置的 QQ 群；后端会负责决定群号和目标 QQ，桥接器只负责发送。

## 测试桥接器

可以在系统设置的通知渠道页面使用测试按钮：

- 邮件测试：填写目标邮箱。
- QQ 测试：填写群号和需要 `@` 的目标 QQ 号。

也可以直接用 HTTP 调试：

```bash
curl -X POST http://127.0.0.1:8095/send_group_msg \
  -H "Content-Type: application/json" \
  -d '{"group_id":"123456789","message":"测试消息","auto_escape":false}'
```

如果配置了 `QQ_BRIDGE_TOKEN`，后端请求会带 `Authorization: Bearer <secret>`；目前桥接器主要用该 secret 访问后端，外部访问桥接器端口时建议用防火墙或反向代理限制来源。

## 生产部署建议

Linux systemd 示例：

```ini
[Unit]
Description=Subtitle Group NoneBot QQ Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/subtitle-group-pipeline/nonebot-bridge
ExecStart=/opt/subtitle-group-pipeline/nonebot-bridge/.venv/bin/python bot.py
Restart=always
RestartSec=5
EnvironmentFile=/opt/subtitle-group-pipeline/nonebot-bridge/.env

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now subtitle-group-nonebot-bridge
sudo systemctl status subtitle-group-nonebot-bridge
```

反向代理时只建议暴露 OneBot 必须连接的 WebSocket 和后端必须访问的发送接口，不建议把桥接器端口直接公开到公网。

## 常见故障

### OneBot 连接被拒绝

日志示例：

```text
反向WebSocket 连接错误 connect ECONNREFUSED 127.0.0.1:8095
```

检查：

- 桥接器是否已经启动。
- OneBot 配置的地址和端口是否是桥接器实际监听地址。
- 跨机器部署时 `HOST` 是否为 `0.0.0.0`。
- 防火墙是否放行 `PORT`。

### 健康检查显示未配置

说明后端没有保存 QQ 桥接器配置。到系统设置的通知渠道页面配置桥接器地址和 secret。

### 健康检查显示未连接

说明后端收到了配置，但没有收到有效心跳，或心跳里 `connected=false`。检查桥接器是否运行，以及 OneBot 是否已经连上反向 WebSocket。

### 验证码失败

检查：

- 用户发送的验证码是否完整。
- 注册验证是否发送在后端配置的 QQ 群里。
- `BACKEND_API_BASE` 是否正确包含 `/api/v1`。
- 桥接器和后端的 `QQ_BRIDGE_TOKEN` 是否一致。

### QQ 消息发送失败

检查：

- OneBot 是否已连接，机器人是否在目标群里。
- 群号和 QQ 号是否填写为纯数字。
- 机器人是否有发言权限。
- 后端系统设置里的桥接器地址是否能从后端机器访问。
