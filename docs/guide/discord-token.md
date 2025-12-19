# Getting Your Discord Token

SchroStream requires your Discord user token to operate as a self-bot.

::: danger Security Warning
**Never share your Discord token with anyone!** Your token gives full access to your Discord account. Treat it like a password.
:::

## Method 1: Browser Developer Tools

1. Open [Discord Web](https://discord.com/app) in your browser
2. Log in to your account
3. Press `F12` or `Ctrl+Shift+I` to open Developer Tools
4. Go to the **Network** tab
5. Type `api` in the filter box
6. Click on any request to `discord.com/api`
7. Look in the **Headers** section for `Authorization`
8. Copy the token value (without quotes)

## Method 2: Console Command

1. Open [Discord Web](https://discord.com/app) in your browser
2. Press `F12` to open Developer Tools
3. Go to the **Console** tab
4. Paste this code and press Enter:

```javascript
(webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()
```

5. Copy the token that appears

## Method 3: Desktop App (Windows)

1. Open Discord desktop app
2. Press `Ctrl+Shift+I` to open Developer Tools
3. Follow Method 1 or 2 above

## Storing Your Token

Add your token to the `.env` file:

```env
DISCORD_TOKEN=your_token_here
```

::: tip Token Format
Discord tokens have three parts separated by dots:
```
[user_id_base64].[timestamp].[hmac]
```
Example format: `XXXXXXXXXXXXXXXXXX.XXXXXX.XXXXXXXXXXXXXXXXXXXXXXXXXXX`
:::

## Token Security Best Practices

- Never commit your `.env` file to version control
- Don't share screenshots that might show your token
- If your token is compromised, change your Discord password immediately
- Consider using a dedicated alt account for the bot
