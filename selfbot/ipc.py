"""IPC client for communicating with the TypeScript backend via HTTP.

The TS backend exposes API endpoints on the web server. This module
provides an async HTTP client to call those endpoints from the Python
selfbot.
"""

from __future__ import annotations

import aiohttp
import logging
from typing import Any

from .config import config

log = logging.getLogger("schrostream.ipc")


class IPCClient:
    """Async HTTP client for the TypeScript backend API."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or config.ipc_base_url).rstrip("/")
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=60)
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    # ------------------------------------------------------------------
    # Generic helpers
    # ------------------------------------------------------------------

    async def _get(self, path: str, **params: Any) -> dict[str, Any]:
        session = await self._get_session()
        url = f"{self.base_url}{path}"
        try:
            async with session.get(url, params=params) as resp:
                data = await resp.json()
                return data
        except Exception as exc:
            log.error("IPC GET %s failed: %s", path, exc)
            return {"success": False, "error": str(exc)}

    async def _post(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        session = await self._get_session()
        url = f"{self.base_url}{path}"
        try:
            async with session.post(url, json=body or {}) as resp:
                data = await resp.json()
                return data
        except Exception as exc:
            log.error("IPC POST %s failed: %s", path, exc)
            return {"success": False, "error": str(exc)}

    # ------------------------------------------------------------------
    # Stream info
    # ------------------------------------------------------------------

    async def get_streams(self) -> dict[str, Any]:
        return await self._get("/api/streams")

    async def get_stream(self, guild_id: str) -> dict[str, Any]:
        return await self._get(f"/api/stream/{guild_id}")

    # ------------------------------------------------------------------
    # Playback controls
    # ------------------------------------------------------------------

    async def control_pause(self, guild_id: str | None = None) -> dict[str, Any]:
        body = {"guildId": guild_id} if guild_id else {}
        return await self._post("/api/ipc/pause", body)

    async def control_stop(self, guild_id: str | None = None) -> dict[str, Any]:
        body = {"guildId": guild_id} if guild_id else {}
        return await self._post("/api/ipc/stop", body)

    async def control_seek(self, guild_id: str, time_ms: int) -> dict[str, Any]:
        return await self._post("/api/ipc/seek", {"guildId": guild_id, "timeMs": time_ms})

    async def control_ff(self, guild_id: str, offset_ms: int) -> dict[str, Any]:
        return await self._post("/api/ipc/ff", {"guildId": guild_id, "offsetMs": offset_ms})

    async def control_rw(self, guild_id: str, offset_ms: int) -> dict[str, Any]:
        return await self._post("/api/ipc/rw", {"guildId": guild_id, "offsetMs": offset_ms})

    async def control_volume(self, guild_id: str, level: int) -> dict[str, Any]:
        return await self._post("/api/ipc/volume", {"guildId": guild_id, "level": level})

    async def control_speed(self, guild_id: str, speed: float) -> dict[str, Any]:
        return await self._post("/api/ipc/speed", {"guildId": guild_id, "speed": speed})

    async def get_now_playing(self, guild_id: str) -> dict[str, Any]:
        return await self._get(f"/api/ipc/nowplaying/{guild_id}")

    # ------------------------------------------------------------------
    # Plex operations
    # ------------------------------------------------------------------

    async def plex_search(self, query: str) -> dict[str, Any]:
        return await self._post("/api/ipc/plex/search", {"query": query})

    async def plex_play(
        self,
        guild_id: str,
        channel_id: str,
        rating_key: str,
        user_id: str,
        start_time_ms: int = 0,
    ) -> dict[str, Any]:
        return await self._post("/api/ipc/plex/play", {
            "guildId": guild_id,
            "channelId": channel_id,
            "ratingKey": rating_key,
            "userId": user_id,
            "startTimeMs": start_time_ms,
        })

    async def plex_episodes(self, rating_key: str) -> dict[str, Any]:
        return await self._get(f"/api/ipc/plex/episodes/{rating_key}")

    async def plex_seasons(self, rating_key: str) -> dict[str, Any]:
        return await self._get(f"/api/ipc/plex/seasons/{rating_key}")

    async def plex_random(
        self,
        guild_id: str,
        channel_id: str,
        user_id: str,
        media_type: str = "any",
    ) -> dict[str, Any]:
        return await self._post("/api/ipc/plex/random", {
            "guildId": guild_id,
            "channelId": channel_id,
            "userId": user_id,
            "type": media_type,
        })

    async def plex_skip(self, guild_id: str) -> dict[str, Any]:
        return await self._post("/api/ipc/plex/skip", {"guildId": guild_id})

    async def plex_ondeck(self) -> dict[str, Any]:
        return await self._get("/api/ipc/plex/ondeck")

    async def plex_ondeck_play(
        self,
        guild_id: str,
        channel_id: str,
        rating_key: str,
        user_id: str,
    ) -> dict[str, Any]:
        return await self._post("/api/ipc/plex/ondeck/play", {
            "guildId": guild_id,
            "channelId": channel_id,
            "ratingKey": rating_key,
            "userId": user_id,
        })

    async def get_playback_position(self, rating_key: str) -> dict[str, Any]:
        return await self._get(f"/api/ipc/playback-position/{rating_key}")

    # ------------------------------------------------------------------
    # YouTube operations
    # ------------------------------------------------------------------

    async def youtube_play(
        self,
        guild_id: str,
        channel_id: str,
        url: str,
        user_id: str,
        start_time_ms: int = 0,
    ) -> dict[str, Any]:
        return await self._post("/api/ipc/youtube/play", {
            "guildId": guild_id,
            "channelId": channel_id,
            "url": url,
            "userId": user_id,
            "startTimeMs": start_time_ms,
        })

    async def youtube_search(self, query: str) -> dict[str, Any]:
        return await self._post("/api/ipc/youtube/search", {"query": query})

    async def youtube_trending(self, category: str = "default") -> dict[str, Any]:
        return await self._get(f"/api/ipc/youtube/trending", category=category)

    async def youtube_music_play(
        self,
        guild_id: str,
        channel_id: str,
        url: str,
        user_id: str,
        action: str | None = None,
        query: str | None = None,
        start_time_ms: int = 0,
    ) -> dict[str, Any]:
        return await self._post("/api/ipc/youtube/music", {
            "guildId": guild_id,
            "channelId": channel_id,
            "url": url,
            "userId": user_id,
            "action": action,
            "query": query,
            "startTimeMs": start_time_ms,
        })

    # ------------------------------------------------------------------
    # External URL
    # ------------------------------------------------------------------

    async def url_play(
        self,
        guild_id: str,
        channel_id: str,
        url: str,
        title: str,
        user_id: str,
    ) -> dict[str, Any]:
        return await self._post("/api/ipc/url/play", {
            "guildId": guild_id,
            "channelId": channel_id,
            "url": url,
            "title": title,
            "userId": user_id,
        })

    # ------------------------------------------------------------------
    # Queue
    # ------------------------------------------------------------------

    async def queue_list(self, guild_id: str) -> dict[str, Any]:
        return await self._get(f"/api/ipc/queue/{guild_id}")

    async def queue_add(self, guild_id: str, item: dict[str, Any]) -> dict[str, Any]:
        return await self._post(f"/api/ipc/queue/{guild_id}/add", item)

    async def queue_remove(self, guild_id: str, index: int) -> dict[str, Any]:
        return await self._post(f"/api/ipc/queue/{guild_id}/remove", {"index": index})

    async def queue_clear(self, guild_id: str) -> dict[str, Any]:
        return await self._post(f"/api/ipc/queue/{guild_id}/clear")

    async def queue_start(self, guild_id: str, channel_id: str, user_id: str) -> dict[str, Any]:
        return await self._post(f"/api/ipc/queue/{guild_id}/start", {
            "channelId": channel_id,
            "userId": user_id,
        })

    async def queue_next(self, guild_id: str, channel_id: str, user_id: str) -> dict[str, Any]:
        return await self._post(f"/api/ipc/queue/{guild_id}/next", {
            "channelId": channel_id,
            "userId": user_id,
        })

    # ------------------------------------------------------------------
    # Status / activity
    # ------------------------------------------------------------------

    async def set_activity(self, text: str | None) -> dict[str, Any]:
        return await self._post("/api/ipc/activity", {"text": text})


# Singleton instance
ipc = IPCClient()
