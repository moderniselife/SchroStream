"""Random command — play random media via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import get_voice_channel, format_duration

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def random_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    voice_channel = get_voice_channel(message)
    if not voice_channel:
        await message.channel.send("❌ You must be in a voice channel to use this command")
        return

    media_type = args[0].lower() if args else "any"
    if media_type not in ("movie", "show", "any"):
        await message.channel.send(
            "❌ Usage: `!random [movie|show|any]`\n\nExamples:\n"
            "- `!random` - Any random media\n"
            "- `!random movie` - Random movie\n"
            "- `!random show` - Random TV show episode"
        )
        return

    label = "movie or show" if media_type == "any" else media_type
    await message.channel.send(f"🎲 Finding a random {label}...")

    result = await ipc.plex_random(
        guild_id=str(message.guild.id),
        channel_id=str(voice_channel.id),
        user_id=str(message.author.id),
        media_type=media_type,
    )

    if result.get("success"):
        title = result.get("title", "Unknown")
        duration = result.get("duration")
        dur_str = format_duration(duration) if duration else "Unknown"
        await message.channel.send(f"🎲 **Now Streaming (Random):** {title}\n⏱️ Duration: {dur_str}")
    else:
        await message.channel.send(f"❌ {result.get('error', 'Failed to play random media')}")
