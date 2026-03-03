"""Shared helpers for the Python selfbot commands."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import discord

if TYPE_CHECKING:
    from .client import SchroStreamBot


def get_voice_channel(message: discord.Message) -> discord.VoiceChannel | None:
    """Return the voice channel the message author is in, or None."""
    if not message.guild:
        return None
    member = message.guild.get_member(message.author.id)
    if member and member.voice and member.voice.channel:
        return member.voice.channel  # type: ignore[return-value]
    return None


def parse_time_string(time_str: str) -> int | None:
    """Parse a time string like '1:30:00', '45:00', or '90' into milliseconds.

    Returns None if the format is invalid.
    """
    time_str = time_str.strip()

    # HH:MM:SS
    m = re.match(r"^(\d+):(\d{1,2}):(\d{1,2})$", time_str)
    if m:
        h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return (h * 3600 + mi * 60 + s) * 1000

    # MM:SS
    m = re.match(r"^(\d+):(\d{1,2})$", time_str)
    if m:
        mi, s = int(m.group(1)), int(m.group(2))
        return (mi * 60 + s) * 1000

    # Seconds (with optional 's' suffix)
    m = re.match(r"^(\d+)s?$", time_str)
    if m:
        return int(m.group(1)) * 1000

    return None


def format_duration(ms: int) -> str:
    """Format milliseconds into HH:MM:SS or MM:SS."""
    total_seconds = max(0, ms // 1000)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60

    if hours > 0:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def create_progress_bar(percentage: float, length: int = 20) -> str:
    """Create a text-based progress bar."""
    filled = round((percentage / 100) * length)
    empty = length - filled
    return f"[{'▓' * filled}{'░' * empty}]"
