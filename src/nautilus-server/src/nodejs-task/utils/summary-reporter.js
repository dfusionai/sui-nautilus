class SummaryReporter {
  constructor() {
    this.stats = {
      startTime: null,
      endTime: null,
      totalPatches: 0, // Patches actually processed
      originalTotalPatches: 0, // Original total patches before selection
      selectedPatches: 0, // Number of patches selected for processing
      successfulFetches: 0,
      failedFetches: 0,
      processedPatches: 0,
      failedProcessing: 0,
      totalMessages: 0,
      successfulEmbeddings: 0,
      successfulVectorStorages: 0,
      errors: [],
      warnings: [],
      errorCounts: {} // Track error frequency
    };
  }

  start() {
    this.stats.startTime = new Date();
  }

  end() {
    this.stats.endTime = new Date();
  }

  recordFetchResults(successful, failed) {
    this.stats.successfulFetches = successful;
    this.stats.failedFetches = failed;
    this.stats.totalPatches = successful + failed;
  }

  recordPatchSelection(originalTotal, selectedCount) {
    this.stats.originalTotalPatches = originalTotal;
    this.stats.selectedPatches = selectedCount;
  }

  recordPatchProcessed(success, messageCount = 0, embeddings = 0, vectors = 0) {
    if (success) {
      this.stats.processedPatches++;
      this.stats.totalMessages += messageCount;
      this.stats.successfulEmbeddings += embeddings;
      this.stats.successfulVectorStorages += vectors;
    } else {
      this.stats.failedProcessing++;
    }
  }

  recordError(message) {
    // Normalize error message for aggregation (extract key error type)
    let errorKey = message;
    
    // Extract HTTP status codes - be more specific to avoid false positives
    // Only match status codes in proper HTTP error contexts
    const httpStatusMatch = message.match(/(?:status code|HTTP|status):\s*(\d{3})|HTTP\s+(\d{3})|(\d{3})\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Timeout|Rate Limit|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)/i);
    if (httpStatusMatch) {
      const statusCode = httpStatusMatch[1] || httpStatusMatch[2] || httpStatusMatch[3];
      const statusNum = parseInt(statusCode);
      
      // Only process valid HTTP status codes (100-599)
      if (statusNum >= 100 && statusNum < 600) {
        // Map common HTTP status codes to readable names
        const statusNames = {
          400: 'Bad Request (400)',
          401: 'Unauthorized (401)',
          403: 'Forbidden (403)',
          404: 'Not Found (404)',
          408: 'Request Timeout (408)',
          429: 'Rate Limit (429)',
          500: 'Internal Server Error (500)',
          502: 'Bad Gateway (502)',
          503: 'Service Unavailable (503)',
          504: 'Gateway Timeout (504)',
        };
        
        if (statusNames[statusNum]) {
          errorKey = `HTTP ${statusNames[statusNum]}`;
        } else if (statusNum >= 400 && statusNum < 500) {
          errorKey = `HTTP Client Error (${statusCode})`;
        } else if (statusNum >= 500 && statusNum < 600) {
          errorKey = `HTTP Server Error (${statusCode})`;
        } else if (statusNum >= 100 && statusNum < 200) {
          // Informational codes - usually not errors, but log them if they appear
          errorKey = `HTTP Informational (${statusCode})`;
        } else {
          // Other codes (200-399) - shouldn't be errors, but handle them
          errorKey = `HTTP Status (${statusCode})`;
        }
      }
    }
    // Extract common error patterns for aggregation
    else if (message.includes('fetch failed') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      errorKey = 'Network/Connection Error';
    } else if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      errorKey = 'Timeout Error';
    } else if (message.includes('sealApprove failed')) {
      errorKey = 'Seal Approval Failed';
    } else if (message.includes('sessionKey.create')) {
      errorKey = 'Session Key Creation Failed';
    } else if (message.includes('decryptFile failed')) {
      // Extract the underlying error from decryptFile
      const match = message.match(/decryptFile failed: (.+)/);
      if (match) {
        const underlyingError = match[1];
        
        // Check for HTTP status in underlying error - be more specific
        const underlyingStatusMatch = underlyingError.match(/(?:status code|HTTP|status):\s*(\d{3})|HTTP\s+(\d{3})/i);
        if (underlyingStatusMatch) {
          const statusCode = underlyingStatusMatch[1] || underlyingStatusMatch[2];
          const statusNum = parseInt(statusCode);
          
          // Only process valid HTTP error status codes (400-599)
          if (statusNum >= 400 && statusNum < 600) {
            const statusNames = {
              429: 'Rate Limit (429)',
              500: 'Internal Server Error (500)',
              502: 'Bad Gateway (502)',
              503: 'Service Unavailable (503)',
              504: 'Gateway Timeout (504)',
            };
            errorKey = `Decryption Failed: HTTP ${statusNames[statusNum] || `Error (${statusCode})`}`;
          }
        } else if (underlyingError.includes('sealApprove')) {
          errorKey = 'Decryption Failed: Seal Approval Error';
        } else if (underlyingError.includes('sessionKey')) {
          errorKey = 'Decryption Failed: Session Key Error';
        } else {
          // Truncate long error messages
          const truncated = underlyingError.length > 60 
            ? underlyingError.substring(0, 60) + '...' 
            : underlyingError;
          errorKey = `Decryption Failed: ${truncated}`;
        }
      }
    } else if (message.includes('Failed to fetch')) {
      errorKey = 'Fetch Operation Failed';
    } else if (message.length > 80) {
      // For very long errors, use first part as key
      errorKey = message.substring(0, 80) + '...';
    }
    
    // Track error frequency
    if (!this.stats.errorCounts[errorKey]) {
      this.stats.errorCounts[errorKey] = 0;
    }
    this.stats.errorCounts[errorKey]++;
    
    // Only store unique error messages (first occurrence of each type)
    if (this.stats.errorCounts[errorKey] === 1) {
      this.stats.errors.push(message);
    }
  }

  recordWarning(message) {
    this.stats.warnings.push(message);
  }

  generateSummary() {
    const duration = this.stats.endTime 
      ? ((this.stats.endTime - this.stats.startTime) / 1000).toFixed(2)
      : 'N/A';
    
    const fetchSuccessRate = this.stats.totalPatches > 0
      ? ((this.stats.successfulFetches / this.stats.totalPatches) * 100).toFixed(1)
      : '0.0';
    
    const processingSuccessRate = this.stats.processedPatches + this.stats.failedProcessing > 0
      ? ((this.stats.processedPatches / (this.stats.processedPatches + this.stats.failedProcessing)) * 100).toFixed(1)
      : '0.0';

    const summary = {
      execution: {
        duration_seconds: duration,
        start_time: this.stats.startTime?.toISOString(),
        end_time: this.stats.endTime?.toISOString()
      },
      patches: {
        original_total: this.stats.originalTotalPatches || this.stats.totalPatches,
        selected_for_processing: this.stats.selectedPatches || this.stats.totalPatches,
        total: this.stats.totalPatches,
        fetched_successfully: this.stats.successfulFetches,
        fetch_failed: this.stats.failedFetches,
        fetch_success_rate_percent: parseFloat(fetchSuccessRate),
        processed_successfully: this.stats.processedPatches,
        processing_failed: this.stats.failedProcessing,
        processing_success_rate_percent: parseFloat(processingSuccessRate)
      },
      messages: {
        total_processed: this.stats.totalMessages,
        successful_embeddings: this.stats.successfulEmbeddings,
        successful_vector_storages: this.stats.successfulVectorStorages
      },
      issues: {
        warnings_count: this.stats.warnings.length,
        errors_count: Object.values(this.stats.errorCounts).reduce((sum, count) => sum + count, 0),
        unique_errors_count: this.stats.errors.length,
        error_breakdown: Object.entries(this.stats.errorCounts)
          .sort((a, b) => b[1] - a[1]) // Sort by frequency
          .slice(0, 10)
          .map(([error, count]) => ({ error, count })),
        warnings: this.stats.warnings.slice(0, 10), // Limit to first 10
        sample_errors: this.stats.errors.slice(0, 10) // Limit to first 10 unique errors
      }
    };

    return summary;
  }

  printSummary(logger) {
    const summary = this.generateSummary();
    
    logger.consoleLog('\n' + '='.repeat(80));
    logger.consoleLog('EXECUTION SUMMARY REPORT');
    logger.consoleLog('='.repeat(80));
    
    logger.consoleLog(`\n⏱️  Execution Time: ${summary.execution.duration_seconds}s`);
    logger.consoleLog(`   Started: ${summary.execution.start_time}`);
    logger.consoleLog(`   Ended: ${summary.execution.end_time}`);
    
    logger.consoleLog(`\n📦 Patch Processing:`);
    if (summary.patches.original_total > summary.patches.selected_for_processing) {
      logger.consoleLog(`   Original Total Patches: ${summary.patches.original_total}`);
      logger.consoleLog(`   Selected for Processing: ${summary.patches.selected_for_processing}`);
      logger.consoleLog(`   Skipped: ${summary.patches.original_total - summary.patches.selected_for_processing}`);
    }
    logger.consoleLog(`   Total Patches Processed: ${summary.patches.total}`);
    logger.consoleLog(`   Fetched Successfully: ${summary.patches.fetched_successfully}`);
    logger.consoleLog(`   Fetch Failed: ${summary.patches.fetch_failed}`);
    logger.consoleLog(`   Fetch Success Rate: ${summary.patches.fetch_success_rate_percent}%`);
    logger.consoleLog(`   Processed Successfully: ${summary.patches.processed_successfully}`);
    logger.consoleLog(`   Processing Failed: ${summary.patches.processing_failed}`);
    logger.consoleLog(`   Processing Success Rate: ${summary.patches.processing_success_rate_percent}%`);
    
    logger.consoleLog(`\n💬 Message Processing:`);
    logger.consoleLog(`   Total Messages: ${summary.messages.total_processed}`);
    logger.consoleLog(`   Successful Embeddings: ${summary.messages.successful_embeddings}`);
    logger.consoleLog(`   Successful Vector Storages: ${summary.messages.successful_vector_storages}`);
    
    if (summary.issues.warnings_count > 0 || summary.issues.errors_count > 0) {
      logger.consoleLog(`\n⚠️  Issues:`);
      logger.consoleLog(`   Warnings: ${summary.issues.warnings_count}`);
      logger.consoleLog(`   Total Errors: ${summary.issues.errors_count} (${summary.issues.unique_errors_count} unique types)`);
      
      if (summary.issues.error_breakdown.length > 0) {
        logger.consoleLog(`\n   Error Breakdown (top ${summary.issues.error_breakdown.length}):`);
        summary.issues.error_breakdown.forEach((item, i) => {
          logger.consoleError(`     ${i + 1}. ${item.error} (occurred ${item.count} time${item.count > 1 ? 's' : ''})`);
        });
      }
      
      if (summary.issues.warnings.length > 0) {
        logger.consoleLog(`\n   Sample Warnings (first ${summary.issues.warnings.length}):`);
        summary.issues.warnings.forEach((w, i) => {
          logger.consoleLog(`     ${i + 1}. ${w}`);
        });
      }
      
      if (summary.issues.sample_errors.length > 0 && summary.issues.error_breakdown.length === 0) {
        logger.consoleLog(`\n   Sample Errors (first ${summary.issues.sample_errors.length}):`);
        summary.issues.sample_errors.forEach((e, i) => {
          logger.consoleError(`     ${i + 1}. ${e}`);
        });
      }
      
      if (summary.issues.errors_count > 10) {
        logger.consoleLog(`\n   Note: Showing aggregated error types. See log file for complete details.`);
      }
    }
    
    logger.consoleLog(`\n📝 Detailed logs saved to: ${logger.getLogFilePath() || 'N/A'}`);
    logger.consoleLog('='.repeat(80) + '\n');
    
    // Also output JSON summary for programmatic access
    logger.consoleLog('===SUMMARY_JSON_START===');
    logger.consoleLog(JSON.stringify(summary, null, 2));
    logger.consoleLog('===SUMMARY_JSON_END===');
    
    return summary;
  }
}

module.exports = SummaryReporter;

