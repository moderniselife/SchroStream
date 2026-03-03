"""Volume command via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def volume_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    guild_id = str(message.guild.id)

    # No args — show current volume
    if not args:
        result = await ipc.get_now_playing(guild_id)
        if result.get("success"):
            vol = result.get("volume", 100)
            await message.channel.send(f"🔊 Current volume: **{vol}%**")
        else:
            await message.channel.send("❌ Nothing is currently playing")
        return

    vol_str = args[0].replace("%", "")
    try:
        volume = int(vol_str)
    except ValueError:
        await message.channel.send("❌ Volume must be a number between 0 and 200")
        return

    if volume < 0 or volume > 200:
        await message.channel.send("❌ Volume must be a number between 0 and 200")
        return

    status_msg = await message.channel.send(f"🔊 Changing volume to **{volume}%**...")

    result = await ipc.control_volume(guild_id, volume)

    if result.get("success"):
        icon = "🔇" if volume == 0 else "🔈" if volume < 50 else "🔉" if volume < 100 else "🔊"
        await status_msg.edit(content=f"{icon} Volume set to **{volume}%**")
    else:
        await status_msg.edit(content="❌ Failed to set volume")
