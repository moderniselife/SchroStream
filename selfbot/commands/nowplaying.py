"""Now playing command via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import format_duration, create_progress_bar

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def now_playing_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    result = await ipc.get_now_playing(str(message.guild.id))

    if not result.get("success"):
        await message.channel.send("❌ Nothing is currently playing")
        return

    data = result
    title = data.get("title", "Unknown")
    is_paused = data.get("isPaused", False)
    current = data.get("currentTime", 0)
    total = data.get("duration", 0)
    percentage = data.get("percentage", 0.0)

    status = "⏸️ Paused" if is_paused else "📺 Streaming (Go Live)"
    progress = f"{format_duration(current)} / {format_duration(total)}"
    bar = create_progress_bar(percentage)

    lines = [
        f"🎬 **{title}**",
        "",
        status,
        bar,
        f"⏱️ {progress} ({percentage:.1f}%)",
    ]

    year = data.get("year")
    if year:
        lines.append(f"📅 {year}")

    await message.channel.send("\n".join(lines))
