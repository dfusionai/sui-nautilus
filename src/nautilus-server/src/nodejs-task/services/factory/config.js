const config = {
  embedding: {
    providers: {
      ollama: {
        defaultBatchSize: 10,
        maxRetries: 3,
        timeout: 30000
      }
    }
  },
  vectorDb: {
    providers: {
      qdrant: {
        defaultBatchSize: 100,
        maxRetries: 3,
        timeout: 10000
      }
    }
  },
  processor: {
    defaultEmbeddingProvider: 'ollama',
    defaultVectorDbProvider: 'qdrant'
  }
};

module.exports = config;