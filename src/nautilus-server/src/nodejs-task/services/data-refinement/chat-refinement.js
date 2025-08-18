const BaseRefinement = require('./base-refinement');

class ChatRefinement extends BaseRefinement {
  constructor(options = {}) {
    super(options);
  }

  async refineData(rawData) {
    this.validateInput(rawData);
    
    console.log(`📝 Starting chat data refinement...`);
    
    const refinedData = {
      revision: rawData.revision,
      user: rawData.user,
      messages: [],
    };

    if (rawData.chats && Array.isArray(rawData.chats)) {
      console.log(`📊 Processing ${rawData.chats.length} chat conversations...`);
      
      for (const chat of rawData.chats) {
        if (chat.contents && Array.isArray(chat.contents)) {
          console.log(`💬 Processing chat with ${chat.contents.length} messages...`);
          
          for (const msg of chat.contents) {
            const transformedMessage = this.transformMessage(msg, rawData.user, chat.chat_id);
            refinedData.messages.push(transformedMessage);
          }
        }
      }
      
      // Sort messages by date
      refinedData.messages = this.sortMessages(refinedData.messages);
    }

    const stats = this.getStats(refinedData.messages);
    console.log(`✅ Chat refinement completed. Stats:`, stats);
    
    return {
      ...refinedData,
      refinementStats: stats
    };
  }

  transformMessage(msg, userId, chatId) {
    if (!msg || typeof msg !== 'object') {
      throw new Error('Message must be an object');
    }

    const messageData = {
      id: msg.id,
      user_id: userId,
      chat_id: chatId,
      from_id: msg.fromId?.userId || null,
      date: msg.date ? new Date(msg.date * 1000).toISOString() : null,
      edit_date: msg.editDate ? new Date(msg.editDate * 1000).toISOString() : null,
      message: msg.message,
      out: msg.out,
      reactions: this._transformReactions(msg.reactions),
    };

    return messageData;
  }

  _transformReactions(reactions) {
    if (!reactions) {
      return null;
    }

    return {
      emoji: reactions.recentReactions?.[0]?.reaction?.emoticon || null,
      count: reactions.results?.[0]?.count || null,
    };
  }

  validateInput(data) {
    super.validateInput(data);
    
    if (!data.chats && !data.messages) {
      throw new Error('Input data must contain either chats or messages array');
    }
    
    if (data.chats && !Array.isArray(data.chats)) {
      throw new Error('Chats must be an array');
    }
    
    return true;
  }

  getStats(messages) {
    const baseStats = super.getStats(messages);
    
    return {
      ...baseStats,
      messagesWithFromId: messages.filter(msg => msg.from_id).length,
      messagesWithEditDate: messages.filter(msg => msg.edit_date).length,
      outgoingMessages: messages.filter(msg => msg.out === true).length,
      incomingMessages: messages.filter(msg => msg.out === false).length,
    };
  }
}

module.exports = ChatRefinement;