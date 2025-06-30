# Node.js Task Runner

This project demonstrates how to execute Node.js tasks from Rust. It consists of:

1. **Node.js Task** (`nodejs-task/`): A simple Node.js application that performs various tasks
2. **Rust Task Runner** (`src/task-runner/`): A Rust application that executes the Node.js task

## Prerequisites

- **Node.js** (v18.0.0 or higher)
- **Rust** (latest stable version)

## Quick Start

### 1. Build the Rust Task Runner

```bash
cargo build --bin task-runner
```

### 2. Run the Node.js Task via Rust

```bash
cargo run --bin task-runner
```

Or with custom options:

```bash
cargo run --bin task-runner -- --task nodejs-task --timeout 60
```

## Node.js Task Details

The Node.js task (`nodejs-task/index.js`) performs three simple operations:

1. **File Operations**: Creates a timestamp file with execution details
2. **API Request**: Fetches data from GitHub's Zen API
3. **Data Processing**: Calculates sum and average of numbers 1-10

### Features:
- ✅ Graceful shutdown handling (SIGINT/SIGTERM)
- ✅ Error handling and proper exit codes
- ✅ Structured logging with emojis
- ✅ Process information output

## Rust Task Runner Details

The Rust task runner (`src/task-runner/src/main.rs`) provides:

### Features:
- 🦀 **Async Execution**: Uses tokio for async Node.js process management
- ⏱️ **Timeout Management**: Configurable execution timeout
- 📝 **Real-time Output**: Live streaming of stdout/stderr
- 🔍 **Validation**: Checks Node.js installation and task directory
- 🛡️ **Error Handling**: Comprehensive error handling with context
- 📊 **Testing**: Includes unit tests for key functionality

### Command Line Options:

```bash
Task Runner 1.0
Executes Node.js tasks from Rust

USAGE:
    task-runner [OPTIONS]

OPTIONS:
    -h, --help              Print help information
    -t, --task <PATH>       Path to the Node.js task directory [default: nodejs-task]
    -T, --timeout <SECONDS> Timeout for task execution in seconds [default: 30]
    -V, --version           Print version information
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Rust Process   │────▶│ Node.js Process │
│                 │     │                 │
│ • Validation    │     │ • File Ops      │
│ • Timeout       │     │ • API Calls     │
│ • Stream Output │     │ • Data Process  │
│ • Error Handle  │     │ • Exit Codes    │
└─────────────────┘     └─────────────────┘
```

## Example Output

```bash
🦀 Rust Task Runner starting...
📂 Task path: nodejs-task
⏱️  Timeout: 30 seconds
🔍 Checking Node.js installation...
✅ Node.js version: v20.10.0
📦 Checking task directory...
✅ Task directory validation passed
🚀 Starting Node.js task...
📝 🚀 Node.js task starting...
📝 📝 Running Task 1: Creating timestamp file...
📝 ✅ Created file: /path/to/nodejs-task/task-output.txt
📝 🌐 Running Task 2: Fetching API data...
📝 ✅ API Response: Design for failure.
📝 🔢 Running Task 3: Processing data...
📝 ✅ Processed data: sum=55, average=5.5
📝 🎉 All tasks completed successfully!
✅ Task completed successfully!
```

## Testing

Run tests for the Rust task runner:

```bash
cargo test --bin task-runner
```

Test the Node.js task directly:

```bash
cd nodejs-task
node index.js
```

## Error Handling

The system includes comprehensive error handling:

- **Node.js not installed**: Clear error message with installation guidance
- **Task directory missing**: Validates directory structure before execution
- **Task timeout**: Configurable timeout with graceful termination
- **Process failures**: Captures and reports exit codes and stderr
- **Invalid arguments**: CLI validation with helpful error messages

## Extending

To add new Node.js tasks:

1. Create a new directory with `package.json` and `index.js`
2. Use the `--task` option to specify the new task directory
3. Ensure proper error handling and exit codes in your Node.js script

The Rust task runner is generic and can execute any Node.js application that follows the expected structure. 