const Link = require('../db/models/Link');

// URL regex pattern - matches http(s) URLs
const URL_REGEX = /https?:\/\/[^\s<>"\]]+/gi;

async function extractLinksFromMessage(message) {
  const urls = message.content.match(URL_REGEX) || [];
  const extractedLinks = [];

  for (const url of urls) {
    try {
      const urlObj = new URL(url);
      const link = await Link.findOneAndUpdate(
        {
          url: url,
          messageId: message.id,
        },
        {
          $set: {
            url: url,
            messageId: message.id,
            guildId: message.guildId,
            channelId: message.channelId,
            authorId: message.author.id,
            authorName: message.author.username,
            domain: urlObj.hostname,
            foundAt: message.createdAt,
          },
        },
        { upsert: true, new: true }
      );
      extractedLinks.push(link);
    } catch (error) {
      console.error(`Failed to process URL: ${url}`, error.message);
    }
  }

  return extractedLinks;
}

async function extractLinksFromEditHistory(messageId, editHistory) {
  let totalLinks = 0;

  for (const edit of editHistory) {
    const urls = edit.content.match(URL_REGEX) || [];
    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        await Link.updateOne(
          {
            url: url,
            messageId: messageId,
          },
          {
            $set: {
              url: url,
              messageId: messageId,
              domain: urlObj.hostname,
            },
          },
          { upsert: true }
        );
        totalLinks++;
      } catch (error) {
        console.error(`Failed to process URL from edit history: ${url}`, error.message);
      }
    }
  }

  return totalLinks;
}

module.exports = {
  extractLinksFromMessage,
  extractLinksFromEditHistory,
  URL_REGEX,
};
