#!/bin/bash
# create-secrets.sh - Helper script to create AWS Secrets Manager secret from .env file
# Copyright (c), Mysten Labs, Inc.
# SPDX-License-Identifier: Apache-2.0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENV_FILE=".env"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

# Show help
show_help() {
    echo -e "${BLUE}create-secrets.sh - Create AWS Secrets Manager secret from .env file${NC}"
    echo ""
    echo "This script reads environment variables from .env file and creates"
    echo "a JSON secret in AWS Secrets Manager containing all the variables."
    echo ""
    echo "Usage:"
    echo "  ./scripts/create-secrets.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help          Show this help message"
    echo "  -f, --file FILE     Specify .env file path (default: .env)"
    echo "  -r, --region REGION AWS region (default: $REGION)"
    echo "  -n, --name NAME     Secret name (required)"
    echo ""
    echo "Example:"
    echo "  ./scripts/create-secrets.sh --name nautilus-env-vars --region us-west-2"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -f|--file)
            ENV_FILE="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -n|--name)
            SECRET_NAME="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Error: Unknown option $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Check if secret name is provided
if [ -z "$SECRET_NAME" ]; then
    echo -e "${RED}Error: Secret name is required${NC}"
    echo "Use --name to specify a secret name"
    exit 1
fi

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}Error: Environment file $ENV_FILE not found${NC}"
    echo "Create one by running: cp env.example .env"
    exit 1
fi

# Required environment variables
REQUIRED_VARS=(
    "API_KEY"
    "MOVE_PACKAGE_ID"
    "SUI_SECRET_KEY"
    "WALRUS_AGGREGATOR_URL"
    "WALRUS_PUBLISHER_URL"
    "WALRUS_EPOCHS"
)

echo -e "${BLUE}🔐 Creating AWS Secrets Manager secret: $SECRET_NAME${NC}"
echo -e "${BLUE}📁 Reading from: $ENV_FILE${NC}"
echo -e "${BLUE}🌍 Region: $REGION${NC}"
echo ""

# Load environment variables
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
    echo -e "${GREEN}✅ Loaded environment variables from $ENV_FILE${NC}"
else
    echo -e "${RED}❌ Environment file $ENV_FILE not found${NC}"
    exit 1
fi

# Validate required variables
echo -e "${YELLOW}🔍 Validating required environment variables...${NC}"
missing_vars=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
        echo -e "${RED}❌ $var is not set${NC}"
    else
        echo -e "${GREEN}✅ $var is set${NC}"
    fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
    echo -e "${RED}❌ Missing required environment variables. Please update your $ENV_FILE file.${NC}"
    exit 1
fi

# Create JSON secret
echo -e "${YELLOW}📦 Creating JSON secret...${NC}"
SECRET_JSON="{"
first=true
for var in "${REQUIRED_VARS[@]}"; do
    value="${!var}"
    if [ "$first" = true ]; then
        first=false
    else
        SECRET_JSON="${SECRET_JSON},"
    fi
    # Escape quotes in values
    escaped_value=$(echo "$value" | sed 's/"/\\"/g')
    SECRET_JSON="${SECRET_JSON}\"$var\":\"$escaped_value\""
done
SECRET_JSON="${SECRET_JSON}}"

echo -e "${BLUE}📋 Secret JSON preview:${NC}"
echo "$SECRET_JSON" | jq '.' 2>/dev/null || echo "$SECRET_JSON"
echo ""

# Confirm creation
read -p "Do you want to create this secret in AWS? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏸️  Secret creation cancelled${NC}"
    exit 0
fi

# Create secret in AWS
echo -e "${YELLOW}🚀 Creating secret in AWS Secrets Manager...${NC}"
SECRET_ARN=$(aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --secret-string "$SECRET_JSON" \
    --region "$REGION" \
    --query 'ARN' \
    --output text 2>&1)

if [ $? -eq 0 ]; then
    echo -e "${GREEN}🎉 Secret created successfully!${NC}"
    echo -e "${BLUE}📋 Secret ARN: $SECRET_ARN${NC}"
    echo ""
    echo -e "${YELLOW}💡 Next steps:${NC}"
    echo "1. Use this ARN when running configure_enclave.sh"
    echo "2. Choose 'existing' when prompted for secret choice"
    echo "3. Provide this ARN: $SECRET_ARN"
else
    echo -e "${RED}❌ Failed to create secret${NC}"
    echo "AWS CLI error: $SECRET_ARN"
    exit 1
fi 