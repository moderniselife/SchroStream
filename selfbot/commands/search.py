"""Search command — search Plex media via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def search_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    query = " ".join(args)
    if not query:
        await message.channel.send("❌ Usage: `!search <query>`")
        return

    status_msg = await message.channel.send(f'🔍 Searching for "{query}"...')

    result = await ipc.plex_search(query)

    if not result.get("success"):
        await status_msg.edit(content=f'❌ Search failed: {result.get("error", "Unknown error")}')
        return

    items = result.get("results", [])
    if not items:
        await status_msg.edit(content=f'❌ No results found for "{query}"')
        return

    # Cache results for play command
    bot.search_sessions[str(message.author.id)] = items

    # Separate movies and TV shows
    movies = [i for i in items if i.get("type") == "movie"]
    shows = [i for i in items if i.get("type") == "show"]

    lines: list[str] = []
    idx = 1

    if movies:
        lines.append("**🎬 Movies**")
        for item in movies:
            year = f" ({item['year']})" if item.get("year") else ""
            rating = f" ⭐ {item['rating']}" if item.get("rating") else ""
            lines.append(f"**{idx}.** {item['title']}{year}{rating}")
            idx += 1

    if shows:
        if lines:
            lines.append("")
        lines.append("**📺 TV Shows**")
        for item in shows:
            year = f" ({item['year']})" if item.get("year") else ""
            rating = f" ⭐ {item['rating']}" if item.get("rating") else ""
            child_count = f" ({item['childCount']} seasons)" if item.get("childCount") else ""
            lines.append(f"**{idx}.** {item['title']}{year}{rating}{child_count}")
            idx += 1

    formatted = "\n".join(lines)
    await status_msg.edit(
        content=f'🎬 **Search Results for "{query}":**\n\n{formatted}\n\n*Use `!play <number>` to start streaming*'
    )
