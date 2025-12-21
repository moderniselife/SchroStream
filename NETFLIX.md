# Netflix Integration

## Overview

SchroStream now includes Netflix integration using Playwright browser automation. This allows you to search, browse, and play Netflix content through Discord commands.

## Features

- ✅ **Authentication**: Login to Netflix with persistent session cookies
- ✅ **Search**: Search Netflix catalog
- ✅ **Recommendations**: Get personalized recommendations
- ✅ **Content Browsing**: Browse Netflix content
- ⚠️ **Stream Playback**: Opens Netflix player (Discord streaming not yet implemented)

## Requirements

- **Playwright**: Installed automatically with `bun add playwright`
- **Chromium Browser**: Downloaded via `bunx playwright install chromium`
- **Netflix Subscription**: Active Netflix account required
- **Non-Headless Browser**: Required for Widevine DRM support

## Commands

### Login
```
!netflix login
```
Opens a browser window for you to log in to Netflix. Your session will be saved for future use.

### Search
```
!netflix search <query>
```
Search Netflix for content. Returns a list of results with IDs.

Example:
```
!netflix search stranger things
```

### Recommendations
```
!netflix recommendations
!netflix recs
```
Get personalized Netflix recommendations based on your viewing history.

### Play Content
```
!netflix play <id>
```
Opens the Netflix player for the specified content ID.

**Note**: Currently only opens the player in the browser. Streaming to Discord is not yet implemented due to Widevine DRM complexity.

### Close Browser
```
!netflix close
```
Closes the Netflix browser instance.

## How It Works

### Authentication
1. First time: Opens a browser window for manual login
2. Saves cookies to `data/netflix-cookies.json`
3. Future sessions: Automatically restores your login session
4. Cookies expire after 30 days

### Browser Automation
- Uses Playwright to control a real Chromium browser
- Browser runs in **non-headless mode** (required for Widevine DRM)
- Maintains persistent session across commands

### Content Discovery
- Scrapes Netflix web interface for content metadata
- Extracts titles, IDs, and thumbnails
- Uses Netflix's internal content IDs for playback

## Limitations

### Current Limitations
1. **No Discord Streaming**: Stream capture to Discord is not yet implemented
   - Widevine DRM requires complex stream extraction
   - Would need to capture and re-encode protected content
   - Legal and technical challenges

2. **Browser Must Stay Open**: The browser window must remain open during use
   - Closing the browser terminates the session
   - Use `!netflix close` to properly close when done

3. **Performance**: Browser automation has overhead
   - Slower than direct API calls
   - Requires more system resources

### Technical Challenges
- **Widevine DRM**: Netflix uses Widevine L1/L3 DRM protection
- **Stream Encryption**: Video streams are encrypted
- **License Server**: Requires valid license keys from Netflix MSL
- **Hardware Requirements**: Some DRM levels require hardware support

## Future Enhancements

### Planned Features
- [ ] Stream capture and re-encoding for Discord
- [ ] MSL (Message Security Layer) integration for direct API access
- [ ] Manifest parsing for quality selection
- [ ] Subtitle support
- [ ] Episode selection for TV shows
- [ ] Watch history tracking
- [ ] Continue watching integration

### Technical Approach for Streaming
To implement Discord streaming, we would need to:

1. **Capture Stream**:
   - Intercept network requests for manifest files
   - Extract video/audio segment URLs
   - Download segments in real-time

2. **Decrypt Content**:
   - Obtain Widevine CDM keys
   - Decrypt video segments
   - Re-encode for Discord

3. **Legal Considerations**:
   - This would violate Netflix ToS
   - DRM circumvention may be illegal in some jurisdictions
   - For personal use only

## Files

- `src/netflix/client.ts` - Netflix client with Playwright automation
- `src/bot/commands/netflix.ts` - Discord bot commands
- `data/netflix-cookies.json` - Saved session cookies (auto-generated)
- `www.netflix.com.har` - HAR file for API analysis

## Troubleshooting

### Browser Won't Open
- Ensure Playwright is installed: `bunx playwright install chromium`
- Check system permissions for browser automation

### Login Fails
- Delete `data/netflix-cookies.json` and try again
- Ensure your Netflix account is active
- Check for 2FA or security challenges

### Content Not Found
- Verify the content ID is correct
- Some content may be region-restricted
- Try searching for the content first

### Performance Issues
- Close unused browser tabs
- Restart the browser: `!netflix close` then `!netflix login`
- Check system resources (RAM, CPU)

## Privacy & Security

- **Cookies**: Stored locally in `data/netflix-cookies.json`
- **Credentials**: Never stored (manual login only)
- **Session**: Maintained by Playwright browser context
- **Data**: No data sent to third parties

## Example Workflow

```bash
# 1. Login to Netflix
!netflix login
# (Browser opens, log in manually, wait for confirmation)

# 2. Search for content
!netflix search breaking bad

# 3. Get recommendations
!netflix recs

# 4. Play content (opens in browser)
!netflix play 70143836

# 5. Close when done
!netflix close
```

## Notes

- This integration is for **personal use only**
- Respects Netflix ToS by using official web interface
- Does not circumvent DRM (yet)
- Browser automation is detectable by Netflix
- Use responsibly and within Netflix's terms of service
