# Discord Archiver

A Discord bot utility that archives chat history to MongoDB and generates weekly usage statistics.

## Features

- **Incremental Syncing**: Only fetches new messages since the last run
- **Message Archiving**: Stores all messages with full context
- **Edit Tracking**: Tracks message edits in the edit history
- **Reaction Tracking**: Records emoji reactions and who used them
- **Link Extraction**: Automatically extracts and indexes all URLs shared
- **Weekly Reports**: Generates detailed statistics including:
  - Top message posters
  - Most edited messages and editors
  - Most used reactions
  - Most active channels
  - Top shared domains
  - Top link sharers

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create or update the `.env` file with your Discord bot credentials:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_GUILD_ID=your_guild_id_here
MONGODB_URI=mongodb://localhost:27017/discord-archiver
```

- **DISCORD_TOKEN**: Your Discord bot token from [Discord Developer Portal](https://discord.com/developers/applications)
- **DISCORD_CLIENT_ID**: Your bot's Client ID
- **DISCORD_GUILD_ID**: The Discord server (guild) ID to archive
- **MONGODB_URI**: MongoDB connection string (defaults to local MongoDB if not set)

### 3. Ensure MongoDB is Running

Make sure MongoDB is running and accessible:

```bash
# If using local MongoDB
mongod

# Or use MongoDB Atlas (cloud) by setting MONGODB_URI in .env
```

## Usage

### Run Archive Sync

This performs an incremental sync of all messages, reactions, and links:

```bash
npm start
```

The first run will fetch messages from the last 7 days. Subsequent runs will only fetch messages since the last sync.

### Generate Weekly Report

Generate a formatted weekly statistics report:

```bash
npm run generate-reports
```

Reports are saved to the `reports/` directory in both JSON and text formats.

## Project Structure

```
discord-archiver/
├── db/
│   ├── connection.js          # MongoDB connection setup
│   └── models/
│       ├── Message.js         # Message schema
│       ├── Reaction.js        # Reaction schema
│       ├── Link.js            # Link schema
│       └── SyncLog.js         # Sync tracking schema
├── utils/
│   ├── archiver.js            # Core archiving logic
│   ├── linkExtractor.js       # URL extraction utilities
│   └── reportGenerator.js     # Report generation logic
├── scripts/
│   └── generateReports.js     # Report generation script
├── index.js                   # Main entry point
├── package.json               # Dependencies
├── .env                       # Environment configuration
└── README.md                  # This file
```

## How It Works

### Incremental Sync

1. Checks MongoDB for the last sync time
2. Fetches messages created since the last sync
3. For first-time runs, fetches messages from the last 7 days
4. Stores new messages and updates existing ones with edit information

### Data Collected

- **Messages**: Content, author, timestamp, edit history
- **Reactions**: Emoji, count, and users who reacted
- **Links**: URL, domain, author, and timestamp
- **Edit History**: Tracks when messages were edited

## Data NOT Stored

To save space and time:
- Embedded content (embeds, rich messages)
- Attachments (files, images, etc.)
- Full user profiles or history beyond what's needed

## Notes

- Bot needs `View Channel`, `Read Messages`, and `Read Message History` permissions
- Reactions and edits are tracked in the current state (not historical snapshots)
- First sync may take a while depending on server size and message volume
- Subsequent syncs are typically very fast (only new messages)

## Scheduling (Optional)

To run syncs on a schedule, use a cron job or task scheduler:

```bash
# Example: Run daily at 2 AM using cron
0 2 * * * cd /path/to/discord-archiver && npm start >> logs/sync.log 2>&1
```

## Troubleshooting

**Bot can't access channels:**
- Ensure the bot has proper permissions in the Discord server
- Check that DISCORD_GUILD_ID is correct

**MongoDB connection fails:**
- Verify MongoDB is running
- Check MONGODB_URI is correct
- Ensure network connectivity to MongoDB

**No messages being archived:**
- Verify DISCORD_GUILD_ID matches your server ID
- Check bot has permission to view channels
- Look for error messages in console output
