#!/usr/bin/env node
require("dotenv").config();
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

// get body params
const args = process.argv.slice(2);
const [
  address,
  blobId,
  onChainFileObjId,
  policyObjectId,
  threshold,
  enclaveId,
] = args;

//get env variables
const {
  MOVE_PACKAGE_ID,
  SUI_SECRET_KEY,
  WALRUS_AGGREGATOR_URL,
  WALRUS_PUBLISHER_URL,
  WALRUS_EPOCHS,
} = process.env;

// initialize sui client
const suiClient = new SuiClient({ url: getFullnodeUrl("testnet") });
const keyServers = getAllowlistedKeyServers("testnet") || [];
const sealClient = new SealClient({
  suiClient,
  serverObjectIds: keyServers.map((id) => [id, 1]),
  verifyKeyServers: false,
});

// Initialize keypair from secret key
const decoded = bech32.bech32.decode(SUI_SECRET_KEY);
if (!decoded) {
  throw new Error("Invalid bech32 private key format");
}
const privateKeyBytes = bech32.bech32.fromWords(decoded.words);
// Remove the first byte (flag), use only the last 32 bytes
const rawSecretKey = Buffer.from(privateKeyBytes).slice(1);
const keypair = Ed25519Keypair.fromSecretKey(rawSecretKey);

// Fetching encrypted file from Walrus
async function fetchEncryptedFile() {
  const walrus_url = `${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`;
  const encryptedFile = await fetch(walrus_url, {
    headers: { "Content-Type": "application/octet-stream" },
    method: "GET",
  }).then((res) => res.arrayBuffer());

  if (!encryptedFile) {
    throw new Error("Failed to fetch encrypted file");
  }

  return encryptedFile;
}

// register attestation
async function registerAttestation(fileObjectId) {
  const tx = new Transaction();
  tx.setGasBudget(10000000);
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
    options: {
      showEffects: true,
    },
  });

  return result?.effects?.created[0]?.reference?.objectId;
}

async function decryptFile(fileObjectId, attestationObjId, encryptedFile) {
  const sessionKey = new SessionKey({
    address,
    packageId: MOVE_PACKAGE_ID,
    ttlMin: 10, // TTL of 10 minutes
    client: suiClient,
  });

  const message = sessionKey.getPersonalMessage();
  const signature = await keypair.signPersonalMessage(Buffer.from(message));
  await sessionKey.setPersonalMessageSignature(signature.signature);

  const tx = new Transaction();
  tx.setGasBudget(10000000);
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

  const txBytes = await tx.build({
    client: suiClient,
    onlyTransactionKind: true,
  });

  // Fetch keys
  const keys = await sealClient.fetchKeys({
    ids: [fileObjectId],
    txBytes,
    sessionKey,
    threshold: Number(threshold),
  });

  // Step 5: Decrypt the file
  const decryptedBytes = await sealClient.decrypt({
    data: new Uint8Array(encryptedFile),
    sessionKey,
    txBytes,
  });

  const decoder = new TextDecoder("utf-8");
  const jsonString = decoder.decode(decryptedBytes);
  const jsonObject = JSON.parse(jsonString);
  return jsonObject;
}

// Simple task 3: Process some data
function processData(rawData) {
  // Initialize refined structure
  const refinedData = {
    chat_id: rawData.chats[0].chat_id,
    user: rawData.user,
    messages: [],
  };

  // For imputing fromId, assume alternating users
  const users = [rawData.user, rawData.chats[0].chat_id];
  let lastUserIndex = 0;

  // Process each message
  rawData.chats[0].contents.forEach((msg) => {
    // Convert timestamp to ISO 8601
    const date = new Date(msg.date * 1000).toISOString();
    const editDate = msg.editDate
      ? new Date(msg.editDate * 1000).toISOString()
      : null;

    // Impute missing fromId (alternate between users)
    const fromId = msg.fromId ? msg.fromId.userId : users[lastUserIndex];
    lastUserIndex = (lastUserIndex + 1) % 2;

    // Clean message text (basic typo correction)
    let message = msg.message;
    if (message === "listner workign?") {
      message = "listener working?";
    }

    // Simplify reactions
    let reactions = null;
    if (msg.reactions) {
      reactions = {
        emoji: msg.reactions.recentReactions[0].reaction.emoticon,
        count: msg.reactions.results[0].count,
      };
    }

    // Create refined message
    refinedData.messages.push({
      id: msg.id,
      from_id: fromId,
      date: date,
      edit_date: editDate,
      message: message,
      out: msg.out,
      reactions: reactions,
    });
  });

  // Sort messages by date
  refinedData.messages.sort((a, b) => new Date(a.date) - new Date(b.date));

  return refinedData;
}

async function encryptFile(refinedData) {
  const policyObjectBytes = fromHex(policyObjectId);
  const nonce = crypto.getRandomValues(new Uint8Array(5));
  const id = toHex(new Uint8Array([...policyObjectBytes, ...nonce]));
  const { encryptedObject: encryptedBytes } = await sealClient.encrypt({
    threshold: 2,
    packageId: MOVE_PACKAGE_ID,
    id,
    data: new Uint8Array(new TextEncoder().encode(JSON.stringify(refinedData))),
  });

  return encryptedBytes;
}

async function publishFile(encryptedData) {
  const uploadUrl = `${WALRUS_PUBLISHER_URL}/v1/blobs?epochs=${WALRUS_EPOCHS}`;

  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: encryptedData,
    headers: {
      "Content-Type": "application/octet-stream",
    },
  });

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
    blobId: blobId
  };

  // Return the URL to access the blob
  return metadata;
}

async function saveEncryptedFileOnChain(encryptedRefinedData, metadata, policyObjId) {
  const encryptedData = new Uint8Array(encryptedRefinedData);
  const encryptedObject = EncryptedObject.parse(encryptedData);
  const tx = new Transaction();
  tx.setGasBudget(10000000);

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

  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    requestType: "WaitForLocalExecution",
    options: {
      showEffects: true,
    },
  });

  return result?.effects?.created[0]?.reference?.objectId;
}

// Main function to run all tasks
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
      JSON.stringify({ walrusUrl: metadata.walrusUrl, attestationObjId, onChainFileObjId, blobId: metadata.blobId })
    );
    process.exit(0);
  } catch (error) {
    console.error("💥 Task failed:", error.message);
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
