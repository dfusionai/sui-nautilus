/**
 * Rate limiter utility for controlling concurrent requests
 * Helps prevent 429 (Rate Limit) errors by throttling parallel operations
 * 
 * Note: Walrus aggregator default limits:
 * - max-concurrent-requests: 256 (default)
 * - max-buffer-size: 384 (default)
 * - When both limits are exceeded, requests return HTTP 429
 * 
 * IMPORTANT: Each patch operation makes multiple HTTP requests:
 * - 1 request to Walrus aggregator (fetchEncryptedFile)
 * - Multiple requests to Sui RPC (tx.build in sealApprove, sessionKey.create, etc.)
 * - Requests to Ruby Nodes API (via SealClient)
 * 
 * So if we have 50 concurrent patches, that's 50+ concurrent Sui RPC requests,
 * which can easily hit rate limits. 
 * 
 * With retry logic in place, we can be more aggressive. Default is set to 20
 * to balance speed with rate limit safety. Each patch makes ~3-5 HTTP requests,
 * so 20 concurrent = ~60-100 total concurrent requests, which is safe for
 * most rate limiters.
 */
class RateLimiter {
  constructor(maxConcurrent = 20, delayMs = 25, maxRetries = 3) {
    this.maxConcurrent = maxConcurrent;
    this.delayMs = delayMs;
    this.maxRetries = maxRetries;
    this.running = 0;
    this.queue = [];
  }

  /**
   * Execute a function with rate limiting and retry logic for 429 errors
   * @param {Function} fn - Async function to execute
   * @param {number} retryCount - Current retry attempt (internal use)
   * @returns {Promise} - Result of the function
   */
  async execute(fn, retryCount = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, retryCount });
      this.process();
    });
  }

  /**
   * Check if error is a rate limit error (429)
   */
  isRateLimitError(error) {
    if (!error) return false;
    const message = error.message || error.toString();
    return message.includes('429') || 
           message.includes('Rate Limit') || 
           message.includes('Too Many Requests') ||
           (error.status === 429) ||
           (error.statusCode === 429);
  }

  /**
   * Calculate exponential backoff delay for retries
   */
  getRetryDelay(retryCount) {
    // Exponential backoff: 1s, 2s, 4s, etc.
    return Math.min(1000 * Math.pow(2, retryCount), 10000); // Max 10 seconds
  }

  /**
   * Process the queue of pending operations with retry logic for rate limits
   */
  async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const { fn, resolve, reject, retryCount = 0 } = this.queue.shift();
    let willRetry = false;

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      // Retry on rate limit errors with exponential backoff
      if (this.isRateLimitError(error) && retryCount < this.maxRetries) {
        willRetry = true;
        const delay = this.getRetryDelay(retryCount);
        const logger = require('./logger');
        logger.log(`⚠️  Rate limit error (429), retrying in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})...`);
        
        // Free up the slot before waiting for retry
        this.running--;
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Retry by re-queuing (will be processed when there's capacity)
        this.queue.push({ fn, resolve, reject, retryCount: retryCount + 1 });
        
        // Process next item in queue (retry will be picked up when capacity is available)
        this.process();
        return; // Don't execute finally block logic since we already decremented running
      } else {
        // Max retries exceeded or non-rate-limit error - reject
        reject(error);
      }
    } finally {
      // Only decrement if we didn't already do it for a retry
      if (!willRetry) {
        this.running--;
      }
      
      // Add delay before processing next item to avoid overwhelming the API
      if (this.delayMs > 0 && !willRetry) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs));
      }
      
      // Process next item in queue (skip if we're retrying)
      if (!willRetry) {
        this.process();
      }
    }
  }

  /**
   * Execute multiple functions in parallel with rate limiting
   * @param {Array<Function>} functions - Array of async functions to execute
   * @returns {Promise<Array>} - Array of results (using Promise.allSettled pattern)
   */
  async executeAll(functions) {
    const results = await Promise.allSettled(
      functions.map(fn => this.execute(fn))
    );
    return results;
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }
}

module.exports = RateLimiter;

