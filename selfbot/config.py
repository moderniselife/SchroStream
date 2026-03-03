"""Configuration loader for SchroStream Python selfbot.

Reads from the same .env file as the TypeScript backend.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the project root (one level up from selfbot/)
_project_root = Path(__file__).parent.parent
load_dotenv(_project_root / ".env")


def _get_env_or_throw(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value


def _get_env_or_default(key: str, default: str) -> str:
    return os.getenv(key, default)


def _parse_comma_separated(value: str | None) -> list[str]:
    if not value or not value.strip():
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


class DiscordConfig:
    token: str = _get_env_or_throw("DISCORD_TOKEN")
    prefix: str = _get_env_or_default("PREFIX", "!")
    allowed_users: list[str] = _parse_comma_separated(os.getenv("ALLOWED_USERS"))
    allowed_roles: list[str] = _parse_comma_separated(os.getenv("ALLOWED_ROLES"))
    allowed_guilds: list[str] = _parse_comma_separated(os.getenv("ALLOWED_GUILDS"))
    bot_token: str | None = os.getenv("BOT_TOKEN")
    client_id: str | None = os.getenv("BOT_CLIENT_ID")
    web_user_id: str | None = os.getenv("WEB_USER_ID")
    web_guild_id: str | None = os.getenv("WEB_GUILD_ID")
    web_channel_id: str | None = os.getenv("WEB_CHANNEL_ID")


class StreamConfig:
    default_quality: int = int(_get_env_or_default("DEFAULT_QUALITY", "1080"))
    max_bitrate: int = int(_get_env_or_default("MAX_BITRATE", "10000"))
    audio_bitrate: int = int(_get_env_or_default("AUDIO_BITRATE", "256"))
    frame_rate: int = int(_get_env_or_default("FRAME_RATE", "30"))
    show_ffmpeg_logs: bool = _get_env_or_default("SHOW_FFMPEG_LOGS", "false").lower() == "true"
    gpu_transcoding: bool = _get_env_or_default("GPU_TRANSCODING", "false").lower() == "true"


class Config:
    discord = DiscordConfig()
    stream = StreamConfig()
    ipc_port: int = int(_get_env_or_default("WEB_PORT", "3105"))
    ipc_base_url: str = f"http://localhost:{int(_get_env_or_default('WEB_PORT', '3105'))}"


config = Config()
