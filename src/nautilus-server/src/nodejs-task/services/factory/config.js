const config = {
  embedding: {
    providers: {
      ollama: {
        defaultBatchSize: 64,
        maxRetries: 3,
        timeout: 1000 * 60 * 6
      }
    }
  },
  vectorDb: {
    providers: {
      qdrant: {
        defaultBatchSize: 500,
        maxRetries: 3,
        timeout: 1000 * 60 * 3
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
        network: "mainnet",
        maxRetries: 3,
        timeout: 1000 * 60 * 2
      },
      walrus: {
        maxRetries: 3,
        timeout: 1000 * 60 * 2
      },
      seal: {
        threshold: 1,
        maxRetries: 3,
        timeout: 1000 * 60 * 2
      }
    }
  }
};

module.exports = config;