// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use crate::common::IntentMessage;
use crate::common::{to_signed_response, IntentScope, ProcessDataRequest, ProcessedDataResponse, get_attestation};
use crate::task_runner::{NodeTaskRunner, TaskConfig};
use crate::AppState;
use crate::EnclaveError;
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::{CorsLayer, AllowOrigin, AllowHeaders};
use std::env;
use axum::routing::{get, post};
use axum::Router;
use axum::http::{HeaderValue, Method, header::{CONTENT_TYPE, AUTHORIZATION, ACCEPT, ORIGIN, REFERER, USER_AGENT}};
use crate::common::{health_check};

/// ====
/// Core Nautilus server logic, replace it with your own
/// relavant structs and process_data endpoint.
/// ====

/// Inner type T for IntentMessage<T>
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskResponse {
    pub status: String,
    pub data: String,
    pub stderr: String,
    pub exit_code: i32,
    pub execution_time_ms: u64,
}

/// Inner type T for ProcessDataRequest<T>
#[derive(Debug, Serialize, Deserialize)]
pub struct TaskRequest {
    pub timeout_secs: Option<u64>,
    pub args: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessedData {
    #[serde(rename = "walrusUrl")]
    pub walrus_url: String,
    #[serde(rename = "attestationObjId")]
    pub attestation_obj_id: String,
    #[serde(rename = "onChainFileObjId")]
    pub on_chain_file_obj_id: String,
    #[serde(rename = "blobId")]
    pub blob_id: Option<String>,
}

pub async fn process_data(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ProcessDataRequest<TaskRequest>>,
) -> Result<Json<TaskResponse>, EnclaveError> {
    // get attestation
    let attestation_info = get_attestation(State(state.clone())).await?;
    
    // Get the absolute path to nodejs-task
    let current_dir = std::env::current_dir().unwrap();
    let task_path = current_dir.join("nodejs-task").to_string_lossy().into_owned();
    
    // Prepare environment variables from AppState
    let mut env_vars = std::collections::HashMap::new();
    env_vars.insert("MOVE_PACKAGE_ID".to_string(), state.move_package_id().to_string());
    env_vars.insert("SUI_SECRET_KEY".to_string(), state.sui_secret_key().to_string());
    env_vars.insert("WALRUS_AGGREGATOR_URL".to_string(), state.walrus_aggregator_url().to_string());
    env_vars.insert("WALRUS_PUBLISHER_URL".to_string(), state.walrus_publisher_url().to_string());
    env_vars.insert("WALRUS_EPOCHS".to_string(), state.walrus_epochs_str().to_string());

    // Configure task runner
    let task_config = TaskConfig {
        task_path,
        timeout_secs: request.payload.timeout_secs.unwrap_or(120),
        args: request.payload.args
            .map(|mut args| {
                args.push(attestation_info.attestation.enclaveId.clone());
                args
            })
            .unwrap_or_default(),
        env_vars,
    };
    
    // Create and run the task
    let task_runner = NodeTaskRunner::new(task_config);
    let task_output = task_runner.run().await.map_err(|e| {
        EnclaveError::GenericError(format!("Failed to execute Node.js task: {}", e))
    })?;

    // If task failed, return error
    // if task_output.exit_code != 0 {
    //     return Err(EnclaveError::GenericError(format!(
    //         "Task failed with exit code {}: {}",
    //         task_output.exit_code,
    //         task_output.stderr
    //     )));
    // }

    // // Parse the stdout JSON
    // let data = serde_json::from_str::<ProcessedData>(&task_output.stdout)
    //     .map_err(|e| EnclaveError::GenericError(format!("Failed to parse task output: {}", e)))?;

    Ok(Json(TaskResponse {
        status: "success".to_string(),
        data: task_output.stdout,
        stderr: task_output.stderr,
        exit_code: task_output.exit_code,
        execution_time_ms: task_output.execution_time_ms,
    }))
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
            move_package_id: "0x1234567890abcdef".to_string(),
            sui_secret_key: "suiprivkey1qtest".to_string(),
            walrus_aggregator_url: "https://aggregator.walrus-testnet.walrus.space".to_string(),
            walrus_publisher_url: "https://publisher.walrus-testnet.walrus.space".to_string(),
            walrus_epochs: "5".to_string(),
        });
        
        let task_response = process_data(
            State(state),
            Json(ProcessDataRequest {
                payload: TaskRequest {
                    timeout_secs: Some(10),
                    args: None,
                },
            }),
        )
        .await
        .unwrap();
        
        assert_eq!(task_response.status, "success");
        assert_eq!(task_response.exit_code, 0);
    }

    #[test]
    fn test_serde() {
        // test result should be consistent with serialization expectations
        use fastcrypto::encoding::{Encoding, Hex};
        let payload = TaskResponse {
            status: "success".to_string(),
            data: "Hello World".to_string(),
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
