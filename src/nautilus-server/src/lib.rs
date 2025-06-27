// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::Response;
use axum::Json;
use fastcrypto::ed25519::Ed25519KeyPair;
use serde_json::json;

pub mod app;
pub mod common;
pub mod task_runner;

/// App state, at minimum needs to maintain the ephemeral keypair and environment configuration.  
pub struct AppState {
    /// Ephemeral keypair on boot
    pub eph_kp: Ed25519KeyPair,
    
    /// Sui blockchain configuration
    pub move_package_id: String,
    pub sui_secret_key: String,
    
    /// Walrus distributed storage configuration
    pub walrus_aggregator_url: String,
    pub walrus_publisher_url: String,
    pub walrus_epochs: String,
}

impl AppState {
    /// Get Sui Move package ID
    pub fn move_package_id(&self) -> &str {
        &self.move_package_id
    }

    /// Get Sui secret key
    pub fn sui_secret_key(&self) -> &str {
        &self.sui_secret_key
    }

    /// Get Walrus aggregator URL
    pub fn walrus_aggregator_url(&self) -> &str {
        &self.walrus_aggregator_url
    }

    /// Get Walrus publisher URL
    pub fn walrus_publisher_url(&self) -> &str {
        &self.walrus_publisher_url
    }

    /// Get Walrus epochs as string
    pub fn walrus_epochs_str(&self) -> &str {
        &self.walrus_epochs
    }

    /// Get Walrus epochs as number
    pub fn walrus_epochs(&self) -> Result<u32, std::num::ParseIntError> {
        self.walrus_epochs.parse()
    }

    /// Check if all required environment variables are properly configured
    pub fn validate_config(&self) -> Result<(), String> {
        if self.move_package_id.is_empty() {
            return Err("MOVE_PACKAGE_ID is empty".to_string());
        }
        if self.sui_secret_key.is_empty() {
            return Err("SUI_SECRET_KEY is empty".to_string());
        }
        if self.walrus_aggregator_url.is_empty() {
            return Err("WALRUS_AGGREGATOR_URL is empty".to_string());
        }
        if self.walrus_publisher_url.is_empty() {
            return Err("WALRUS_PUBLISHER_URL is empty".to_string());
        }
        if self.walrus_epochs.is_empty() {
            return Err("WALRUS_EPOCHS is empty".to_string());
        }
        
        // Validate that epochs is a valid number
        self.walrus_epochs().map_err(|_| "WALRUS_EPOCHS must be a valid number".to_string())?;
        
        Ok(())
    }
}

/// Implement IntoResponse for EnclaveError.
impl IntoResponse for EnclaveError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            EnclaveError::GenericError(e) => (StatusCode::BAD_REQUEST, e),
        };
        let body = Json(json!({
            "error": error_message,
        }));
        (status, body).into_response()
    }
}

/// Enclave errors enum.
#[derive(Debug)]
pub enum EnclaveError {
    GenericError(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use fastcrypto::{ed25519::Ed25519KeyPair, traits::KeyPair};
    use std::collections::HashMap;
    use crate::task_runner::{NodeTaskRunner, TaskConfig};

    #[tokio::test]
    async fn test_env_vars_passing() {
        // Create AppState with test values
        let state = AppState {
            eph_kp: Ed25519KeyPair::generate(&mut rand::thread_rng()),
            move_package_id: "0x1234567890abcdef".to_string(),
            sui_secret_key: "suiprivkey1qtest".to_string(),
            walrus_aggregator_url: "https://aggregator.walrus-testnet.walrus.space".to_string(),
            walrus_publisher_url: "https://publisher.walrus-testnet.walrus.space".to_string(),
            walrus_epochs: "5".to_string(),
        };

        // Create environment variables map
        let mut env_vars = HashMap::new();
        env_vars.insert("MOVE_PACKAGE_ID".to_string(), state.move_package_id().to_string());
        env_vars.insert("SUI_SECRET_KEY".to_string(), state.sui_secret_key().to_string());
        env_vars.insert("WALRUS_AGGREGATOR_URL".to_string(), state.walrus_aggregator_url().to_string());
        env_vars.insert("WALRUS_PUBLISHER_URL".to_string(), state.walrus_publisher_url().to_string());
        env_vars.insert("WALRUS_EPOCHS".to_string(), state.walrus_epochs_str().to_string());

        // Verify that env vars from AppState are correctly mapped
        assert_eq!(env_vars.get("MOVE_PACKAGE_ID").unwrap(), "0x1234567890abcdef");
        assert_eq!(env_vars.get("SUI_SECRET_KEY").unwrap(), "suiprivkey1qtest");
        assert_eq!(env_vars.get("WALRUS_AGGREGATOR_URL").unwrap(), "https://aggregator.walrus-testnet.walrus.space");
        assert_eq!(env_vars.get("WALRUS_PUBLISHER_URL").unwrap(), "https://publisher.walrus-testnet.walrus.space");
        assert_eq!(env_vars.get("WALRUS_EPOCHS").unwrap(), "5");

        println!("✅ Environment variables correctly mapped from AppState");
        for (key, value) in &env_vars {
            println!("  {}: {}", key, if key.contains("SECRET") { "***hidden***" } else { value });
        }
    }
}
