# Task Runner Integration with Nautilus Server

This document explains how the Node.js task runner has been integrated into the Nautilus server's `process_data` endpoint.

## Overview

The integration allows the Nautilus server to execute Node.js tasks through its HTTP API, providing a secure and scalable way to run JavaScript/Node.js code within the Nautilus enclave environment.

## Architecture

```
HTTP Request → Nautilus Server → Task Runner → Node.js Process → Response
```

### Components

1. **Nautilus Server** (`src/nautilus-server/`): Main HTTP server with integrated task runner
2. **Task Runner Module** (`src/nautilus-server/src/task_runner.rs`): Handles Node.js process execution
3. **Node.js Tasks** (`nodejs-task/`): Executable Node.js applications
4. **Standalone Task Runner** (`src/task-runner/`): Independent CLI tool (still available)

## Features

### ✅ **Integrated Task Execution**
- Execute Node.js tasks via HTTP API calls
- Real-time output capture (stdout/stderr)
- Configurable timeouts and arguments
- Unique task ID generation for tracking

### ✅ **Security & Reliability**
- Process isolation and cleanup
- Timeout management to prevent hanging
- Error handling and proper exit code reporting
- Input validation and sanitization

### ✅ **Monitoring & Debugging**
- Execution time tracking
- Complete output capture
- Status reporting (success/failed)
- Comprehensive error messages

## Usage

### 1. **HTTP API (Recommended)**

Send a POST request to the `/process_data` endpoint:

```bash
curl -X POST http://localhost:3000/process_data \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {
      "task_path": "nodejs-task",
      "timeout_secs": 30,
      "args": []
    }
  }'
```

**Response:**
```json
{
  "response": {
    "data": {
      "task_id": "123e4567-e89b-12d3-a456-426614174000",
      "status": "success",
      "stdout": "🚀 Node.js task starting...\n✅ Task completed successfully!",
      "stderr": "",
      "exit_code": 0,
      "execution_time_ms": 1250
    },
    "signature": "...",
    "timestamp": 1744038900000
  }
}
```

### 2. **Direct Function Call (Development)**

```rust
use nautilus_server::app::{process_data, TaskRequest};
use nautilus_server::common::ProcessDataRequest;

let request = ProcessDataRequest {
    payload: TaskRequest {
        task_path: Some("nodejs-task".to_string()),
        timeout_secs: Some(30),
        args: None,
    },
};

let response = process_data(State(state), Json(request)).await?;
```

### 3. **Standalone CLI (Original)**

```bash
cargo run --bin task-runner -- --task nodejs-task --timeout 30
```

## Configuration

### Request Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task_path` | string | No | `"nodejs-task"` | Path to the Node.js task directory |
| `timeout_secs` | number | No | `30` | Maximum execution time in seconds |
| `args` | array | No | `[]` | Additional command-line arguments |

### Environment Requirements

- **Node.js** v18.0.0 or higher
- **Rust** latest stable version
- **Task directory** with `package.json` and `index.js`

## Task Development

### Directory Structure

```
your-task/
├── package.json    # Required: Node.js package configuration
└── index.js        # Required: Main executable script
```

### Example Task

**package.json:**
```json
{
  "name": "my-task",
  "version": "1.0.0",
  "main": "index.js",
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**index.js:**
```javascript
#!/usr/bin/env node

console.log('🚀 Task starting...');

// Your business logic here
async function main() {
  try {
    // Perform some work
    const result = await performWork();
    console.log('✅ Result:', result);
    
    // Success exit
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

async function performWork() {
  // Example: API call, data processing, file operations, etc.
  return "Task completed successfully";
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Graceful shutdown...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Graceful shutdown...');
  process.exit(0);
});

main();
```

## Error Handling

### Common Error Scenarios

1. **Task Directory Not Found**
   ```json
   {"error": "Failed to execute Node.js task: Task directory does not exist: /path/to/task"}
   ```

2. **Missing Files**
   ```json
   {"error": "Failed to execute Node.js task: package.json not found in task directory"}
   ```

3. **Execution Timeout**
   ```json
   {"error": "Failed to execute Node.js task: Task execution timed out after 30 seconds"}
   ```

4. **Node.js Not Installed**
   ```json
   {"error": "Failed to execute Node.js task: Failed to check Node.js installation. Is Node.js installed?"}
   ```

### Exit Code Handling

- `exit_code: 0` → `status: "success"`
- `exit_code: != 0` → `status: "failed"`

## Testing

### Unit Tests

```bash
# Test nautilus-server integration
cd src/nautilus-server && cargo test

# Test standalone task runner
cargo test --bin task-runner
```

### Integration Testing

```bash
# Run the demo script
cargo run --example task_runner_demo

# Test with HTTP requests
curl -X POST http://localhost:3000/process_data -H "Content-Type: application/json" -d '{"payload": {}}'
```

## Performance Considerations

### Resource Management
- Each task runs in a separate Node.js process
- Processes are automatically cleaned up after execution
- Memory usage scales with concurrent task execution

### Timeout Settings
- Default: 30 seconds
- Recommended: 10-300 seconds depending on task complexity
- Maximum: Configurable based on requirements

### Concurrent Execution
- Multiple tasks can run simultaneously
- Each task is isolated in its own process
- Resource contention handled by the OS

## Security Considerations

### Process Isolation
- Tasks run in separate Node.js processes
- No direct access to Nautilus server internals
- Stdout/stderr capture prevents information leakage

### Input Validation
- Task path validation prevents directory traversal
- Timeout limits prevent resource exhaustion
- Argument sanitization prevents command injection

### Output Filtering
- All output is captured and returned via API
- Sensitive information should be handled carefully in tasks
- Consider implementing output filtering if needed

## Migration Guide

### From Standalone to Integrated

If you were using the standalone task runner:

**Before:**
```bash
cargo run --bin task-runner --task my-task --timeout 60
```

**After:**
```bash
curl -X POST http://localhost:3000/process_data \
  -H "Content-Type: application/json" \
  -d '{"payload": {"task_path": "my-task", "timeout_secs": 60}}'
```

### Updating Existing Tasks

No changes required! Your existing Node.js tasks will work as-is with the integrated system.

## Troubleshooting

### Common Issues

1. **Node.js not found**
   - Ensure Node.js is installed and in PATH
   - Check version compatibility (>=18.0.0)

2. **Task timeout**
   - Increase timeout value
   - Optimize task performance
   - Check for infinite loops or blocking operations

3. **Permission errors**
   - Ensure task directory is readable
   - Check file permissions on package.json and index.js

### Debug Mode

Enable verbose logging in your tasks:

```javascript
// Add at the top of your index.js
if (process.env.DEBUG) {
  console.log('Debug mode enabled');
  console.log('Process ID:', process.pid);
  console.log('Arguments:', process.argv);
}
```

## Future Enhancements

- [ ] Support for other runtime environments (Python, Ruby, etc.)
- [ ] Advanced task queuing and scheduling
- [ ] Task result caching
- [ ] WebSocket streaming for real-time output
- [ ] Task dependency management
- [ ] Resource usage monitoring and limits 