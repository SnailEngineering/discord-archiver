const Link = require('../db/models/Link');

// URL regex pattern - matches http(s) URLs
const URL_REGEX = /https?:\/\/[^\s<>"\]]+/gi;

// Build link documents for a message and its edit history.
function buildLinkDocs(message, editHistory = []) {
  const docs = [];

  const addDocs = (content) => {
    const urls = content.match(URL_REGEX) || [];
    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        docs.push({
          url,
          messageId: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          authorId: message.author.id,
          authorName: message.author.username,
          domain: urlObj.hostname,
          foundAt: message.createdAt,
        });
      } catch {
        // invalid URL, skip
      }
    }
  };

  addDocs(message.content);
  for (const edit of editHistory) addDocs(edit.content);

  return docs;
}

// Insert all links for a batch of new { message, editHistory } pairs.
// Caller guarantees these are new messages, so no existence check is needed.
async function extractLinksFromBatch(batch) {
  const docs = batch.flatMap(({ message, editHistory }) => buildLinkDocs(message, editHistory));
  if (docs.length > 0) await Link.insertMany(docs, { ordered: false });
  return docs.length;
}

module.exports = { URL_REGEX, buildLinkDocs, extractLinksFromBatch };
