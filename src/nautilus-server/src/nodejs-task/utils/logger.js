const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logFile = null;
    this.logStream = null;
    this.quietMode = true; // Only write to file by default, not to console
    this.fileLoggingEnabled = false; // File logging disabled
    // Skip file initialization - file logging is disabled
    // this.initialize();
  }
  
  setQuietMode(quiet) {
    this.quietMode = quiet;
  }

  initialize() {
    // File logging is disabled - do nothing
    return;
  }

  writeToFile(message) {
    // File logging is disabled - do nothing
    return;
  }

  log(message, toConsole = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    // Always output structured data markers and JSON to stdout (for Rust process to capture)
    const isStructuredOutput = message.includes('===TASK_RESULT_START===') ||
                                message.includes('===TASK_RESULT_END===') ||
                                message.includes('===SUMMARY_JSON_START===') ||
                                message.includes('===SUMMARY_JSON_END===') ||
                                (message.startsWith('{') && message.endsWith('}') && message.includes('"status"'));
    
    // Write to console only if explicitly requested, not in quiet mode, or is structured output
    if (!this.quietMode || toConsole || isStructuredOutput) {
      console.log(message);
    }
    
    // Always write to file
    this.writeToFile(logMessage);
  }

  error(message, toConsole = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ERROR: ${message}\n`;
    
    // Write to console only if explicitly requested or not in quiet mode
    if (!this.quietMode || toConsole) {
      console.error(message);
    }
    
    // Always write to file
    this.writeToFile(logMessage);
  }

  warn(message, toConsole = false) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] WARN: ${message}\n`;
    
    // Write to console only if explicitly requested or not in quiet mode
    if (!this.quietMode || toConsole) {
      console.warn(message);
    }
    
    // Always write to file
    this.writeToFile(logMessage);
  }
  
  // Force output to console (for summaries and critical messages)
  // DISABLED: No console output to avoid polluting stdout/stderr captured by Rust process
  // Only structured output (TASK_RESULT, SUMMARY_JSON) should go to stdout via log() method
  consoleLog(message) {
    // Console output disabled - do nothing
    this.writeToFile(`[${new Date().toISOString()}] ${message}\n`);
  }
  
  consoleError(message) {
    // Console output disabled - do nothing
    this.writeToFile(`[${new Date().toISOString()}] ERROR: ${message}\n`);
  }
  
  consoleWarn(message) {
    // Console output disabled - do nothing
    this.writeToFile(`[${new Date().toISOString()}] WARN: ${message}\n`);
  }

  getLogFilePath() {
    return null; // File logging is disabled
  }

  close() {
    // File logging is disabled - do nothing
    return;
  }
}

// Create singleton instance
const logger = new Logger();

// Handle process exit to close log file
process.on('exit', () => {
  logger.close();
});

process.on('SIGINT', () => {
  logger.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.close();
  process.exit(0);
});

module.exports = logger;

