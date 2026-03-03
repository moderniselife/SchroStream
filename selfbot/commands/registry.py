"""Command registry — maps command names to handler coroutines.

Mirrors the TypeScript src/bot/commands/index.ts command map.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable, Awaitable
import discord

if TYPE_CHECKING:
    from ..client import SchroStreamBot

CommandHandler = Callable[["SchroStreamBot", discord.Message, list[str]], Awaitable[None]]

# Import all command modules
from .help import help_command
from .search import search_command
from .play import play_command
from .stop import stop_command
from .pause import pause_command
from .seek import seek_command
from .skip import skip_command
from .nowplaying import now_playing_command
from .volume import volume_command
from .speed import speed_command
from .ffwd import ffwd_command, rewind_command
from .episodes import episodes_command
from .random_cmd import random_command
from .ondeck import ondeck_command
from .queue import queue_command
from .youtube import youtube_command
from .url import url_command
from .ytsearch import yt_search_command, yt_play_command
from .ytrending import yt_trending_command
from .ytmusic import yt_music_command

COMMANDS: dict[str, CommandHandler] = {
    # Help
    "help": help_command,
    "h": help_command,
    "commands": help_command,
    # Search & Play
    "search": search_command,
    "s": search_command,
    "play": play_command,
    "p": play_command,
    "stop": stop_command,
    "pause": pause_command,
    "resume": pause_command,
    # Seek & Navigation
    "seek": seek_command,
    "skip": skip_command,
    "next": skip_command,
    "ff": ffwd_command,
    "ffwd": ffwd_command,
    "forward": ffwd_command,
    "rw": rewind_command,
    "rewind": rewind_command,
    "back": rewind_command,
    # Playback info
    "np": now_playing_command,
    "nowplaying": now_playing_command,
    "playing": now_playing_command,
    # Audio / Speed
    "volume": volume_command,
    "vol": volume_command,
    "v": volume_command,
    "speed": speed_command,
    "playspeed": speed_command,
    # Episodes & Browse
    "episodes": episodes_command,
    "eps": episodes_command,
    "seasons": episodes_command,
    "random": random_command,
    "rand": random_command,
    # Watch deck
    "ondeck": ondeck_command,
    "deck": ondeck_command,
    "continue": ondeck_command,
    # Queue
    "queue": queue_command,
    "q": queue_command,
    # YouTube
    "yt": youtube_command,
    "youtube": youtube_command,
    "yts": yt_search_command,
    "ytsearch": yt_search_command,
    "ytp": yt_play_command,
    "ytplay": yt_play_command,
    "ytrending": yt_trending_command,
    "trend": yt_trending_command,
    "trending": yt_trending_command,
    "ytm": yt_music_command,
    "ytmusic": yt_music_command,
    "music": yt_music_command,
    # External URL
    "url": url_command,
    "stream": url_command,
    "m3u8": url_command,
}
