// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

use anyhow::Result;
use axum::{routing::get, routing::post, Router};
use fastcrypto::{ed25519::Ed25519KeyPair, traits::KeyPair};
use nautilus_server::app::process_data;
use nautilus_server::common::{get_attestation, health_check, get_config};
use nautilus_server::AppState;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer, AllowHeaders};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    let eph_kp = Ed25519KeyPair::generate(&mut rand::thread_rng());

    // Load all environment variables required by the application
    // These values are stored in AWS Secrets Manager and injected via configure_enclave.sh
    let move_package_id = std::env::var("MOVE_PACKAGE_ID").expect("MOVE_PACKAGE_ID must be set");
    let sui_secret_key = std::env::var("SUI_SECRET_KEY").expect("SUI_SECRET_KEY must be set");
    let walrus_aggregator_url = std::env::var("WALRUS_AGGREGATOR_URL").expect("WALRUS_AGGREGATOR_URL must be set");
    let walrus_publisher_url = std::env::var("WALRUS_PUBLISHER_URL").expect("WALRUS_PUBLISHER_URL must be set");
    let walrus_epochs = std::env::var("WALRUS_EPOCHS").expect("WALRUS_EPOCHS must be set");

    // Log loaded configuration (without sensitive values)
    info!("Loading Nautilus server configuration:");
    info!("  MOVE_PACKAGE_ID: {}", move_package_id);
    info!("  WALRUS_AGGREGATOR_URL: {}", walrus_aggregator_url);
    info!("  WALRUS_PUBLISHER_URL: {}", walrus_publisher_url);
    info!("  WALRUS_EPOCHS: {}", walrus_epochs);
    info!("  SUI_SECRET_KEY: ****** (hidden)");

    let state = Arc::new(AppState { 
        eph_kp, 
        move_package_id,
        sui_secret_key,
        walrus_aggregator_url,
        walrus_publisher_url,
        walrus_epochs,
    });

    // Validate configuration before starting server
    if let Err(e) = state.validate_config() {
        return Err(anyhow::anyhow!("Configuration validation failed: {}", e));
    }
    info!("✅ Configuration validation passed");

    // Define your own restricted CORS policy here if needed.
    let cors = CorsLayer::new().allow_methods(Any).allow_headers(AllowHeaders::any()).allow_origin(Any);

    let app = Router::new()
        .route("/", get(ping))
        .route("/get_attestation", get(get_attestation))
        .route("/process_data", post(process_data))
        .route("/health_check", get(health_check))
        .route("/config", get(get_config))
        .with_state(state)
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    info!("listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app.into_make_service())
        .await
        .map_err(|e| anyhow::anyhow!("Server error: {}", e))
}

async fn ping() -> &'static str {
    "Pong!"
}
