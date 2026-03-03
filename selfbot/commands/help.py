"""Help command."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..config import config

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def help_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    prefix = config.discord.prefix

    help_text = f"""**📺 SchroStream Commands**

**Media Search & Playback:**
`{prefix}search <query>` - Search for movies or TV shows
`{prefix}episodes <number>` - List seasons/episodes for a show
`{prefix}play <number>` - Play a result (S01E01 for shows)
`{prefix}play <number> S02E05` - Play specific episode
`{prefix}random [movie|show]` - Play random media
`{prefix}ondeck` - Show recently watched (resume)
`{prefix}queue` - View/manage playback queue
`{prefix}stop` - Stop the current stream

**Playback Controls:**
`{prefix}pause` - Pause playback (remembers position)
`{prefix}resume` - Resume paused playback
`{prefix}seek <time>` - Seek to time (e.g., `1:30:00` or `45:00`)
`{prefix}ff [time]` - Skip forward (default: 30s)
`{prefix}rw [time]` - Rewind (default: 30s)
`{prefix}skip` - Skip to next episode (TV shows only)
`{prefix}np` - Show what's currently playing
`{prefix}volume <0-200>` - Set volume (default: 100%)
`{prefix}speed <0.5-3>` - Set playback speed (e.g., `1.5` for 1.5x)

**External Sources:**
`{prefix}yt <url>` - Play YouTube/Twitch/etc via yt-dlp
`{prefix}yts <query>` - Search YouTube
`{prefix}ytp <number>` - Play YouTube search/trending result
`{prefix}ytrending [category]` - Show recommended YouTube videos
`{prefix}ytm <url>` - Play YouTube audio with music visualiser
`{prefix}url <url> [title]` - Play m3u8/stream URL directly

**Example:**
1. `{prefix}search breaking bad`
2. `{prefix}play 1`
3. Enjoy the stream! 🎬

*Your playback position is saved automatically and persists across restarts.*"""

    await message.channel.send(help_text)
