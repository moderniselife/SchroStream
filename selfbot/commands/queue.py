"""Queue command — manage playback queue via IPC."""

from __future__ import annotations

from typing import TYPE_CHECKING
import discord

from ..ipc import ipc
from ..helpers import get_voice_channel

if TYPE_CHECKING:
    from ..client import SchroStreamBot


async def queue_command(bot: SchroStreamBot, message: discord.Message, args: list[str]) -> None:
    if not message.guild:
        await message.channel.send("❌ This command can only be used in a server")
        return

    guild_id = str(message.guild.id)
    sub = args[0].lower() if args else "list"

    if sub == "list" or sub == "show":
        result = await ipc.queue_list(guild_id)
        if not result.get("success"):
            await message.channel.send("❌ Failed to get queue")
            return
        items = result.get("items", [])
        if not items:
            await message.channel.send("📋 **Queue is empty**\n\nUse `!queue add <number>` after searching to add items.")
            return
        lines = [f"**{i+1}.** {item.get('title', 'Unknown')}" for i, item in enumerate(items)]
        await message.channel.send("📋 **Playback Queue**\n\n" + "\n".join(lines))

    elif sub == "add":
        if len(args) < 2:
            await message.channel.send("❌ Usage: `!queue add <number>` (search result number)")
            return
        try:
            num = int(args[1])
        except ValueError:
            await message.channel.send("❌ Invalid number")
            return
        user_id = str(message.author.id)
        cached = bot.search_sessions.get(user_id, [])
        if not cached or num < 1 or num > len(cached):
            await message.channel.send("❌ Invalid selection. Use `!search` first")
            return
        item = cached[num - 1]
        result = await ipc.queue_add(guild_id, item)
        if result.get("success"):
            await message.channel.send(f"✅ Added **{item.get('title', 'Unknown')}** to queue")
        else:
            await message.channel.send(f"❌ {result.get('error', 'Failed to add to queue')}")

    elif sub == "remove":
        if len(args) < 2:
            await message.channel.send("❌ Usage: `!queue remove <number>`")
            return
        try:
            idx = int(args[1])
        except ValueError:
            await message.channel.send("❌ Invalid number")
            return
        result = await ipc.queue_remove(guild_id, idx)
        if result.get("success"):
            await message.channel.send(f"🗑️ Removed item #{idx} from queue")
        else:
            await message.channel.send(f"❌ {result.get('error', 'Failed to remove from queue')}")

    elif sub == "clear":
        result = await ipc.queue_clear(guild_id)
        if result.get("success"):
            await message.channel.send("🗑️ Queue cleared")
        else:
            await message.channel.send(f"❌ {result.get('error', 'Failed to clear queue')}")

    elif sub == "start":
        voice_channel = get_voice_channel(message)
        if not voice_channel:
            await message.channel.send("❌ You must be in a voice channel")
            return
        result = await ipc.queue_start(guild_id, str(voice_channel.id), str(message.author.id))
        if result.get("success"):
            await message.channel.send(f"▶️ {result.get('message', 'Playing from queue')}")
        else:
            await message.channel.send(f"❌ {result.get('error', 'Queue is empty')}")

    elif sub == "next":
        voice_channel = get_voice_channel(message)
        if not voice_channel:
            await message.channel.send("❌ You must be in a voice channel")
            return
        result = await ipc.queue_next(guild_id, str(voice_channel.id), str(message.author.id))
        if result.get("success"):
            await message.channel.send(f"⏭️ {result.get('message', 'Playing next in queue')}")
        else:
            await message.channel.send(f"❌ {result.get('error', 'No more items in queue')}")

    else:
        await message.channel.send(
            "❌ Usage: `!queue [list|add|remove|clear|start|next]`"
        )
