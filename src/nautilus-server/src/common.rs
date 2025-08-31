// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use crate::AppState;
use crate::EnclaveError;
use axum::{extract::State, Json};
use fastcrypto::traits::Signer;
use fastcrypto::{encoding::Encoding, traits::ToFromBytes};
use fastcrypto::{encoding::Hex, traits::KeyPair as FcKeyPair};
use nsm_api::api::{Request as NsmRequest, Response as NsmResponse};
use nsm_api::driver;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;
use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;
use std::collections::HashMap;
use std::fmt::Debug;
use std::sync::Arc;
use std::time::Duration;
use tracing::info;

use fastcrypto::ed25519::Ed25519KeyPair;
/// ==== COMMON TYPES ====

/// Intent message wrapper struct containing the intent scope and timestamp.
/// This standardizes the serialized payload for signing.
#[derive(Debug, Serialize, Deserialize)]
pub struct IntentMessage<T: Serialize> {
    pub intent: IntentScope,
    pub timestamp_ms: u64,
    pub data: T,
}

/// Intent scope enum. Add new scope here if needed, each corresponds to a
/// scope for signing. Replace with your own intent per message type being signed by the enclave.
#[derive(Serialize_repr, Deserialize_repr, Debug)]
#[repr(u8)]
pub enum IntentScope {
    // Add your own intent scopes here
    // Example: DataProcessing = 0,
    Generic = 0,
}

impl<T: Serialize + Debug> IntentMessage<T> {
    pub fn new(data: T, timestamp_ms: u64, intent: IntentScope) -> Self {
        Self {
            data,
            timestamp_ms,
            intent,
        }
    }
}

/// Wrapper struct containing the response (the intent message) and signature.
#[derive(Serialize, Deserialize)]
pub struct ProcessedDataResponse<T> {
    pub response: T,
    pub signature: String,
}

/// Wrapper struct containing the request payload.
#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessDataRequest<T> {
    pub payload: T,
}

/// Sign the bcs bytes of the the payload with keypair.
pub fn to_signed_response<T: Serialize + Clone>(
    kp: &Ed25519KeyPair,
    payload: T,
    timestamp_ms: u64,
    intent: IntentScope,
) -> ProcessedDataResponse<IntentMessage<T>> {
    let intent_msg = IntentMessage {
        intent,
        timestamp_ms,
        data: payload.clone(),
    };

    let signing_payload = bcs::to_bytes(&intent_msg).expect("should not fail");
    let sig = kp.sign(&signing_payload);
    ProcessedDataResponse {
        response: intent_msg,
        signature: Hex::encode(sig),
    }
}

/// ==== HEALTHCHECK, GET ATTESTASTION ENDPOINT IMPL ====

/// Response for get attestation.
#[derive(Debug, Serialize, Deserialize)]
pub struct GetAttestationResponse {
    /// Attestation document serialized in Hex.
    pub attestation: String,
}

pub async fn get_attestation(
    State(state): State<Arc<AppState>>,
) -> Result<Json<GetAttestationResponse>, EnclaveError> {
    info!("get attestation called");

    let pk = state.eph_kp.public();
    let fd = driver::nsm_init();

    // Send attestation request to NSM driver with public key set.
    let request = NsmRequest::Attestation {
        user_data: None,
        nonce: None,
        public_key: Some(ByteBuf::from(pk.as_bytes().to_vec())),
    };

    let response = driver::nsm_process_request(fd, request);
    match response {
        NsmResponse::Attestation { document } => {
            driver::nsm_exit(fd);
            Ok(Json(GetAttestationResponse {
                attestation: Hex::encode(document),
            }))
        }
        _ => {
            driver::nsm_exit(fd);
            Err(EnclaveError::GenericError(
                "unexpected response".to_string(),
            ))
        }
    }

    // let mock_response = GetAttestationResponse {
    //     success: true,
    //     attestation: AttestationInfo {
    //         enclaveId: "i-0a1b2c3d4e5f6g7h8".to_string(),
    //         attestationDocument: "mock-base64-attestation-document".to_string(),
    //     },
    // };

    // Ok(Json(mock_response))
}


/// Health check response.
#[derive(Debug, Serialize, Deserialize)]
pub struct HealthCheckResponse {
    /// Hex encoded public key booted on enclave.
    pub pk: String,
    /// Status of endpoint connectivity checks
    pub endpoints_status: HashMap<String, bool>,
    /// Configuration status
    pub config_status: ConfigStatus,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigStatus {
    /// Whether all required environment variables are loaded
    pub config_valid: bool,
    /// Configuration details (without sensitive data)
    pub config_info: ConfigInfo,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigInfo {
    pub move_package_id: String,
    pub walrus_aggregator_url: String,
    pub walrus_publisher_url: String,
    pub walrus_epochs: String,

    pub sui_secret_key_configured: bool,
    pub internal_encryption_secret_key_configured: bool,
}

/// Endpoint that health checks the enclave connectivity to all
/// domains and returns the enclave's public key.
pub async fn health_check(
    State(state): State<Arc<AppState>>,
) -> Result<Json<HealthCheckResponse>, EnclaveError> {
    let pk = state.eph_kp.public();

    // Create HTTP client with timeout
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| EnclaveError::GenericError(format!("Failed to create HTTP client: {}", e)))?;

    // Load allowed endpoints from YAML file
    let endpoints_status = match std::fs::read_to_string("allowed_endpoints.yaml") {
        Ok(yaml_content) => {
            match serde_yaml::from_str::<serde_yaml::Value>(&yaml_content) {
                Ok(yaml_value) => {
                    let mut status_map = HashMap::new();

                    if let Some(endpoints) =
                        yaml_value.get("endpoints").and_then(|e| e.as_sequence())
                    {
                        for endpoint in endpoints {
                            if let Some(endpoint_str) = endpoint.as_str() {
                                // Check connectivity to each endpoint
                                let url = if endpoint_str.contains(".amazonaws.com") {
                                    format!("https://{}/ping", endpoint_str)
                                } else {
                                    format!("https://{}", endpoint_str)
                                };

                                let is_reachable = match client.get(&url).send().await {
                                    Ok(response) => {
                                        if endpoint_str.contains(".amazonaws.com") {
                                            // For AWS endpoints, check if response body contains "healthy"
                                            match response.text().await {
                                                Ok(body) => body.to_lowercase().contains("healthy"),
                                                Err(e) => {
                                                    info!(
                                                        "Failed to read response body from {}: {}",
                                                        endpoint_str, e
                                                    );
                                                    false
                                                }
                                            }
                                        } else {
                                            // For non-AWS endpoints, check for 200 status
                                            response.status().is_success()
                                        }
                                    }
                                    Err(e) => {
                                        info!("Failed to connect to {}: {}", endpoint_str, e);
                                        false
                                    }
                                };

                                status_map.insert(endpoint_str.to_string(), is_reachable);
                                info!(
                                    "Checked endpoint {}: reachable = {}",
                                    endpoint_str, is_reachable
                                );
                            }
                        }
                    }

                    status_map
                }
                Err(e) => {
                    info!("Failed to parse YAML: {}", e);
                    HashMap::new()
                }
            }
        }
        Err(e) => {
            info!("Failed to read allowed_endpoints.yaml: {}", e);
            HashMap::new()
        }
    };

    // Check configuration status
    let config_valid = state.validate_config().is_ok();
    let config_status = ConfigStatus {
        config_valid,
        config_info: ConfigInfo {
            move_package_id: state.move_package_id().to_string(),
            walrus_aggregator_url: state.walrus_aggregator_url().to_string(),
            walrus_publisher_url: state.walrus_publisher_url().to_string(),
            walrus_epochs: state.walrus_epochs_str().to_string(),
            sui_secret_key_configured: !state.sui_secret_key().is_empty(),
            internal_encryption_secret_key_configured: !state.internal_encryption_secret_key().is_empty(),
        },
    };

    Ok(Json(HealthCheckResponse {
        pk: Hex::encode(pk.as_bytes()),
        endpoints_status,
        config_status,
    }))
}

/// Configuration endpoint response.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigResponse {
    pub config_valid: bool,
    pub config_info: ConfigInfo,
    pub validation_errors: Vec<String>,
}

/// Endpoint to check current configuration (for debugging)
/// Only shows non-sensitive configuration data
pub async fn get_config(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ConfigResponse>, EnclaveError> {
    let validation_result = state.validate_config();
    let validation_errors = match &validation_result {
        Ok(_) => vec![],
        Err(e) => vec![e.clone()],
    };

    let config_response = ConfigResponse {
        config_valid: validation_result.is_ok(),
        config_info: ConfigInfo {
            move_package_id: state.move_package_id().to_string(),
            walrus_aggregator_url: state.walrus_aggregator_url().to_string(),
            walrus_publisher_url: state.walrus_publisher_url().to_string(),
            walrus_epochs: state.walrus_epochs_str().to_string(),
            sui_secret_key_configured: !state.sui_secret_key().is_empty(),
            internal_encryption_secret_key_configured: !state.internal_encryption_secret_key().is_empty(),
        },
        validation_errors,
    };

    Ok(Json(config_response))
}
