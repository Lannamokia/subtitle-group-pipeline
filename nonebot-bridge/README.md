# NoneBot QQ Bridge

Minimal NoneBot2 bridge for SubtitleSync.

## What It Does

- Registers the OneBot V11 adapter.
- Listens for QQ commands:
  - `/verify <code>`
  - `验证 <code>`
  - `/resetpass <code>`
  - `重置密码 <code>`
  - `/rebindqq-old <code>`
  - `换绑旧QQ <code>`
  - `/rebindqq-new <code>`
  - `换绑新QQ <code>`
- Forwards verification events to the backend:
  - `POST {BACKEND_API_BASE}/qq/verify`
- Reports bridge liveness to the backend:
  - `POST {BACKEND_API_BASE}/qq/heartbeat`
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
HEARTBEAT_INTERVAL_SECONDS=30
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

## Password Reset Flow

1. User requests password reset from the login page.
2. Backend returns `/resetpass <code>`.
3. User sends `/resetpass <code>` from the QQ account bound to that user.
4. NoneBot forwards the command to `POST /api/v1/qq/verify`.
5. Backend verifies the code and allows the user to finish the reset in the web UI.

## QQ Rebind Flow

1. User starts QQ rebind from the profile page and enters the new QQ number.
2. Backend returns two commands: `/rebindqq-old <code>` and `/rebindqq-new <code>`.
3. User sends `/rebindqq-old <code>` from the old bound QQ account.
4. User sends `/rebindqq-new <code>` from the new QQ account.
5. NoneBot forwards both commands to `POST /api/v1/qq/verify`; backend only updates the account after the old QQ step is complete and the new QQ number is not already bound to another account.

## Heartbeat Flow

1. NoneBot starts a background heartbeat task when the bridge process starts.
2. Every `HEARTBEAT_INTERVAL_SECONDS`, the bridge calls `POST /api/v1/qq/heartbeat`.
3. Backend stores the latest heartbeat time, OneBot connection state, and bot account metadata.
4. The system health page reports QQ bridge online only when a recent heartbeat exists.

## Notification Flow

1. Backend notification delivery calls `NONEBOT_HTTP_API/send_group_msg`.
2. Bridge sends OneBot group message with CQ `at` mentions.
