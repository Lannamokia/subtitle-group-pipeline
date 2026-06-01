import os
import asyncio
from typing import Any

import httpx
from nonebot import get_driver, logger, on_command
from nonebot.adapters.onebot.v11 import Bot, GroupMessageEvent, Message, MessageEvent, MessageSegment
from nonebot.params import CommandArg

BACKEND_API_BASE = os.getenv("BACKEND_API_BASE", "http://127.0.0.1:3000/api/v1").rstrip("/")
QQ_BRIDGE_TOKEN = os.getenv("QQ_BRIDGE_TOKEN", "")
HEARTBEAT_INTERVAL_SECONDS = max(10, int(os.getenv("HEARTBEAT_INTERVAL_SECONDS", "30")))


def auth_headers() -> dict[str, str]:
    if not QQ_BRIDGE_TOKEN:
        return {}
    return {"Authorization": f"Bearer {QQ_BRIDGE_TOKEN}"}


async def post_backend(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{BACKEND_API_BASE}{path}",
            json=payload,
            headers=auth_headers(),
        )
        response.raise_for_status()
        data = response.json()
        return data.get("data", data)


verify = on_command("verify", aliases={"验证"}, priority=5, block=True)
resetpass = on_command("resetpass", aliases={"重置密码"}, priority=5, block=True)
rebindqq_old = on_command("rebindqq-old", aliases={"换绑旧QQ"}, priority=5, block=True)
rebindqq_new = on_command("rebindqq-new", aliases={"换绑新QQ"}, priority=5, block=True)


@verify.handle()
async def handle_verify(event: GroupMessageEvent, args: Message = CommandArg()):
    code = args.extract_plain_text().strip()
    if not code:
        await verify.finish("请输入验证码，例如：/verify ABCD1234")

    try:
        await post_backend(
            "/qq/verify",
            {
                "code": code,
                "qq_number": str(event.user_id),
                "qq_group": str(event.group_id),
            },
        )
    except httpx.HTTPStatusError as exc:
        logger.warning(f"QQ verification failed: {exc.response.text}")
        await verify.finish("验证失败，请确认验证码和群号是否正确。")
    except Exception as exc:
        logger.exception(f"QQ verification bridge error: {exc}")
        await verify.finish("验证服务暂时不可用，请稍后重试。")

    await verify.finish("验证成功，账号已激活。")


@resetpass.handle()
async def handle_resetpass(event: MessageEvent, args: Message = CommandArg()):
    code = args.extract_plain_text().strip()
    if not code:
        await resetpass.finish("请输入验证码，例如：/resetpass ABCD1234")

    payload: dict[str, Any] = {
        "message": f"/resetpass {code}",
        "qq_number": str(event.user_id),
    }
    if isinstance(event, GroupMessageEvent):
        payload["qq_group"] = str(event.group_id)

    try:
        await post_backend("/qq/verify", payload)
    except httpx.HTTPStatusError as exc:
        logger.warning(f"QQ password reset verification failed: {exc.response.text}")
        await resetpass.finish("密码重置验证失败，请确认验证码和 QQ 号是否正确。")
    except Exception as exc:
        logger.exception(f"QQ password reset bridge error: {exc}")
        await resetpass.finish("验证服务暂时不可用，请稍后重试。")

    await resetpass.finish("密码重置验证成功，请回到页面设置新密码。")


async def handle_rebind_command(
    matcher: Any,
    event: MessageEvent,
    args: Message,
    command: str,
    empty_hint: str,
    success_message: str,
):
    code = args.extract_plain_text().strip()
    if not code:
        await matcher.finish(empty_hint)

    payload: dict[str, Any] = {
        "message": f"/{command} {code}",
        "qq_number": str(event.user_id),
    }
    if isinstance(event, GroupMessageEvent):
        payload["qq_group"] = str(event.group_id)

    try:
        await post_backend("/qq/verify", payload)
    except httpx.HTTPStatusError as exc:
        logger.warning(f"QQ rebind verification failed: {exc.response.text}")
        await matcher.finish("QQ 换绑验证失败，请确认验证码、发送账号和验证顺序是否正确。")
    except Exception as exc:
        logger.exception(f"QQ rebind bridge error: {exc}")
        await matcher.finish("验证服务暂时不可用，请稍后重试。")

    await matcher.finish(success_message)


@rebindqq_old.handle()
async def handle_rebindqq_old(event: MessageEvent, args: Message = CommandArg()):
    await handle_rebind_command(
        rebindqq_old,
        event,
        args,
        "rebindqq-old",
        "请输入旧 QQ 验证码，例如：/rebindqq-old ABCD1234wxyz5678",
        "旧 QQ 验证成功，请用新 QQ 发送新 QQ 验证命令。",
    )


@rebindqq_new.handle()
async def handle_rebindqq_new(event: MessageEvent, args: Message = CommandArg()):
    await handle_rebind_command(
        rebindqq_new,
        event,
        args,
        "rebindqq-new",
        "请输入新 QQ 验证码，例如：/rebindqq-new ABCD1234wxyz5678",
        "QQ 换绑成功，请回到页面刷新个人信息。",
    )


driver = get_driver()


@driver.on_startup
async def show_onebot_endpoint():
    config = driver.config
    host = getattr(config, "host", "127.0.0.1")
    port = getattr(config, "port", 8095)
    logger.info(f"OneBot V11 reverse WebSocket endpoint: ws://{host}:{port}/onebot/v11/ws")


def get_onebot() -> Bot | None:
    bot = next(iter(driver.bots.values()), None)
    if bot is None or not isinstance(bot, Bot):
        return None
    return bot


def extract_message_id(result: Any) -> str:
    if isinstance(result, dict):
        message_id = result.get("message_id")
        return "" if message_id is None else str(message_id)
    if result is None:
        return ""
    return str(result)


async def build_heartbeat_payload() -> dict[str, Any]:
    bot = get_onebot()
    if bot is None:
        return {
            "status": "waiting_for_bot",
            "connected": False,
            "adapter": "onebot-v11",
            "error": "No OneBot V11 bot connected",
        }

    bot_id = str(bot.self_id)
    return {
        "status": "online",
        "connected": True,
        "bot_id": bot_id,
        "bot_nickname": None,
        "adapter": "onebot-v11",
    }


async def heartbeat_loop():
    while True:
        try:
            await post_backend("/qq/heartbeat", await build_heartbeat_payload())
        except Exception as exc:
            logger.warning(f"QQ bridge heartbeat failed: {exc}")
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)


@driver.on_startup
async def start_heartbeat():
    logger.info(f"QQ bridge heartbeat interval: {HEARTBEAT_INTERVAL_SECONDS}s")
    asyncio.create_task(heartbeat_loop())


@driver.server_app.post("/send_group_msg")
async def send_group_msg(payload: dict[str, Any]):
    group_id = int(payload["group_id"])
    message = Message(payload.get("message", ""))
    bot = get_onebot()
    if bot is None:
        return {"success": False, "error": "No OneBot V11 bot connected"}

    result = await bot.send_group_msg(
        group_id=group_id,
        message=message,
        auto_escape=bool(payload.get("auto_escape", False)),
    )
    return {"success": True, "message_id": extract_message_id(result)}


@driver.server_app.post("/send_private_msg")
async def send_private_msg(payload: dict[str, Any]):
    user_id = int(payload["user_id"])
    message = Message(payload.get("message", ""))
    bot = get_onebot()
    if bot is None:
        return {"success": False, "error": "No OneBot V11 bot connected"}

    result = await bot.send_private_msg(
        user_id=user_id,
        message=message,
        auto_escape=bool(payload.get("auto_escape", False)),
    )
    return {"success": True, "message_id": extract_message_id(result)}


def build_group_message(message: str, at_users: list[Any]) -> Message:
    result = Message()
    for user in at_users:
        result += MessageSegment.at(int(user))
        result += MessageSegment.text(" ")
    if at_users:
        result += MessageSegment.text("\n")
    result += MessageSegment.text(message)
    return result


@driver.server_app.post("/bridge/send_group")
async def bridge_send_group(payload: dict[str, Any]):
    group_id = int(payload["group_id"])
    message = str(payload.get("message", ""))
    at_users = payload.get("at_users") or []
    bot = get_onebot()
    if bot is None:
        return {"success": False, "error": "No OneBot V11 bot connected"}

    result = await bot.send_group_msg(
        group_id=group_id,
        message=build_group_message(message, at_users),
    )
    return {"success": True, "message_id": extract_message_id(result)}
