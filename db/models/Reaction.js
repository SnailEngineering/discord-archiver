const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
  messageId: { type: String, required: true, index: true },
  guildId: { type: String, required: true, index: true },
  emoji: { type: String, required: true },
  emojiId: String,
  emojiName: String,
  count: { type: Number, default: 1 },
  users: [
    {
      userId: String,
      userName: String,
      addedAt: Date,
    }
  ],
}, {
  timestamps: true,
});

reactionSchema.index({ messageId: 1, emoji: 1 }, { unique: true });
reactionSchema.index({ guildId: 1, emoji: 1 });

module.exports = mongoose.model('Reaction', reactionSchema);
