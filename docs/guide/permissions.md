# Permissions

SchroStream supports fine-grained permission control for who can use the bot.

## Default Behavior

By default, only the Discord account running the bot can use commands.

## Configuring Permissions

### Allow Specific Users

Add Discord user IDs to `ALLOWED_USERS`:

```env
ALLOWED_USERS=123456789012345678,987654321098765432
```

### Allow Roles

Add Discord role IDs to `ALLOWED_ROLES`:

```env
ALLOWED_ROLES=123456789012345678
```

Any user with one of these roles can control the bot.

### Restrict to Specific Servers

Add Discord server (guild) IDs to `ALLOWED_GUILDS`:

```env
ALLOWED_GUILDS=123456789012345678,987654321098765432
```

The bot will only respond to commands in these servers.

## Finding IDs

### Enable Developer Mode

1. Open Discord Settings
2. Go to **App Settings** → **Advanced**
3. Enable **Developer Mode**

### Copy User ID

Right-click on a user → **Copy User ID**

### Copy Role ID

1. Go to **Server Settings** → **Roles**
2. Right-click on a role → **Copy Role ID**

### Copy Server ID

Right-click on the server icon → **Copy Server ID**

## Permission Check Order

1. Check if user ID is in `ALLOWED_USERS`
2. Check if user has any role in `ALLOWED_ROLES`
3. Check if command is in `ALLOWED_GUILDS` (if configured)

If any check passes, the command is allowed.

## Example Configurations

### Personal Use Only
```env
ALLOWED_USERS=
ALLOWED_ROLES=
```
Only the bot account can use commands.

### Allow Friends
```env
ALLOWED_USERS=123456789,987654321
```
Specific users can control the bot.

### Server Admin Role
```env
ALLOWED_ROLES=123456789
```
Anyone with the "Media Controller" role can use the bot.

### Restrict to One Server
```env
ALLOWED_GUILDS=123456789
```
Bot only works in your private server.

### Combined
```env
ALLOWED_USERS=123456789
ALLOWED_ROLES=987654321
ALLOWED_GUILDS=555555555
```
Specific users OR users with the role can use the bot, but only in the specified server.
