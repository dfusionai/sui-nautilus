class WalrusOperations {
  constructor(options = {}) {
    this.options = options;
    this.aggregatorUrl = process.env.WALRUS_AGGREGATOR_URL;
    this.publisherUrl = process.env.WALRUS_PUBLISHER_URL;
    this.epochs = process.env.WALRUS_EPOCHS;
    
    if (!this.aggregatorUrl || !this.publisherUrl || !this.epochs) {
      throw new Error('WALRUS_AGGREGATOR_URL, WALRUS_PUBLISHER_URL, and WALRUS_EPOCHS environment variables are required');
    }
  }

  // {
  //   "id": "", -----------------> id for by-quilt-patch-id
  //   "blobId": "",
  //   "blobObject": {
  //     "id": { "id": "" }, ------------> object chain id
  //     "registered_epoch": 155,
  //     "blob_id": "",
  //     "size": "445556",
  //     "encoding_type": 1,
  //     "certified_epoch": null,
  //     "storage": { "id": { "id": "" }, "start_epoch": 155, "end_epoch": 156, "storage_size": "66034000" },
  //     "deletable": true
  //   }
  // }

  async fetchQuiltPatches(quiltId) {
    const walrusUrl = `${this.aggregatorUrl}/v1/quilts/${quiltId}/patches`;
    
    try {
      console.log(`📥 Fetching quilt patches from ${walrusUrl}`);
      
      const res = await fetch(walrusUrl, {
        headers: { "Content-Type": "application/json" },
        method: "GET",
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const patches = await res.json();
      if (!Array.isArray(patches)) {
        throw new Error("Invalid response format: expected array of patches");
      }
      
      console.log(`✅ Successfully fetched ${patches.length} patches from quilt`);
      return patches;
    } catch (err) {
      console.error(`❌ Failed to fetch quilt patches: ${err.message}`);
      throw new Error(`fetchQuiltPatches failed: ${err.message}`);
    }
  }

  async fetchEncryptedFile(quiltPatchId) {
    // This endpoint fetches the blob of a patch using the quilt patch ID
    // The quilt patch ID comes from the "patch_id" field in patches returned by /v1/quilts/{quilt_id}/patches
    // https://github.com/MystenLabs/walrus-sdk-example-app/blob/6db2b791a102dc7f7ffc202ec89f2a14537177e9/src/components/ImageCard.tsx#L31
    const walrusUrl = `${this.aggregatorUrl}/v1/blobs/by-quilt-patch-id/${quiltPatchId}`;
    
    try {
      // Reduced verbosity: only log on success for batch operations
      // Individual fetch attempts are logged at aggregate level in index.js
      
      const res = await fetch(walrusUrl, {
        headers: { "Content-Type": "application/octet-stream" },
        method: "GET",
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const encryptedFile = await res.arrayBuffer();
      if (!encryptedFile) {
        throw new Error("Empty response from Walrus");
      }
      
      // Only log success for single-file operations (not batch)
      // Batch operations will log aggregate results
      return encryptedFile;
    } catch (err) {
      // Don't log individual errors here - let the caller handle aggregate logging
      throw new Error(`fetchEncryptedFile failed: ${err.message}`);
    }
  }



  async publishFile(encryptedData) {
    const uploadUrl = `${this.publisherUrl}/v1/blobs?epochs=${this.epochs}`;
    
    try {
      console.log(`📤 Publishing file to ${uploadUrl}`);
      
      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: encryptedData,
        headers: { "Content-Type": "application/octet-stream" },
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
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
        walrusUrl: `${this.aggregatorUrl}/v1/blobs/${blobId}`,
        size: data.newlyCreated?.blobObject?.size || 0,
        storageSize: data.newlyCreated?.blobObject?.storage?.storageSize || 0,
        blobId,
        publisherUrl: this.publisherUrl,
        aggregatorUrl: this.aggregatorUrl,
        epochs: this.epochs,
        publishedAt: new Date().toISOString()
      };

      console.log(`✅ File published successfully. Blob ID: ${blobId}`);
      return metadata;
    } catch (err) {
      console.error(`❌ Failed to publish file: ${err.message}`);
      throw new Error(`publishFile failed: ${err.message}`);
    }
  }



  async getStorageInfo() {
    try {
      const response = await fetch(`${this.aggregatorUrl}/v1/info`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const info = await response.json();
      return {
        aggregatorUrl: this.aggregatorUrl,
        publisherUrl: this.publisherUrl,
        epochs: this.epochs,
        networkInfo: info
      };
    } catch (err) {
      console.error(`❌ Failed to get storage info: ${err.message}`);
      throw new Error(`getStorageInfo failed: ${err.message}`);
    }
  }

  async healthCheck() {
    try {
      const [aggregatorResponse, publisherResponse] = await Promise.all([
        fetch(`${this.aggregatorUrl}/v1/info`, { method: 'GET' }),
        fetch(`${this.publisherUrl}/v1/info`, { method: 'GET' })
      ]);

      return {
        status: 'healthy',
        aggregator: {
          url: this.aggregatorUrl,
          healthy: aggregatorResponse.ok
        },
        publisher: {
          url: this.publisherUrl,
          healthy: publisherResponse.ok
        },
        epochs: this.epochs
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        aggregatorUrl: this.aggregatorUrl,
        publisherUrl: this.publisherUrl
      };
    }
  }
}

module.exports = WalrusOperations;