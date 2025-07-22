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

  static createRefinementService(type = 'chat', options = {}) {
    const providerConfig = config.refinement.providers[type];
    if (!providerConfig) {
      throw new Error(`Unknown refinement service type: ${type}`);
    }

    const mergedOptions = { ...providerConfig, ...options };

    switch (type) {
      case 'chat':
        const ChatRefinement = require('../data-refinement/chat-refinement');
        return new ChatRefinement(mergedOptions);
      default:
        throw new Error(`Unsupported refinement service type: ${type}`);
    }
  }

  static createSuiService(options = {}) {
    const providerConfig = config.blockchain.providers.sui;
    const mergedOptions = { ...providerConfig, ...options };

    const SuiOperations = require('../blockchain/sui-operations');
    return new SuiOperations(mergedOptions);
  }

  static createWalrusService(options = {}) {
    const providerConfig = config.blockchain.providers.walrus;
    const mergedOptions = { ...providerConfig, ...options };

    const WalrusOperations = require('../blockchain/walrus-operations');
    return new WalrusOperations(mergedOptions);
  }

  static createSealService(suiClient, options = {}) {
    const providerConfig = config.blockchain.providers.seal;
    const mergedOptions = { ...providerConfig, ...options };

    const SealOperations = require('../blockchain/seal-operations');
    return new SealOperations(suiClient, mergedOptions);
  }

  static createBlockchainServices(options = {}) {
    const suiService = this.createSuiService(options.sui || {});
    const walrusService = this.createWalrusService(options.walrus || {});
    
    // Initialize Sui client for Seal operations
    const { SuiClient, getFullnodeUrl } = require("@mysten/sui/client");
    const suiClient = new SuiClient({ url: getFullnodeUrl("testnet") });
    const sealService = this.createSealService(suiClient, options.seal || {});

    return {
      sui: suiService,
      walrus: walrusService,
      seal: sealService
    };
  }



  static getAvailableServices() {
    return {
      embedding: Object.keys(config.embedding.providers),
      vectorDb: Object.keys(config.vectorDb.providers),
      refinement: Object.keys(config.refinement.providers),
      blockchain: Object.keys(config.blockchain.providers)
    };
  }
}

module.exports = ServiceFactory;