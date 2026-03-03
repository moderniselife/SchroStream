"""YouTube search and play commands via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import get_voice_channel, format_duration

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def yt_search_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    query = " ".join(args)
    if not query:
        await message.channel.send("❌ Usage: `!yts <query>`")
        return

    status_msg = await message.channel.send(f'🔍 Searching YouTube for "{query}"...')

    result = await ipc.youtube_search(query)

    if not result.get("success"):
        await status_msg.edit(content=f"❌ {result.get('error', 'Search failed')}")
        return

    results = result.get("results", [])
    if not results:
        await status_msg.edit(content=f'❌ No results found for "{query}"')
        return

    # Cache for yt play command
    bot.yt_search_sessions[str(message.author.id)] = results

    lines: list[str] = []
    for i, item in enumerate(results[:20], 1):
        title = item.get("title", "Unknown")
        duration = item.get("duration", "N/A")
        channel = item.get("channel", "Unknown")
        views = item.get("views", "")
        views_str = f" • {views}" if views else ""
        lines.append(f"**{i}.** {title} [{duration}]\n   *{channel}{views_str}*")

    await status_msg.edit(
        content=f'🎬 **YouTube Results for "{query}":**\n\n' + "\n".join(lines) + "\n\n*Use `!ytp <number>` to play*"
    )


async def yt_play_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    if not args:
        await message.channel.send("❌ Usage: `!ytp <number>`")
        return

    try:
        num = int(args[0])
    except ValueError:
        await message.channel.send("❌ Usage: `!ytp <number>`")
        return

    user_id = str(message.author.id)
    cached = bot.yt_search_sessions.get(user_id, [])
    if not cached or num < 1 or num > len(cached):
        await message.channel.send("❌ Invalid selection. Use `!yts` to search first")
        return

    item = cached[num - 1]
    url = item.get("url") or f"https://youtube.com/watch?v={item.get('id', '')}"

    voice_channel = get_voice_channel(message)
    if not voice_channel:
        await message.channel.send("❌ You must be in a voice channel to use this command")
        return

    status_msg = await message.channel.send(f"🔍 Loading: {item.get('title', 'video')}...")

    result = await ipc.youtube_play(
        guild_id=str(message.guild.id),
        channel_id=str(voice_channel.id),
        url=url,
        user_id=str(message.author.id),
    )

    if result.get("success"):
        title = result.get("title", item.get("title", "YouTube Video"))
        duration = result.get("duration")
        dur_str = format_duration(duration) if duration else "Live/Unknown"
        await status_msg.edit(content=f"📺 **Now Streaming:** {title}\n⏱️ Duration: {dur_str}\n🎬 Enjoy the show!")
    else:
        await status_msg.edit(content=f"❌ {result.get('error', 'Failed to play')}")
