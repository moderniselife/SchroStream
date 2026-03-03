"""YouTube command — play YouTube videos via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import get_voice_channel, parse_time_string, format_duration

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def youtube_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    if not args:
        await message.channel.send(
            "❌ Usage: `!yt <url> [time]`\n"
            "Example: `!yt https://youtu.be/abc123 6:30`\n"
            "Supports YouTube, Twitch, Twitter/X, and 1000+ other sites via yt-dlp"
        )
        return

    url = args[0]

    # Parse optional time argument
    start_time_ms = 0
    if len(args) > 1:
        parsed = parse_time_string(args[1])
        if parsed is not None:
            start_time_ms = parsed

    voice_channel = get_voice_channel(message)
    if not voice_channel:
        await message.channel.send("❌ You must be in a voice channel to use this command")
        return

    status_msg = await message.channel.send("🔍 Fetching video info...")

    result = await ipc.youtube_play(
        guild_id=str(message.guild.id),
        channel_id=str(voice_channel.id),
        url=url,
        user_id=str(message.author.id),
        start_time_ms=start_time_ms,
    )

    if result.get("success"):
        title = result.get("title", "YouTube Video")
        duration = result.get("duration")
        dur_str = format_duration(duration) if duration else "Live/Unknown"
        uploader = result.get("uploader", "")
        uploader_line = f"👤 {uploader}\n" if uploader else ""

        await status_msg.edit(
            content=(
                f"📺 **Now Streaming:** {title}\n"
                f"{uploader_line}"
                f"⏱️ Duration: {dur_str}\n"
                f"🎬 Enjoy the show!"
            )
        )
    else:
        await status_msg.edit(content=f"❌ {result.get('error', 'Failed to play')}")
