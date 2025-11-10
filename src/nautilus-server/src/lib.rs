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
    
    /// Ruby nodes configuration
    pub ruby_nodes_api_key: String,
    
    /// Walrus distributed storage configuration
    pub walrus_aggregator_url: String,
    pub walrus_publisher_url: String,
    pub walrus_epochs: String,
    
    /// Ollama embedding service configuration
    pub ollama_api_url: String,
    pub ollama_model: String,
    
    // Azure open ai embedding configuration
    pub azure_text_embedding_api_endpoint: String,
    pub azure_text_embedding_api_key: String,
    
    /// Qdrant vector database configuration
    pub qdrant_url: String,
    pub qdrant_api_key: Option<String>,
    pub qdrant_collection_name: String,
    
    /// Task processing configuration
    pub embedding_batch_size: String,
    pub vector_batch_size: String,
    
    // Social truth telegram bot configuration
    pub telegram_social_truth_bot_id: String,
    
    // ID mask salt configuration
    pub id_mask_salt: String,
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
    
    /// Get ruby nodes api key
    pub fn ruby_nodes_api_key(&self) -> &str {
        &self.ruby_nodes_api_key
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

    /// Get Ollama API URL
    pub fn ollama_api_url(&self) -> &str {
        &self.ollama_api_url
    }

    /// Get Ollama model
    pub fn ollama_model(&self) -> &str {
        &self.ollama_model
    }
    
    pub fn azure_text_embedding_api_endpoint(&self) -> &str {
        &self.azure_text_embedding_api_endpoint
    }
    
    pub fn azure_text_embedding_api_key(&self) -> &str {
        &self.azure_text_embedding_api_key
    }

    /// Get Qdrant URL
    pub fn qdrant_url(&self) -> &str {
        &self.qdrant_url
    }

    /// Get Qdrant API key
    pub fn qdrant_api_key(&self) -> Option<&str> {
        self.qdrant_api_key.as_deref()
    }

    /// Get Qdrant collection name
    pub fn qdrant_collection_name(&self) -> &str {
        &self.qdrant_collection_name
    }

    /// Get embedding batch size as string
    pub fn embedding_batch_size_str(&self) -> &str {
        &self.embedding_batch_size
    }

    /// Get embedding batch size as number
    pub fn embedding_batch_size(&self) -> Result<u32, std::num::ParseIntError> {
        self.embedding_batch_size.parse()
    }

    /// Get vector batch size as string
    pub fn vector_batch_size_str(&self) -> &str {
        &self.vector_batch_size
    }

    /// Get vector batch size as number
    pub fn vector_batch_size(&self) -> Result<u32, std::num::ParseIntError> {
        self.vector_batch_size.parse()
    }

    pub fn telegram_social_truth_bot_id(&self) -> &str {
        &self.telegram_social_truth_bot_id
    }

    pub fn id_mask_salt(&self) -> &str {
        &self.id_mask_salt
    }

    /// Check if all required environment variables are properly configured
    pub fn validate_config(&self) -> Result<(), String> {
        if self.move_package_id.is_empty() {
            return Err("MOVE_PACKAGE_ID is empty".to_string());
        }
        if self.sui_secret_key.is_empty() {
            return Err("SUI_SECRET_KEY is empty".to_string());
        }
        if self.ruby_nodes_api_key.is_empty() {
            return Err("RUBY_NODES_API_KEY is empty".to_string());
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
        if self.ollama_api_url.is_empty() {
            return Err("OLLAMA_API_URL is empty".to_string());
        }
        if self.ollama_model.is_empty() {
            return Err("OLLAMA_MODEL is empty".to_string());
        }
        if self.azure_text_embedding_api_endpoint.is_empty() {
            return Err("AZURE_TEXT_EMBEDDING_API_ENDPOINT is empty".to_string());
        }
        if self.azure_text_embedding_api_key.is_empty() {
            return Err("AZURE_TEXT_EMBEDDING_API_KEY is empty".to_string());
        }
        if self.qdrant_url.is_empty() {
            return Err("QDRANT_URL is empty".to_string());
        }
        if self.qdrant_collection_name.is_empty() {
            return Err("QDRANT_COLLECTION_NAME is empty".to_string());
        }
        if self.embedding_batch_size.is_empty() {
            return Err("EMBEDDING_BATCH_SIZE is empty".to_string());
        }
        if self.vector_batch_size.is_empty() {
            return Err("VECTOR_BATCH_SIZE is empty".to_string());
        }
        if self.telegram_social_truth_bot_id.is_empty() {
            return Err("TELEGRAM_SOCIAL_TRUTH_BOT_ID is empty".to_string());
        }
        if self.id_mask_salt.is_empty() {
            return Err("ID_MASK_SALT is empty".to_string());
        }
        
        // Validate that numeric values are valid
        self.walrus_epochs().map_err(|_| "WALRUS_EPOCHS must be a valid number".to_string())?;
        self.embedding_batch_size().map_err(|_| "EMBEDDING_BATCH_SIZE must be a valid number".to_string())?;
        self.vector_batch_size().map_err(|_| "VECTOR_BATCH_SIZE must be a valid number".to_string())?;
        
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
            ruby_nodes_api_key: "ABC123".to_string(),
            walrus_aggregator_url: "https://aggregator.walrus-testnet.walrus.space".to_string(),
            walrus_publisher_url: "https://publisher.walrus-testnet.walrus.space".to_string(),
            walrus_epochs: "5".to_string(),
            ollama_api_url: "http://localhost:11434".to_string(),
            ollama_model: "nomic-embed-text".to_string(),
            azure_text_embedding_api_endpoint: "https://example.com".to_string(),
            azure_text_embedding_api_key: "test-key".to_string(),
            qdrant_url: "http://localhost:6333".to_string(),
            qdrant_api_key: None,
            qdrant_collection_name: "messages".to_string(),
            embedding_batch_size: "10".to_string(),
            vector_batch_size: "100".to_string(),
            telegram_social_truth_bot_id: "123456789".to_string(),
            id_mask_salt: "test-salt".to_string(),
        };

        // Create environment variables map
        let mut env_vars = HashMap::new();
        env_vars.insert("MOVE_PACKAGE_ID".to_string(), state.move_package_id().to_string());
        env_vars.insert("SUI_SECRET_KEY".to_string(), state.sui_secret_key().to_string());
        env_vars.insert("RUBY_NODES_API_KEY".to_string(), state.ruby_nodes_api_key().to_string());
        env_vars.insert("WALRUS_AGGREGATOR_URL".to_string(), state.walrus_aggregator_url().to_string());
        env_vars.insert("WALRUS_PUBLISHER_URL".to_string(), state.walrus_publisher_url().to_string());
        env_vars.insert("WALRUS_EPOCHS".to_string(), state.walrus_epochs_str().to_string());

        // Verify that env vars from AppState are correctly mapped
        assert_eq!(env_vars.get("MOVE_PACKAGE_ID").unwrap(), "0x1234567890abcdef");
        assert_eq!(env_vars.get("SUI_SECRET_KEY").unwrap(), "suiprivkey1qtest");
        assert_eq!(env_vars.get("RUBY_NODES_API_KEY").unwrap(), "ABC123");
        assert_eq!(env_vars.get("WALRUS_AGGREGATOR_URL").unwrap(), "https://aggregator.walrus-testnet.walrus.space");
        assert_eq!(env_vars.get("WALRUS_PUBLISHER_URL").unwrap(), "https://publisher.walrus-testnet.walrus.space");
        assert_eq!(env_vars.get("WALRUS_EPOCHS").unwrap(), "5");

        println!("✅ Environment variables correctly mapped from AppState");
        for (key, value) in &env_vars {
            println!("  {}: {}", key, if key.contains("SECRET") { "***hidden***" } else { value });
        }
    }
}
