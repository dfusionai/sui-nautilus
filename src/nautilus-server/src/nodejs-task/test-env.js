#!/usr/bin/env node

console.log("=== Environment Variables Test ===");

const requiredEnvVars = [
  "MOVE_PACKAGE_ID",
  "SUI_SECRET_KEY", 
  "WALRUS_AGGREGATOR_URL",
  "WALRUS_PUBLISHER_URL",
  "WALRUS_EPOCHS",
];

console.log("🧪 Testing environment variables passed from Rust app:");

let allPresent = true;
for (const key of requiredEnvVars) {
  const value = process.env[key];
  if (value) {
    console.log(`✅ ${key}: ${key.includes('SECRET') ? '***hidden***' : value}`);
  } else {
    console.log(`❌ ${key}: NOT FOUND`);
    allPresent = false;
  }
}

if (allPresent) {
  console.log("✅ All environment variables passed successfully!");
  console.log(JSON.stringify({
    status: "success", 
    message: "Environment variables received from Rust app",
    env_count: requiredEnvVars.length
  }));
} else {
  console.error("❌ Some environment variables missing!");
  process.exit(1);
} 