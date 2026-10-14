# Lunar Кадровый Аудит

Discord.js v14 bot for Render.

## Files
- `index.js` — bot and slash commands
- `package.json` — dependencies and start command
- `.env.example` — local environment variable template

## Render setup
Create a **Web Service** or **Background Worker** from this repository. Since the bot does not serve HTTP traffic, a **Background Worker** is the appropriate service type.

Build command:
```bash
npm install
```

Start command:
```bash
npm start
```

Environment variables:
- `DISCORD_TOKEN` — bot token (keep secret)
- `GUILD_ID` — `1420742723991900233`
- `CHANNEL_ID` — `1559955029627244705`
- `STAFF_ROLE_ID` — `1559959552710021302`
- `NEWBIE_ROLE_ID` — leave blank until the role ID is known

## Discord Developer Portal
Enable the **Server Members Intent** if required by the server's bot configuration. Invite the bot with `bot` and `applications.commands` scopes. It needs View Channel, Send Messages, Embed Links, Use Application Commands, and Manage Roles. Put the bot's highest role above all roles it needs to assign.

## Behavior notes
- Slash commands are registered automatically to the configured guild on startup.
- `/принятие` takes a member and a game nickname/static, then displays a position menu. The two Owner entries intentionally look identical; they have distinct internal values.
- `/выдача_ролей` uses role autocomplete filtered by hierarchy and excludes roles the recipient already has.
- Unauthorized staff command use is silently discarded; wrong-channel responses are ephemeral.
- Acceptance and role issuance logs are posted in the configured channel.
- Acceptance role selection is held in memory for up to two minutes. If the process restarts while a selection is pending, the selection must be started again.
- The bot does not store a database. The Discord channel is the journal.
