"""URL command — play external stream URLs via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import get_voice_channel

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def url_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    if not args:
        await message.channel.send(
            "❌ Usage: `!url <stream_url> [title]`\n\n"
            "**Supported formats:**\n"
            "• HLS streams (.m3u8, .m3u)\n"
            "• Direct video files (.mp4, .webm, .mkv, .avi, .mov)\n"
            "• MPEG-TS streams (.ts)\n"
            "• RTMP streams (rtmp://...)\n\n"
            "Example: `!url https://example.com/stream.m3u8 My Stream`"
        )
        return

    url = args[0]
    title = " ".join(args[1:]) or "External Stream"

    voice_channel = get_voice_channel(message)
    if not voice_channel:
        await message.channel.send("❌ You must be in a voice channel to use this command")
        return

    status_msg = await message.channel.send(f"🔗 Loading stream...")

    result = await ipc.url_play(
        guild_id=str(message.guild.id),
        channel_id=str(voice_channel.id),
        url=url,
        title=title,
        user_id=str(message.author.id),
    )

    if result.get("success"):
        stream_type = result.get("streamType", "Unknown")
        await status_msg.edit(content=f"📺 **Now Streaming:** {title}\n📡 Type: {stream_type}")
    else:
        await status_msg.edit(content=f"❌ {result.get('error', 'Failed to play stream')}")
