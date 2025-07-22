#!/usr/bin/env node
require("dotenv").config();

// Polyfill for AbortSignal.any() if not available (Node.js < 20.3.0)
if (!AbortSignal.any) {
  AbortSignal.any = function(signals) {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      signal.addEventListener('abort', () => {
        controller.abort(signal.reason);
      }, { once: true });
    }
    return controller.signal;
  };
}

const ServiceFactory = require("./services/factory/service-factory");

// Required environment variables that should be passed from Rust app
const requiredEnvVars = [
  "MOVE_PACKAGE_ID",
  "SUI_SECRET_KEY", 
  "WALRUS_AGGREGATOR_URL",
  "WALRUS_PUBLISHER_URL",
  "WALRUS_EPOCHS",
  "OLLAMA_API_URL",
  "OLLAMA_MODEL",
  "QDRANT_URL",
  "QDRANT_COLLECTION_NAME",
];

console.log("🔧 Validating environment variables passed from Rust app...");
const missingVars = [];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    missingVars.push(key);
    console.error(`❌ Missing required environment variable: ${key}`);
  } else {
    console.log(`✅ ${key}: ${key.includes('SECRET') ? '***hidden***' : process.env[key]}`);
  }
}

if (missingVars.length > 0) {
  console.error(`💥 Missing ${missingVars.length} required environment variable(s).`);
  console.error("These should be passed from Rust app via AppState.");
  process.exit(1);
}

console.log("✅ All required environment variables are available from Rust app");

// Validate required CLI arguments
const args = process.argv.slice(2);
if (args.length < 6) {
  console.error("Usage: node index.js <address> <blobId> <onChainFileObjId> <policyObjectId> <threshold> <enclaveId>");
  process.exit(1);
}
const [
  address,
  blobId,
  onChainFileObjId,
  policyObjectId,
  threshold,
  enclaveId,
] = args;

console.log("📋 CLI Arguments received:");
console.log(`  Address: ${address}`);
console.log(`  BlobId: ${blobId}`);
console.log(`  OnChainFileObjId: ${onChainFileObjId}`);
console.log(`  PolicyObjectId: ${policyObjectId}`);
console.log(`  Threshold: ${threshold}`);
console.log(`  EnclaveId: ${enclaveId}`);

// --- Services ---
let services = {};

async function initializeServices() {
  try {
    console.log("🔧 Initializing all services...");
    
    // Initialize all services using factory
    services = {
      refinement: ServiceFactory.createRefinementService('chat'),
      embedding: ServiceFactory.createEmbeddingService('ollama', {
        batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '10')
      }),
      vectorDb: ServiceFactory.createVectorDbService('qdrant', {
        batchSize: parseInt(process.env.VECTOR_BATCH_SIZE || '100')
      }),
      blockchain: ServiceFactory.createBlockchainServices()
    };

    // Initialize blockchain services
    await services.blockchain.sui.initialize();
    
    console.log("✅ All services initialized successfully");
    return services;
  } catch (error) {
    console.error("❌ Failed to initialize services:", error.message);
    throw error;
  }
}

async function processMessagesDirectly(messages, embeddingService, vectorDbService, walrusService, sealService, policyObjectId) {
  if (!Array.isArray(messages) || messages.length === 0) {
    console.log('⚠️  No messages to process');
    return [];
  }

  console.log(`🔄 Starting direct message processing for ${messages.length} messages`);
  
  const batchSize = parseInt(process.env.PROCESSING_BATCH_SIZE || '50');
  const storeVectors = process.env.STORE_VECTORS !== 'false';
  const includeEmbeddings = process.env.INCLUDE_EMBEDDINGS !== 'false';
  
  const results = [];
  const stats = {
    totalMessages: messages.length,
    successfulEmbeddings: 0,
    failedEmbeddings: 0,
    successfulWalrusUploads: 0,
    failedWalrusUploads: 0,
    storedVectors: 0,
    failedVectorStorage: 0
  };

  // Connect to vector database if needed
  if (storeVectors && !vectorDbService.isConnected()) {
    await vectorDbService.connect();
  }

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(messages.length / batchSize);
    
    console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} messages)`);
    
    const messagesWithText = batch.filter(msg => 
      msg.message && typeof msg.message === 'string' && msg.message.trim().length > 0
    );

    if (messagesWithText.length === 0) {
      console.log('⚠️  No messages with text content in this batch');
      results.push(...batch.map(msg => ({
        ...msg,
        embedding: null,
        vectorStored: false,
        walrusUploaded: false,
        processingError: 'No text content'
      })));
      continue;
    }

    // Generate embeddings for batch
    const embeddingResults = await embeddingService.embedBatch(
      messagesWithText.map(msg => msg.message)
    );

    // Process results and prepare for vector storage
    const vectorsToStore = [];
    
    for (let j = 0; j < batch.length; j++) {
      const originalMessage = batch[j];
      const messageWithTextIndex = messagesWithText.findIndex(msg => msg.id === originalMessage.id);
      
      if (messageWithTextIndex === -1) {
        results.push({
          ...originalMessage,
          embedding: null,
          vectorStored: false,
          walrusUploaded: false,
          processingError: 'No text content'
        });
        continue;
      }

      const embeddingResult = embeddingResults[messageWithTextIndex];
      
      if (embeddingResult.success) {
        stats.successfulEmbeddings++;
        
        const processedMessage = {
          ...originalMessage,
          embedding: includeEmbeddings ? embeddingResult.embedding : null,
          vectorStored: false,
          walrusUploaded: false,
          embeddingDimensions: embeddingResult.embedding.length
        };

        // Upload encrypted message to Walrus
        try {
          console.log(`📤 Uploading encrypted message ${originalMessage.id} to Walrus...`);
          
          // Encrypt message using Seal operations (same pattern as main flow)
          const encryptedData = await sealService.encryptFile(originalMessage, policyObjectId);
          
          // Publish encrypted data to Walrus
          const walrusMetadata = await walrusService.publishFile(encryptedData);
          
          processedMessage.walrusUploaded = true;
          processedMessage.walrusBlobId = walrusMetadata.blobId;
          processedMessage.walrusUrl = walrusMetadata.walrusUrl;
          stats.successfulWalrusUploads++;
          
          console.log(`✅ Encrypted message ${originalMessage.id} uploaded to Walrus with blob ID: ${walrusMetadata.blobId}`);
        } catch (error) {
          console.error(`❌ Failed to upload encrypted message ${originalMessage.id} to Walrus: ${error.message}`);
          processedMessage.walrusUploaded = false;
          processedMessage.walrusUploadError = error.message;
          stats.failedWalrusUploads++;
        }

        if (storeVectors && processedMessage.walrusUploaded) {
          vectorsToStore.push({
            id: originalMessage.id,
            vector: embeddingResult.embedding,
            metadata: {
              message_id: originalMessage.id,
              from_id: originalMessage.from_id,
              date: originalMessage.date,
              walrus_blob_id: processedMessage.walrusBlobId,
              walrus_url: processedMessage.walrusUrl,
              out: originalMessage.out,
              reactions: originalMessage.reactions,
              processed_at: new Date().toISOString()
            }
          });
        }

        results.push(processedMessage);
      } else {
        stats.failedEmbeddings++;
        results.push({
          ...originalMessage,
          embedding: null,
          vectorStored: false,
          walrusUploaded: false,
          processingError: embeddingResult.error || 'Unknown embedding error'
        });
      }
    }

    // Store vectors if any
    if (vectorsToStore.length > 0 && storeVectors) {
      try {
        console.log(`📊 Storing ${vectorsToStore.length} vectors in vector database...`);
        const storeResults = await vectorDbService.storeBatch(vectorsToStore);
        
        for (let k = 0; k < storeResults.length; k++) {
          const storeResult = storeResults[k];
          const messageIndex = results.findIndex(msg => msg.id.toString() === storeResult.id);
          
          if (messageIndex !== -1) {
            if (storeResult.success) {
              results[messageIndex].vectorStored = true;
              stats.storedVectors++;
            } else {
              results[messageIndex].vectorStored = false;
              results[messageIndex].vectorStorageError = storeResult.error || 'Unknown storage error';
              stats.failedVectorStorage++;
            }
          }
        }
      } catch (error) {
        console.error(`❌ Failed to store vectors: ${error.message}`);
        stats.failedVectorStorage += vectorsToStore.length;
      }
    }

    // Small delay between batches
    if (i + batchSize < messages.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`✅ Direct message processing completed. Stats:`, stats);
  return { messages: results, stats };
}

// --- Main Task Runner ---
async function runTasks() {
  try {
    console.log("🚀 Starting task execution...");
    
    // Initialize all services
    await initializeServices();
    
    // Step 1: Fetch encrypted file from Walrus
    console.log("📥 Step 1: Fetching encrypted file...");
    const encryptedFile = await services.blockchain.walrus.fetchEncryptedFile(blobId);
    
    // Step 2: Parse encrypted object
    console.log("📦 Step 2: Parsing encrypted object...");
    const encryptedObject = services.blockchain.seal.parseEncryptedObject(encryptedFile);
    
    // Step 3: Register attestation
    console.log("🔗 Step 3: Registering attestation...");
    const attestationObjId = await services.blockchain.sui.registerAttestation(
      encryptedObject.id, 
      enclaveId, 
      address
    );
    
    // Step 4: Decrypt file
    console.log("🔓 Step 4: Decrypting file...");
    const decryptedFile = await services.blockchain.seal.decryptFile(
      encryptedObject.id,
      attestationObjId,
      encryptedFile,
      address,
      onChainFileObjId,
      policyObjectId,
      threshold,
      services.blockchain.sui
    );
    
    // Step 5: Refine data
    console.log("📝 Step 5: Refining data...");
    const refinedData = await services.refinement.refineData(decryptedFile);
    
    // Step 6: Process messages (embedding + vector storage)
    console.log("🔤 Step 6: Processing messages with embeddings...");
    const processedData = await processMessagesDirectly(
      refinedData.messages, 
      services.embedding, 
      services.vectorDb,
      services.blockchain.walrus,
      services.blockchain.seal,
      policyObjectId
    );
    
    // Step 7: Encrypt refined data
    console.log("🔒 Step 7: Encrypting processed data...");
    const finalData = {
      ...refinedData,
      messages: processedData.messages,
      processingStats: processedData.stats
    };
    const encryptedRefinedData = await services.blockchain.seal.encryptFile(finalData, policyObjectId);
    
    // Step 8: Publish to Walrus
    console.log("📤 Step 8: Publishing to Walrus...");
    const metadata = await services.blockchain.walrus.publishFile(encryptedRefinedData);
    
    // Step 9: Save on-chain
    console.log("💾 Step 9: Saving on-chain...");
    const onChainFileObjId = await services.blockchain.sui.saveEncryptedFileOnChain(
      encryptedRefinedData,
      metadata,
      policyObjectId
    );
    
    // Output results
    const result = {
      walrusUrl: metadata.walrusUrl,
      attestationObjId,
      onChainFileObjId,
      blobId: metadata.blobId,
      refinementStats: refinedData.refinementStats,
      processingStats: processedData.stats,
      metadata
    };
    
    console.log("✅ Task completed successfully!");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("💥 Task failed:", error.stack || error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT, shutting down gracefully...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Run the tasks
runTasks();