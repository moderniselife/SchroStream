"""SchroStream Python selfbot client.

Replaces the Node.js discord.js-selfbot-v13 client with discord.py-self.
Handles Discord gateway connection, message commands, and delegates all
backend operations to the TypeScript server via IPC.
"""

from __future__ import annotations

import logging
import discord
from discord.ext import commands

from .config import config
from .ipc import ipc

log = logging.getLogger("schrostream.client")


class SchroStreamBot(discord.Client):
    """Discord selfbot client using discord.py-self."""

    def __init__(self) -> None:
        super().__init__()
        self.prefix = config.discord.prefix
        # Per-user search session cache (user_id -> list of results)
        self.search_sessions: dict[str, list[dict]] = {}
        self.yt_search_sessions: dict[str, list[dict]] = {}

    # ------------------------------------------------------------------
    # Permission checks (mirrors the TS hasPermission logic)
    # ------------------------------------------------------------------

    def has_permission(self, message: discord.Message) -> bool:
        """Check whether the message author is allowed to issue commands."""
        # Always allow the bot's own account
        if message.author.id == self.user.id:  # type: ignore[union-attr]
            return True

        # Check allowed users list
        if config.discord.allowed_users:
            if str(message.author.id) in config.discord.allowed_users:
                return True

        # Check allowed roles (guild only)
        if config.discord.allowed_roles and message.guild and isinstance(message.author, discord.Member):
            member_role_ids = {str(r.id) for r in message.author.roles}
            if member_role_ids & set(config.discord.allowed_roles):
                return True

        # If no users or roles configured, only bot account can use
        return not config.discord.allowed_users and not config.discord.allowed_roles

    def is_allowed_guild(self, message: discord.Message) -> bool:
        """Check guild restrictions."""
        if not config.discord.allowed_guilds:
            return True
        if message.guild:
            return str(message.guild.id) in config.discord.allowed_guilds
        return True

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    async def on_ready(self) -> None:
        log.info("[SchroStream] Logged in as %s", self.user)
        log.info("[SchroStream] Prefix: %s", self.prefix)

        if config.discord.allowed_users:
            log.info("[SchroStream] Allowed users: %s", ", ".join(config.discord.allowed_users))
        else:
            log.info("[SchroStream] Allowed users: %s (self only)", self.user.id if self.user else "?")  # type: ignore[union-attr]

        if config.discord.allowed_roles:
            log.info("[SchroStream] Allowed roles: %s", ", ".join(config.discord.allowed_roles))

        guilds_str = ", ".join(config.discord.allowed_guilds) if config.discord.allowed_guilds else "all"
        log.info("[SchroStream] Allowed guilds: %s", guilds_str)
        log.info("[SchroStream] Video streaming enabled (Go Live)")

    async def on_message(self, message: discord.Message) -> None:
        # Permission checks
        if not self.has_permission(message):
            return
        if not self.is_allowed_guild(message):
            return
        if not message.content.startswith(self.prefix):
            return

        # Parse command and args
        content = message.content[len(self.prefix):].strip()
        parts = content.split()
        if not parts:
            return

        command_name = parts[0].lower()
        args = parts[1:]

        try:
            await self.handle_command(command_name, message, args)
        except Exception as exc:
            log.error("[Command Error] %s: %s", command_name, exc, exc_info=True)
            try:
                await message.channel.send(f"❌ Error: {exc}")
            except Exception:
                pass

    async def on_error(self, event: str, *args, **kwargs) -> None:  # type: ignore[override]
        log.error("[Discord Error] event=%s", event, exc_info=True)

    # ------------------------------------------------------------------
    # Command dispatch
    # ------------------------------------------------------------------

    async def handle_command(self, name: str, message: discord.Message, args: list[str]) -> None:
        """Dispatch a command by name."""
        from .commands import registry
        handler = registry.COMMANDS.get(name)
        if handler is None:
            return
        await handler(self, message, args)


async def start_bot() -> SchroStreamBot:
    """Create and start the selfbot. Returns the client instance."""
    bot = SchroStreamBot()
    log.info("[SchroStream] Starting Python selfbot...")
    await bot.start(config.discord.token)
    return bot
