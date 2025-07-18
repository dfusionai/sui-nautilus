const config = require('./config');

class ServiceFactory {
  static createEmbeddingService(type = 'ollama', options = {}) {
    const providerConfig = config.embedding.providers[type];
    if (!providerConfig) {
      throw new Error(`Unknown embedding service type: ${type}`);
    }

    const mergedOptions = { ...providerConfig, ...options };

    switch (type) {
      case 'ollama':
        const OllamaEmbedding = require('../embedding/ollama-embedding');
        return new OllamaEmbedding(mergedOptions);
      default:
        throw new Error(`Unsupported embedding service type: ${type}`);
    }
  }

  static createVectorDbService(type = 'qdrant', options = {}) {
    const providerConfig = config.vectorDb.providers[type];
    if (!providerConfig) {
      throw new Error(`Unknown vector database service type: ${type}`);
    }

    const mergedOptions = { ...providerConfig, ...options };

    switch (type) {
      case 'qdrant':
        const QdrantService = require('../vector-db/qdrant-service');
        return new QdrantService(mergedOptions);
      default:
        throw new Error(`Unsupported vector database service type: ${type}`);
    }
  }

  static createMessageProcessor(embeddingType = null, vectorDbType = null, options = {}) {
    const processorConfig = config.processor;
    
    const embeddingService = this.createEmbeddingService(
      embeddingType || processorConfig.defaultEmbeddingProvider,
      options.embedding || {}
    );
    
    const vectorDbService = this.createVectorDbService(
      vectorDbType || processorConfig.defaultVectorDbProvider,
      options.vectorDb || {}
    );

    const MessageProcessor = require('../processors/message-processor');
    return new MessageProcessor(embeddingService, vectorDbService, options.processor || {});
  }

  static getAvailableServices() {
    return {
      embedding: Object.keys(config.embedding.providers),
      vectorDb: Object.keys(config.vectorDb.providers)
    };
  }
}

module.exports = ServiceFactory;