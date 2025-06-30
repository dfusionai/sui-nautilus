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
const { SuiClient, getFullnodeUrl } = require("@mysten/sui/client");
const { Ed25519Keypair } = require("@mysten/sui/keypairs/ed25519");
const { Transaction } = require("@mysten/sui/transactions");
const { fromHex, toHex } = require("@mysten/sui/utils");
const {
  SealClient,
  SessionKey,
  EncryptedObject,
  getAllowlistedKeyServers,
} = require("@mysten/seal");
const bech32 = require("bech32");
const crypto = require("crypto");

// Required environment variables that should be passed from Rust app
const requiredEnvVars = [
  "MOVE_PACKAGE_ID",
  "SUI_SECRET_KEY", 
  "WALRUS_AGGREGATOR_URL",
  "WALRUS_PUBLISHER_URL",
  "WALRUS_EPOCHS",
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

// Environment variables (now passed from Rust app)
const MOVE_PACKAGE_ID = process.env.MOVE_PACKAGE_ID;
const SUI_SECRET_KEY = process.env.SUI_SECRET_KEY;
const WALRUS_AGGREGATOR_URL = process.env.WALRUS_AGGREGATOR_URL;
const WALRUS_PUBLISHER_URL = process.env.WALRUS_PUBLISHER_URL;
const WALRUS_EPOCHS = process.env.WALRUS_EPOCHS;

// Initialize Sui client and Seal client
const suiClient = new SuiClient({ url: getFullnodeUrl("testnet") });
const keyServers = getAllowlistedKeyServers("testnet") || [];
const sealClient = new SealClient({
  suiClient,
  serverObjectIds: keyServers.map((id) => [id, 1]),
  verifyKeyServers: false,
});

// Initialize keypair from secret key
let keypair;
try {
  const decoded = bech32.bech32.decode(SUI_SECRET_KEY);
  if (!decoded) throw new Error("Invalid bech32 private key format");
  const privateKeyBytes = bech32.bech32.fromWords(decoded.words);
  const rawSecretKey = Buffer.from(privateKeyBytes).slice(1);
  keypair = Ed25519Keypair.fromSecretKey(rawSecretKey);
} catch (err) {
  console.error("Failed to initialize keypair:", err);
  process.exit(1);
}

// --- Helper Functions ---

async function fetchEncryptedFile() {
  const walrus_url = `${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`;
  try {
    const res = await fetch(walrus_url, {
      headers: { "Content-Type": "application/octet-stream" },
      method: "GET",
    });
    console.log(`1. Fetching encrypted file from ${walrus_url}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const encryptedFile = await res.arrayBuffer();
    if (!encryptedFile) throw new Error("Empty response from Walrus");
    return encryptedFile;
  } catch (err) {
    throw new Error(`fetchEncryptedFile failed: ${err.message} ${JSON.stringify(err)} ${walrus_url}`);
  }
}

async function registerAttestation(fileObjectId) {
  try {
    const tx = new Transaction();
    tx.setGasBudget(10_000_000);
    tx.setSender(keypair.getPublicKey().toSuiAddress());
    tx.moveCall({
      target: `${MOVE_PACKAGE_ID}::seal_manager::register_tee_attestation`,
      arguments: [
        tx.pure.vector("u8", new TextEncoder().encode(enclaveId)),
        tx.pure.vector("u8", fromHex(fileObjectId)),
        tx.pure.address(address),
      ],
    });

    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      requestType: "WaitForLocalExecution",
      options: { showEffects: true },
    });

    const attestationObjId = result?.effects?.created[0]?.reference?.objectId;
    if (!attestationObjId) throw new Error("No attestation object created");
    console.log(`2. Attestation object created: ${attestationObjId}`);
    return attestationObjId;
  } catch (err) {
    throw new Error(`registerAttestation failed: ${err.message} ${JSON.stringify(err)} ${MOVE_PACKAGE_ID}`);
  }
}

async function decryptFile(fileObjectId, attestationObjId, encryptedFile) {
  try {

    console.log(`3. Decrypting file: fileObjectId: ${fileObjectId} attestationObjId: ${attestationObjId} address: ${address}`);

    const sessionKey = new SessionKey({
      address,
      packageId: MOVE_PACKAGE_ID,
      ttlMin: 10,
      client: suiClient,
    });

    const message = sessionKey.getPersonalMessage();
    console.log(`3.1. Personal message: ${message}`);
    const signature = await keypair.signPersonalMessage(Buffer.from(message));
    console.log(`3.2. Signature: ${signature.signature}`);
    await sessionKey.setPersonalMessageSignature(signature.signature);

    console.log(`4. Initializing transaction: fileObjectId: ${fileObjectId} onChainFileObjId: ${onChainFileObjId} policyObjectId: ${policyObjectId} attestationObjId: ${attestationObjId} address: ${address}`);

    const tx = new Transaction();
    tx.setGasBudget(10_000_000);
    tx.setSender(keypair.getPublicKey().toSuiAddress());
    tx.moveCall({
      target: `${MOVE_PACKAGE_ID}::seal_manager::seal_approve`,
      arguments: [
        tx.pure.vector("u8", fromHex(fileObjectId)),
        tx.object(onChainFileObjId),
        tx.object(policyObjectId),
        tx.object(attestationObjId),
        tx.pure.address(address),
      ],
    });

    console.log(`5. Building transaction`);

    const txBytes = await tx.build({
      client: suiClient,
      onlyTransactionKind: true,
    });

    console.log(`6. TX bytes: ${txBytes}`);

    await sealClient.fetchKeys({
      ids: [fileObjectId],
      txBytes,
      sessionKey,
      threshold: Number(threshold),
    });

    console.log(`7. Fetched keys`);

    const decryptedBytes = await sealClient.decrypt({
      data: new Uint8Array(encryptedFile),
      sessionKey,
      txBytes,
    });

    console.log(`8. Decrypted bytes: ${decryptedBytes}`);

    const decoder = new TextDecoder("utf-8");
    const jsonString = decoder.decode(decryptedBytes);
    console.log(`9. JSON string: ${jsonString}`);
    return JSON.parse(jsonString);
  } catch (err) {
    throw new Error(`decryptFile failed: ${err.message} ${JSON.stringify(err)} ${MOVE_PACKAGE_ID}`);
  }
}

function processData(rawData) {
  const refinedData = {
    revision: rawData.revision,
    user: rawData.user,
    messages: [],
  };

  console.log(`10. Processing data: ${rawData}`);

  if (rawData.chats && Array.isArray(rawData.chats)) {
    rawData.chats.forEach(chat => {
      if (chat.contents && Array.isArray(chat.contents)) {
        chat.contents.forEach(msg => {
          refinedData.messages.push({
            id: msg.id,
            from_id: msg.fromId?.userId || null,
            date: msg.date ? new Date(msg.date * 1000).toISOString() : null,
            edit_date: msg.editDate ? new Date(msg.editDate * 1000).toISOString() : null,
            message: msg.message,
            out: msg.out,
            reactions: msg.reactions
              ? {
                  emoji: msg.reactions.recentReactions?.[0]?.reaction?.emoticon || null,
                  count: msg.reactions.results?.[0]?.count || null,
                }
              : null,
          });
        });
      }
    });
    // Optional: sort by date if you want
    refinedData.messages.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  console.log(`11. Refined data: ${refinedData}`);

  return refinedData;
}

async function encryptFile(refinedData) {
  try {
    console.log(`12. Encrypting file: policyObjectId: ${policyObjectId}`);
    const policyObjectBytes = fromHex(policyObjectId);
    const nonce = crypto.getRandomValues(new Uint8Array(5));
    const id = toHex(new Uint8Array([...policyObjectBytes, ...nonce]));

    console.log(`13. Encrypting file: id: ${id}`);
    const { encryptedObject: encryptedBytes } = await sealClient.encrypt({
      threshold: 2,
      packageId: MOVE_PACKAGE_ID,
      id,
      data: new Uint8Array(new TextEncoder().encode(JSON.stringify(refinedData))),
    });

    console.log(`14. Encrypted bytes: ${encryptedBytes}`);
    return encryptedBytes;
  } catch (err) {
    throw new Error(`encryptFile failed: ${err.message} ${JSON.stringify(err)} ${MOVE_PACKAGE_ID}`);
  }
}

async function publishFile(encryptedData) {
  try {
    const uploadUrl = `${WALRUS_PUBLISHER_URL}/v1/blobs?epochs=${WALRUS_EPOCHS}`;

    console.log(`15. Publishing file: uploadUrl: ${uploadUrl}`);

    const response = await fetch(uploadUrl, {
      method: "PUT",
      body: encryptedData,
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json();
    let blobId;
    if (data.newlyCreated) {
      blobId = data.newlyCreated.blobObject.blobId;
    } else if (data.alreadyCertified) {
      blobId = data.alreadyCertified.blobId;
    } else {
      throw new Error("Invalid response format from Walrus");
    }

    const metadata = {
      walrusUrl: `${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`,
      size: data.newlyCreated?.blobObject?.size || 0,
      storageSize: data.newlyCreated?.blobObject?.storage?.storageSize || 0,
      blobId,
    };

    console.log(`16. Metadata: ${metadata}`);

    return metadata;
  } catch (err) {
    throw new Error(`publishFile failed: ${err.message} ${JSON.stringify(err)} ${uploadUrl}`);
  }
}

async function saveEncryptedFileOnChain(encryptedRefinedData, metadata, policyObjId) {
  try {
    console.log(`17. Saving encrypted file on chain: encryptedRefinedData: ${encryptedRefinedData} metadata: ${metadata} policyObjId: ${policyObjId}`);
    const encryptedData = new Uint8Array(encryptedRefinedData);
    const encryptedObject = EncryptedObject.parse(encryptedData);

    console.log(`18. Building transaction`);
    const tx = new Transaction();
    tx.setGasBudget(10_000_000);
    const metadataBytes = new Uint8Array(
      new TextEncoder().encode(JSON.stringify(metadata))
    );
    tx.moveCall({
      target: `${MOVE_PACKAGE_ID}::seal_manager::save_encrypted_file`,
      arguments: [
        tx.pure.vector("u8", fromHex(encryptedObject.id)),
        tx.object(policyObjId),
        tx.pure.vector("u8", metadataBytes),
      ],
    });

    console.log(`19. Signing and executing transaction`);
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      requestType: "WaitForLocalExecution",
      options: { showEffects: true },
    });

    const objId = result?.effects?.created[0]?.reference?.objectId;
    if (!objId) throw new Error("No on-chain file object created");
    console.log(`20. On-chain file object created: ${objId}`);

    return objId;
  } catch (err) {
    throw new Error(`saveEncryptedFileOnChain failed: ${err.message} ${JSON.stringify(err)}`);
  }
}

// --- Main Task Runner ---
async function runTasks() {
  try {
    const encryptedFile = await fetchEncryptedFile();
    const encryptedData = new Uint8Array(encryptedFile);
    const encryptedObject = EncryptedObject.parse(encryptedData);
    const attestationObjId = await registerAttestation(encryptedObject.id);
    const decryptedFile = await decryptFile(
      encryptedObject.id,
      attestationObjId,
      encryptedFile
    );
    const refinedData = processData(decryptedFile);
    const encryptedRefinedData = await encryptFile(refinedData);
    const metadata = await publishFile(encryptedRefinedData);
    const onChainFileObjId = await saveEncryptedFileOnChain(
      encryptedRefinedData,
      metadata,
      policyObjectId
    );
    console.log(
      JSON.stringify({
        walrusUrl: metadata.walrusUrl,
        attestationObjId,
        onChainFileObjId,
        blobId: metadata.blobId,
      })
    );
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
