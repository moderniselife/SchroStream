#!/usr/bin/env python3
"""Entry point for the SchroStream Python selfbot.

Usage:
    python -m selfbot.run
    # or
    python selfbot/run.py
"""

from __future__ import annotations

import asyncio
import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("schrostream")


async def main() -> None:
    print("╔═══════════════════════════════════════╗")
    print("║     SchroStream Python Selfbot        ║")
    print("║   discord.py-self migration           ║")
    print("╚═══════════════════════════════════════╝")
    print()

    from .config import config
    from .ipc import ipc

    log.info("[Startup] IPC backend: %s", config.ipc_base_url)
    log.info("[Startup] Checking IPC backend connectivity...")

    # Quick health check — the TS backend should be running
    try:
        result = await ipc.get_streams()
        log.info("[Startup] ✓ IPC backend is reachable")
    except Exception as exc:
        log.warning("[Startup] ⚠ IPC backend not reachable (%s). Bot will start anyway.", exc)
        log.warning("[Startup]   Make sure the TypeScript backend is running (bun run start)")

    log.info("[Startup] Starting Discord selfbot...")

    from .client import SchroStreamBot

    bot = SchroStreamBot()

    try:
        await bot.start(config.discord.token)
    except KeyboardInterrupt:
        log.info("[Shutdown] Received keyboard interrupt")
    except Exception as exc:
        log.error("[Fatal] %s", exc, exc_info=True)
    finally:
        await ipc.close()
        if not bot.is_closed():
            await bot.close()
        log.info("[Shutdown] Cleanup complete")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
