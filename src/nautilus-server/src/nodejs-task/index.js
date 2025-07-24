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
  "QDRANT_API_KEY"
];

console.log("🔧 Validating environment variables passed from Rust app...");
const missingVars = [];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    missingVars.push(key);
    console.error(`❌ Missing required environment variable: ${key}`);
  } else {
    console.log(`✅ ${key}: ${key.includes('SECRET') || key.includes('API_KEY') ? '***hidden***' : process.env[key]}`);
  }
}

if (missingVars.length > 0) {
  console.error(`💥 Missing ${missingVars.length} required environment variable(s).`);
  console.error("These should be passed from Rust app via AppState.");
  process.exit(1);
}

console.log("✅ All required environment variables are available from Rust app");

// Parse CLI arguments for different operations
const args = process.argv.slice(2);

// Check for operation type
const operationIndex = args.indexOf('--operation');
const operation = operationIndex !== -1 ? args[operationIndex + 1] : 'default';

console.log(`🎯 Operation: ${operation}`);

let parsedArgs = {};

if (operation === 'embedding') {
  // Embedding operation: --operation embedding --walrus-blob-id <blobId> --address <address> --on-chain-file-obj-id <objId> --policy-object-id <policyId> --threshold <threshold> [--batch-size N] <enclaveId>
  const walrusBlobIdIndex = args.indexOf('--walrus-blob-id');
  const addressIndex = args.indexOf('--address');
  const onChainFileObjIdIndex = args.indexOf('--on-chain-file-obj-id');
  const policyObjectIdIndex = args.indexOf('--policy-object-id');
  const thresholdIndex = args.indexOf('--threshold');
  
  if (walrusBlobIdIndex === -1 || addressIndex === -1 || onChainFileObjIdIndex === -1 || 
      policyObjectIdIndex === -1 || thresholdIndex === -1 || args.length < 12) {
    console.error("Usage for embedding: node index.js --operation embedding --walrus-blob-id <blobId> --address <address> --on-chain-file-obj-id <objId> --policy-object-id <policyId> --threshold <threshold> [--batch-size N] <enclaveId>");
    process.exit(1);
  }

  // Parse optional batch size
  const batchSizeIndex = args.indexOf('--batch-size');
  
  const processingConfig = {};
  if (batchSizeIndex !== -1 && args[batchSizeIndex + 1]) {
    processingConfig.batchSize = args[batchSizeIndex + 1];
  }
  
  // Embedding operation always stores vectors and includes embeddings
  processingConfig.storeVectors = 'true';
  processingConfig.includeEmbeddings = 'false'; // We don't need to include raw embeddings in response
  
  parsedArgs = {
    operation: 'embedding',
    walrusBlobId: args[walrusBlobIdIndex + 1],
    address: args[addressIndex + 1],
    onChainFileObjId: args[onChainFileObjIdIndex + 1],
    policyObjectId: args[policyObjectIdIndex + 1],
    threshold: args[thresholdIndex + 1],
    enclaveId: args[args.length - 1], // Last argument is enclaveId
    processingConfig,
  };
  
  console.log("📋 Embedding Operation Arguments:");
  console.log(`  Walrus Blob ID: ${parsedArgs.walrusBlobId}`);
  console.log(`  Address: ${parsedArgs.address}`);
  console.log(`  OnChainFileObjId: ${parsedArgs.onChainFileObjId}`);
  console.log(`  PolicyObjectId: ${parsedArgs.policyObjectId}`);
  console.log(`  Threshold: ${parsedArgs.threshold}`);
  console.log(`  Enclave ID: ${parsedArgs.enclaveId}`);
  if (Object.keys(processingConfig).length > 0) {
    console.log(`  Processing Config:`, processingConfig);
  }
  
} else if (operation === 'retrieve') {
  // Retrieve operation: --operation retrieve --query <query> --address <address> --on-chain-file-obj-id <objId> --policy-object-id <policyId> --threshold <threshold> [--limit N] <enclaveId>
  const queryIndex = args.indexOf('--query');
  const addressIndex = args.indexOf('--address');
  const onChainFileObjIdIndex = args.indexOf('--on-chain-file-obj-id');
  const policyObjectIdIndex = args.indexOf('--policy-object-id');
  const thresholdIndex = args.indexOf('--threshold');
  
  if (queryIndex === -1 || addressIndex === -1 || onChainFileObjIdIndex === -1 || 
      policyObjectIdIndex === -1 || thresholdIndex === -1 || args.length < 12) {
    console.error("Usage for retrieve: node index.js --operation retrieve --query <query> --address <address> --on-chain-file-obj-id <objId> --policy-object-id <policyId> --threshold <threshold> [--limit N] <enclaveId>");
    process.exit(1);
  }

  // Parse optional limit
  const limitIndex = args.indexOf('--limit');
  
  const processingConfig = {};
  if (limitIndex !== -1 && args[limitIndex + 1]) {
    processingConfig.limit = parseInt(args[limitIndex + 1]);
  } else {
    processingConfig.limit = 10; // default limit
  }
  
  parsedArgs = {
    operation: 'retrieve',
    query: args[queryIndex + 1],
    address: args[addressIndex + 1],
    onChainFileObjId: args[onChainFileObjIdIndex + 1],
    policyObjectId: args[policyObjectIdIndex + 1],
    threshold: args[thresholdIndex + 1],
    enclaveId: args[args.length - 1], // Last argument is enclaveId
    processingConfig,
  };
  
  console.log("📋 Retrieve Operation Arguments:");
  console.log(`  Query: ${parsedArgs.query}`);
  console.log(`  Address: ${parsedArgs.address}`);
  console.log(`  OnChainFileObjId: ${parsedArgs.onChainFileObjId}`);
  console.log(`  PolicyObjectId: ${parsedArgs.policyObjectId}`);
  console.log(`  Threshold: ${parsedArgs.threshold}`);
  console.log(`  Enclave ID: ${parsedArgs.enclaveId}`);
  console.log(`  Limit: ${processingConfig.limit}`);
  
} else if (operation === 'retrieve-by-blob-ids') {
  // Retrieve by blob IDs operation: --operation retrieve-by-blob-ids --blob-file-pairs <jsonString> --address <address> --threshold <threshold> <enclaveId>
  const blobFilePairsIndex = args.indexOf('--blob-file-pairs');
  const addressIndex = args.indexOf('--address');
  const thresholdIndex = args.indexOf('--threshold');
  
  if (blobFilePairsIndex === -1 || addressIndex === -1 || 
      thresholdIndex === -1 || args.length < 8) {
    console.error("Usage for retrieve-by-blob-ids: node index.js --operation retrieve-by-blob-ids --blob-file-pairs <jsonString> --address <address> --threshold <threshold> <enclaveId>");
    process.exit(1);
  }

  const blobFilePairsStr = args[blobFilePairsIndex + 1];
  let blobFilePairs;
  
  try {
    blobFilePairs = JSON.parse(blobFilePairsStr);
  } catch (error) {
    console.error("❌ Failed to parse blob file pairs JSON:", error.message);
    process.exit(1);
  }
  
  if (!Array.isArray(blobFilePairs) || blobFilePairs.length === 0) {
    console.error("❌ No valid blob file pairs provided");
    process.exit(1);
  }
  
  // Validate blob file pairs structure
  for (let i = 0; i < blobFilePairs.length; i++) {
    const pair = blobFilePairs[i];
    if (!pair.walrusBlobId || !pair.onChainFileObjId || !pair.policyObjectId) {
      console.error(`❌ Invalid blob file pair at index ${i}: missing walrusBlobId, onChainFileObjId, or policyObjectId`);
      process.exit(1);
    }
  }
  
  parsedArgs = {
    operation: 'retrieve-by-blob-ids',
    blobFilePairs: blobFilePairs,
    address: args[addressIndex + 1],
    threshold: args[thresholdIndex + 1],
    enclaveId: args[args.length - 1], // Last argument is enclaveId
    processingConfig: {},
  };
  
  console.log("📋 Retrieve by Blob IDs Operation Arguments:");
  console.log(`  Blob File Pairs: ${blobFilePairs.length} pairs`);
  blobFilePairs.forEach((pair, index) => {
    console.log(`    ${index + 1}. Blob ID: ${pair.walrusBlobId}, File ID: ${pair.onChainFileObjId}, Policy ID: ${pair.policyObjectId}`);
  });
  console.log(`  Address: ${parsedArgs.address}`);
  console.log(`  Threshold: ${parsedArgs.threshold}`);
  console.log(`  Enclave ID: ${parsedArgs.enclaveId}`);
  
} else {
  // Default operation (refinement): <address> <blobId> <onChainFileObjId> <policyObjectId> <threshold> <enclaveId>
  if (args.length < 6) {
    console.error("Usage: node index.js <address> <blobId> <onChainFileObjId> <policyObjectId> <threshold> <enclaveId>");
    process.exit(1);
  }
  
  const [address, blobId, onChainFileObjId, policyObjectId, threshold, enclaveId] = args.slice(0, 6);

  // Default operation doesn't need processing config
  const processingConfig = {};
  
  parsedArgs = {
    operation: 'default',
    address,
    blobId,
    onChainFileObjId,
    policyObjectId,
    threshold,
    enclaveId,
    processingConfig,
  };
  
  console.log("📋 Default Operation Arguments:");
  console.log(`  Address: ${address}`);
  console.log(`  BlobId: ${blobId}`);
  console.log(`  OnChainFileObjId: ${onChainFileObjId}`);
  console.log(`  PolicyObjectId: ${policyObjectId}`);
  console.log(`  Threshold: ${threshold}`);
  console.log(`  EnclaveId: ${enclaveId}`);
}


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

// --- Main Task Runner ---
async function runTasks() {
  try {
    console.log("🚀 Starting task execution...");
    
    // Initialize all services
    await initializeServices();
    
    if (parsedArgs.operation === 'embedding') {
      await runEmbeddingOperation();
    } else if (parsedArgs.operation === 'retrieve') {
      await runRetrieveOperation();
    } else if (parsedArgs.operation === 'retrieve-by-blob-ids') {
      await runRetrieveByBlobIdsOperation();
    } else {
      await runDefaultOperation();
    }
    
  } catch (error) {
    console.error("💥 Task failed:", error.stack || error.message);
    process.exit(1);
  }
}

async function runEmbeddingOperation() {
  console.log("🔤 Running Embedding Operation...");
  
  // Step 1: Fetch encrypted refined data from Walrus
  console.log("📥 Step 1: Fetching encrypted refined data from Walrus...");
  const refinedDataEncrypted = await services.blockchain.walrus.fetchEncryptedFile(parsedArgs.walrusBlobId);
  
  // Step 2: Parse encrypted object
  console.log("📦 Step 2: Parsing encrypted refined data...");
  const encryptedObject = services.blockchain.seal.parseEncryptedObject(refinedDataEncrypted);
  
  // Step 3: Register attestation for decryption
  console.log("🔗 Step 3: Registering attestation...");
  const attestationObjId = await services.blockchain.sui.registerAttestation(
    encryptedObject.id, 
    parsedArgs.enclaveId, 
    parsedArgs.address
  );
  
  // Step 4: Decrypt refined data
  console.log("🔓 Step 4: Decrypting refined data...");
  const decryptedData = await services.blockchain.seal.decryptFile(
    encryptedObject.id,
    attestationObjId,
    refinedDataEncrypted,
    parsedArgs.address,
    parsedArgs.onChainFileObjId,
    parsedArgs.policyObjectId,
    parsedArgs.threshold,
    services.blockchain.sui
  );
  
  // Step 5: Process messages individually with embeddings
  console.log("🔤 Step 5: Processing messages individually with embeddings...");
  const result = await processMessagesByMessage(decryptedData.messages, services, parsedArgs);
  
  if (result.status === "failed") {
    console.error("❌ Embedding operation failed!");
    process.exit(1); // Exit with error code to indicate failure
  } else {
    console.log("✅ Embedding operation completed successfully!");
    console.log("===TASK_RESULT_START===");
    console.log(JSON.stringify(result));
    console.log("===TASK_RESULT_END===");
    process.exit(0);
  }
}

async function processMessagesByMessage(messages, services, args) {
  if (!Array.isArray(messages) || messages.length === 0) {
    console.log('⚠️  No messages to process');
    return {
      status: "success",
      operation: "embedding",
      processedCount: 0,
      successfulEmbeddings: 0,
      successfulWalrusUploads: 0,
      successfulVectorStorages: 0,
      errors: []
    };
  }

  const batchSize = parseInt(args.processingConfig.batchSize || '50');
  const stats = {
    totalMessages: messages.length,
    successfulEmbeddings: 0,
    failedEmbeddings: 0,
    successfulWalrusUploads: 0,
    failedWalrusUploads: 0,
    successfulVectorStorages: 0,
    failedVectorStorages: 0,
    errors: []
  };

  // Connect to vector database
  if (!services.vectorDb.isConnected()) {
    await services.vectorDb.connect();
  }

  console.log(`📊 Processing ${messages.length} messages individually...`);

  // Filter messages that have text content
  const validMessages = messages.filter(msg => 
    msg.message && typeof msg.message === 'string' && msg.message.trim().length > 0
  );

  console.log(`📝 Found ${validMessages.length} messages with text content`);

  // Process messages in batches for embedding generation
  for (let i = 0; i < validMessages.length; i += batchSize) {
    const batch = validMessages.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(validMessages.length / batchSize);
    
    console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} messages)`);
    
    // Generate embeddings for this batch
    const embeddingResults = await services.embedding.embedBatch(
      batch.map(msg => {
        // Format message content as: Date: datetime, From User Id: 233, Message: ...., Conversation Id: 333, Owner User Id: ...
        const datetime = msg.date || "";
        const fromUserId = msg.from_id || '';
        const message = msg.message || '';
        const conversationId = msg.chat_id || '';
        const ownerUserId = msg.user_id || '';
        
        return `Date: ${datetime}, From User Id: ${fromUserId}, Message: ${message}, Conversation Id: ${conversationId}, Owner User Id: ${ownerUserId}`;
      })
    );

    // Check if any embeddings failed - FAIL FAST approach
    for (let j = 0; j < embeddingResults.length; j++) {
      const embeddingResult = embeddingResults[j];
      const message = batch[j];
      
      if (!embeddingResult.success) {
        const error = `Failed to generate embedding for message ${message.id}: ${embeddingResult.error || 'Unknown error'}`;
        console.error(`💥 EMBEDDING FAILURE - STOPPING PROCESSING: ${error}`);
        
        const failureResult = {
          status: "failed",
          operation: "embedding",
          processedCount: 0,
          failureReason: "embedding_generation_failed",
          failedMessage: message.id,
          error: error,
          totalMessages: validMessages.length,
          processedSoFar: stats.successfulEmbeddings
        };
        
        console.log("===TASK_RESULT_START===");
        console.log(JSON.stringify(failureResult));
        console.log("===TASK_RESULT_END===");
        
        return failureResult;
      }
    }

    // All embeddings successful - process each message
    for (let j = 0; j < batch.length; j++) {
      const message = batch[j];
      const embeddingResult = embeddingResults[j];
      
      try {
        stats.successfulEmbeddings++;
        
        console.log(`🔤 Processing message ${message.id}: embedding successful, processing...`);
        
        // Step 1: Encrypt individual message
        console.log(`🔒 Encrypting message ${message.id}...`);
        const encryptedMessage = await services.blockchain.seal.encryptFile(message, args.policyObjectId);
        
        // Step 2: Upload encrypted message to Walrus
        console.log(`📤 Uploading encrypted message ${message.id} to Walrus...`);
        const walrusMetadata = await services.blockchain.walrus.publishFile(encryptedMessage);
        stats.successfulWalrusUploads++;
        
        console.log(`✅ Message ${message.id} uploaded to Walrus with blob ID: ${walrusMetadata.blobId}`);
        
        // Step 3: Save encrypted message on-chain to get individual onChainFileObjId
        console.log(`💾 Saving encrypted message ${message.id} on-chain...`);
        const messageOnChainFileObjId = await services.blockchain.sui.saveEncryptedFileOnChain(
          encryptedMessage,
          walrusMetadata,
          args.policyObjectId
        );
        
        console.log(`✅ Message ${message.id} saved on-chain with ID: ${messageOnChainFileObjId}`);
        
        // Step 4: Store vector + blob ID + onChainFileId + policyObjectId in vector database
        console.log(`💾 Storing vector for message ${message.id} in vector database...`);
        const vectorData = {
          id: message.id,
          vector: embeddingResult.embedding,
          metadata: {
            message_id: message.id,
            user_id: message.user_id,
            chat_id: message.chat_id,
            from_id: message.from_id,
            walrus_blob_id: walrusMetadata.blobId,
            walrus_url: walrusMetadata.walrusUrl,
            on_chain_file_obj_id: messageOnChainFileObjId,
            policy_object_id: args.policyObjectId,
            request_address: args.address,
            embedding_dimensions: embeddingResult.embedding.length
          }
        };
        
        const storeResult = await services.vectorDb.storeBatch([vectorData]);
        if (storeResult[0] && storeResult[0].success) {
          stats.successfulVectorStorages++;
          console.log(`✅ Vector for message ${message.id} stored in vector database`);
        } else {
          // Vector storage failure should also fail the entire operation
          const error = `Failed to store vector for message ${message.id}: ${storeResult[0]?.error || 'Unknown error'}`;
          console.error(`💥 VECTOR STORAGE FAILURE - STOPPING PROCESSING: ${error}`);
          
          const failureResult = {
            status: "failed",
            operation: "embedding",
            processedCount: 0,
            failureReason: "vector_storage_failed",
            failedMessage: message.id,
            error: error,
            totalMessages: validMessages.length,
            processedSoFar: stats.successfulEmbeddings
          };
          
          console.log("===TASK_RESULT_START===");
          console.log(JSON.stringify(failureResult));
          console.log("===TASK_RESULT_END===");
          
          return failureResult;
        }
        
      } catch (error) {
        const errorMsg = `Error processing message ${message.id}: ${error.message}`;
        console.error(`💥 PROCESSING FAILURE - STOPPING PROCESSING: ${errorMsg}`);
        
        let failureReason = "processing_error";
        if (error.message.includes('Walrus')) {
          failureReason = "walrus_upload_failed";
        } else if (error.message.includes('encrypt')) {
          failureReason = "encryption_failed";
        }
        
        const failureResult = {
          status: "failed",
          operation: "embedding",
          processedCount: 0,
          failureReason: failureReason,
          failedMessage: message.id,
          error: errorMsg,
          totalMessages: validMessages.length,
          processedSoFar: stats.successfulEmbeddings
        };
        
        console.log("===TASK_RESULT_START===");
        console.log(JSON.stringify(failureResult));
        console.log("===TASK_RESULT_END===");
        
        return failureResult;
      }
    }

    // Small delay between batches
    if (i + batchSize < validMessages.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // If we reach here, all messages were processed successfully
  const result = {
    status: "success",
    operation: "embedding",
    processedCount: validMessages.length,
    totalMessages: validMessages.length,
    successfulEmbeddings: stats.successfulEmbeddings,
    successfulWalrusUploads: stats.successfulWalrusUploads,
    successfulVectorStorages: stats.successfulVectorStorages,
    message: "All messages processed successfully"
  };

  console.log(`✅ All ${validMessages.length} messages processed successfully!`);
  console.log(`📊 Final Stats: ${stats.successfulEmbeddings} embeddings, ${stats.successfulWalrusUploads} uploads, ${stats.successfulVectorStorages} vectors stored`);
  
  // Output the final result with delimiter for parsing
  console.log("===TASK_RESULT_START===");
  console.log(JSON.stringify(result));
  console.log("===TASK_RESULT_END===");
  
  return result;
}

async function runRetrieveOperation() {
  console.log("🔍 Running Message Retrieval Operation...");
  
  try {
    // Step 1: Connect to vector database
    console.log("📦 Step 1: Connecting to vector database...");
    if (!services.vectorDb.isConnected()) {
      await services.vectorDb.connect();
    }
    
    // Step 2: Generate embedding for the query
    console.log("🔤 Step 2: Generating embedding for query...");
    const queryEmbeddingResult = await services.embedding.embed(parsedArgs.query);
    
    if (!queryEmbeddingResult.success) {
      console.error(`❌ Failed to generate embedding for query: ${queryEmbeddingResult.error}`);
      process.exit(1);
    }
    
    console.log(`✅ Query embedding generated (${queryEmbeddingResult.embedding.length} dimensions)`);
    
    // Step 3: Search for similar vectors in the database
    console.log("🔍 Step 3: Searching for similar messages...");
    const searchResults = await services.vectorDb.search(
      queryEmbeddingResult.embedding,
      parsedArgs.processingConfig.limit
    );
    
    console.log(`🔍 Found ${searchResults.length} similar messages`);
    
    if (searchResults.length === 0) {
      const result = {
        status: "success",
        operation: "retrieve",
        query: parsedArgs.query,
        results: [],
        count: 0,
        message: "No similar messages found"
      };
      
      console.log("✅ Message retrieval completed!");
      console.log("===TASK_RESULT_START===");
      console.log(JSON.stringify(result));
      console.log("===TASK_RESULT_END===");
      process.exit(0);
    }
    
    // Step 4: Decrypt each message
    console.log("🔓 Step 4: Decrypting messages...");
    const decryptedMessages = [];
    
    for (let i = 0; i < searchResults.length; i++) {
      const searchResult = searchResults[i];
      console.log(`🔓 Decrypting message ${i + 1}/${searchResults.length} (ID: ${searchResult.metadata.message_id}, Score: ${searchResult.score.toFixed(4)})`);
      
      try {
        // Fetch encrypted message from Walrus
        const encryptedMessage = await services.blockchain.walrus.fetchEncryptedFile(searchResult.metadata.walrus_blob_id);
        
        // Parse encrypted object
        const encryptedObject = services.blockchain.seal.parseEncryptedObject(encryptedMessage);
        
        // Register attestation for decryption
        const attestationObjId = await services.blockchain.sui.registerAttestation(
          encryptedObject.id, 
          parsedArgs.enclaveId, 
          parsedArgs.address
        );
        
        // Decrypt message
        const decryptedMessage = await services.blockchain.seal.decryptFile(
          encryptedObject.id,
          attestationObjId,
          encryptedMessage,
          parsedArgs.address,
          parsedArgs.onChainFileObjId,
          parsedArgs.policyObjectId,
          parsedArgs.threshold,
          services.blockchain.sui
        );
        
        decryptedMessages.push({
          id: searchResult.metadata.message_id,
          score: searchResult.score,
          message: decryptedMessage,
          metadata: {
            walrus_blob_id: searchResult.metadata.walrus_blob_id,
            walrus_url: searchResult.metadata.walrus_url,
            processed_at: searchResult.metadata.processed_at,
            embedding_dimensions: searchResult.metadata.embedding_dimensions
          }
        });
        
        console.log(`✅ Successfully decrypted message ${searchResult.metadata.message_id}`);
        
      } catch (error) {
        console.error(`❌ Failed to decrypt message ${searchResult.metadata.message_id}: ${error.message}`);
        
        // Add failed message with error info
        decryptedMessages.push({
          id: searchResult.metadata.message_id,
          score: searchResult.score,
          error: error.message,
          metadata: {
            walrus_blob_id: searchResult.metadata.walrus_blob_id,
            walrus_url: searchResult.metadata.walrus_url,
            processed_at: searchResult.metadata.processed_at,
            embedding_dimensions: searchResult.metadata.embedding_dimensions
          }
        });
      }
    }
    
    // Step 5: Return results
    const result = {
      status: "success",
      operation: "retrieve",
      query: parsedArgs.query,
      results: decryptedMessages,
      count: decryptedMessages.length,
      successfulDecryptions: decryptedMessages.filter(msg => !msg.error).length,
      failedDecryptions: decryptedMessages.filter(msg => msg.error).length
    };
    
    console.log("✅ Message retrieval completed!");
    console.log(`📊 Retrieved ${result.count} messages (${result.successfulDecryptions} successful, ${result.failedDecryptions} failed)`);
    console.log("===TASK_RESULT_START===");
    console.log(JSON.stringify(result));
    console.log("===TASK_RESULT_END===");
    process.exit(0);
    
  } catch (error) {
    console.error("💥 Retrieval operation failed:", error.message);
    
    const result = {
      status: "failed",
      operation: "retrieve",
      query: parsedArgs.query,
      error: error.message
    };
    
    console.log("===TASK_RESULT_START===");
    console.log(JSON.stringify(result));
    console.log("===TASK_RESULT_END===");
    process.exit(1);
  }
}

async function runRetrieveByBlobIdsOperation() {
  console.log("📦 Running Message Retrieval by Blob IDs Operation...");
  
  try {
    console.log(`📊 Processing ${parsedArgs.blobFilePairs.length} blob file pairs...`);
    
    const decryptedMessages = [];
    
    // Process each blob file pair
    for (let i = 0; i < parsedArgs.blobFilePairs.length; i++) {
      const pair = parsedArgs.blobFilePairs[i];
      const blobId = pair.walrusBlobId;
      const onChainFileObjId = pair.onChainFileObjId;
      const policyObjectId = pair.policyObjectId;
      
      console.log(`📦 Processing pair ${i + 1}/${parsedArgs.blobFilePairs.length}`);
      console.log(`   Blob ID: ${blobId}`);
      console.log(`   File ID: ${onChainFileObjId}`);
      console.log(`   Policy ID: ${policyObjectId}`);
      
      try {
        // Step 1: Fetch encrypted message from Walrus
        console.log(`📥 Fetching encrypted message from Walrus...`);
        const encryptedMessage = await services.blockchain.walrus.fetchEncryptedFile(blobId);
        
        // Step 2: Parse encrypted object
        console.log(`📦 Parsing encrypted object...`);
        const encryptedObject = services.blockchain.seal.parseEncryptedObject(encryptedMessage);
        
        // Step 3: Register attestation for decryption
        console.log(`🔗 Registering attestation...`);
        const attestationObjId = await services.blockchain.sui.registerAttestation(
          encryptedObject.id, 
          parsedArgs.enclaveId, 
          parsedArgs.address
        );
        
        // Step 4: Decrypt message using the specific on-chain file ID and policy ID for this pair
        console.log(`🔓 Decrypting message...`);
        const decryptedMessage = await services.blockchain.seal.decryptFile(
          encryptedObject.id,
          attestationObjId,
          encryptedMessage,
          parsedArgs.address,
          onChainFileObjId, // Use the specific on-chain file ID for this pair
          policyObjectId, // Use the specific policy ID for this pair
          parsedArgs.threshold,
          services.blockchain.sui
        );
        
        decryptedMessages.push({
          walrus_blob_id: blobId,
          on_chain_file_obj_id: onChainFileObjId,
          policy_object_id: policyObjectId,
          status: 'success',
          message: decryptedMessage,
          encrypted_object_id: encryptedObject.id,
          attestation_obj_id: attestationObjId
        });
        
        console.log(`✅ Successfully decrypted message from blob ${blobId}`);
        
      } catch (error) {
        console.error(`❌ Failed to decrypt message from blob ${blobId}: ${error.message}`);
        
        // Add failed message with error info
        decryptedMessages.push({
          walrus_blob_id: blobId,
          on_chain_file_obj_id: onChainFileObjId,
          policy_object_id: policyObjectId,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Return results
    const result = {
      status: "success",
      operation: "retrieve-by-blob-ids",
      requested_pairs: parsedArgs.blobFilePairs.map(pair => ({
        walrus_blob_id: pair.walrusBlobId,
        on_chain_file_obj_id: pair.onChainFileObjId,
        policy_object_id: pair.policyObjectId
      })),
      results: decryptedMessages,
      total_requested: parsedArgs.blobFilePairs.length,
      successful_decryptions: decryptedMessages.filter(msg => msg.status === 'success').length,
      failed_decryptions: decryptedMessages.filter(msg => msg.status === 'failed').length
    };
    
    console.log("✅ Blob ID retrieval completed!");
    console.log(`📊 Processed ${result.total_requested} pairs (${result.successful_decryptions} successful, ${result.failed_decryptions} failed)`);
    console.log("===TASK_RESULT_START===");
    console.log(JSON.stringify(result));
    console.log("===TASK_RESULT_END===");
    process.exit(0);
    
  } catch (error) {
    console.error("💥 Blob ID retrieval operation failed:", error.message);
    
    const result = {
      status: "failed",
      operation: "retrieve-by-blob-ids",
      requested_pairs: parsedArgs.blobFilePairs.map(pair => ({
        walrus_blob_id: pair.walrusBlobId,
        on_chain_file_obj_id: pair.onChainFileObjId,
        policy_object_id: pair.policyObjectId
      })),
      error: error.message
    };
    
    console.log("===TASK_RESULT_START===");
    console.log(JSON.stringify(result));
    console.log("===TASK_RESULT_END===");
    process.exit(1);
  }
}

async function runDefaultOperation() {
  console.log("📝 Running Default (Refinement) Operation...");
  
  // Step 1: Fetch encrypted file from Walrus
  console.log("📥 Step 1: Fetching encrypted file...");
  const encryptedFile = await services.blockchain.walrus.fetchEncryptedFile(parsedArgs.blobId);
  
  // Step 2: Parse encrypted object
  console.log("📦 Step 2: Parsing encrypted object...");
  const encryptedObject = services.blockchain.seal.parseEncryptedObject(encryptedFile);
  
  // Step 3: Register attestation
  console.log("🔗 Step 3: Registering attestation...");
  const attestationObjId = await services.blockchain.sui.registerAttestation(
    encryptedObject.id, 
    parsedArgs.enclaveId, 
    parsedArgs.address
  );
  
  // Step 4: Decrypt file
  console.log("🔓 Step 4: Decrypting file...");
  const decryptedFile = await services.blockchain.seal.decryptFile(
    encryptedObject.id,
    attestationObjId,
    encryptedFile,
    parsedArgs.address,
    parsedArgs.onChainFileObjId,
    parsedArgs.policyObjectId,
    parsedArgs.threshold,
    services.blockchain.sui
  );
  
  // Step 5: Refine data
  console.log("📝 Step 5: Refining data...");
  const refinedData = await services.refinement.refineData(decryptedFile);
  
  // Step 6: Encrypt refined data (embedding is now handled separately)
  console.log("🔒 Step 6: Encrypting refined data...");
  const encryptedRefinedData = await services.blockchain.seal.encryptFile(refinedData, parsedArgs.policyObjectId);
  
  // Step 7: Publish to Walrus
  console.log("📤 Step 7: Publishing to Walrus...");
  const metadata = await services.blockchain.walrus.publishFile(encryptedRefinedData);
  
  // Step 8: Save on-chain
  console.log("💾 Step 8: Saving on-chain...");
  const onChainFileObjId = await services.blockchain.sui.saveEncryptedFileOnChain(
    encryptedRefinedData,
    metadata,
    parsedArgs.policyObjectId
  );
  
  // Output results
  const result = {
    walrusUrl: metadata.walrusUrl,
    attestationObjId,
    onChainFileObjId,
    blobId: metadata.blobId,
    refinementStats: refinedData.refinementStats,
    metadata
  };
  
  console.log("✅ Task completed successfully!");
  console.log("===TASK_RESULT_START===");
  console.log(JSON.stringify(result));
  console.log("===TASK_RESULT_END===");
  process.exit(0);
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