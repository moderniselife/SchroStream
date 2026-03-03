"""Stop command — stop the current stream via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def stop_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    result = await ipc.control_stop(str(message.guild.id))

    if result.get("success"):
        await message.channel.send("⏹️ Playback stopped")
    else:
        await message.channel.send(f"❌ {result.get('error', 'Nothing is currently playing')}")
