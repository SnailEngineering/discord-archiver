const Message = require('../db/models/Message');
const Reaction = require('../db/models/Reaction');
const SyncLog = require('../db/models/SyncLog');
const { extractLinksFromMessage } = require('./linkExtractor');

async function getSyncStartTime(guildId) {
  const lastSync = await SyncLog.findOne({ guildId });

  if (!lastSync) {
    // First sync: start from 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return sevenDaysAgo;
  }

  return lastSync.lastSyncTime;
}

async function archiveMessage(message, editHistory = []) {
  try {
    const existingMessage = await Message.findOne({ messageId: message.id });

    // Extract links from message content
    await extractLinksFromMessage(message);

    // Extract links from edit history
    if (editHistory.length > 0) {
      const { extractLinksFromEditHistory } = require('./linkExtractor');
      await extractLinksFromEditHistory(message.id, editHistory);
    }

    const messageData = {
      messageId: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: message.author.id,
      authorName: message.author.username,
      authorDiscriminator: message.author.discriminator,
      content: message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      editHistory: editHistory,
      mentionedUserIds: Array.from(message.mentions.users.keys()),
      mentionedRoleIds: Array.from(message.mentions.roles.keys()),
    };

    if (existingMessage) {
      // Update existing message
      await Message.updateOne(
        { messageId: message.id },
        { $set: messageData }
      );
    } else {
      // Create new message
      await Message.create(messageData);
    }

    return true;
  } catch (error) {
    console.error(`Failed to archive message ${message.id}:`, error.message);
    return false;
  }
}

async function archiveReactions(message) {
  try {
    for (const [emoji, reactionObj] of message.reactions.cache) {
      const users = await reactionObj.users.fetch();
      const userArray = Array.from(users.values()).map(user => ({
        userId: user.id,
        userName: user.username,
        addedAt: new Date(),
      }));

      await Reaction.findOneAndUpdate(
        {
          messageId: message.id,
          emoji: emoji,
        },
        {
          $set: {
            messageId: message.id,
            guildId: message.guildId,
            emoji: emoji,
            emojiName: reactionObj.emoji.name,
            emojiId: reactionObj.emoji.id,
            count: reactionObj.count,
            users: userArray,
          },
        },
        { upsert: true, new: true }
      );
    }
    return true;
  } catch (error) {
    console.error(`Failed to archive reactions for message ${message.id}:`, error.message);
    return false;
  }
}

async function fetchMessageHistory(channel, afterDate) {
  const messages = [];
  let lastMessageId = null;
  let hasMore = true;

  console.log(`  Fetching messages from #${channel.name} after ${afterDate.toLocaleString()}`);

  while (hasMore) {
    try {
      const options = {
        limit: 100,
      };

      if (lastMessageId) {
        options.before = lastMessageId;
      }

      const fetchedMessages = await channel.messages.fetch(options);

      if (fetchedMessages.size === 0) {
        hasMore = false;
        break;
      }

      for (const [, message] of fetchedMessages) {
        if (message.createdAt <= afterDate) {
          hasMore = false;
          break;
        }
        messages.push(message);
      }

      if (hasMore && fetchedMessages.size > 0) {
        lastMessageId = fetchedMessages.last().id;
      }
    } catch (error) {
      console.error(`  Error fetching messages from #${channel.name}:`, error.message);
      break;
    }
  }

  return messages.reverse();
}

async function syncGuild(guild) {
  const startSyncTime = new Date();
  let totalMessagesProcessed = 0;
  let totalReactionsProcessed = 0;
  let totalLinksExtracted = 0;

  try {
    // Get the start time for this sync
    const syncStartTime = await getSyncStartTime(guild.id);

    console.log(`Last sync: ${syncStartTime.toLocaleString()}`);
    console.log(`Syncing guild: ${guild.name}\n`);

    // Fetch all text channels
    const channels = guild.channels.cache.filter(ch => ch.isTextBased() && !ch.isDMBased());

    if (channels.size === 0) {
      console.log('✗ No text channels found');
      return;
    }

    console.log(`Found ${channels.size} text channels\n`);

    // Process each channel
    for (const [, channel] of channels) {
      try {
        if (!channel.permissionsFor(guild.members.me).has('ViewChannel')) {
          console.log(`⊘ Skipping #${channel.name} (no access)`);
          continue;
        }

        const channelMessages = await fetchMessageHistory(channel, syncStartTime);

        if (channelMessages.length === 0) {
          console.log(`✓ #${channel.name} - no new messages`);
          continue;
        }

        console.log(`✓ #${channel.name} - processing ${channelMessages.length} messages`);

        for (const message of channelMessages) {
          if (message.author.bot) continue;

          // Track edit history
          const editHistory = [];
          if (message.editedAt) {
            // Note: Discord doesn't provide full edit history via API
            // We can only track that a message was edited and the current content
            editHistory.push({
              content: message.content,
              editedAt: message.editedAt,
            });
          }

          const archived = await archiveMessage(message, editHistory);
          if (archived) {
            totalMessagesProcessed++;
            totalLinksExtracted += (message.content.match(/https?:\/\/[^\s<>"\]]+/gi) || []).length;
          }

          const reactionsArchived = await archiveReactions(message);
          if (reactionsArchived) {
            totalReactionsProcessed += message.reactions.cache.size;
          }
        }
      } catch (error) {
        console.error(`Error processing channel #${channel.name}:`, error.message);
      }
    }

    // Update sync log
    await SyncLog.findOneAndUpdate(
      { guildId: guild.id },
      {
        $set: {
          guildId: guild.id,
          lastSyncTime: startSyncTime,
          syncDuration: Date.now() - startSyncTime.getTime(),
          messagesProcessed: totalMessagesProcessed,
          reactionsProcessed: totalReactionsProcessed,
          linksExtracted: totalLinksExtracted,
        },
      },
      { upsert: true, new: true }
    );

    console.log(`\n📊 Sync Summary:`);
    console.log(`  Messages: ${totalMessagesProcessed}`);
    console.log(`  Reactions: ${totalReactionsProcessed}`);
    console.log(`  Links: ${totalLinksExtracted}`);
  } catch (error) {
    console.error('Error during guild sync:', error);
    throw error;
  }
}

module.exports = {
  syncGuild,
  archiveMessage,
  archiveReactions,
  fetchMessageHistory,
  getSyncStartTime,
};
