# Message Processing Flow

## Overview

The message processing workflow has been updated to ensure better security and efficiency. Instead of storing raw messages in the vector database, each message will be:

1. **Encrypted and uploaded to Walrus** first
2. **Only store vectors and encryptedObjectId** in the vector database

## New Workflow

### 1. Message Processing Pipeline

```
Raw Messages → Embedding → Seal Encryption → Walrus Upload → Vector Storage
```

#### Detailed steps:

1. **Embedding Generation**: Generate vector embedding for message text
2. **Seal Encryption**: Encrypt message using Seal operations (same pattern as main flow)
3. **Walrus Upload**: Upload encrypted message to Walrus, receive blobId
4. **Vector Storage**: Store vector + metadata (including walrus_blob_id) in vector database

### 2. Vector Database Schema

Metadata stored in vector database includes:

```javascript
{
  message_id: "message_id",
  from_id: "user_id", 
  date: "2024-01-01T00:00:00Z",
  walrus_blob_id: "walrus_blob_id", // ID to fetch encrypted message from Walrus
  walrus_url: "https://walrus.example.com/v1/blobs/blob_id",
  out: true/false,
  reactions: [...],
  processed_at: "2024-01-01T00:00:00Z"
}
```

### 3. Message Retrieval

When message content needs to be fetched:

1. **Vector Search**: Search in vector database
2. **Extract blobId**: Get walrus_blob_id from search results
3. **Fetch from Walrus**: Use blobId to fetch encrypted message from Walrus
4. **Parse & Decrypt**: Use Seal operations to parse and decrypt message (same pattern as main flow)

## API Changes

### Updated Methods

#### WalrusOperations
- `publishFile(encryptedData)`: Upload encrypted data to Walrus (used for both files and messages)
- `fetchEncryptedFile(blobId)`: Fetch encrypted data from Walrus (used for both files and messages)

#### processMessagesByMessage()
- Uses `seal.encryptFile()` to encrypt message
- Uses `walrus.publishFile()` to upload encrypted message
- Updated metadata to only store walrus_blob_id instead of raw message
- Implements fail-fast approach - any error stops entire operation

## Usage Examples

### 1. Processing Messages (Current Implementation)

```javascript
// Embedding operation processes messages individually
const result = await processMessagesByMessage(decryptedData.messages, services, args);
```

### 2. Searching and Fetching Messages

```javascript
// Search for similar messages
const searchResults = await vectorDbService.search(queryVector, 10);

// Fetch and decrypt actual message content
const messages = [];
for (const result of searchResults) {
  const blobId = result.metadata?.walrus_blob_id;
  if (blobId) {
    // Fetch encrypted message from Walrus
    const encryptedFile = await walrusService.fetchEncryptedFile(blobId);
    
    // Parse and decrypt message (same pattern as main flow)
    const encryptedObject = sealService.parseEncryptedObject(encryptedFile);
    const messageData = await sealService.decryptFile(
      encryptedObject.id,
      null, // attestationObjId - not needed for individual messages
      encryptedFile,
      address,
      onChainFileObjId,
      policyObjectId,
      threshold,
      suiService
    );
    
    messages.push({
      id: result.id,
      score: result.score,
      message: messageData,
      metadata: result.metadata
    });
  }
}
```

## Benefits

1. **Security**: Raw message content is not stored in vector database
2. **Encryption**: Messages are encrypted using Seal operations (same pattern as main flow)
3. **Consistency**: Uses same encryption/decryption pattern as main flow
4. **Unified API**: Uses `publishFile` and `fetchEncryptedFile` for both files and messages
5. **Privacy**: Messages can only be accessed and decrypted through proper authentication
6. **Scalability**: Vector database only stores lightweight metadata
7. **Simplicity**: Eliminated MessageUtils layer and custom methods, uses unified API
8. **Fail-fast**: Any processing error stops the entire operation, ensuring data consistency

## Error Handling

- If Walrus upload fails, message will not be stored in vector database
- If embedding generation fails, entire operation stops
- If vector storage fails, entire operation stops
- Stats tracking includes `successfulWalrusUploads` and `failedWalrusUploads`
- Fail-fast approach ensures all-or-nothing processing

## Configuration

Related environment variables:

```bash
WALRUS_AGGREGATOR_URL=...
WALRUS_PUBLISHER_URL=...
WALRUS_EPOCHS=...
OLLAMA_API_URL=...
OLLAMA_MODEL=...
QDRANT_URL=...
QDRANT_COLLECTION_NAME=...
``` 