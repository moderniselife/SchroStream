"""Pause/resume command via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def pause_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    result = await ipc.control_pause(str(message.guild.id))

    if result.get("success"):
        action = result.get("message", "Toggled")
        await message.channel.send(f"{'⏸️' if 'Pause' in action else '▶️'} {action}")
    else:
        await message.channel.send(f"❌ {result.get('error', 'Nothing is currently playing')}")
