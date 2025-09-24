class BaseEmbedding {
  constructor(options = {}) {
    this.options = {
      batchSize: options.batchSize || 50,
      maxRetries: options.maxRetries || 3,
      timeout: options.timeout || (1000 * 60 * 10),
      ...options
    };
  }

  async embedSingle(message) {
    throw new Error('embedSingle method must be implemented by subclass');
  }

  async embedBatch(messages, batchSize = null) {
    const timerLabel = `⌚ embedBatch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.time(timerLabel);
    const effectiveBatchSize = batchSize || this.options.batchSize;
    const results = [];
    
    console.log(`🔤 Starting batch embedding for ${messages.length} messages (batch size: ${effectiveBatchSize})`);
    
    for (let i = 0; i < messages.length; i += effectiveBatchSize) {
      const batch = messages.slice(i, i + effectiveBatchSize);
      console.log(`🔤 Processing batch ${Math.floor(i / effectiveBatchSize) + 1}/${Math.ceil(messages.length / effectiveBatchSize)}`);
      
      const batchResults = await this._processBatch(batch);
      results.push(...batchResults);
      
      if (i + effectiveBatchSize < messages.length) {
        await this._delay(100);
      }
    }
    
    console.log(`✅ Completed batch embedding for ${results.length} messages`);
    console.timeEnd(timerLabel);
    return results;
  }

  async _processBatch(batch) {
    const results = [];
    
    for (const message of batch) {
      try {
        const embedding = await this.embedSingle(message);
        results.push({
          message,
          embedding,
          success: true
        });
      } catch (error) {
        console.error(`❌ Failed to embed message: ${error.message}`);
        results.push({
          message,
          embedding: null,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }

  async _retryOperation(operation, maxRetries = null) {
    const retries = maxRetries || this.options.maxRetries;
    let lastError;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`⚠️ Attempt ${attempt + 1} failed: ${error.message}, retrying in ${delay}ms...`);
          await this._delay(delay);
        }
      }
    }
    
    throw lastError;
  }

  async _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      batchSize: this.options.batchSize,
      maxRetries: this.options.maxRetries,
      timeout: this.options.timeout
    };
  }
}

module.exports = BaseEmbedding;