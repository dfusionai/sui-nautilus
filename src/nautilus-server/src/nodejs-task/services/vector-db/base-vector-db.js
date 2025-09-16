class BaseVectorDb {
  constructor(options = {}) {
    this.options = {
      batchSize: options.batchSize || 500,
      maxRetries: options.maxRetries || 3,
      timeout: options.timeout || (1000 * 60 * 3),
      ...options
    };
    this.connected = false;
  }

  async connect() {
    throw new Error('connect method must be implemented by subclass');
  }

  async disconnect() {
    throw new Error('disconnect method must be implemented by subclass');
  }

  async store(id, vector, metadata = {}) {
    throw new Error('store method must be implemented by subclass');
  }

  async storeBatch(vectors) {
    const batchSize = this.options.batchSize;
    const results = [];
    
    console.log(`📊 Starting batch storage for ${vectors.length} vectors (batch size: ${batchSize})`);
    
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      console.log(`📊 Storing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)}`);
      
      const batchResults = await this._storeBatch(batch);
      results.push(...batchResults);
      
      if (i + batchSize < vectors.length) {
        await this._delay(100);
      }
    }
    
    console.log(`✅ Completed batch storage for ${results.length} vectors`);
    return results;
  }

  async _storeBatch(batch) {
    throw new Error('_storeBatch method must be implemented by subclass');
  }

  async search(queryVector, limit = 10, filter = null) {
    throw new Error('search method must be implemented by subclass');
  }

  async deleteById(id) {
    throw new Error('deleteById method must be implemented by subclass');
  }

  async deleteBatch(ids) {
    throw new Error('deleteBatch method must be implemented by subclass');
  }

  async _retryOperation(operation, maxRetries = null) {
    const retries = maxRetries || this.options.maxRetries;
    let lastError;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt + 1} failed: ${error.message}`);
        if (error.response) {
          console.error(`   Response status: ${error.response.status}`);
          console.error(`   Response data:`, error.response.data);
        }
        if (error.request) {
          console.error(`   Request details:`, error.request);
        }
        
        if (attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`⚠️  Retrying in ${delay}ms...`);
          await this._delay(delay);
        }
      }
    }
    
    throw lastError;
  }

  async _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isConnected() {
    return this.connected;
  }

  getStats() {
    return {
      batchSize: this.options.batchSize,
      maxRetries: this.options.maxRetries,
      timeout: this.options.timeout,
      connected: this.connected
    };
  }
}

module.exports = BaseVectorDb;