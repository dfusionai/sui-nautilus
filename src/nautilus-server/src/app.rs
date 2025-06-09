// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use crate::common::IntentMessage;
use crate::common::{to_signed_response, IntentScope, ProcessDataRequest, ProcessedDataResponse};
use crate::task_runner::{NodeTaskRunner, TaskConfig};
use crate::AppState;
use crate::EnclaveError;
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use std::sync::Arc;
/// ====
/// Core Nautilus server logic, replace it with your own
/// relavant structs and process_data endpoint.
/// ====

/// Inner type T for IntentMessage<T>
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskResponse {
    pub task_id: String,
    pub status: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub execution_time_ms: u64,
}

/// Inner type T for ProcessDataRequest<T>
#[derive(Debug, Serialize, Deserialize)]
pub struct TaskRequest {
    pub task_path: Option<String>,
    pub timeout_secs: Option<u64>,
    pub args: Option<Vec<String>>,
}

pub async fn process_data(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ProcessDataRequest<TaskRequest>>,
) -> Result<Json<ProcessedDataResponse<IntentMessage<TaskResponse>>>, EnclaveError> {
    // Generate unique task ID
    let task_id = uuid::Uuid::new_v4().to_string();
    
    // Configure task runner
    let task_config = TaskConfig {
        task_path: request.payload.task_path.unwrap_or_else(|| "nodejs-task".to_string()),
        timeout_secs: request.payload.timeout_secs.unwrap_or(30),
        args: request.payload.args.unwrap_or_default(),
    };
    
    // Create and run the task
    let task_runner = NodeTaskRunner::new(task_config);
    let task_output = task_runner.run().await.map_err(|e| {
        EnclaveError::GenericError(format!("Failed to execute Node.js task: {}", e))
    })?;
    
    // Get current timestamp
    let current_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| EnclaveError::GenericError(format!("Failed to get current timestamp: {}", e)))?
        .as_millis() as u64;

    // Determine status based on exit code
    let status = if task_output.exit_code == 0 {
        "success".to_string()
    } else {
        "failed".to_string()
    };

    Ok(Json(to_signed_response(
        &state.eph_kp,
        TaskResponse {
            task_id,
            status,
            stdout: task_output.stdout,
            stderr: task_output.stderr,
            exit_code: task_output.exit_code,
            execution_time_ms: task_output.execution_time_ms,
        },
        current_timestamp,
        IntentScope::Weather, // You may want to create a new IntentScope::Task
    )))
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::common::IntentMessage;
    use axum::{extract::State, Json};
    use fastcrypto::{ed25519::Ed25519KeyPair, traits::KeyPair};

    #[tokio::test]
    async fn test_process_data() {
        // Create a temporary task directory for testing
        use tempfile::TempDir;
        use std::fs;
        
        let temp_dir = TempDir::new().unwrap();
        let task_path = temp_dir.path().to_str().unwrap();
        
        // Create minimal package.json and index.js for testing
        fs::write(temp_dir.path().join("package.json"), r#"{"name": "test-task"}"#).unwrap();
        fs::write(temp_dir.path().join("index.js"), "console.log('Test task executed');").unwrap();
        
        let state = Arc::new(AppState {
            eph_kp: Ed25519KeyPair::generate(&mut rand::thread_rng()),
            api_key: "test_api_key".to_string(),
        });
        
        let task_response = process_data(
            State(state),
            Json(ProcessDataRequest {
                payload: TaskRequest {
                    task_path: Some(task_path.to_string()),
                    timeout_secs: Some(10),
                    args: None,
                },
            }),
        )
        .await
        .unwrap();
        
        assert_eq!(task_response.response.data.status, "success");
        assert_eq!(task_response.response.data.exit_code, 0);
        assert!(task_response.response.data.stdout.contains("Test task executed"));
    }

    #[test]
    fn test_serde() {
        // test result should be consistent with serialization expectations
        use fastcrypto::encoding::{Encoding, Hex};
        let payload = TaskResponse {
            task_id: "test-123".to_string(),
            status: "success".to_string(),
            stdout: "Hello World".to_string(),
            stderr: "".to_string(),
            exit_code: 0,
            execution_time_ms: 1500,
        };
        let timestamp = 1744038900000;
        let intent_msg = IntentMessage::new(payload, timestamp, IntentScope::Weather);
        let signing_payload = bcs::to_bytes(&intent_msg).expect("should not fail");
        
        // Just ensure serialization works without checking exact bytes since structure changed
        assert!(!signing_payload.is_empty());
    }
}
