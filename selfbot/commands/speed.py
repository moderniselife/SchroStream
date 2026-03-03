"""Speed command via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def speed_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    guild_id = str(message.guild.id)

    # No args — show current speed
    if not args:
        result = await ipc.get_now_playing(guild_id)
        if result.get("success"):
            spd = result.get("speed", 1.0)
            await message.channel.send(
                f"⏩ Current playback speed: **{spd}x**\n\n"
                "Usage: `!speed <multiplier>`\n"
                "Examples: `!speed 1.5`, `!speed 2`, `!speed 0.75`\n"
                "Range: 0.5x - 3x"
            )
        else:
            await message.channel.send("❌ Nothing is currently playing")
        return

    speed_str = args[0].replace("x", "")
    try:
        speed = float(speed_str)
    except ValueError:
        await message.channel.send("❌ Invalid speed. Use a number like `1.5` or `2x`")
        return

    speed = max(0.5, min(3.0, speed))

    status_msg = await message.channel.send(f"⏩ Setting playback speed to {speed}x...")

    result = await ipc.control_speed(guild_id, speed)

    if result.get("success"):
        emoji = "⏩" if speed > 1 else "⏪" if speed < 1 else "▶️"
        await status_msg.edit(content=f"{emoji} Playback speed set to **{speed}x**")
    else:
        await status_msg.edit(content="❌ Failed to change playback speed")
