# Discord Archiver

A run-once batch job that backfills historical Discord messages, reactions, and links into the same MongoDB instance used by [discord-jarvis](../discord-jarvis). Designed to be deployed as a Portainer stack that joins discord-jarvis's `discord-network`.

## Features

- **Backfill modes**: archive yesterday, last week, last month, last year, everything, or a custom date range
- **Incremental sync**: when no backfill mode is set, only fetches since the last run
- **Message archiving**: stores content, author, edit history, mentions
- **Reaction tracking**: records emoji reactions and who used them
- **Link extraction**: extracts and indexes every URL shared

## Prerequisites

- The `discord-jarvis` stack must be running (owns `discord-network` and MongoDB)
- The bot must have `View Channel` + `Read Message History` permissions in the guild

---

## Portainer / Docker Setup

### 1. Build and push the image

```bash
docker build -t registry.garage.kwandrews.com/discord-archiver:latest .
docker push registry.garage.kwandrews.com/discord-archiver:latest
```

### 2. Create the stack in Portainer

Add a new stack and paste the contents of `docker-compose.yml`, then set the following environment variables in Portainer's env editor:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_CLIENT_ID` | Bot client ID |
| `DISCORD_GUILD_ID` | Guild (server) ID to archive |
| `MONGO_ROOT_USER` | Matches `MONGO_ROOT_USER` in discord-jarvis stack |
| `MONGO_ROOT_PASSWORD` | Matches `MONGO_ROOT_PASSWORD` in discord-jarvis stack |
| `BACKFILL_MODE` | See table below |
| `BACKFILL_START_DATE` | ISO 8601 — only for `custom` mode |
| `BACKFILL_END_DATE` | ISO 8601 — only for `custom` mode (omit to use now) |

### 3. Backfill progressively

Run the stack once per batch, increasing `BACKFILL_MODE` each time:

| `BACKFILL_MODE` | Window |
|---|---|
| `yesterday` | Past 24 hours |
| `last_week` | Past 7 days |
| `last_month` | Past 30 days |
| `last_year` | Past 365 days |
| `all` | Everything since 2015-01-01 |
| `custom` | `BACKFILL_START_DATE` → `BACKFILL_END_DATE` |
| *(unset)* | Incremental: since last SyncLog entry (first run = 7 days) |

All modes are idempotent — re-running will upsert without creating duplicates.

---

## Local Dev Setup

```bash
npm install
cp .env.example .env
# Fill in .env, then:
npm start
```

For local dev, set `MONGODB_URI=mongodb://localhost:27017/discord-jarvis` in `.env` to bypass the Docker hostname.

---

## Project Structure

```
discord-archiver/
├── db/
│   ├── connection.js          # MongoDB connection
│   └── models/
│       ├── Message.js         # Matches discord-jarvis schema exactly
│       ├── Reaction.js
│       ├── Link.js
│       └── SyncLog.js
├── utils/
│   ├── archiver.js            # Core archiving + backfill date-range logic
│   ├── linkExtractor.js       # URL extraction
│   └── reportGenerator.js
├── scripts/
│   └── generateReports.js
├── index.js                   # Entry point
├── docker-compose.yml         # Joins discord-network as external
└── .env.example
```

## Notes

- The archiver writes into the same `discord-jarvis` database, so data is immediately visible to the bot's queries and slash commands
- `SyncLog` is only updated on incremental runs; backfill batches do not touch it
- Bot messages are skipped during archiving
- Discord's API only exposes the current content of edited messages (not the full edit history), so `editHistory` will contain at most one entry per edited message
