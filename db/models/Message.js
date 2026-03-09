const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true, index: true },
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true, index: true },
  authorId: { type: String, required: true, index: true },
  authorName: String,
  authorDiscriminator: String,
  content: String,
  createdAt: { type: Date, required: true, index: true },
  editedAt: Date,
  editHistory: [
    {
      content: String,
      editedAt: Date,
    }
  ],
  reactionCount: { type: Number, default: 0 },
  mentionedUserIds: [String],
  mentionedRoleIds: [String],
  deleted: { type: Boolean, default: false, index: true },
  deletedAt: Date,
}, {
  timestamps: true,
});

messageSchema.index({ guildId: 1, createdAt: -1 });
messageSchema.index({ authorId: 1, createdAt: -1 });
messageSchema.index({ channelId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
