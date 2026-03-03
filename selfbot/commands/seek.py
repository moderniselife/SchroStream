"""Seek command via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import parse_time_string, format_duration

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def seek_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    if not args:
        await message.channel.send("❌ Usage: `!seek <time>` (e.g., `!seek 1:30:00` or `!seek 45:00`)")
        return

    time_ms = parse_time_string(args[0])
    if time_ms is None:
        await message.channel.send("❌ Invalid time format. Use `HH:MM:SS`, `MM:SS`, or seconds")
        return

    status_msg = await message.channel.send(f"⏩ Seeking to {format_duration(time_ms)}...")

    result = await ipc.control_seek(str(message.guild.id), time_ms)

    if result.get("success"):
        await status_msg.edit(content=f"⏩ Seeked to {format_duration(time_ms)}")
    else:
        await status_msg.edit(content="❌ Failed to seek")
