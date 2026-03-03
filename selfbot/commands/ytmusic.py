"""YouTube Music command via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import get_voice_channel, parse_time_string

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def yt_music_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    voice_channel = get_voice_channel(message)
    guild_id = str(message.guild.id)
    channel_id = str(voice_channel.id) if voice_channel else ""
    user_id = str(message.author.id)

    # Parse args — could be a URL, action, or query
    url: str | None = None
    action: str | None = None
    query: str | None = None
    start_time_ms = 0

    for i, arg in enumerate(args):
        lower = arg.lower()
        if lower in ("mix", "autoplay", "autoplay-off", "queue", "stop"):
            action = lower
        elif arg.startswith("http://") or arg.startswith("https://"):
            url = arg
        elif i > 0 and parse_time_string(arg) is not None:
            start_time_ms = parse_time_string(arg) or 0
        else:
            # Treat remaining as query
            query = " ".join(args[i:])
            break

    if not url and not action and not query:
        await message.channel.send(
            "❌ Usage: `!ytm <url>` or `!ytm mix [query]` or `!ytm autoplay`\n\n"
            "**Subcommands:**\n"
            "• `!ytm <url>` - Play YouTube audio with visualiser\n"
            "• `!ytm mix [query]` - Play auto-mix\n"
            "• `!ytm autoplay` - Enable autoplay recommendations\n"
            "• `!ytm autoplay-off` - Disable autoplay\n"
            "• `!ytm queue` - Show music queue status\n"
            "• `!ytm stop` - Stop music and clear queue"
        )
        return

    if not voice_channel and action not in ("queue", "autoplay", "autoplay-off"):
        await message.channel.send("❌ You must be in a voice channel to use this command")
        return

    status_msg = await message.channel.send("🎵 Loading music...")

    result = await ipc.youtube_music_play(
        guild_id=guild_id,
        channel_id=channel_id,
        url=url or "",
        user_id=user_id,
        action=action,
        query=query,
        start_time_ms=start_time_ms,
    )

    if result.get("success"):
        await status_msg.edit(content=result.get("message", "🎵 Music playing"))
    else:
        await status_msg.edit(content=f"❌ {result.get('error', 'Failed to play music')}")
