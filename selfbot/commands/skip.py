"""Skip command — skip to next episode via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def skip_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    status_msg = await message.channel.send("⏭️ Loading next episode...")

    result = await ipc.plex_skip(str(message.guild.id))

    if result.get("success"):
        title = result.get("title", "Next episode")
        duration = result.get("duration")
        dur_str = f"\n⏱️ Duration: {duration}" if duration else ""
        await status_msg.edit(content=f"⏭️ **Now Streaming:** {title}{dur_str}")
    else:
        await status_msg.edit(content=f"❌ {result.get('error', 'No next episode available')}")
