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

  async fetchEncryptedFile(blobId) {
    const walrusUrl = `${this.aggregatorUrl}/v1/blobs/${blobId}`;
    
    try {
      console.log(`📥 Fetching encrypted file from ${walrusUrl}`);
      
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
      
      console.log(`✅ Successfully fetched encrypted file (${encryptedFile.byteLength} bytes)`);
      return encryptedFile;
    } catch (err) {
      console.error(`❌ Failed to fetch encrypted file: ${err.message}`);
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