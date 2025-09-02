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
  refinement: {
    providers: {
      chat: {
        sortByDate: true,
        filterEmptyMessages: true
      }
    }
  },
  blockchain: {
    providers: {
      sui: {
        network: "testnet",
        maxRetries: 3,
        timeout: 30000
      },
      walrus: {
        maxRetries: 3,
        timeout: 30000
      },
      seal: {
        threshold: 1,
        maxRetries: 3,
        timeout: 30000
      }
    }
  }
};

module.exports = config;