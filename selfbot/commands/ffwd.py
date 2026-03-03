"""Fast-forward and rewind commands via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import parse_time_string, format_duration

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def ffwd_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    time_arg = args[0] if args else "30"
    offset_ms = parse_time_string(time_arg)
    if offset_ms is None:
        await message.channel.send("❌ Invalid time format. Use `HH:MM:SS`, `MM:SS`, or seconds")
        return

    status_msg = await message.channel.send(f"⏩ Skipping forward {format_duration(offset_ms)}...")

    result = await ipc.control_ff(str(message.guild.id), offset_ms)

    if result.get("success"):
        new_time = result.get("newTime", 0)
        await status_msg.edit(
            content=f"⏩ Skipped forward {format_duration(offset_ms)} → {format_duration(new_time)}"
        )
    else:
        await status_msg.edit(content="❌ Failed to skip forward")


async def rewind_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    time_arg = args[0] if args else "30"
    offset_ms = parse_time_string(time_arg)
    if offset_ms is None:
        await message.channel.send("❌ Invalid time format. Use `HH:MM:SS`, `MM:SS`, or seconds")
        return

    status_msg = await message.channel.send(f"⏪ Rewinding {format_duration(offset_ms)}...")

    result = await ipc.control_rw(str(message.guild.id), offset_ms)

    if result.get("success"):
        new_time = result.get("newTime", 0)
        await status_msg.edit(
            content=f"⏪ Rewound {format_duration(offset_ms)} → {format_duration(new_time)}"
        )
    else:
        await status_msg.edit(content="❌ Failed to rewind")
