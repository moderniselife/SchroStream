# Troubleshooting

Common issues and their solutions.

## Connection Issues

### "Failed to initialize Plex session: 400 Bad Request"

This usually happens when:
- A previous stream didn't close properly
- Plex transcode session is stuck

**Solutions:**
1. Wait 1-2 minutes and try again
2. Restart the bot
3. In Plex settings, go to **Settings > Status > Now Playing** and stop any stuck sessions

### "Could not get stream URL for media"

**Causes:**
- Invalid Plex token
- Media file not accessible
- Plex server offline

**Solutions:**
1. Verify your `PLEX_TOKEN` is correct
2. Check Plex can play the media directly
3. Ensure Plex server is running and accessible

### Bot doesn't respond to commands

**Causes:**
- Wrong command prefix
- User not in `ALLOWED_USERS` or doesn't have `ALLOWED_ROLES`
- Command sent in wrong guild

**Solutions:**
1. Check `COMMAND_PREFIX` in your `.env`
2. Verify your user ID is allowed
3. Check `ALLOWED_GUILDS` configuration

## Streaming Issues

### "Frame takes too long to send" warnings

These warnings are normal during stream startup or when seeking. If they persist:
- Lower `MAX_BITRATE` (try 5000)
- Lower `DEFAULT_QUALITY` (try 720)
- Check your network connection

### No audio/video in Discord

**Causes:**
- FFmpeg not installed correctly
- Missing codecs

**Solutions:**
1. Verify FFmpeg installation: `ffmpeg -version`
2. Ensure libx264 and libopus are available
3. Try reinstalling FFmpeg

### Stream stops unexpectedly

**Causes:**
- Plex transcode timeout
- Network interruption
- Cloud mount issues

**Solutions:**
1. Check Plex server logs
2. If using cloud mounts (zurg/rclone), verify they're working
3. Try restarting the stream

## Docker Issues

### Container keeps restarting

Check logs:
```bash
docker logs schrostream
```

Common causes:
- Missing environment variables
- Invalid tokens
- FFmpeg not available in image

### Can't connect to Plex on host

Use `--network host` or the host's IP address:
```bash
-e PLEX_URL=http://192.168.1.100:32400
```

Don't use `localhost` or `127.0.0.1` unless using host networking.

## Performance Issues

### High CPU usage

FFmpeg transcoding is CPU-intensive. Solutions:
- Lower `DEFAULT_QUALITY` to 720
- Lower `MAX_BITRATE` to 5000
- Enable hardware transcoding in Plex

### High memory usage

- Normal usage is 200-500MB
- If higher, check for memory leaks in logs
- Restart the bot periodically

## Getting Help

If you're still having issues:

1. Check the [GitHub Issues](https://github.com/moderniselife/SchroStream/issues)
2. Enable debug logging: `DEBUG=* bun dev`
3. Include relevant logs when reporting issues

### Useful Debug Information

When reporting issues, include:
- Node.js/Bun version
- FFmpeg version
- Operating system
- Relevant error messages
- Steps to reproduce
