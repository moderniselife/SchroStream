"""YouTube trending command via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def yt_trending_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    category = args[0].lower() if args else "default"

    valid_categories = {
        "default", "all", "music", "gaming", "news", "movies", "sports", "learning", "tech",
    }
    if category == "all":
        category = "default"

    if category not in valid_categories:
        await message.channel.send(
            "❌ Usage: `!ytrending [category]`\n"
            "Categories: all, music, gaming, news, movies, sports, learning, tech"
        )
        return

    status_msg = await message.channel.send(f"📈 Fetching trending videos ({category})...")

    result = await ipc.youtube_trending(category)

    if not result.get("success"):
        await status_msg.edit(content=f"❌ {result.get('error', 'Failed to fetch trending')}")
        return

    results = result.get("results", [])
    if not results:
        await status_msg.edit(content="❌ No trending videos found")
        return

    # Cache for ytp command
    bot.yt_search_sessions[str(message.author.id)] = results

    lines: list[str] = []
    for i, item in enumerate(results[:20], 1):
        title = item.get("title", "Unknown")
        duration = item.get("duration", "N/A")
        channel = item.get("channel", "Unknown")
        views = item.get("views", "")
        views_str = f" • {views}" if views else ""
        lines.append(f"**{i}.** {title} [{duration}]\n   *{channel}{views_str}*")

    cat_label = f" ({category})" if category != "default" else ""
    await status_msg.edit(
        content=f"📈 **Trending YouTube Videos{cat_label}:**\n\n" + "\n".join(lines) + "\n\n*Use `!ytp <number>` to play*"
    )
