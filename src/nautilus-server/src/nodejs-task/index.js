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
const IdUnmasker = require("./utils/id-unmasker");
const logger = require("./utils/logger");
const SummaryReporter = require("./utils/summary-reporter");
const RateLimiter = require("./utils/rate-limiter");

// Enable quiet mode - only write summaries to console, detailed logs go to file
logger.setQuietMode(true);

// Rate limiting configuration constants
const MAX_CONCURRENT_FETCHES = 30; // Max concurrent patch operations (each makes 3-5 HTTP requests)
const FETCH_DELAY_MS = 10; // Delay between operations in milliseconds
const MAX_RETRIES = 3; // Max retry attempts for 429 rate limit errors

// Patch selection configuration constants
const GROUP_SIZE = 100; // Group patches into groups of this size
const SELECT_PER_GROUP = 30; // Select this many patches from each group

// Create summary reporter
const summaryReporter = new SummaryReporter();
summaryReporter.start();

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
  "QDRANT_API_KEY",
  "AZURE_TEXT_EMBEDDING_API_ENDPOINT",
  "AZURE_TEXT_EMBEDDING_API_KEY",
  "TELEGRAM_SOCIAL_TRUTH_BOT_ID",
  "ID_MASK_SALT"
];

// Optional but recommended environment variables
const optionalEnvVars = [
  "SUI_NETWORK" // Sui network: mainnet, testnet, devnet, or localnet (defaults to mainnet)
];

logger.log("🔧 Validating environment variables passed from Rust app...");
logger.log(`📝 Log file: ${logger.getLogFilePath() || 'Not available'}`);
// Output log file location to console for database capture
logger.consoleLog(`📝 Detailed logs: ${logger.getLogFilePath() || 'Not available'}`);
const missingVars = [];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    missingVars.push(key);
    logger.error(`❌ Missing required environment variable: ${key}`);
  } else {
    logger.log(`✅ ${key}: ${key.includes('SECRET') || key.includes('API_KEY') ? '***hidden***' : process.env[key]}`);
  }
}

if (missingVars.length > 0) {
  logger.error(`💥 Missing ${missingVars.length} required environment variable(s).`);
  logger.error("These should be passed from Rust app via AppState.");
  process.exit(1);
}

// Check optional variables
for (const key of optionalEnvVars) {
  if (!process.env[key]) {
    const warning = `⚠️  Missing optional environment variable: ${key}`;
    logger.warn(warning);
    summaryReporter.recordWarning(warning);
  } else {
    logger.log(`✅ ${key}: ${key.includes('SECRET') || key.includes('API_KEY') ? '***hidden***' : process.env[key]}`);
  }
}

logger.log("✅ All required environment variables are available from Rust app");

// Parse CLI arguments for different operations
const args = process.argv.slice(2);

// Check for operation type
const operationIndex = args.indexOf('--operation');
const operation = operationIndex !== -1 ? args[operationIndex + 1] : 'default';

logger.log(`🎯 Operation: ${operation}`);

let parsedArgs = {};

if (operation === 'embedding') {
  // Embedding operation: --operation embedding --quilt-id <quiltId> --on-chain-file-obj-id <objId> --policy-object-id <policyId> --threshold <threshold> [--batch-size N] <enclaveId>
  const quiltIdIndex = args.indexOf('--quilt-id');
  const onChainFileObjIdIndex = args.indexOf('--on-chain-file-obj-id');
  const policyObjectIdIndex = args.indexOf('--policy-object-id');
  const thresholdIndex = args.indexOf('--threshold');
  
  if (quiltIdIndex === -1 || onChainFileObjIdIndex === -1 || 
      policyObjectIdIndex === -1 || thresholdIndex === -1 || args.length < 11) {
    logger.error("Usage for embedding: node index.js --operation embedding --quilt-id <quiltId> --on-chain-file-obj-id <objId> --policy-object-id <policyId> --threshold <threshold> [--batch-size N] <enclaveId>");
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
    quiltId: args[quiltIdIndex + 1],
    onChainFileObjId: args[onChainFileObjIdIndex + 1],
    policyObjectId: args[policyObjectIdIndex + 1],
    threshold: args[thresholdIndex + 1],
    enclaveId: args[args.length - 1], // Last argument is enclaveId
    processingConfig,
  };
  
logger.log("📋 Embedding Operation Arguments:");
    logger.log(`  Quilt ID: ${parsedArgs.quiltId}`);
    logger.log(`  OnChainFileObjId: ${parsedArgs.onChainFileObjId}`);
    logger.log(`  PolicyObjectId: ${parsedArgs.policyObjectId}`);
    logger.log(`  Threshold: ${parsedArgs.threshold}`);
    logger.log(`  Enclave ID: ${parsedArgs.enclaveId}`);
    if (Object.keys(processingConfig).length > 0) {
      logger.log(`  Processing Config:`, JSON.stringify(processingConfig));
    }
  
} else if (operation === 'retrieve-by-blob-ids') {
  // Retrieve by blob IDs operation: --operation retrieve-by-blob-ids --blob-file-pairs <jsonString> --threshold <threshold> <enclaveId>
  const blobFilePairsIndex = args.indexOf('--blob-file-pairs');
  const thresholdIndex = args.indexOf('--threshold');
  
  if (blobFilePairsIndex === -1 || 
      thresholdIndex === -1 || args.length < 7) {
    logger.error("Usage for retrieve-by-blob-ids: node index.js --operation retrieve-by-blob-ids --blob-file-pairs <jsonString> --threshold <threshold> <enclaveId>");
    process.exit(1);
  }

  const blobFilePairsStr = args[blobFilePairsIndex + 1];
  let blobFilePairs;
  
  try {
    blobFilePairs = JSON.parse(blobFilePairsStr);
  } catch (error) {
    logger.error("❌ Failed to parse blob file pairs JSON:", error.message);
    process.exit(1);
  }
  
  if (!Array.isArray(blobFilePairs) || blobFilePairs.length === 0) {
    logger.error("❌ No valid blob file pairs provided");
    process.exit(1);
  }
  
  // Validate blob file pairs structure
  for (let i = 0; i < blobFilePairs.length; i++) {
    const pair = blobFilePairs[i];
    if (!pair.walrusBlobId || !pair.onChainFileObjId || !pair.policyObjectId) {
      logger.error(`❌ Invalid blob file pair at index ${i}: missing walrusBlobId, onChainFileObjId, or policyObjectId`);
      process.exit(1);
    }
    // Validate message indices if provided
    if (pair.messageIndices && !Array.isArray(pair.messageIndices)) {
      logger.error(`❌ Invalid blob file pair at index ${i}: messageIndices must be an array`);
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
  
  logger.log("📋 Retrieve by Blob IDs Operation Arguments:");
  logger.log(`  Blob File Pairs: ${blobFilePairs.length} pairs`);
  blobFilePairs.forEach((pair, index) => {
    const indicesInfo = pair.messageIndices ? ` (indices: ${pair.messageIndices.join(',')})` : ' (all messages)';
    logger.log(`    ${index + 1}. Blob ID: ${pair.walrusBlobId}, File ID: ${pair.onChainFileObjId}, Policy ID: ${pair.policyObjectId}${indicesInfo}`);
  });
  logger.log(`  Threshold: ${parsedArgs.threshold}`);
  logger.log(`  Enclave ID: ${parsedArgs.enclaveId}`);
  
  } else {
    // Default operation (refinement): <blobId> <onChainFileObjId> <policyObjectId> <threshold> <enclaveId>
    if (args.length < 5) {
      logger.error("Usage: node index.js <blobId> <onChainFileObjId> <policyObjectId> <threshold> <enclaveId>");
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
  
  logger.log("📋 Default Operation Arguments:");   
  logger.log(`  BlobId: ${blobId}`);
  logger.log(`  OnChainFileObjId: ${onChainFileObjId}`);
  logger.log(`  PolicyObjectId: ${policyObjectId}`);
  logger.log(`  Threshold: ${threshold}`);
  logger.log(`  EnclaveId: ${enclaveId}`);
}


// --- Services ---
let services = {};

async function initializeServices() {
  try {
    logger.log("🔧 Initializing all services...");
    
    // Initialize all services using factory
    services = {
      refinement: ServiceFactory.createRefinementService('chat'),
      // embedding: ServiceFactory.createEmbeddingService('ollama', {
      //   batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '50')
      // }),
      embedding: ServiceFactory.createEmbeddingService('azure', {
        batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '50')
      }),
      vectorDb: ServiceFactory.createVectorDbService('qdrant', {
        batchSize: parseInt(process.env.VECTOR_BATCH_SIZE || '500')
      }),
      blockchain: ServiceFactory.createBlockchainServices()
    };

    // Initialize blockchain services
    await services.blockchain.sui.initialize();
    
    logger.log("✅ All services initialized successfully");
    return services;
  } catch (error) {
    logger.error("❌ Failed to initialize services:", error.message);
    throw error;
  }
}

// --- Main Task Runner ---
async function runTasks() {
  try {
    logger.log("🚀 Starting task execution...");
    
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
    logger.error("💥 Task failed:", error.stack || error.message);
    process.exit(1);
  }
}

async function runEmbeddingOperation() {
  logger.log("🔤 Running Embedding Operation...");
  
  // Initialize ID unmasker for unmasking patch tags
  const idUnmasker = new IdUnmasker();
  
  // Step 1: Fetch all patches from the quilt
  logger.log("📥 Step 1: Fetching all patches from quilt...");
  const patches = await services.blockchain.walrus.fetchQuiltPatches(parsedArgs.quiltId);
  
  if (!patches || patches.length === 0) {
    logger.error("❌ No patches found in quilt");
    process.exit(1);
  }
  
  logger.log(`✅ Found ${patches.length} patches in quilt`);
  
  // Group patches into groups, then randomly select from each group
  const groups = [];
  for (let i = 0; i < patches.length; i += GROUP_SIZE) {
    groups.push(patches.slice(i, i + GROUP_SIZE));
  }
  
  logger.log(`📦 Grouped ${patches.length} patches into ${groups.length} groups of up to ${GROUP_SIZE} patches each`);
  
  // Select 30 patches from each group
  const originalTotalPatches = patches.length;
  const selectedPatches = [];
  
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const selectCount = Math.min(SELECT_PER_GROUP, group.length);
    const groupSelected = getRandomItems(group, selectCount);
    selectedPatches.push(...groupSelected);
    logger.log(`   Group ${i + 1} (${group.length} patches): selected ${selectCount} patches`);
  }
  
  logger.log(`🎲 Selected ${selectedPatches.length} patches total (${SELECT_PER_GROUP} from each group of ${GROUP_SIZE})`);
  logger.log(`⏭️  Skipping ${originalTotalPatches - selectedPatches.length} patches`);
  
  // Record patch selection in summary reporter
  summaryReporter.recordPatchSelection(originalTotalPatches, selectedPatches.length);
  
  // Use only the selected patches for processing
  patches = selectedPatches;
  
  // Create rate limiter to prevent overwhelming the API (reduce 429 errors)
  // IMPORTANT: Each patch operation makes multiple HTTP requests:
  // - 1 to Walrus aggregator (fetchEncryptedFile)
  // - Multiple to Sui RPC (tx.build in sealApprove, sessionKey.create, etc.)
  // - Requests to Ruby Nodes API (via SealClient)
  // With retry logic, we can balance speed and rate limit safety
  // Walrus aggregator defaults: max 256 concurrent, 384 buffer
  // Using constants: MAX_CONCURRENT_FETCHES concurrent patches (each makes 3-5 HTTP requests = ~60-100 total concurrent)
  const rateLimiter = new RateLimiter(MAX_CONCURRENT_FETCHES, FETCH_DELAY_MS, MAX_RETRIES);
  
  logger.log(`🚀 Step 2: Fetching ${patches.length} patches with rate limiting (max ${MAX_CONCURRENT_FETCHES} concurrent, ${FETCH_DELAY_MS}ms delay, ${MAX_RETRIES} retries for 429 errors)...`);
  
  // Create fetch functions
  const fetchFunctions = patches.map((patch, i) => async () => {
    // The patch object from /v1/quilts/{quilt_id}/patches has a "patch_id" field
    // This is the quilt patch ID used with /v1/blobs/by-quilt-patch-id/{quilt_patch_id}
    const patchId = patch.patch_id || patch.id || patch.identifier;
    
    if (!patchId) {
      throw new Error(`Patch at index ${i} missing patch_id field (expected from /v1/quilts/{quilt_id}/patches)`);
    }
    
    try {
      // Fetch encrypted patch blob from Walrus (rate limited!)
      const encryptedPatch = await services.blockchain.walrus.fetchEncryptedFile(patchId);
      
      // Parse encrypted object
      const encryptedObject = await services.blockchain.seal.parseEncryptedObject(encryptedPatch);
      
      // Decrypt patch
      const decryptedPatch = await services.blockchain.seal.decryptFile(
        encryptedObject.id,
        encryptedPatch,
        parsedArgs.policyObjectId,
        services.blockchain.sui
      );
      
      return {
        patchIndex: i,
        patch: patch,
        patchId: patchId,
        encryptedPatch: encryptedPatch,
        encryptedObject: encryptedObject,
        decryptedPatch: decryptedPatch,
        success: true
      };
    } catch (error) {
      return {
        patchIndex: i,
        patch: patch,
        patchId: patchId,
        success: false,
        error: error.message
      };
    }
  });
  
  // Execute with rate limiting
  const fetchResults = await rateLimiter.executeAll(fetchFunctions);
  
  // Aggregate fetch results for better error reporting
  const successfulFetches = fetchResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failedFetches = fetchResults.length - successfulFetches;
  
  if (failedFetches > 0) {
    logger.log(`⚠️  Finished fetching patches: ${successfulFetches} succeeded, ${failedFetches} failed`);
    // Only log detailed errors if there are relatively few failures (to avoid spam)
    if (failedFetches <= 10) {
      fetchResults.forEach((result, i) => {
        if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
          const patchId = patches[i].patch_id || patches[i].id || patches[i].identifier || `index ${i}`;
          const error = result.status === 'rejected' ? result.reason?.message : result.value.error;
          logger.error(`❌ Failed to fetch patch ${i + 1} (${patchId}): ${error}`);
        }
      });
    } else {
      logger.error(`❌ ${failedFetches} patches failed to fetch. Details suppressed to reduce log noise.`);
    }
  } else {
    logger.log(`✅ Finished fetching patches. All ${fetchResults.length} patches fetched successfully.`);
  }
  
  // Step 3: Process fetched patches sequentially (or in parallel if needed)
  const allResults = [];
  
  for (let i = 0; i < fetchResults.length; i++) {
    const fetchResult = fetchResults[i];
    const patch = patches[i];
    // The patch object from /v1/quilts/{quilt_id}/patches has a "patch_id" field
    // This is the quilt patch ID used with /v1/blobs/by-quilt-patch-id/{quilt_patch_id}
    const patchId = patch.patch_id || patch.id || patch.identifier;
    
    if (fetchResult.status === 'rejected') {
      // Error already logged in aggregate above, skip individual logging
      allResults.push({
        patchIndex: i,
        patchId: patchId,
        result: {
          status: "failed",
          error: `Fetch failed: ${fetchResult.reason}`
        }
      });
      continue;
    }
    
    const fetched = fetchResult.value;
    
    if (!fetched.success) {
      // Error already logged in aggregate above, skip individual logging
      allResults.push({
        patchIndex: i,
        patchId: patchId,
        result: {
          status: "failed",
          error: `Fetch failed: ${fetched.error}`
        }
      });
      continue;
    }
    
    logger.log(`\n📦 Processing patch ${i + 1}/${patches.length} (patch_id: ${patchId})`);
    
    try {
      // Unmask patch tags to get original IDs
      const unmaskedTags = idUnmasker.unmaskPatchTags(fetched.patch);
      // logger.log(`🔓 Unmasked IDs - User: ${unmaskedTags.userId || 'N/A'}, Chat: ${unmaskedTags.chatId || 'N/A'}, Submission: ${unmaskedTags.submissionId || 'N/A'}`);
      
      // Process patch (each patch is a chat with messages)
      // The decrypted patch should be a single chat object with chat_id and contents
      // We need to wrap it in the expected format for processMessagesByMessage
      let patchData;
      
      // Check if decryptedPatch is already in the full format (with chats array)
      if (fetched.decryptedPatch.chats && Array.isArray(fetched.decryptedPatch.chats)) {
        // Already in the expected format, but ensure user ID is set from unmasked tags
        // Prioritize userId to match stored format, then fallback to user, then unmasked tags
        patchData = {
          ...fetched.decryptedPatch,
          user: fetched.decryptedPatch.userId || fetched.decryptedPatch.user || unmaskedTags.userId || ""
        };
      } else if (fetched.decryptedPatch.chat_id && fetched.decryptedPatch.contents) {
        // Single chat object (patch format) - wrap it in the expected format
        // Use unmasked chat_id if available, otherwise use decrypted one
        const chatId = unmaskedTags.chatId ? Number(unmaskedTags.chatId) : fetched.decryptedPatch.chat_id;
        // Prioritize userId to match stored format, then fallback to user, then unmasked tags
        const userId = fetched.decryptedPatch.userId || fetched.decryptedPatch.user || unmaskedTags.userId || "";
        patchData = {
          revision: fetched.decryptedPatch.revision || "01.01",
          source: fetched.decryptedPatch.source || "telegramMiner",
          user: userId,
          submission_token: fetched.decryptedPatch.submission_token || "token",
          chats: [{
            ...fetched.decryptedPatch,
            chat_id: chatId
          }]
        };
      } else if (Array.isArray(fetched.decryptedPatch)) {
        // Array of chat objects
        patchData = {
          revision: "01.01",
          source: "telegramMiner",
          user: unmaskedTags.userId || "",
          submission_token: "token",
          chats: fetched.decryptedPatch
        };
      } else {
        // Try to extract user from unmasked tags and create a chat object
        const chatId = unmaskedTags.chatId ? Number(unmaskedTags.chatId) : null;
        
        patchData = {
          revision: "01.01",
          source: "telegramMiner",
          user: unmaskedTags.userId || "",
          submission_token: "token",
          chats: [{
            chat_id: chatId || 0,
            contents: Array.isArray(fetched.decryptedPatch) ? fetched.decryptedPatch : (fetched.decryptedPatch.contents || [])
          }]
        };
      }
      
      const embeddingArgs = {
        ...parsedArgs,
        originalBlobId: patchId, // Use patch_id as the original blob id
        onChainFileObjId: parsedArgs.onChainFileObjId,
        policyObjectId: parsedArgs.policyObjectId,
        processingConfig: {
          batchSize: process.env.EMBEDDING_BATCH_SIZE || '50',
          storeVectors: 'true',
          includeEmbeddings: 'false'
        }
      };
      
      logger.log(`🔤 Processing patch messages with embeddings...`);
      const patchResult = await processMessagesByMessage(patchData, services, embeddingArgs);
      
      allResults.push({
        patchIndex: i,
        patchId: patchId,
        result: patchResult
      });
      
      if (patchResult.status === "success") {
        logger.log(`✅ Patch ${i + 1} processed successfully: ${patchResult.processedCount || 0} messages`);
        summaryReporter.recordPatchProcessed(
          true,
          patchResult.processedCount || 0,
          patchResult.successfulEmbeddings || 0,
          patchResult.successfulVectorStorages || 0
        );
      } else {
        logger.error(`❌ Patch ${i + 1} processing failed: ${patchResult.error || patchResult.failureReason}`);
        summaryReporter.recordPatchProcessed(false);
        summaryReporter.recordError(`Patch ${i + 1} processing failed: ${patchResult.error || patchResult.failureReason}`);
      }
      
    } catch (error) {
      logger.error(`❌ Failed to process patch ${i + 1} (${patchId}): ${error.message}`);
      summaryReporter.recordPatchProcessed(false);
      summaryReporter.recordError(`Failed to process patch ${i + 1} (${patchId}): ${error.message}`);
      allResults.push({
        patchIndex: i,
        patchId: patchId,
        result: {
          status: "failed",
          error: error.message
        }
      });
    }
  }
  
  // Aggregate results (recalculate from allResults to ensure accuracy after parallel processing)
  const successfulResults = allResults.filter(r => r.result.status === "success");
  const failedResults = allResults.filter(r => r.result.status === "failed");
  const recalculatedTotalProcessed = successfulResults.reduce((sum, r) => sum + (r.result.processedCount || 0), 0);
  const recalculatedTotalSuccessful = successfulResults.reduce((sum, r) => sum + (r.result.processedCount || 0), 0);
  
  const finalResult = {
    status: failedResults.length === 0 ? "success" : (successfulResults.length > 0 ? "partial" : "failed"),
    operation: "embedding",
    quiltId: parsedArgs.quiltId,
    totalPatches: patches.length,
    processedPatches: successfulResults.length,
    failedPatches: failedResults.length,
    totalProcessedMessages: recalculatedTotalProcessed,
    successfulEmbeddings: recalculatedTotalSuccessful,
    patchResults: allResults
  };
  
  summaryReporter.end();
  const summary = summaryReporter.generateSummary();
  
  // Include summary in result data
  finalResult.summary = summary;
  
  if (finalResult.status === "failed") {
    logger.error("❌ Embedding operation failed for all patches!");
    summaryReporter.printSummary(logger);
    logger.log("===TASK_RESULT_START===");
    logger.log(JSON.stringify(finalResult));
    logger.log("===TASK_RESULT_END===");
    process.exit(1);
  } else {
    logger.log(`\n✅ Embedding operation completed!`);
    logger.log(`📊 Summary: ${finalResult.processedPatches}/${finalResult.totalPatches} patches processed, ${recalculatedTotalProcessed} messages embedded`);
    
    // Print summary report to console (for database capture)
    summaryReporter.printSummary(logger);
    
    logger.log("===TASK_RESULT_START===");
    logger.log(JSON.stringify(finalResult));
    logger.log("===TASK_RESULT_END===");
    process.exit(0);
  }
}


async function processMessagesByMessage(rawData, services, args) {
  const messageIndexMap = new Map();
  const socialTruthBotId = Number(process.env.TELEGRAM_SOCIAL_TRUTH_BOT_ID);

  const selectedMessages = [];
  const currentTime = new Date();
  const cutoffTime = new Date(currentTime.getTime() - 16 * 60 * 60 * 1000);

  if (rawData.chats && Array.isArray(rawData.chats)) {
    for (let chatIndex = 0; chatIndex < rawData.chats.length; chatIndex++) {
      const chat = rawData.chats[chatIndex];
      if (!Array.isArray(chat.contents) || chat.chat_id === socialTruthBotId) continue;

      // Attach context
      const chatMessages = chat.contents.map((msg, contentIndex) => {
        const flatIndex = selectedMessages.length;
        const wrapped = {
          ...msg,
          chat_id: chat.chat_id,
          user_id: rawData.user
        };
        messageIndexMap.set(flatIndex, { chatIndex, contentIndex });
        return wrapped;
      });

      // ☕ 1. Filter out messages that have no text content
      // ☕ 2. Remove messages that are older than current time less 16 hours
      // ☕ 3. Remove messages whose content is > 20% emojis (will exclude messages that are only emojis)
      // ☕ 4. Deduplicate by message text, keeping the latest one (highest date)
      // ☕ 5. Filter messages that are between 15-20 words long (non-English not accounted for) - choose 5
      // ☕ 6. Filter messages that are between 20-50 words long (non-English not accounted for) - choose 5
      // ☕ 7. Messages to be embedded = 10 msgs (10% of max 50 messages per conversation)
      
      // 1. Non-empty text messages
      const nonEmpty = chatMessages.filter(m =>
        m.message &&
        typeof m.message === "string" &&
        m.message.trim().length > 0 &&
        new Date(m.date * 1000) > cutoffTime
      );

      // 2. Exclude messages >20% emojis
      const nonEmoji = nonEmpty.filter(m => {
        const emojiRegex = /\p{Emoji_Presentation}/gu;
        const matches = m.message.match(emojiRegex);
        const emojiCount = matches ? matches.length : 0;
        return (emojiCount / m.message.length) < 0.2;
      });

      // 3. Deduplicate by text, keep latest
      const uniqueMap = new Map();
      for (const m of nonEmoji) {
        const existing = uniqueMap.get(m.message);
        if (!existing || m.date > existing.date) {
          uniqueMap.set(m.message, m);
        }
      }
      const deduped = Array.from(uniqueMap.values());

      // 4. Split by word length
      const medium = deduped.filter(m => {
        const wc = m.message.split(" ").length;
        return wc >= 15 && wc <= 20;
      });
      const long = deduped.filter(m => {
        const wc = m.message.split(" ").length;
        return wc > 20 && wc <= 50;
      });

      // 5. Pick up to 10 per chat (5 medium + 5 long)
      const chosen = [
        ...getRandomItems(medium, 5),
        ...getRandomItems(long, 5)
      ];

      selectedMessages.push(...chosen);
    }
  }

  if (!selectedMessages.length) {
    logger.log("⚠️ No messages to process");
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

  const batchSize = parseInt(args.processingConfig.batchSize || "64");
  const stats = {
    totalMessages: selectedMessages.length,
    successfulEmbeddings: 0,
    failedEmbeddings: 0,
    successfulWalrusUploads: 0,
    failedWalrusUploads: 0,
    successfulVectorStorages: 0,
    failedVectorStorages: 0,
    errors: []
  };

  if (!services.vectorDb.isConnected()) {
    await services.vectorDb.connect();
  }

  logger.log(`📊 Processing ${selectedMessages.length} selected messages in batches of ${batchSize}...`);

  // Create batches
  const allBatches = [];
  for (let i = 0; i < selectedMessages.length; i += batchSize) {
    allBatches.push({
      messages: selectedMessages.slice(i, i + batchSize),
      startIndex: i
    });
  }

  const totalBatches = allBatches.length;
  let processedBatches = 0;

  try {
    await parallelProcess(
      allBatches,
      async (batchData, batchNum) => {
        const { messages: batch, startIndex } = batchData;
        
        logger.log(`📦 Processing batch ${batchNum + 1}/${totalBatches} (${batch.length} messages)`);

        // Generate embeddings for this batch
        const embeddingResults = await services.embedding.embedBatch(
          batch.map(msg => {
            const datetime = msg.date ? new Date(msg.date * 1000).toISOString() : "";
            const fromUserId = msg.fromId?.userId || "";
            const message = msg.message || "";
            const conversationId = msg.chat_id || "";
            const ownerUserId = msg.user_id || "";
            return `Date: ${datetime}, From User Id: ${fromUserId}, Message: ${message}, Conversation Id: ${conversationId}, Owner User Id: ${ownerUserId}`;
          })
        );

        // Check for embedding failures
        for (let j = 0; j < embeddingResults.length; j++) {
          if (!embeddingResults[j].success) {
            const error = `Failed to generate embedding for message ${batch[j].id}: ${embeddingResults[j].error || "Unknown error"}`;
            logger.error(`💥 EMBEDDING FAILURE: ${error}`);
            throw new Error(error);
          }
        }

        // Build vector batch
        const vectorBatch = batch.map((message, j) => {
          const embeddingResult = embeddingResults[j];
          const currentMessageIndex = startIndex + j;
          const rawPosition = messageIndexMap.get(currentMessageIndex);
          return {
            id: message.id,
            vector: embeddingResult.embedding,
            metadata: {
              message_id: message.id,
              message_index: currentMessageIndex,
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
        });

        // Store vectors
        const storeResults = await services.vectorDb.storeBatch(vectorBatch);
        for (let r = 0; r < storeResults.length; r++) {
          if (!storeResults[r] || !storeResults[r].success) {
            const failedMessage = batch[r].id;
            const error = `Failed to store vector for message ${failedMessage}: ${storeResults[r]?.error || "Unknown error"}`;
            logger.error(`💥 VECTOR STORAGE FAILURE: ${error}`);
            throw new Error(error);
          }
        }

        stats.successfulEmbeddings += batch.length;
        stats.successfulVectorStorages += batch.length;
        processedBatches++;
        logger.log(`✅ Batch ${batchNum + 1}/${totalBatches} complete`);
        return { success: true, processedCount: batch.length };
      },
      4
    );
  } catch (error) {
    logger.error(`💥 PROCESSING FAILED: ${error.message}`);
    summaryReporter.recordError(`Processing failed: ${error.message}`);
    return {
      status: "failed",
      operation: "embedding",
      processedCount: stats.successfulEmbeddings,
      failureReason: "parallel_processing_failed",
      error: error.message,
      totalMessages: selectedMessages.length,
      processedSoFar: stats.successfulEmbeddings
    };
  }

  const result = {
    status: "success",
    operation: "embedding",
    processedCount: selectedMessages.length,
    totalMessages: selectedMessages.length,
    successfulEmbeddings: stats.successfulEmbeddings,
    successfulWalrusUploads: stats.successfulWalrusUploads,
    successfulVectorStorages: stats.successfulVectorStorages,
    message: "All messages processed successfully"
  };

  logger.log(`✅ All ${selectedMessages.length} messages processed successfully!`);
  logger.log(`📊 Final Stats: ${stats.successfulEmbeddings} embeddings, ${stats.successfulVectorStorages} vectors stored`);
  
  // Note: Don't record here - let the caller (patch processing loop) record it
  // This prevents double counting when processMessagesByMessage is called from patch processing
  
  logger.log("===TASK_RESULT_START===");
  logger.log(JSON.stringify(result));
  logger.log("===TASK_RESULT_END===");

  return result;
}

function getRandomItems(arr, n) {
  if (arr.length <= n) return arr;
  const copy = [...arr];
  const result = [];
  while (result.length < n) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}


async function parallelProcess(items, processFn, concurrency = 4) {
  let index = 0;
  
  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      await processFn(item, currentIndex);
    }
  }
  
  // Create worker promises
  const workers = Array(Math.min(concurrency, items.length))
    .fill()
    .map(() => worker());
  
  // Wait for all workers to complete
  await Promise.all(workers);
}


async function runRetrieveByBlobIdsOperation() {
  logger.log("📦 Running Optimized Message Retrieval by Blob IDs with Message Indices...");
  
  try {
    logger.log(`📊 Processing ${parsedArgs.blobFilePairs.length} blob file pairs...`);
    
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
    
    logger.log(`📦 Optimized to ${Object.keys(fileGroups).length} unique file downloads`);
    
    // Process each unique file group
    for (const [key, group] of Object.entries(fileGroups)) {
      const { walrusBlobId, onChainFileObjId, policyObjectId, messageIndices } = group;
      
      logger.log(`📥 Processing file: ${walrusBlobId} (${onChainFileObjId})`);
      const indicesInfo = messageIndices ? `indices: ${Array.from(messageIndices).join(',')}` : 'all messages';
      logger.log(`   Retrieving: ${indicesInfo}`);
      
      try {
        // Step 1: Fetch encrypted file from Walrus (once per unique file)
        logger.log(`📥 Fetching encrypted file from Walrus...`);
        const encryptedFile = await services.blockchain.walrus.fetchEncryptedFile(walrusBlobId);
        
        // Step 2: Parse encrypted object
        logger.log(`📦 Parsing encrypted object...`);
        const encryptedObject = await services.blockchain.seal.parseEncryptedObject(encryptedFile);
        
        // Step 3: Register attestation for decryption
        // logger.log(`🔗 Registering attestation...`);
        // const attestationObjId = await services.blockchain.sui.registerAttestation(
        //   encryptedObject.id, 
        //   parsedArgs.enclaveId, 
        // );
        
        // Step 4: Decrypt file once
        logger.log(`🔓 Decrypting refined file...`);
        const decryptedFile = await services.blockchain.seal.decryptFile(
          encryptedObject.id,
          // attestationObjId,
          encryptedFile,
          // onChainFileObjId,
          policyObjectId,
          // parsedArgs.threshold,
          services.blockchain.sui
        );
        
        // Step 5: Extract specific messages by indices from patch format
        // Each patch is a single chat object with chat_id and contents array
        // Format: { chat_id, contents: [...], userId, submissionId, revision, source }
        const flatMessages = [];
        
        // Handle patch format (single chat per patch)
        if (!decryptedFile.chat_id || !decryptedFile.contents || !Array.isArray(decryptedFile.contents)) {
          throw new Error(`Invalid patch format: expected chat_id and contents array, got ${JSON.stringify(Object.keys(decryptedFile))}`);
        }
        
        // Patch format: single chat with contents array
        // Prioritize userId to match stored format, then fallback to user
        const userId = decryptedFile.userId || decryptedFile.user || "";
        for (const msg of decryptedFile.contents) {
          flatMessages.push({
            ...msg,
            chat_id: decryptedFile.chat_id,
            user_id: userId
          });
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
            logger.log(`✅ Retrieved all ${flatMessages.length} messages from ${walrusBlobId}`);
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
              logger.log(`✅ Retrieved message at index ${messageIndex} from ${walrusBlobId}`);
            } else {
              retrievedMessages.push({
                walrus_blob_id: walrusBlobId,
                on_chain_file_obj_id: onChainFileObjId,
                policy_object_id: policyObjectId,
                message_index: messageIndex,
                status: 'failed',
                error: `Message not found at index ${messageIndex}`
              });
              logger.log(`❌ Message not found at index ${messageIndex} in ${walrusBlobId}`);
            }
          }
        }
        
      } catch (error) {
        logger.error(`❌ Failed to process file ${walrusBlobId}: ${error.message}`);
        
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
    
    summaryReporter.end();
    const summary = summaryReporter.generateSummary();
    
    // Include summary in result data
    result.summary = summary;
    
    summaryReporter.printSummary(logger);
    
    logger.log("✅ Optimized blob ID retrieval completed!");
    logger.log(`📊 Processed ${result.total_files_processed} unique files, retrieved ${result.total_messages_retrieved} messages (${result.successful_retrievals} successful, ${result.failed_retrievals} failed)`);
    logger.log("===TASK_RESULT_START===");
    logger.log(JSON.stringify(result));
    logger.log("===TASK_RESULT_END===");
    process.exit(0);
    
  } catch (error) {
    logger.error("💥 Optimized blob ID retrieval operation failed:", error.message);
    
    summaryReporter.end();
    const summary = summaryReporter.generateSummary();
    
    const result = {
      status: "failed",
      operation: "retrieve-by-blob-ids",
      requested_pairs: parsedArgs.blobFilePairs.map(pair => ({
        walrus_blob_id: pair.walrusBlobId,
        on_chain_file_obj_id: pair.onChainFileObjId,
        policy_object_id: pair.policyObjectId,
        message_indices: pair.messageIndices || null
      })),
      error: error.message,
      summary: summary
    };
    
    summaryReporter.printSummary(logger);
    logger.log("===TASK_RESULT_START===");
    logger.log(JSON.stringify(result));
    logger.log("===TASK_RESULT_END===");
    process.exit(1);
  }
}

async function runDefaultOperation() {
  console.time('⌚ runDefaultOperation <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
  logger.log("📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝📝 Running Default Operation...");
  
  // Step 1: Check if blobId is a quilt ID by trying to fetch patches
  // If it's a quilt ID, we'll process all patches. If it's a patch ID, we'll process it directly.
  logger.log("📥 Step 1: Checking if blobId is a quilt ID or patch ID...");
  
  let patches = null;
  try {
    patches = await services.blockchain.walrus.fetchQuiltPatches(parsedArgs.blobId);
    if (patches && patches.length > 0) {
      logger.log(`✅ Detected quilt ID. Found ${patches.length} patches. Processing as quilt...`);
      // It's a quilt ID - process all patches
      const summary = await processQuiltPatches(patches, parsedArgs);
      
      const result = {
        originalBlobId: parsedArgs.blobId,
        type: "quilt",
        summary: summary
      };
      
      logger.log("✅ Task completed successfully!");
      logger.log("===TASK_RESULT_START===");
      logger.log(JSON.stringify(result));
      logger.log("===TASK_RESULT_END===");
      console.timeEnd('⌚ runDefaultOperation <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
      process.exit(0);
      return;
    }
  } catch (error) {
    // Not a quilt ID, treat as patch ID
    logger.log(`ℹ️  Not a quilt ID (${error.message}). Treating as patch ID...`);
  }
  
  // Step 2: Treat as patch ID and fetch encrypted file from Walrus
  logger.log("📥 Step 2: Fetching encrypted file as patch ID...");
  const encryptedFile = await services.blockchain.walrus.fetchEncryptedFile(parsedArgs.blobId);
  
  // Step 3: Parse encrypted object
  logger.log("📦 Step 3: Parsing encrypted object...");
  const encryptedObject = await services.blockchain.seal.parseEncryptedObject(encryptedFile);
  
  // Step 4: Register attestation
  // logger.log("🔗 Step 4: Registering attestation...");
  // const attestationObjId = await services.blockchain.sui.registerAttestation(
  //   encryptedObject.id, 
  //   parsedArgs.enclaveId, 
  // );
  
  // Step 5: Decrypt file
  logger.log("🔓 Step 5: Decrypting file...");
  const decryptedFile = await services.blockchain.seal.decryptFile(
    encryptedObject.id, // seal id
    // attestationObjId,
    encryptedFile,
    // parsedArgs.onChainFileObjId,
    parsedArgs.policyObjectId,
    // parsedArgs.threshold,
    services.blockchain.sui
  );
  
  // Step 6: Process embeddings directly from decrypted data
  logger.log("🔤 Step 6: Processing embeddings directly from decrypted data...");
  await processMessagesByMessage(
    decryptedFile,
    services,
    {
      ...parsedArgs,
      originalBlobId: parsedArgs.blobId,
      processingConfig: {
        batchSize: process.env.EMBEDDING_BATCH_SIZE || '50',
        storeVectors: 'true',
        includeEmbeddings: 'false'
      }
    }
);
  
  // Output results
  summaryReporter.end();
  const summary = summaryReporter.generateSummary();
  
  const result = {
    // attestationObjId,
    originalBlobId: parsedArgs.blobId,
    type: "patch",
    summary: summary
  };
  
  summaryReporter.printSummary(logger);
  
  logger.log("✅ Task completed successfully!");
  logger.log("===TASK_RESULT_START===");
  logger.log(JSON.stringify(result));
  logger.log("===TASK_RESULT_END===");
  console.timeEnd('⌚ runDefaultOperation <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<');
  process.exit(0);
}

// Helper function to process quilt patches (similar to runEmbeddingOperation)
async function processQuiltPatches(patches, parsedArgs) {
  const idUnmasker = new IdUnmasker();
  
  logger.log(`✅ Found ${patches.length} patches in quilt`);
  
  // Group patches into groups, then randomly select from each group
  const groups = [];
  for (let i = 0; i < patches.length; i += GROUP_SIZE) {
    groups.push(patches.slice(i, i + GROUP_SIZE));
  }
  
  logger.log(`📦 Grouped ${patches.length} patches into ${groups.length} groups of up to ${GROUP_SIZE} patches each`);
  
  // Select 30 patches from each group
  const originalTotalPatches = patches.length;
  const selectedPatches = [];
  
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const selectCount = Math.min(SELECT_PER_GROUP, group.length);
    const groupSelected = getRandomItems(group, selectCount);
    selectedPatches.push(...groupSelected);
    logger.log(`   Group ${i + 1} (${group.length} patches): selected ${selectCount} patches`);
  }
  
  logger.log(`🎲 Selected ${selectedPatches.length} patches total (${SELECT_PER_GROUP} from each group of ${GROUP_SIZE})`);
  logger.log(`⏭️  Skipping ${originalTotalPatches - selectedPatches.length} patches`);
  
  // Record patch selection in summary reporter
  summaryReporter.recordPatchSelection(originalTotalPatches, selectedPatches.length);
  
  // Use only the selected patches for processing
  patches = selectedPatches;
  
  // Create rate limiter to prevent overwhelming the API (reduce 429 errors)
  // IMPORTANT: Each patch operation makes multiple HTTP requests:
  // - 1 to Walrus aggregator (fetchEncryptedFile)
  // - Multiple to Sui RPC (tx.build in sealApprove, sessionKey.create, etc.)
  // - Requests to Ruby Nodes API (via SealClient)
  // With retry logic, we can balance speed and rate limit safety
  // Walrus aggregator defaults: max 256 concurrent, 384 buffer
  // Using constants: MAX_CONCURRENT_FETCHES concurrent patches (each makes 3-5 HTTP requests = ~60-100 total concurrent)
  const rateLimiter = new RateLimiter(MAX_CONCURRENT_FETCHES, FETCH_DELAY_MS, MAX_RETRIES);
  
  logger.log(`🚀 Fetching ${patches.length} patches with rate limiting (max ${MAX_CONCURRENT_FETCHES} concurrent, ${FETCH_DELAY_MS}ms delay, ${MAX_RETRIES} retries for 429 errors)...`);
  
  // Create fetch functions
  const fetchFunctions = patches.map((patch, i) => async () => {
    // The patch object from /v1/quilts/{quilt_id}/patches has a "patch_id" field
    // This is the quilt patch ID used with /v1/blobs/by-quilt-patch-id/{quilt_patch_id}
    const patchId = patch.patch_id || patch.id || patch.identifier;
    
    if (!patchId) {
      throw new Error(`Patch at index ${i} missing patch_id field (expected from /v1/quilts/{quilt_id}/patches)`);
    }
    
    try {
      // Fetch encrypted patch blob from Walrus (rate limited!)
      const encryptedPatch = await services.blockchain.walrus.fetchEncryptedFile(patchId);
      
      // Parse encrypted object
      const encryptedObject = await services.blockchain.seal.parseEncryptedObject(encryptedPatch);
      
      // Decrypt patch
      const decryptedPatch = await services.blockchain.seal.decryptFile(
        encryptedObject.id,
        encryptedPatch,
        parsedArgs.policyObjectId,
        services.blockchain.sui
      );
      
      return {
        patchIndex: i,
        patch: patch,
        patchId: patchId,
        encryptedPatch: encryptedPatch,
        encryptedObject: encryptedObject,
        decryptedPatch: decryptedPatch,
        success: true
      };
    } catch (error) {
      return {
        patchIndex: i,
        patch: patch,
        patchId: patchId,
        success: false,
        error: error.message
      };
    }
  });
  
  // Execute with rate limiting
  const fetchResults = await rateLimiter.executeAll(fetchFunctions);
  
  // Aggregate fetch results for better error reporting
  const successfulFetches = fetchResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failedFetches = fetchResults.length - successfulFetches;
  
  // Record fetch results in summary
  summaryReporter.recordFetchResults(successfulFetches, failedFetches);
  
  if (failedFetches > 0) {
    logger.log(`⚠️  Finished fetching patches: ${successfulFetches} succeeded, ${failedFetches} failed`);
    // Always record error types for aggregation, but only log details if few failures
    fetchResults.forEach((result, i) => {
      if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)) {
        const patchId = patches[i].patch_id || patches[i].id || patches[i].identifier || `index ${i}`;
        const error = result.status === 'rejected' ? result.reason?.message : result.value.error;
        
        // Always record in summary for aggregation (even if many failures)
        summaryReporter.recordError(`Failed to fetch patch ${i + 1} (${patchId}): ${error}`);
        
        // Only log to file if few failures (to avoid spam)
        if (failedFetches <= 10) {
          logger.error(`❌ Failed to fetch patch ${i + 1} (${patchId}): ${error}`);
        }
      }
    });
    
    if (failedFetches > 10) {
      logger.error(`❌ ${failedFetches} patches failed to fetch. Error types aggregated in summary.`);
    }
  } else {
    logger.log(`✅ Finished fetching patches. All ${fetchResults.length} patches fetched successfully.`);
  }
  
  // Process fetched patches sequentially
  for (let i = 0; i < fetchResults.length; i++) {
    const fetchResult = fetchResults[i];
    const patch = patches[i];
    const patchId = patch.patch_id || patch.id || patch.identifier;
    
    if (fetchResult.status === 'rejected') {
      // Error already logged in aggregate above, skip individual logging
      continue;
    }
    
    const fetched = fetchResult.value;
    
    if (!fetched.success) {
      // Error already logged in aggregate above, skip individual logging
      continue;
    }
    
    logger.log(`\n📦 Processing patch ${i + 1}/${patches.length} (patch_id: ${patchId})`);
    
    try {
      // Unmask patch tags to get original IDs
      const unmaskedTags = idUnmasker.unmaskPatchTags(fetched.patch);
      // logger.log(`🔓 Unmasked IDs - User: ${unmaskedTags.userId || 'N/A'}, Chat: ${unmaskedTags.chatId || 'N/A'}, Submission: ${unmaskedTags.submissionId || 'N/A'}`);
      
      // Process patch (each patch is a chat with messages)
      let patchData;
      
      if (fetched.decryptedPatch.chats && Array.isArray(fetched.decryptedPatch.chats)) {
        patchData = {
          ...fetched.decryptedPatch,
          user: fetched.decryptedPatch.userId || fetched.decryptedPatch.user || unmaskedTags.userId || ""
        };
      } else if (fetched.decryptedPatch.chat_id && fetched.decryptedPatch.contents) {
        const chatId = unmaskedTags.chatId ? Number(unmaskedTags.chatId) : fetched.decryptedPatch.chat_id;
        const userId = fetched.decryptedPatch.userId || fetched.decryptedPatch.user || unmaskedTags.userId || "";
        patchData = {
          revision: fetched.decryptedPatch.revision || "01.01",
          source: fetched.decryptedPatch.source || "telegramMiner",
          user: userId,
          submission_token: fetched.decryptedPatch.submission_token || "token",
          chats: [{
            ...fetched.decryptedPatch,
            chat_id: chatId
          }]
        };
      } else if (Array.isArray(fetched.decryptedPatch)) {
        patchData = {
          revision: "01.01",
          source: "telegramMiner",
          user: unmaskedTags.userId || "",
          submission_token: "token",
          chats: fetched.decryptedPatch
        };
      } else {
        const chatId = unmaskedTags.chatId ? Number(unmaskedTags.chatId) : null;
        patchData = {
          revision: "01.01",
          source: "telegramMiner",
          user: unmaskedTags.userId || "",
          submission_token: "token",
          chats: [{
            chat_id: chatId || 0,
            contents: Array.isArray(fetched.decryptedPatch) ? fetched.decryptedPatch : (fetched.decryptedPatch.contents || [])
          }]
        };
      }
      
      const embeddingArgs = {
        ...parsedArgs,
        originalBlobId: patchId,
        onChainFileObjId: parsedArgs.onChainFileObjId,
        policyObjectId: parsedArgs.policyObjectId,
        processingConfig: {
          batchSize: process.env.EMBEDDING_BATCH_SIZE || '50',
          storeVectors: 'true',
          includeEmbeddings: 'false'
        }
      };
      
      logger.log(`🔤 Processing patch messages with embeddings...`);
      const patchResult = await processMessagesByMessage(patchData, services, embeddingArgs);
      
      if (patchResult.status === "success") {
        logger.log(`✅ Patch ${i + 1} processed successfully: ${patchResult.processedCount || 0} messages`);
        summaryReporter.recordPatchProcessed(
          true,
          patchResult.processedCount || 0,
          patchResult.successfulEmbeddings || 0,
          patchResult.successfulVectorStorages || 0
        );
      } else {
        logger.error(`❌ Patch ${i + 1} processing failed: ${patchResult.error || patchResult.failureReason}`);
        summaryReporter.recordPatchProcessed(false);
        summaryReporter.recordError(`Patch ${i + 1} processing failed: ${patchResult.error || patchResult.failureReason}`);
      }
      
    } catch (error) {
      logger.error(`❌ Failed to process patch ${i + 1} (${patchId}): ${error.message}`);
      summaryReporter.recordPatchProcessed(false);
      summaryReporter.recordError(`Failed to process patch ${i + 1} (${patchId}): ${error.message}`);
    }
  }
  
  summaryReporter.end();
  const summary = summaryReporter.generateSummary();
  summaryReporter.printSummary(logger);
  
  return summary;
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.log("\n🛑 Received SIGINT, shutting down gracefully...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  logger.log("\n🛑 Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Run the tasks
runTasks();