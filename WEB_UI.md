# Web UI - Stream Viewer

## Overview

SchroStream now includes a web-based stream viewer that allows people to watch your Discord streams in their browser. When you start streaming (Plex, YouTube, or external URLs), the stream becomes available on a web interface that anyone can access.

## Features

- 🌐 **Web-based Player** - Watch streams in any modern browser
- 📺 **Multiple Stream Support** - View all active streams at once
- 🎬 **Video.js Player** - Professional HTML5 video player with controls
- 📊 **Real-time Updates** - Stream info updates every 5 seconds
- 🎨 **Beautiful UI** - Modern gradient design with responsive layout
- 🔄 **Auto-sync** - Player syncs with Discord stream progress

## Supported Stream Types

- ✅ **Plex Streams** - Direct Plex HLS streams
- ✅ **External M3U8** - HLS streams from any source
- ✅ **Direct Video URLs** - MP4, WebM, etc.
- ⚠️ **YouTube** - Shows in list but requires Discord (DRM)

## Quick Start

### 1. Start the Bot
```bash
bun dev
```

The web server automatically starts on port 3000 (configurable via `WEB_PORT` env variable).

### 2. Start Streaming
Use any Discord command to start streaming:
```
!play <content>          # Plex content
!yt <youtube-url>        # YouTube video
!url <stream-url>        # External stream
```

### 3. Access Web UI
Open your browser to:
```
http://localhost:3000
```

You'll see all active streams. Click any stream to watch it.

## URLs

### Main Dashboard
```
http://localhost:3000/
```
Shows all active streams with thumbnails, progress bars, and metadata.

### Individual Player
```
http://localhost:3000/player/<guildId>
```
Full-screen video player for a specific stream.

### API Endpoints

#### Get All Streams
```
GET /api/streams
```
Returns JSON array of all active streams with metadata.

#### Get Stream Details
```
GET /api/stream/:guildId
```
Returns detailed information about a specific stream.

#### Get Stream URL
```
GET /api/stream/:guildId/url
```
Returns the direct stream URL for playback.

#### Proxy Stream (CORS bypass)
```
GET /api/proxy/:guildId
```
Proxies the stream to avoid CORS issues.

## Configuration

### Environment Variables

Add to your `.env` file:
```env
WEB_PORT=3000          # Web server port (default: 3000)
```

### Firewall / Network

To allow external access:
1. Open port 3000 in your firewall
2. Forward port 3000 in your router (for internet access)
3. Access via `http://your-ip:3000`

**Security Note:** The web UI has no authentication. Only expose it to trusted networks.

## Features in Detail

### Stream Dashboard

The main page (`/`) shows:
- **Stream Cards** - Visual cards for each active stream
- **Thumbnails** - Plex artwork or placeholder
- **Progress Bars** - Visual playback progress
- **Stream Type** - Plex, External, etc.
- **Status** - Playing/Paused indicator
- **Time Info** - Current position / Total duration
- **Volume** - Current volume level
- **Auto-refresh** - Updates every 5 seconds

### Video Player

The player page (`/player/:guildId`) includes:
- **Video.js Player** - Full-featured HTML5 player
- **Controls** - Play/pause, seek, volume, fullscreen
- **Auto-seek** - Starts at current Discord position
- **Stream Info** - Title, description, metadata
- **Progress Tracking** - Syncs with Discord stream
- **Responsive Design** - Works on desktop and mobile

## How It Works

### Stream Registration

When you start streaming in Discord:
1. Bot starts FFmpeg/stream process
2. Stream session is created
3. Web server is notified via `registerWebStream()`
4. Stream appears on web dashboard
5. URL is logged to console

### Stream Playback

When someone opens the player:
1. Fetches stream metadata from API
2. Gets stream URL (Plex HLS or external URL)
3. Initializes Video.js player
4. Seeks to current Discord position
5. Starts playback

### Stream Cleanup

When streaming stops:
1. Discord stream ends
2. `unregisterWebStream()` is called
3. Stream removed from dashboard
4. Player shows "Stream not found" if still open

## Limitations

### Current Limitations

1. **No Authentication** - Anyone with the URL can watch
2. **No DVR** - Can't rewind past Discord stream position
3. **YouTube Restrictions** - YouTube streams can't be played in web UI (DRM)
4. **Single Quality** - Uses the quality Discord is streaming
5. **Network Dependent** - Requires good network for smooth playback

### Browser Compatibility

- ✅ Chrome/Edge (Recommended)
- ✅ Firefox
- ✅ Safari
- ⚠️ Mobile browsers (may have issues with HLS)

## Troubleshooting

### Stream Not Showing

**Problem:** Stream started in Discord but not on web UI

**Solutions:**
- Refresh the dashboard page
- Check console for `[WebServer] Registered stream` message
- Ensure web server started successfully

### Player Won't Load

**Problem:** Video player shows error or black screen

**Solutions:**
- Check stream URL in browser console
- For Plex: Ensure Plex server is accessible
- For external: Check if URL is still valid
- Try refreshing the page

### CORS Errors

**Problem:** Browser console shows CORS errors

**Solutions:**
- Use the proxy endpoint: `/api/proxy/:guildId`
- For Plex: Check Plex network settings
- For external: Some streams block browser playback

### Playback Stuttering

**Problem:** Video playback is choppy or buffering

**Solutions:**
- Check network bandwidth
- Reduce Discord stream quality
- Close other applications using bandwidth
- Try wired connection instead of WiFi

## Advanced Usage

### Custom Port

Change the web server port:
```env
WEB_PORT=8080
```

Then access at `http://localhost:8080`

### Reverse Proxy

Use nginx or Caddy to add HTTPS and authentication:

**Nginx example:**
```nginx
server {
    listen 443 ssl;
    server_name stream.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Embedding

Embed the player in another webpage:
```html
<iframe 
  src="http://localhost:3000/player/YOUR_GUILD_ID" 
  width="1280" 
  height="720" 
  frameborder="0" 
  allowfullscreen>
</iframe>
```

## API Examples

### Get All Streams (JavaScript)
```javascript
fetch('http://localhost:3000/api/streams')
  .then(res => res.json())
  .then(data => {
    console.log('Active streams:', data.streams);
  });
```

### Get Stream Details (cURL)
```bash
curl http://localhost:3000/api/stream/YOUR_GUILD_ID
```

### Response Example
```json
{
  "guildId": "123456789",
  "title": "Breaking Bad - S01E01",
  "description": "Pilot episode",
  "type": "plex",
  "streamUrl": "https://plex.server/stream.m3u8",
  "duration": 2700000,
  "currentTime": 450000,
  "percentage": 16.67,
  "isPaused": false,
  "volume": 100,
  "thumbnail": "https://plex.server/thumb.jpg",
  "year": 2008
}
```

## Security Considerations

⚠️ **Important Security Notes:**

1. **No Authentication** - The web UI has no login system
2. **Local Network Only** - By default, only accessible on localhost
3. **Plex Tokens** - Stream URLs may contain Plex tokens
4. **Content Access** - Anyone with the URL can watch your streams

### Recommendations:

- Only expose on trusted networks
- Use a reverse proxy with authentication for internet access
- Consider VPN for remote access
- Don't share stream URLs publicly
- Monitor access logs

## Future Enhancements

Planned features:
- [ ] Authentication system (username/password)
- [ ] Multi-user support with permissions
- [ ] Chat integration (see Discord chat while watching)
- [ ] Quality selection
- [ ] Subtitle support
- [ ] DVR functionality (rewind/fast-forward)
- [ ] Mobile app
- [ ] Chromecast support
- [ ] Watch party mode (synchronized viewing)

## Files

- `src/web/server.ts` - Express web server
- `public/index.html` - Stream dashboard
- `public/player.html` - Video player page
- API endpoints for stream data

## Example Workflow

```bash
# 1. Start the bot
bun dev
# Output: [WebServer] Started on http://localhost:3000

# 2. Start streaming in Discord
!play breaking bad
# Output: [WebServer] Registered stream for guild 123456789
# Output: [WebServer] View at: http://localhost:3000/player/123456789

# 3. Open browser to http://localhost:3000
# See the stream in the dashboard

# 4. Click the stream card
# Opens full-screen player

# 5. Watch along with Discord stream
# Player auto-syncs with Discord position

# 6. Stop streaming in Discord
!stop
# Output: [WebServer] Unregistered stream for guild 123456789
```

## Support

For issues or questions:
- Check console logs for errors
- Verify network connectivity
- Ensure stream is active in Discord
- Check browser console for errors
- Review this documentation

## Notes

- Web UI is for **viewing only** - controls don't affect Discord stream
- Stream quality matches Discord stream quality
- Some streams may not work due to DRM or CORS restrictions
- Mobile support is experimental
- Requires modern browser with HTML5 video support
