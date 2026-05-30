# NoneBot QQ Bridge

Minimal NoneBot2 bridge for SubtitleSync.

## What It Does

- Registers the OneBot V11 adapter.
- Listens for QQ group commands:
  - `/verify <code>`
  - `验证 <code>`
- Forwards verification events to the backend:
  - `POST {BACKEND_API_BASE}/qq/verify`
- Exposes a tiny HTTP API used by the backend QQ adapter:
  - `POST /send_group_msg`
  - `POST /send_private_msg`

## Install

```powershell
cd nonebot-bridge
python -m venv .venv
.\.venv\Scripts\pip install -e .
Copy-Item .env.example .env
```

Edit `.env`:

```env
BACKEND_API_BASE=http://127.0.0.1:3000/api/v1
QQ_BRIDGE_TOKEN=change-me
HOST=127.0.0.1
PORT=8095
```

Set the same token in backend `.env`:

```env
NONEBOT_HTTP_API=http://127.0.0.1:8095
QQ_BRIDGE_TOKEN=change-me
```

## Run

```powershell
cd nonebot-bridge
.\.venv\Scripts\python bot.py
```

Configure your OneBot V11 protocol implementation to use reverse WebSocket:

```text
ws://127.0.0.1:8095/onebot/v11/ws
```

## Backend Flow

1. User registers under QQ verification mode.
2. Backend returns `/verify <code>`.
3. User sends `/verify <code>` in the configured QQ group.
4. NoneBot receives the group message and calls `POST /api/v1/qq/verify`.
5. Backend checks group id, activates the account, and marks the challenge used.

## Notification Flow

1. Backend notification delivery calls `NONEBOT_HTTP_API/send_group_msg`.
2. Bridge sends OneBot group message with CQ `at` mentions.
