"""Play command — play Plex media from search results via IPC."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import get_voice_channel, format_duration

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def play_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    voice_channel = get_voice_channel(message)
    if not voice_channel:
        await message.channel.send("❌ You must be in a voice channel to use this command")
        return

    if not args:
        await message.channel.send("❌ Usage: `!play <number>` (use `!search` first)")
        return

    # Handle resume/start subcommands
    first_arg = args[0].lower()
    if first_arg in ("resume", "r", "start", "new", "beginning"):
        # Delegate resume/start to the IPC backend
        result = await ipc._post("/api/ipc/plex/play-resume", {
            "guildId": str(message.guild.id),
            "channelId": str(voice_channel.id),
            "userId": str(message.author.id),
            "action": first_arg,
        })
        if result.get("success"):
            await message.channel.send(result.get("message", "▶️ Resuming..."))
        else:
            await message.channel.send(f"❌ {result.get('error', 'Failed')}")
        return

    # Parse selection number
    try:
        selection = int(args[0])
    except ValueError:
        await message.channel.send("❌ Usage: `!play <number>` (use `!search` first)")
        return

    if selection < 1:
        await message.channel.send("❌ Usage: `!play <number>` (use `!search` first)")
        return

    # Get cached search results
    user_id = str(message.author.id)
    cached = bot.search_sessions.get(user_id, [])
    if not cached or selection > len(cached):
        await message.channel.send("❌ Invalid selection. Use `!search` to find media first")
        return

    media_item = cached[selection - 1]

    # Parse optional episode selection (S02E05 format)
    episode_spec: str | None = None
    season_num: int | None = None
    episode_num: int | None = None

    if len(args) >= 2 and media_item.get("type") == "show":
        arg = args[1].upper()
        m = re.match(r"S(\d+)E(\d+)", arg)
        if m:
            season_num = int(m.group(1))
            episode_num = int(m.group(2))
        else:
            m = re.match(r"S(\d+)", arg)
            if m:
                nums = m.group(1)
                if len(nums) >= 3:
                    season_num = int(nums[:-2])
                    episode_num = int(nums[-2:])
                else:
                    season_num = int(nums)
                    episode_num = 1
            elif len(args) >= 3:
                try:
                    season_num = int(args[1])
                    episode_num = int(args[2])
                except ValueError:
                    pass

    status_msg = await message.channel.send(f'🎬 Loading "{media_item["title"]}"...')

    result = await ipc.plex_play(
        guild_id=str(message.guild.id),
        channel_id=str(voice_channel.id),
        rating_key=media_item["ratingKey"],
        user_id=str(message.author.id),
        start_time_ms=0,
    )

    # If it's a show, include episode info in the request
    if media_item.get("type") == "show":
        result = await ipc._post("/api/ipc/plex/play", {
            "guildId": str(message.guild.id),
            "channelId": str(voice_channel.id),
            "ratingKey": media_item["ratingKey"],
            "userId": str(message.author.id),
            "startTimeMs": 0,
            "seasonNum": season_num,
            "episodeNum": episode_num,
        })

    if result.get("success"):
        title = result.get("title", media_item["title"])
        duration = result.get("duration")
        dur_str = format_duration(duration) if duration else "Unknown"
        await status_msg.edit(content=f"📺 **Now Streaming (Go Live):** {title}\n⏱️ Duration: {dur_str}")
    else:
        await status_msg.edit(content=f"❌ {result.get('error', 'Failed to start stream')}")
