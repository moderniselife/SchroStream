# Commands

All commands use the configured prefix (default: `!`).

## Search & Playback

### `!search <query>`
Search for movies and TV shows in your Plex library.

**Aliases:** `!s`

```
!search breaking bad
!search the matrix
```

**Output:**
```
🎬 Search Results for "breaking bad":

🎬 Movies (1)
1. El Camino: A Breaking Bad Movie (2019)

📺 TV Shows (1)
2. Breaking Bad (2008)

Use !play <number> to start streaming
```

---

### `!episodes <number>`
List all seasons and episodes for a TV show from search results.

**Aliases:** `!eps`, `!seasons`

```
!episodes 2
```

**Output:**
```
📺 Breaking Bad (2008)

Season 1 (7 episodes)
  E01 - Pilot
  E02 - Cat's in the Bag...
  ...

Use !play 2 S01E01 to play a specific episode
```

---

### `!play <number> [episode]`
Start playing a search result. For TV shows, you can specify an episode.

**Aliases:** `!p`

```
!play 1              # Play movie or S01E01 of show
!play 2 S02E05       # Play Season 2 Episode 5
!play 2 3 8          # Play Season 3 Episode 8
```

**Special options:**
```
!play resume         # Continue from saved position
!play start          # Start from beginning (ignore saved position)
```

---

### `!stop`
Stop the current stream and leave the voice channel.

```
!stop
```

## Playback Controls

### `!pause` / `!resume`
Pause or resume playback. Position is saved automatically.

```
!pause
!resume
```

---

### `!seek <time>`
Jump to a specific time in the media.

**Formats:**
```
!seek 1:30:00        # 1 hour, 30 minutes
!seek 45:00          # 45 minutes
!seek 90             # 90 seconds
```

---

### `!skip`
Skip to the next episode (TV shows only).

**Aliases:** `!next`

```
!skip
```

---

### `!volume <0-200>`
Set the playback volume. Default is 100%.

**Aliases:** `!vol`, `!v`

```
!volume 50           # 50% volume
!volume 150          # 150% volume (amplified)
!v 100               # Reset to normal
```

---

### `!np`
Show information about what's currently playing.

**Aliases:** `!nowplaying`, `!playing`

```
!np
```

**Output:**
```
📺 Now Playing: Breaking Bad S01E01 - Pilot
⏱️ 23:45 / 58:00 (40%)
🔊 Volume: 100%
```

## Utility Commands

### `!help`
Show all available commands.

**Aliases:** `!h`, `!commands`

```
!help
```

## Command Summary

| Command | Description |
|---------|-------------|
| `!search <query>` | Search Plex library |
| `!episodes <n>` | List episodes for a show |
| `!play <n> [ep]` | Start streaming |
| `!stop` | Stop streaming |
| `!pause` | Pause playback |
| `!resume` | Resume playback |
| `!seek <time>` | Jump to time |
| `!skip` | Next episode |
| `!volume <n>` | Set volume (0-200%) |
| `!np` | Now playing info |
| `!help` | Show help |
