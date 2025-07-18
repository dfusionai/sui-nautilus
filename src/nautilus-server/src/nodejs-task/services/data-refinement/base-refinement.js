class BaseRefinement {
  constructor(options = {}) {
    this.options = {
      sortByDate: options.sortByDate !== false,
      filterEmptyMessages: options.filterEmptyMessages !== false,
      ...options
    };
  }

  async refineData(rawData) {
    throw new Error('refineData method must be implemented by subclass');
  }

  validateInput(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Input data must be an object');
    }
    return true;
  }

  transformMessage(msg) {
    throw new Error('transformMessage method must be implemented by subclass');
  }

  sortMessages(messages) {
    if (!this.options.sortByDate) {
      return messages;
    }
    
    return messages.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateA - dateB;
    });
  }

  filterMessages(messages) {
    if (!this.options.filterEmptyMessages) {
      return messages;
    }
    
    return messages.filter(msg => 
      msg.message && 
      typeof msg.message === 'string' && 
      msg.message.trim().length > 0
    );
  }

  getStats(messages) {
    return {
      totalMessages: messages.length,
      messagesWithText: messages.filter(msg => 
        msg.message && typeof msg.message === 'string' && msg.message.trim().length > 0
      ).length,
      messagesWithReactions: messages.filter(msg => msg.reactions).length,
      dateRange: this._getDateRange(messages)
    };
  }

  _getDateRange(messages) {
    const validDates = messages
      .map(msg => msg.date)
      .filter(date => date)
      .map(date => new Date(date))
      .sort((a, b) => a - b);
    
    if (validDates.length === 0) {
      return { start: null, end: null };
    }
    
    return {
      start: validDates[0].toISOString(),
      end: validDates[validDates.length - 1].toISOString()
    };
  }
}

module.exports = BaseRefinement;