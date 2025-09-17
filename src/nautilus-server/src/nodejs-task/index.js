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
  "RUBY_NODES_API_KEY",
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
  // Embedding operation: --operation embedding --walrus-blob-id <blobId> --on-chain-file-obj-id <objId> --policy-object-id <policyId> --threshold <threshold> [--batch-size N] <enclaveId>
  const walrusBlobIdIndex = args.indexOf('--walrus-blob-id');
  const onChainFileObjIdIndex = args.indexOf('--on-chain-file-obj-id');
  const policyObjectIdIndex = args.indexOf('--policy-object-id');
  const thresholdIndex = args.indexOf('--threshold');
  
  if (walrusBlobIdIndex === -1 || onChainFileObjIdIndex === -1 || 
      policyObjectIdIndex === -1 || thresholdIndex === -1 || args.length < 11) {
    console.error("Usage for embedding: node index.js --operation embedding --walrus-blob-id <blobId> --on-chain-file-obj-id <objId> --policy-object-id <policyId> --threshold <threshold> [--batch-size N] <enclaveId>");
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
    onChainFileObjId: args[onChainFileObjIdIndex + 1],
    policyObjectId: args[policyObjectIdIndex + 1],
    threshold: args[thresholdIndex + 1],
    enclaveId: args[args.length - 1], // Last argument is enclaveId
    processingConfig,
  };
  
  console.log("📋 Embedding Operation Arguments:");
  console.log(`  Walrus Blob ID: ${parsedArgs.walrusBlobId}`);
  console.log(`  OnChainFileObjId: ${parsedArgs.onChainFileObjId}`);
  console.log(`  PolicyObjectId: ${parsedArgs.policyObjectId}`);
  console.log(`  Threshold: ${parsedArgs.threshold}`);
  console.log(`  Enclave ID: ${parsedArgs.enclaveId}`);
  if (Object.keys(processingConfig).length > 0) {
    console.log(`  Processing Config:`, processingConfig);
  }
  
} else if (operation === 'retrieve-by-blob-ids') {
  // Retrieve by blob IDs operation: --operation retrieve-by-blob-ids --blob-file-pairs <jsonString> --threshold <threshold> <enclaveId>
  const blobFilePairsIndex = args.indexOf('--blob-file-pairs');
  const thresholdIndex = args.indexOf('--threshold');
  
  if (blobFilePairsIndex === -1 || 
      thresholdIndex === -1 || args.length < 7) {
    console.error("Usage for retrieve-by-blob-ids: node index.js --operation retrieve-by-blob-ids --blob-file-pairs <jsonString> --threshold <threshold> <enclaveId>");
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
    // Validate message indices if provided
    if (pair.messageIndices && !Array.isArray(pair.messageIndices)) {
      console.error(`❌ Invalid blob file pair at index ${i}: messageIndices must be an array`);
      process.exit(1);
    }
  }
  
  parsedArgs = {
    operation: 'retrieve-by-blob-ids',
    blobFilePairs: blobFilePairs,
    threshold: args[thresholdIndex + 1],
    enclaveId: args[args.length - 1], // Last argument is enclaveId
    processingConfig: {},
  };
  
  console.log("📋 Retrieve by Blob IDs Operation Arguments:");
  console.log(`  Blob File Pairs: ${blobFilePairs.length} pairs`);
  blobFilePairs.forEach((pair, index) => {
    const indicesInfo = pair.messageIndices ? ` (indices: ${pair.messageIndices.join(',')})` : ' (all messages)';
    console.log(`    ${index + 1}. Blob ID: ${pair.walrusBlobId}, File ID: ${pair.onChainFileObjId}, Policy ID: ${pair.policyObjectId}${indicesInfo}`);
  });
  console.log(`  Threshold: ${parsedArgs.threshold}`);
  console.log(`  Enclave ID: ${parsedArgs.enclaveId}`);
  
} else {
  // Default operation (refinement): <blobId> <onChainFileObjId> <policyObjectId> <threshold> <enclaveId>
  if (args.length < 5) {
    console.error("Usage: node index.js <blobId> <onChainFileObjId> <policyObjectId> <threshold> <enclaveId>");
    process.exit(1);
  }
  
  const [blobId, onChainFileObjId, policyObjectId, threshold, enclaveId] = args.slice(0, 5);

  // Default operation doesn't need processing config
  const processingConfig = {};
  
  parsedArgs = {
    operation: 'default',
    blobId,
    onChainFileObjId,
    policyObjectId,
    threshold,
    enclaveId,
    processingConfig,
  };
  
  console.log("📋 Default Operation Arguments:");   
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
        batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '64')
      }),
      vectorDb: ServiceFactory.createVectorDbService('qdrant', {
        batchSize: parseInt(process.env.VECTOR_BATCH_SIZE || '500')
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
  const encryptedObject = await services.blockchain.seal.parseEncryptedObject(refinedDataEncrypted);
  
  // Step 3: Register attestation for decryption
  // console.log("🔗 Step 3: Registering attestation...");
  // const attestationObjId = await services.blockchain.sui.registerAttestation(
  //   encryptedObject.id, 
  //   parsedArgs.enclaveId, 
  // );
  
  // Step 4: Decrypt refined data
  console.log("🔓 Step 4: Decrypting refined data...");
  const decryptedData = await services.blockchain.seal.decryptFile(
    encryptedObject.id,
    // attestationObjId,
    refinedDataEncrypted,
    // parsedArgs.onChainFileObjId,
    parsedArgs.policyObjectId,
    // parsedArgs.threshold,
    services.blockchain.sui
  );

  const embeddingArgs = {
    ...parsedArgs,
    original_blob_id: parsedArgs.walrusBlobId, // Pass from main process
    on_chain_file_obj_id: parsedArgs.onChainFileObjId, // Pass from main process
    processingConfig: {
      batchSize: process.env.EMBEDDING_BATCH_SIZE || '64',
      storeVectors: 'true',
      includeEmbeddings: 'false'
    }
  };

  // Step 5: Process messages individually with embeddings
  console.log("🔤 Step 5: Processing messages individually with embeddings...");
  const result = await processMessagesByMessage(decryptedData, services, embeddingArgs);
  
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


async function processMessagesByMessage(rawData, services, args) {
  // Extract messages from raw data format with proper indexing
  const messages = [];
  const messageIndexMap = new Map(); // Map to track message position in raw structure
  
  if (rawData.chats && Array.isArray(rawData.chats)) {
    for (let chatIndex = 0; chatIndex < rawData.chats.length; chatIndex++) {
      const chat = rawData.chats[chatIndex];
      if (chat.contents && Array.isArray(chat.contents)) {
        for (let contentIndex = 0; contentIndex < chat.contents.length; contentIndex++) {
          const msg = chat.contents[contentIndex];
          const flatIndex = messages.length;
          messages.push({
            ...msg,
            chat_id: chat.chat_id,
            user_id: rawData.user
          });
          messageIndexMap.set(flatIndex, {
            chatIndex: chatIndex,
            contentIndex: contentIndex
          });
        }
      }
    }
  }

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

  const batchSize = parseInt(args.processingConfig.batchSize || '64');
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

  console.log(`📊 Processing ${messages.length} messages in batches of embeddings and vectors...`);

  // Filter messages that have text content
  const validMessages = messages.filter(msg => 
    msg.message && typeof msg.message === 'string' && msg.message.trim().length > 0
  );
  console.log(`📝 Found ${validMessages.length} messages with text content`);

  // Process messages in batches for embedding generation and vector storage
  for (let i = 0; i < validMessages.length; i += batchSize) {
    const batch = validMessages.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(validMessages.length / batchSize);

    console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} messages)`);

    // Generate embeddings for this batch
    const embeddingResults = await services.embedding.embedBatch(
      batch.map(msg => {
        const datetime = msg.date ? new Date(msg.date * 1000).toISOString() : "";
        const fromUserId = msg.fromId?.userId || '';
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
        return {
          status: "failed",
          operation: "embedding",
          processedCount: 0,
          failureReason: "embedding_generation_failed",
          failedMessage: message.id,
          error: error,
          totalMessages: validMessages.length,
          processedSoFar: stats.successfulEmbeddings
        };
      }
    }

    // All embeddings successful - collect vectors for batch
    const vectorBatch = [];
    for (let j = 0; j < batch.length; j++) {
      const message = batch[j];
      const embeddingResult = embeddingResults[j];
      stats.successfulEmbeddings++;

      const currentMessageIndex = i + j;
      const rawPosition = messageIndexMap.get(currentMessageIndex);

      const vectorData = {
        id: message.id,
        vector: embeddingResult.embedding,
        metadata: {
          message_id: message.id,
          message_index: currentMessageIndex, // Flat index
          chat_index: rawPosition?.chatIndex,
          content_index: rawPosition?.contentIndex,
          user_id: message.user_id,
          chat_id: message.chat_id,
          from_id: message.fromId?.userId || null,
          original_blob_id: args.originalBlobId,
          on_chain_file_obj_id: args.onChainFileObjId,
          policy_object_id: args.policyObjectId,
          embedding_dimensions: embeddingResult.embedding.length
        }
      };
      vectorBatch.push(vectorData);
    }

    // Store the whole batch at once in vector DB
    try {
      const storeResults = await services.vectorDb.storeBatch(vectorBatch);
      for (let r = 0; r < storeResults.length; r++) {
        if (storeResults[r] && storeResults[r].success) {
          stats.successfulVectorStorages++;
        } else {
          stats.failedVectorStorages++;
          stats.errors.push(storeResults[r]?.error || 'Unknown error');
          const failedMessage = batch[r].id;
          const error = `Failed to store vector for message ${failedMessage}: ${storeResults[r]?.error || 'Unknown error'}`;
          console.error(`💥 VECTOR STORAGE FAILURE - STOPPING PROCESSING: ${error}`);
          return {
            status: "failed",
            operation: "embedding",
            processedCount: stats.successfulEmbeddings,
            failureReason: "vector_storage_failed",
            failedMessage: failedMessage,
            error: error,
            totalMessages: validMessages.length,
            processedSoFar: stats.successfulEmbeddings
          };
        }
      }
    } catch (error) {
      const errorMsg = `Error storing batch vectors: ${error.message}`;
      console.error(`💥 BATCH VECTOR STORAGE FAILURE: ${errorMsg}`);
      return {
        status: "failed",
        operation: "embedding",
        processedCount: stats.successfulEmbeddings,
        failureReason: "batch_vector_storage_failed",
        error: errorMsg,
        totalMessages: validMessages.length,
        processedSoFar: stats.successfulEmbeddings
      };
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
  console.log(`📊 Final Stats: ${stats.successfulEmbeddings} embeddings, ${stats.successfulVectorStorages} vectors stored`);
  console.log("===TASK_RESULT_START===");
  console.log(JSON.stringify(result));
  console.log("===TASK_RESULT_END===");

  return result;
}



async function runRetrieveByBlobIdsOperation() {
  console.log("📦 Running Optimized Message Retrieval by Blob IDs with Message Indices...");
  
  try {
    console.log(`📊 Processing ${parsedArgs.blobFilePairs.length} blob file pairs...`);
    
    const retrievedMessages = [];
    
    // Group pairs by blob ID to optimize file downloads
    const fileGroups = {};
    for (const pair of parsedArgs.blobFilePairs) {
      const key = `${pair.walrusBlobId}-${pair.onChainFileObjId}-${pair.policyObjectId}`;
      if (!fileGroups[key]) {
        fileGroups[key] = {
          walrusBlobId: pair.walrusBlobId,
          onChainFileObjId: pair.onChainFileObjId,
          policyObjectId: pair.policyObjectId,
          messageIndices: new Set()
        };
      }
      
      // Collect all message indices for this file
      if (pair.messageIndices && Array.isArray(pair.messageIndices)) {
        pair.messageIndices.forEach(index => fileGroups[key].messageIndices.add(index));
      } else {
        // If no indices specified, mark as "all messages"
        fileGroups[key].messageIndices = null;
      }
    }
    
    console.log(`📦 Optimized to ${Object.keys(fileGroups).length} unique file downloads`);
    
    // Process each unique file group
    for (const [key, group] of Object.entries(fileGroups)) {
      const { walrusBlobId, onChainFileObjId, policyObjectId, messageIndices } = group;
      
      console.log(`📥 Processing file: ${walrusBlobId} (${onChainFileObjId})`);
      const indicesInfo = messageIndices ? `indices: ${Array.from(messageIndices).join(',')}` : 'all messages';
      console.log(`   Retrieving: ${indicesInfo}`);
      
      try {
        // Step 1: Fetch encrypted file from Walrus (once per unique file)
        console.log(`📥 Fetching encrypted file from Walrus...`);
        const encryptedFile = await services.blockchain.walrus.fetchEncryptedFile(walrusBlobId);
        
        // Step 2: Parse encrypted object
        console.log(`📦 Parsing encrypted object...`);
        const encryptedObject = await services.blockchain.seal.parseEncryptedObject(encryptedFile);
        
        // Step 3: Register attestation for decryption
        // console.log(`🔗 Registering attestation...`);
        // const attestationObjId = await services.blockchain.sui.registerAttestation(
        //   encryptedObject.id, 
        //   parsedArgs.enclaveId, 
        // );
        
        // Step 4: Decrypt file once
        console.log(`🔓 Decrypting refined file...`);
        const decryptedFile = await services.blockchain.seal.decryptFile(
          encryptedObject.id,
          // attestationObjId,
          encryptedFile,
          // onChainFileObjId,
          policyObjectId,
          // parsedArgs.threshold,
          services.blockchain.sui
        );
        
        // Step 5: Extract specific messages by indices from raw format
        // First, flatten the messages from raw format for indexing consistency
        const flatMessages = [];
        if (decryptedFile.chats && Array.isArray(decryptedFile.chats)) {
          for (const chat of decryptedFile.chats) {
            if (chat.contents && Array.isArray(chat.contents)) {
              for (const msg of chat.contents) {
                flatMessages.push({
                  ...msg,
                  chat_id: chat.chat_id,
                  user_id: decryptedFile.user
                });
              }
            }
          }
        }
        
        if (messageIndices === null) {
          // Return all messages
          if (flatMessages.length > 0) {
            flatMessages.forEach((message, index) => {
              retrievedMessages.push({
                walrus_blob_id: walrusBlobId,
                on_chain_file_obj_id: onChainFileObjId,
                policy_object_id: policyObjectId,
                message_index: index,
                status: 'success',
                message: message,
                encrypted_object_id: encryptedObject.id,
                // attestation_obj_id: attestationObjId
              });
            });
            console.log(`✅ Retrieved all ${flatMessages.length} messages from ${walrusBlobId}`);
          } else {
            retrievedMessages.push({
              walrus_blob_id: walrusBlobId,
              on_chain_file_obj_id: onChainFileObjId,
              policy_object_id: policyObjectId,
              status: 'failed',
              error: 'No messages found in decrypted file'
            });
          }
        } else {
          // Return specific messages by indices
          const requestedIndices = Array.from(messageIndices);
          for (const messageIndex of requestedIndices) {
            if (flatMessages[messageIndex]) {
              retrievedMessages.push({
                walrus_blob_id: walrusBlobId,
                on_chain_file_obj_id: onChainFileObjId,
                policy_object_id: policyObjectId,
                message_index: messageIndex,
                status: 'success',
                message: flatMessages[messageIndex],
                encrypted_object_id: encryptedObject.id,
                // attestation_obj_id: attestationObjId
              });
              console.log(`✅ Retrieved message at index ${messageIndex} from ${walrusBlobId}`);
            } else {
              retrievedMessages.push({
                walrus_blob_id: walrusBlobId,
                on_chain_file_obj_id: onChainFileObjId,
                policy_object_id: policyObjectId,
                message_index: messageIndex,
                status: 'failed',
                error: `Message not found at index ${messageIndex}`
              });
              console.log(`❌ Message not found at index ${messageIndex} in ${walrusBlobId}`);
            }
          }
        }
        
      } catch (error) {
        console.error(`❌ Failed to process file ${walrusBlobId}: ${error.message}`);
        
        // Add failed result for this entire file group
        const affectedIndices = messageIndices ? Array.from(messageIndices) : ['all'];
        for (const index of affectedIndices) {
          retrievedMessages.push({
            walrus_blob_id: walrusBlobId,
            on_chain_file_obj_id: onChainFileObjId,
            policy_object_id: policyObjectId,
            message_index: index === 'all' ? null : index,
            status: 'failed',
            error: error.message
          });
        }
      }
    }
    
    // Return optimized results
    const result = {
      status: "success",
      operation: "retrieve-by-blob-ids",
      requested_pairs: parsedArgs.blobFilePairs.map(pair => ({
        walrus_blob_id: pair.walrusBlobId,
        on_chain_file_obj_id: pair.onChainFileObjId,
        policy_object_id: pair.policyObjectId,
        message_indices: pair.messageIndices || null
      })),
      results: retrievedMessages,
      total_files_processed: Object.keys(fileGroups).length,
      total_messages_retrieved: retrievedMessages.length,
      successful_retrievals: retrievedMessages.filter(msg => msg.status === 'success').length,
      failed_retrievals: retrievedMessages.filter(msg => msg.status === 'failed').length
    };
    
    console.log("✅ Optimized blob ID retrieval completed!");
    console.log(`📊 Processed ${result.total_files_processed} unique files, retrieved ${result.total_messages_retrieved} messages (${result.successful_retrievals} successful, ${result.failed_retrievals} failed)`);
    console.log("===TASK_RESULT_START===");
    console.log(JSON.stringify(result));
    console.log("===TASK_RESULT_END===");
    process.exit(0);
    
  } catch (error) {
    console.error("💥 Optimized blob ID retrieval operation failed:", error.message);
    
    const result = {
      status: "failed",
      operation: "retrieve-by-blob-ids",
      requested_pairs: parsedArgs.blobFilePairs.map(pair => ({
        walrus_blob_id: pair.walrusBlobId,
        on_chain_file_obj_id: pair.onChainFileObjId,
        policy_object_id: pair.policyObjectId,
        message_indices: pair.messageIndices || null
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
  console.time('⌚ runDefaultOperation <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
  console.log("📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝 Running Default Operation...");
  
  // Step 1: Fetch encrypted file from Walrus
  console.log("📥 Step 1: Fetching encrypted file...");
  const encryptedFile = await services.blockchain.walrus.fetchEncryptedFile(parsedArgs.blobId);
  
  // Step 2: Parse encrypted object
  console.log("📦 Step 2: Parsing encrypted object...");
  const encryptedObject = await services.blockchain.seal.parseEncryptedObject(encryptedFile);
  
  // Step 3: Register attestation
  // console.log("🔗 Step 3: Registering attestation...");
  // const attestationObjId = await services.blockchain.sui.registerAttestation(
  //   encryptedObject.id, 
  //   parsedArgs.enclaveId, 
  // );
  
  // Step 4: Decrypt file
  console.log("🔓 Step 4: Decrypting file...");
  const decryptedFile = await services.blockchain.seal.decryptFile(
    encryptedObject.id, // seal id
    // attestationObjId,
    encryptedFile,
    // parsedArgs.onChainFileObjId,
    parsedArgs.policyObjectId,
    // parsedArgs.threshold,
    services.blockchain.sui
  );
  
  // Step 5: Process embeddings directly from decrypted data
  console.log("🔤 Step 5: Processing embeddings directly from decrypted data...");
  await processMessagesByMessage(
    decryptedFile,
    services,
    {
      ...parsedArgs,
      originalBlobId: parsedArgs.blobId,
      processingConfig: {
        batchSize: process.env.EMBEDDING_BATCH_SIZE || '64',
        storeVectors: 'true',
        includeEmbeddings: 'false'
      }
    }
);
  
  // Output results
  const result = {
    // attestationObjId,
    originalBlobId: parsedArgs.blobId,
  };
  
  console.log("✅ Task completed successfully!");
  console.log("===TASK_RESULT_START===");
  console.log(JSON.stringify(result));
  console.log("===TASK_RESULT_END===");
  console.timeEnd('⌚ runDefaultOperation <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
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