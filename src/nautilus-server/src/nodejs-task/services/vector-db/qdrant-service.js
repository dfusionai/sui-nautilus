const BaseVectorDb = require('./base-vector-db');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { randomUUID } = require('crypto');

class QdrantService extends BaseVectorDb {
  constructor(options = {}) {
    super(options);
    
    this.url = process.env.QDRANT_URL || 'http://localhost:6333';
    this.port = this.url?.startsWith('https://') ? 443 : null;
    this.apiKey = process.env.QDRANT_API_KEY || null;
    this.collectionName = process.env.QDRANT_COLLECTION_NAME || 'messages';

    this.client = new QdrantClient({
      url: this.url,
      port: this.port,
      apiKey: this.apiKey
    });
    
    this.vectorSize = null;
  }

  async connect() {
    try {
      console.log(`🔗 Connecting to Qdrant at ${this.url} (${this.port}) ...`);
      console.log(`🔑 Using API key: ${this.apiKey ? '***provided***' : 'none'}`);
      
      // Use a simpler health check - just try to get collections
      const collections = await this.client.getCollections();
      console.log('✅ Qdrant health check passed');
      
      await this._ensureCollection();
      
      this.connected = true;
      console.log(`✅ Successfully connected to Qdrant collection: ${this.collectionName}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to connect to Qdrant: ${error.message}`);
      this.connected = false;
      throw error;
    }
  }

  async disconnect() {
    try {
      this.connected = false;
      console.log('✅ Disconnected from Qdrant');
      return true;
    } catch (error) {
      console.error(`❌ Error disconnecting from Qdrant: ${error.message}`);
      throw error;
    }
  }

  async store(id, vector, metadata = {}) {
    if (!this.connected) {
      await this.connect();
    }

    if (!Array.isArray(vector)) {
      throw new Error('Vector must be an array');
    }

    if (this.vectorSize === null) {
      this.vectorSize = vector.length;
      // Ensure collection is created now that we know the vector size
      await this._ensureCollection();
    } else if (vector.length !== this.vectorSize) {
      throw new Error(`Vector dimension mismatch. Expected ${this.vectorSize}, got ${vector.length}`);
    }

    const operation = async () => {
      const point = {
        id: randomUUID(),
        vector: vector,
        payload: {
          ingestedAt: new Date().toISOString(),
          ...metadata
        }
      };

      console.log(`Inserting point: ${JSON.stringify(point)}`)

      await this.client.upsert(this.collectionName, {
        wait: true,
        points: [point]
      });

      console.log(`✅ Stored vector ${id} in Qdrant`);
      return { id, success: true };
    };

    return this._retryOperation(operation);
  }

  async _storeBatch(batch) {
    if (!this.connected) {
      await this.connect();
    }

    // Set vector size from first item and ensure collection exists
    if (batch.length > 0 && this.vectorSize === null) {
      const firstVector = batch[0].vector;
      if (firstVector && Array.isArray(firstVector)) {
        this.vectorSize = firstVector.length;
        await this._ensureCollection();
      }
    }

    const operation = async () => {
      const points = batch.map(item => {
        if (!item.id || !item.vector) {
          throw new Error('Each batch item must have id and vector properties');
        }

        if (!Array.isArray(item.vector)) {
          throw new Error(`Vector must be an array, got ${typeof item.vector}`);
        }

        if (this.vectorSize === null) {
          this.vectorSize = item.vector.length;
        } else if (item.vector.length !== this.vectorSize) {
          throw new Error(`Vector dimension mismatch. Expected ${this.vectorSize}, got ${item.vector.length}`);
        }

        // Validate vector values
        for (let i = 0; i < item.vector.length; i++) {
          const val = item.vector[i];
          if (typeof val !== 'number' || !isFinite(val)) {
            throw new Error(`Invalid vector value at index ${i}: ${val} (type: ${typeof val})`);
          }
        }

        return {
          id: randomUUID(),
          vector: item.vector,
          payload: {
            timestamp: new Date().toISOString(),
            original_id: item.id.toString(),
            ...item.metadata || {}
          }
        };
      });

      console.log(`🔍 Upserting ${points.length} points to collection '${this.collectionName}'`);
      console.log(`Inserting points: ${JSON.stringify(points)}`)

      await this.client.upsert(this.collectionName, {
        wait: true,
        points
      });

      console.log(`✅ Stored batch of ${points.length} vectors in Qdrant`);
      return points.map(point => ({ id: point.id, success: true }));
    };

    return this._retryOperation(operation);
  }

  async search(queryVector, limit = 10, filter = null) {
    if (!this.connected) {
      await this.connect();
    }

    if (!Array.isArray(queryVector)) {
      throw new Error('Query vector must be an array');
    }

    const operation = async () => {
      const searchParams = {
        vector: queryVector,
        limit,
        with_payload: true,
        with_vector: false
      };

      if (filter) {
        searchParams.filter = filter;
      }

      const results = await this.client.search(this.collectionName, searchParams);
      
      console.log(`🔍 Found ${results.length} similar vectors`);
      return results.map(result => ({
        id: result.id,
        score: result.score,
        metadata: result.payload
      }));
    };

    return this._retryOperation(operation);
  }

  async deleteById(id) {
    if (!this.connected) {
      await this.connect();
    }

    const operation = async () => {
      await this.client.delete(this.collectionName, {
        wait: true,
        points: [id.toString()]
      });

      console.log(`🗑️  Deleted vector ${id} from Qdrant`);
      return { id, success: true };
    };

    return this._retryOperation(operation);
  }

  async deleteBatch(ids) {
    if (!this.connected) {
      await this.connect();
    }

    const operation = async () => {
      const stringIds = ids.map(id => id.toString());
      
      await this.client.delete(this.collectionName, {
        wait: true,
        points: stringIds
      });

      console.log(`🗑️  Deleted batch of ${ids.length} vectors from Qdrant`);
      return ids.map(id => ({ id, success: true }));
    };

    return this._retryOperation(operation);
  }

  async _ensureCollection() {
    try {
      const collections = await this.client.getCollections();
      const collectionExists = collections.collections.some(
        col => col.name === this.collectionName
      );

      if (!collectionExists) {
        // Only create collection if we know the vector size
        if (this.vectorSize === null) {
          console.log(`⏳ Collection ${this.collectionName} will be created when first vector is stored`);
          return;
        }
        
        console.log(`📦 Creating Qdrant collection: ${this.collectionName} with vector size ${this.vectorSize}`);
        
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.vectorSize,
            distance: 'Cosine'
          }
        });
        
        console.log(`✅ Created Qdrant collection: ${this.collectionName}`);
      } else {
        console.log(`✅ Qdrant collection already exists: ${this.collectionName}`);
        
        // Get collection info to verify vector size matches if we have one set
        if (this.vectorSize !== null) {
          try {
            const collectionInfo = await this.client.getCollection(this.collectionName);
            const existingVectorSize = collectionInfo.config.params.vectors.size;
            
            if (this.vectorSize !== existingVectorSize) {
              throw new Error(`Vector size mismatch: expected ${this.vectorSize}, collection has ${existingVectorSize}`);
            }
          } catch (error) {
            console.warn(`⚠️  Could not verify collection vector size: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error ensuring collection: ${error.message}`);
      throw error;
    }
  }

  async getCollectionInfo() {
    if (!this.connected) {
      await this.connect();
    }

    try {
      const info = await this.client.getCollection(this.collectionName);
      return {
        name: this.collectionName,
        vectorsCount: info.vectors_count,
        indexedVectorsCount: info.indexed_vectors_count,
        pointsCount: info.points_count,
        config: info.config
      };
    } catch (error) {
      console.error(`❌ Error getting collection info: ${error.message}`);
      throw error;
    }
  }

  async healthCheck() {
    try {
      // Use getCollections as health check instead of cluster status
      const collections = await this.client.getCollections();
      const collectionInfo = this.connected ? await this.getCollectionInfo() : null;
      
      return {
        status: 'healthy',
        url: this.url,
        collectionName: this.collectionName,
        connected: this.connected,
        collectionsCount: collections.collections.length,
        collectionInfo
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        url: this.url,
        collectionName: this.collectionName,
        connected: this.connected,
        error: error.message
      };
    }
  }

  getStats() {
    return {
      ...super.getStats(),
      url: this.url,
      collectionName: this.collectionName,
      vectorSize: this.vectorSize
    };
  }
}

module.exports = QdrantService;