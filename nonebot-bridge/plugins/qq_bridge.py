import os
from typing import Any

import httpx
from nonebot import get_driver, logger, on_command
from nonebot.adapters.onebot.v11 import Bot, GroupMessageEvent, Message, MessageSegment
from nonebot.params import CommandArg

BACKEND_API_BASE = os.getenv("BACKEND_API_BASE", "http://127.0.0.1:3000/api/v1").rstrip("/")
QQ_BRIDGE_TOKEN = os.getenv("QQ_BRIDGE_TOKEN", "")


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


driver = get_driver()


@driver.on_startup
async def show_onebot_endpoint():
    config = driver.config
    host = getattr(config, "host", "127.0.0.1")
    port = getattr(config, "port", 8095)
    logger.info(f"OneBot V11 reverse WebSocket endpoint: ws://{host}:{port}/onebot/v11/ws")


@driver.server_app.post("/send_group_msg")
async def send_group_msg(payload: dict[str, Any]):
    group_id = int(payload["group_id"])
    message = Message(payload.get("message", ""))
    bot = next(iter(driver.bots.values()), None)
    if bot is None or not isinstance(bot, Bot):
        return {"success": False, "error": "No OneBot V11 bot connected"}

    result = await bot.send_group_msg(
        group_id=group_id,
        message=message,
        auto_escape=bool(payload.get("auto_escape", False)),
    )
    return {"success": True, "message_id": str(result.get("message_id", ""))}


@driver.server_app.post("/send_private_msg")
async def send_private_msg(payload: dict[str, Any]):
    user_id = int(payload["user_id"])
    message = Message(payload.get("message", ""))
    bot = next(iter(driver.bots.values()), None)
    if bot is None or not isinstance(bot, Bot):
        return {"success": False, "error": "No OneBot V11 bot connected"}

    result = await bot.send_private_msg(
        user_id=user_id,
        message=message,
        auto_escape=bool(payload.get("auto_escape", False)),
    )
    return {"success": True, "message_id": str(result.get("message_id", ""))}


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
    bot = next(iter(driver.bots.values()), None)
    if bot is None or not isinstance(bot, Bot):
        return {"success": False, "error": "No OneBot V11 bot connected"}

    result = await bot.send_group_msg(
        group_id=group_id,
        message=build_group_message(message, at_users),
    )
    return {"success": True, "message_id": str(result.get("message_id", ""))}
