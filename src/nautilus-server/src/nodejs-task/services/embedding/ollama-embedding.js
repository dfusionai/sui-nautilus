const BaseEmbedding = require('./base-embedding');
const axios = require('axios');

class OllamaEmbedding extends BaseEmbedding {
  constructor(options = {}) {
    super(options);
    
    this.apiUrl = process.env.OLLAMA_API_URL || 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL || 'nomic-embed-text';
    
    if (!this.apiUrl || !this.model) {
      throw new Error('OLLAMA_API_URL and OLLAMA_MODEL environment variables are required');
    }
  }

  async embedSingle(message) {
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new Error('Message must be a non-empty string');
    }

    const operation = async () => {
      console.log(`🔤 Generating embedding for message: ${message.substring(0, 50)}...`);
      
      const response = await axios.post(
        `${this.apiUrl}/api/embeddings`,
        {
          model: this.model,
          prompt: message.trim()
        },
        {
          timeout: this.options.timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.data || !response.data.embedding) {
        throw new Error(`Invalid response from Ollama API: ${JSON.stringify(response.data)}`);
      }

      const embedding = response.data.embedding;
      console.log(`✅ Successfully generated embedding (${embedding.length} dimensions)`);
      return embedding;
    };

    return this._retryOperation(operation);
  }

  async embedBatch(messages, batchSize = null) {
    if (!Array.isArray(messages)) {
      throw new Error('Messages must be an array');
    }

    const validMessages = messages.filter(msg => 
      msg && typeof msg === 'string' && msg.trim().length > 0
    );

    if (validMessages.length === 0) {
      console.log('⚠️  No valid messages to embed');
      return [];
    }

    if (validMessages.length !== messages.length) {
      console.log(`⚠️  Filtered out ${messages.length - validMessages.length} invalid messages`);
    }

    return super.embedBatch(validMessages, batchSize);
  }

  async _processBatch(batch) {
    const results = [];
    
    for (const message of batch) {
      try {
        const embedding = await this.embedSingle(message);
        results.push({
          message,
          embedding,
          success: true,
          dimensions: embedding.length
        });
      } catch (error) {
        console.error(`❌ Failed to embed message: ${error.message}`);
        results.push({
          message,
          embedding: null,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }

  async healthCheck() {
    try {
      const response = await axios.get(`${this.apiUrl}/api/tags`, {
        timeout: 5000
      });
      
      const modelExists = response.data.models?.some(model => 
        model.name.includes(this.model)
      );
      
      return {
        status: 'healthy',
        apiUrl: this.apiUrl,
        model: this.model,
        modelAvailable: modelExists,
        models: response.data.models?.map(m => m.name) || []
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        apiUrl: this.apiUrl,
        model: this.model,
        error: error.message
      };
    }
  }

  getStats() {
    return {
      ...super.getStats(),
      apiUrl: this.apiUrl,
      model: this.model
    };
  }
}

module.exports = OllamaEmbedding;