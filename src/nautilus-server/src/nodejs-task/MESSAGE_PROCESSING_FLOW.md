# Message Processing Flow

## Overview

Quy trình xử lý message đã được cập nhật để đảm bảo tính bảo mật và hiệu quả hơn. Thay vì lưu raw message vào vector database, mỗi message sẽ được:

1. **Encrypt và upload lên Walrus** trước
2. **Chỉ lưu vector và encryptedObjectId** vào vector database

## Quy trình mới

### 1. Message Processing Pipeline

```
Raw Messages → Embedding → Seal Encryption → Walrus Upload → Vector Storage
```

#### Chi tiết từng bước:

1. **Embedding Generation**: Tạo vector embedding cho message text
2. **Seal Encryption**: Mã hóa message sử dụng Seal operations (cùng pattern với main flow)
3. **Walrus Upload**: Upload encrypted message lên Walrus, nhận về blobId
4. **Vector Storage**: Lưu vector + metadata (bao gồm walrus_blob_id) vào vector database

### 2. Vector Database Schema

Metadata được lưu trong vector database bao gồm:

```javascript
{
  message_id: "message_id",
  from_id: "user_id", 
  date: "2024-01-01T00:00:00Z",
  walrus_blob_id: "walrus_blob_id", // ID để fetch encrypted message từ Walrus
  walrus_url: "https://walrus.example.com/v1/blobs/blob_id",
  out: true/false,
  reactions: [...],
  processed_at: "2024-01-01T00:00:00Z"
}
```

### 3. Message Retrieval

Khi cần fetch message content:

1. **Vector Search**: Tìm kiếm trong vector database
2. **Extract blobId**: Lấy walrus_blob_id từ search results
3. **Fetch from Walrus**: Sử dụng blobId để fetch encrypted message từ Walrus
4. **Parse & Decrypt**: Sử dụng Seal operations để parse và decrypt message (cùng pattern với main flow)

## API Changes

### Updated Methods

#### WalrusOperations
- `publishFile(encryptedData)`: Upload encrypted data lên Walrus (được sử dụng cho cả file và message)
- `fetchEncryptedFile(blobId)`: Fetch encrypted data từ Walrus (được sử dụng cho cả file và message)

#### processMessagesDirectly()
- Thêm parameters `sealService` và `policyObjectId`
- Sử dụng `seal.encryptFile()` để mã hóa message
- Sử dụng `walrus.publishFile()` để upload encrypted message
- Cập nhật metadata để chỉ lưu walrus_blob_id thay vì raw message

## Usage Examples

### 1. Processing Messages

```javascript
const processedData = await processMessagesDirectly(
  refinedData.messages, 
  services.embedding, 
  services.vectorDb,
  services.blockchain.walrus,
  services.blockchain.seal,
  policyObjectId
);
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

1. **Security**: Raw message content không được lưu trong vector database
2. **Encryption**: Message được mã hóa bằng Seal operations (cùng pattern với main flow)
3. **Consistency**: Sử dụng cùng encryption/decryption pattern như main flow
4. **Unified API**: Sử dụng `publishFile` và `fetchEncryptedFile` cho cả file và message
5. **Privacy**: Message chỉ có thể truy cập và decrypt thông qua proper authentication
6. **Scalability**: Vector database chỉ lưu metadata nhẹ
7. **Simplicity**: Loại bỏ MessageUtils layer và custom methods, sử dụng unified API

## Error Handling

- Nếu Walrus upload fail, message sẽ không được lưu vào vector database
- Stats tracking bao gồm `successfulWalrusUploads` và `failedWalrusUploads`
- Graceful degradation khi Walrus service unavailable

## Configuration

Các environment variables liên quan:

```bash
WALRUS_AGGREGATOR_URL=...
WALRUS_PUBLISHER_URL=...
WALRUS_EPOCHS=...
STORE_VECTORS=true/false
INCLUDE_EMBEDDINGS=true/false
PROCESSING_BATCH_SIZE=50
``` 