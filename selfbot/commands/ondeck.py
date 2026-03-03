"""On Deck command — show recently watched and resume via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import get_voice_channel, format_duration

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def ondeck_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    # If a number is provided, resume that item
    if args:
        try:
            index = int(args[0])
        except ValueError:
            index = None

        if index is not None and index >= 1:
            if not message.guild:
                await message.channel.send("❌ This command can only be used in a server")
                return

            voice_channel = get_voice_channel(message)
            if not voice_channel:
                await message.channel.send("❌ You must be in a voice channel to play")
                return

            # Get the deck to find the rating key
            deck_result = await ipc.plex_ondeck()
            if not deck_result.get("success"):
                await message.channel.send("❌ Failed to load watch deck")
                return

            deck = deck_result.get("deck", [])
            if index > len(deck):
                await message.channel.send("❌ Invalid selection")
                return

            entry = deck[index - 1]
            result = await ipc.plex_ondeck_play(
                guild_id=str(message.guild.id),
                channel_id=str(voice_channel.id),
                rating_key=entry["ratingKey"],
                user_id=str(message.author.id),
            )

            if result.get("success"):
                title = result.get("title", entry.get("title", "Unknown"))
                duration = result.get("duration")
                dur_str = format_duration(duration) if duration else "Unknown"
                await message.channel.send(f"📺 **Now Streaming:** {title}\n⏱️ Duration: {dur_str}")
            else:
                await message.channel.send(f"❌ {result.get('error', 'Failed to resume')}")
            return

    # No args — show the deck
    result = await ipc.plex_ondeck()

    if not result.get("success"):
        await message.channel.send("❌ Failed to load watch deck")
        return

    deck = result.get("deck", [])
    if not deck:
        await message.channel.send("📺 **On Deck**\n\nNo recently watched items yet. Start watching something!")
        return

    lines: list[str] = []
    for i, entry in enumerate(deck, 1):
        title = entry.get("title", "Unknown")
        if entry.get("type") == "episode" and entry.get("showTitle"):
            s = entry.get("seasonNum", 0)
            e = entry.get("episodeNum", 0)
            title = f"{entry['showTitle']} S{s:02d}E{e:02d} - {title}"

        position = entry.get("position", 0)
        duration = entry.get("duration", 0)
        pos_str = format_duration(position) if position else "0:00"
        dur_str = format_duration(duration) if duration else "??:??"
        pct = round((position / duration) * 100) if duration else 0

        lines.append(f"**{i}.** {title} — {pos_str} / {dur_str} ({pct}%)")

    response = f"📺 **On Deck** (Recently Watched)\n\n" + "\n".join(lines) + "\n\nUse `!ondeck <number>` to resume watching"
    await message.channel.send(response)
