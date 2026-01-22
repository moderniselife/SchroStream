# YouTube Cast Receiver

SchroStream can act as a YouTube Cast receiver, allowing you to cast YouTube videos directly from your phone or browser to Bob for playback in Discord voice channels.

## How It Works

1. **SSDP Discovery** - SchroStream advertises itself on your local network using SSDP (Simple Service Discovery Protocol), the same protocol used by Chromecast devices.

2. **DIAL Protocol** - When you select SchroStream as a cast target, YouTube communicates with it using the DIAL (Discovery and Launch) protocol to send video information.

3. **Video Playback** - SchroStream extracts the video ID, fetches the stream URL using yt-dlp, and starts playing it in the configured Discord voice channel.

## Requirements

- SchroStream must be running on the same local network as your casting device
- Web control must be configured (`WEB_USER_ID`, `WEB_GUILD_ID`, `WEB_CHANNEL_ID`)
- The selfbot must be in the target voice channel or able to join it
- `yt-dlp` must be installed on the system

## Configuration

Add these to your `.env` file:

```bash
# Enable Cast receiver
CAST_ENABLED=true

# Device name (internal)
CAST_DEVICE_NAME=SchroStream

# Friendly name shown in YouTube cast menu
CAST_FRIENDLY_NAME=SchroStream (Bob)

# Required: Web control settings
WEB_USER_ID=your_user_id
WEB_GUILD_ID=your_guild_id
WEB_CHANNEL_ID=your_voice_channel_id
```

## Usage

1. **Enable Cast Receiver** - Set `CAST_ENABLED=true` in your `.env` file

2. **Configure Target Channel** - Set the guild and voice channel IDs where videos should play

3. **Start SchroStream** - Run the bot normally

4. **Cast from YouTube**:
   - Open YouTube on your phone or in Chrome
   - Click the Cast button (📺)
   - Select "SchroStream (Bob)" from the device list
   - The video will start playing in your Discord voice channel

## Troubleshooting

### Device Not Appearing in Cast Menu

- Ensure SchroStream and your device are on the same network
- Check that `CAST_ENABLED=true` is set
- SSDP uses port 1900 - ensure no firewall is blocking it
- Try restarting SchroStream

### Video Doesn't Play

- Verify `WEB_USER_ID`, `WEB_GUILD_ID`, and `WEB_CHANNEL_ID` are correctly set
- Ensure the selfbot is logged in and can join the voice channel
- Check that `yt-dlp` is installed and working

### Logs

Look for `[Cast]` and `[DIAL]` prefixed messages in the console:

```
[Cast] Initializing Cast receiver...
[Cast] Device name: SchroStream (Bob)
[Cast] ✓ Cast receiver ready
[Cast] ✓ Device discoverable as "SchroStream (Bob)"
[DIAL] YouTube app launch requested
[Cast] Processing YouTube play request for video: dQw4w9WgXcQ
[Cast] ✓ Started playing: Never Gonna Give You Up
```

## Technical Details

### SSDP Response

SchroStream responds to `M-SEARCH` requests for:
- `urn:dial-multiscreen-org:service:dial:1`
- `urn:dial-multiscreen-org:device:dial:1`
- `ssdp:all`
- `upnp:rootdevice`

### DIAL Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ssdp/device-desc.xml` | GET | UPnP device descriptor |
| `/apps` | GET | List available apps |
| `/apps/YouTube` | GET | Get YouTube app state |
| `/apps/YouTube` | POST | Launch YouTube with video |
| `/apps/YouTube/:id` | DELETE | Stop YouTube playback |

### Limitations

- Only YouTube casting is supported (not Netflix, etc.)
- Playlists are supported but queue management is basic
- Live streams may have issues with seeking
- The receiver must be on the same network subnet

## Security Note

The Cast receiver listens on the local network only. It does not expose any endpoints to the internet. However, anyone on your local network could potentially cast to it if they discover it.
