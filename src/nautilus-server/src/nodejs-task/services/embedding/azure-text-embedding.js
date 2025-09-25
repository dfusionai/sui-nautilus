const BaseEmbedding = require("./base-embedding");
const { AzureOpenAI } = require("openai");

class AzureTextEmbedding extends BaseEmbedding {
  constructor(options = {}) {
    super(options);

    this.endpoint = process.env.AZURE_TEXT_EMBEDDING_API_ENDPOINT;
    this.apiKey = process.env.AZURE_TEXT_EMBEDDING_API_KEY;
    this.apiVersion = "2024-04-01-preview";
    this.deployment = "text-embedding-3-small"; // modelName

    if (!this.endpoint) {
      throw new Error("AZURE_TEXT_EMBEDDING_API_ENDPOINT environment variable is required");
    }
    if (!this.apiKey) {
      throw new Error("AZURE_TEXT_EMBEDDING_API_KEY environment variable is required");
    }

    this.client = new AzureOpenAI({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      apiVersion: this.apiVersion,
      deployment: this.deployment,
    });

    console.log(`✅ AzureTextEmbedding initialized for deployment: ${this.deployment}`);
  }

  async embedBatch(messages, batchSize = null) {
    if (!Array.isArray(messages)) {
      throw new Error("Messages must be an array");
    }

    const validMessages = messages.filter((msg) => msg && typeof msg === "string" && msg.trim().length > 0);

    if (validMessages.length === 0) {
      console.log("⚠️  No valid messages to embed");
      return [];
    }

    if (validMessages.length !== messages.length) {
      console.log(`⚠️  Filtered out ${messages.length - validMessages.length} invalid messages`);
    }

    const effectiveBatchSize = batchSize || this.options.batchSize;
    const numParallel = 4;
    const timerLabel = `⌚ embedBatch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.time(timerLabel);

    const results = [];

    // Split messages into batches
    const batches = [];
    for (let i = 0; i < validMessages.length; i += effectiveBatchSize) {
      batches.push(validMessages.slice(i, i + effectiveBatchSize));
    }

    // Process batches in chunks of numParallel
    for (let i = 0; i < batches.length; i += numParallel) {
      const chunk = batches.slice(i, i + numParallel);
      console.log(`🔤 Processing batch chunk ${Math.floor(i / numParallel) + 1}/${Math.ceil(batches.length / numParallel)}`);

      const chunkResults = await Promise.all(chunk.map((batch) => this._processBatch(batch)));
      chunkResults.forEach((batchResult) => results.push(...batchResult));

      // Optional small delay between chunks to avoid overwhelming Ollama
      if (i + numParallel < batches.length) await this._delay(50);
    }

    console.log(`✅ Completed batch embedding for ${results.length} messages`);
    console.timeEnd(timerLabel);

    return results;
  }

  async _processBatch(batch) { // batch: string[]
    const operation = async () => {
    const response = await this.client.embeddings.create({
      input: batch,
      model: this.deployment,
      dimensions: 768,
    });

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error(`Invalid or empty response from Azure: ${JSON.stringify(response)}`);
    }

    return batch.map((text, i) => {
      const item = response.data[i];
      if (!item?.embedding) {
        throw new Error(`Missing embedding at index ${i}`);
      }
      return {
        message: text,
        embedding: item.embedding,
        success: true,
        dimensions: item.embedding.length
      };
    });
  };

  return this._retryOperation(operation);
}

  getStats() {
    return {
      ...super.getStats(),
      apiUrl: this.endpoint,
      model: this.deployment,
    };
  }

}

module.exports = AzureTextEmbedding;
