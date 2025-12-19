# Getting Your Plex Token

SchroStream needs a Plex authentication token to access your media server.

## Method 1: Plex Web App (Easiest)

1. Open your Plex server in a web browser
2. Play any media item
3. Click the **···** menu and select **Get Info**
4. Click **View XML**
5. Look at the URL - find `X-Plex-Token=` parameter
6. Copy the token value

## Method 2: Browser Developer Tools

1. Open [Plex Web](https://app.plex.tv) in your browser
2. Log in and navigate to your server
3. Press `F12` to open Developer Tools
4. Go to the **Network** tab
5. Refresh the page
6. Look for any request to your Plex server
7. Find `X-Plex-Token` in the request URL or headers

## Method 3: Plex Account Page

1. Go to [plex.tv/devices.xml](https://plex.tv/devices.xml)
2. Sign in if prompted
3. Search for `token=` in the XML
4. Copy the token value

## Method 4: Command Line

If you have `curl` installed:

```bash
curl -X POST 'https://plex.tv/users/sign_in.json' \
  -H 'X-Plex-Client-Identifier: SchroStream' \
  -H 'X-Plex-Product: SchroStream' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'user[login]=YOUR_EMAIL&user[password]=YOUR_PASSWORD'
```

The response will contain your `authToken`.

## Storing Your Token

Add your token to the `.env` file:

```env
PLEX_URL=http://192.168.1.100:32400
PLEX_TOKEN=your_plex_token_here
```

::: tip Finding Your Plex URL
- Local server: `http://192.168.x.x:32400`
- Remote access: Use your Plex server's external URL
- Docker: Use the container name or host IP
:::

## Token Security

- Plex tokens don't expire unless you sign out of all devices
- Keep your token private - it grants full access to your Plex account
- You can revoke access by signing out from Plex settings
