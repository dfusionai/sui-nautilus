const config = {
  embedding: {
    providers: {
      ollama: {
        defaultBatchSize: 50,
        maxRetries: 3,
        timeout: 1000 * 60 * 10
      }
    }
  },
  vectorDb: {
    providers: {
      qdrant: {
        defaultBatchSize: 500,
        maxRetries: 3,
        timeout: 1000 * 60 * 10
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