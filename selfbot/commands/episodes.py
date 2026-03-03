"""Episodes command — list seasons/episodes for a show via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def episodes_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not args:
        await message.channel.send("❌ Usage: `!episodes <number>` (use `!search` first to find a show)")
        return

    try:
        selection = int(args[0])
    except ValueError:
        await message.channel.send("❌ Usage: `!episodes <number>` (use `!search` first to find a show)")
        return

    if selection < 1:
        await message.channel.send("❌ Usage: `!episodes <number>` (use `!search` first to find a show)")
        return

    user_id = str(message.author.id)
    cached = bot.search_sessions.get(user_id, [])
    if not cached or selection > len(cached):
        await message.channel.send("❌ Invalid selection. Use `!search` to find media first")
        return

    media_item = cached[selection - 1]

    if media_item.get("type") != "show":
        await message.channel.send(f'❌ "{media_item["title"]}" is not a TV show')
        return

    status_msg = await message.channel.send(f'📺 Loading episodes for "{media_item["title"]}"...')

    result = await ipc.plex_episodes(media_item["ratingKey"])

    if not result.get("success"):
        await status_msg.edit(content=f"❌ {result.get('error', 'Failed to load episodes')}")
        return

    episodes = result.get("episodes", [])
    if not episodes:
        await status_msg.edit(content="❌ No episodes found for this show")
        return

    # Group by season
    seasons: dict[int, list[dict]] = {}
    for ep in episodes:
        s_num = ep.get("parentIndex", 0)
        seasons.setdefault(s_num, []).append(ep)

    year = media_item.get("year", "N/A")
    lines: list[str] = [f'**📺 {media_item["title"]}** ({year})\n']

    for s_num in sorted(seasons.keys()):
        season_eps = seasons[s_num]
        label = "Specials" if s_num == 0 else f"Season {s_num}"
        lines.append(f"**{label}** ({len(season_eps)} episodes)")

        ep_list = sorted(season_eps, key=lambda e: e.get("index", 0))[:26]
        for ep in ep_list:
            ep_num = ep.get("index", 0)
            ep_str = f"E{ep_num:02d}" if ep_num else ""
            lines.append(f"  {ep_str} - {ep['title']}")

        if len(season_eps) > 26:
            lines.append(f"  *...and {len(season_eps) - 26} more*")
        lines.append("")

    lines.append(f"\n*Use `!play {selection} S01E01` to play a specific episode*")

    output = "\n".join(lines)
    if len(output) > 1900:
        # Send summary only
        summary = [f'**📺 {media_item["title"]}** ({year})\n']
        for s_num in sorted(seasons.keys()):
            season_eps = sorted(seasons[s_num], key=lambda e: e.get("index", 0))
            label = "Specials" if s_num == 0 else f"Season {s_num}"
            first_ep = season_eps[0].get("index", 1)
            last_ep = season_eps[-1].get("index", len(season_eps))
            summary.append(f"**{label}**: {len(season_eps)} episodes (E{first_ep:02d} - E{last_ep:02d})")
        summary.append(f"\n*Total: {len(episodes)} episodes*")
        summary.append(f"*Use `!play {selection} S01E01` to play a specific episode*")
        await status_msg.edit(content="\n".join(summary))
    else:
        await status_msg.edit(content=output)
