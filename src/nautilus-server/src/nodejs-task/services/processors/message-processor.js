class MessageProcessor {
  constructor(embeddingService, vectorDbService, options = {}) {
    this.embeddingService = embeddingService;
    this.vectorDbService = vectorDbService;
    this.options = {
      storeVectors: options.storeVectors !== false,
      includeEmbeddingsInOutput: options.includeEmbeddingsInOutput !== false,
      batchSize: options.batchSize || 50,
      ...options
    };
    
    this.stats = {
      totalMessages: 0,
      successfulEmbeddings: 0,
      failedEmbeddings: 0,
      storedVectors: 0,
      failedVectorStorage: 0
    };
  }

  async processMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      console.log('⚠️  No messages to process');
      return [];
    }

    console.log(`🔄 Starting message processing for ${messages.length} messages`);
    this.stats.totalMessages = messages.length;

    const results = [];
    
    for (let i = 0; i < messages.length; i += this.options.batchSize) {
      const batch = messages.slice(i, i + this.options.batchSize);
      const batchNum = Math.floor(i / this.options.batchSize) + 1;
      const totalBatches = Math.ceil(messages.length / this.options.batchSize);
      
      console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} messages)`);
      
      const batchResults = await this._processBatch(batch);
      results.push(...batchResults);
      
      if (i + this.options.batchSize < messages.length) {
        await this._delay(100);
      }
    }

    console.log(`✅ Completed message processing. Stats:`, this.getStats());
    return results;
  }

  async _processBatch(batch) {
    const messagesWithText = batch.filter(msg => 
      msg.message && typeof msg.message === 'string' && msg.message.trim().length > 0
    );

    if (messagesWithText.length === 0) {
      console.log('⚠️  No messages with text content in this batch');
      return batch.map(msg => ({
        ...msg,
        embedding: null,
        vectorStored: false,
        processingError: 'No text content'
      }));
    }

    const embeddingResults = await this.embeddingService.embedBatch(
      messagesWithText.map(msg => msg.message)
    );

    const processedMessages = [];
    const vectorsToStore = [];

    for (let i = 0; i < batch.length; i++) {
      const originalMessage = batch[i];
      const messageWithTextIndex = messagesWithText.findIndex(msg => msg.id === originalMessage.id);
      
      if (messageWithTextIndex === -1) {
        processedMessages.push({
          ...originalMessage,
          embedding: null,
          vectorStored: false,
          processingError: 'No text content'
        });
        continue;
      }

      const embeddingResult = embeddingResults[messageWithTextIndex];
      
      if (embeddingResult.success) {
        this.stats.successfulEmbeddings++;
        
        const processedMessage = {
          ...originalMessage,
          embedding: this.options.includeEmbeddingsInOutput ? embeddingResult.embedding : null,
          vectorStored: false,
          embeddingDimensions: embeddingResult.embedding.length
        };

        if (this.options.storeVectors) {
          vectorsToStore.push({
            id: originalMessage.id,
            vector: embeddingResult.embedding,
            metadata: {
              message_id: originalMessage.id,
              from_id: originalMessage.from_id,
              date: originalMessage.date,
              message_text: originalMessage.message,
              out: originalMessage.out,
              reactions: originalMessage.reactions,
              processed_at: new Date().toISOString()
            }
          });
        }

        processedMessages.push(processedMessage);
      } else {
        this.stats.failedEmbeddings++;
        processedMessages.push({
          ...originalMessage,
          embedding: null,
          vectorStored: false,
          processingError: embeddingResult.error || 'Unknown embedding error'
        });
      }
    }

    if (vectorsToStore.length > 0 && this.options.storeVectors) {
      await this._storeVectors(vectorsToStore, processedMessages);
    }

    return processedMessages;
  }

  async _storeVectors(vectors, processedMessages) {
    try {
      console.log(`📊 Storing ${vectors.length} vectors in vector database...`);
      
      if (!this.vectorDbService.isConnected()) {
        await this.vectorDbService.connect();
      }

      const storeResults = await this.vectorDbService.storeBatch(vectors);
      
      for (let i = 0; i < storeResults.length; i++) {
        const storeResult = storeResults[i];
        const messageIndex = processedMessages.findIndex(msg => msg.id.toString() === storeResult.id);
        
        if (messageIndex !== -1) {
          if (storeResult.success) {
            processedMessages[messageIndex].vectorStored = true;
            this.stats.storedVectors++;
          } else {
            processedMessages[messageIndex].vectorStored = false;
            processedMessages[messageIndex].vectorStorageError = storeResult.error || 'Unknown storage error';
            this.stats.failedVectorStorage++;
          }
        }
      }

      console.log(`✅ Successfully stored ${this.stats.storedVectors} vectors`);
    } catch (error) {
      console.error(`❌ Failed to store vectors: ${error.message}`);
      this.stats.failedVectorStorage += vectors.length;
      
      processedMessages.forEach(msg => {
        if (msg.vectorStored === false && !msg.vectorStorageError) {
          msg.vectorStorageError = error.message;
        }
      });
    }
  }

  async searchSimilarMessages(queryMessage, limit = 10) {
    try {
      console.log(`🔍 Searching for similar messages to: ${queryMessage.substring(0, 50)}...`);
      
      const embedding = await this.embeddingService.embedSingle(queryMessage);
      
      if (!this.vectorDbService.isConnected()) {
        await this.vectorDbService.connect();
      }

      const results = await this.vectorDbService.search(embedding, limit);
      
      console.log(`🔍 Found ${results.length} similar messages`);
      return results;
    } catch (error) {
      console.error(`❌ Error searching similar messages: ${error.message}`);
      throw error;
    }
  }

  async healthCheck() {
    const embeddingHealth = await this.embeddingService.healthCheck();
    const vectorDbHealth = await this.vectorDbService.healthCheck();
    
    return {
      status: embeddingHealth.status === 'healthy' && vectorDbHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
      embedding: embeddingHealth,
      vectorDb: vectorDbHealth,
      options: this.options,
      stats: this.stats
    };
  }

  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalMessages > 0 ? 
        (this.stats.successfulEmbeddings / this.stats.totalMessages * 100).toFixed(2) + '%' : '0%',
      vectorStorageRate: this.stats.successfulEmbeddings > 0 ? 
        (this.stats.storedVectors / this.stats.successfulEmbeddings * 100).toFixed(2) + '%' : '0%'
    };
  }

  resetStats() {
    this.stats = {
      totalMessages: 0,
      successfulEmbeddings: 0,
      failedEmbeddings: 0,
      storedVectors: 0,
      failedVectorStorage: 0
    };
  }

  async _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = MessageProcessor;