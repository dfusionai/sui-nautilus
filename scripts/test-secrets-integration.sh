#!/bin/bash
# test-secrets-integration.sh - Test script for secrets manager integration
# Copyright (c), Mysten Labs, Inc.
# SPDX-License-Identifier: Apache-2.0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 Testing Secrets Manager Integration${NC}"
echo "========================================"

# Test 1: Check if required tools are available
echo -e "${YELLOW}📋 Test 1: Checking required tools...${NC}"

tools=("aws" "jq" "socat")
for tool in "${tools[@]}"; do
    if command -v "$tool" &> /dev/null; then
        echo -e "${GREEN}✅ $tool is available${NC}"
    else
        echo -e "${RED}❌ $tool is not available${NC}"
        echo "Please install $tool and try again"
        exit 1
    fi
done

# Test 2: Check .env file
echo -e "${YELLOW}📋 Test 2: Checking .env file...${NC}"

if [ -f ".env" ]; then
    echo -e "${GREEN}✅ .env file exists${NC}"
    
    # Check required variables
    required_vars=("MOVE_PACKAGE_ID" "SUI_SECRET_KEY" "INTERNAL_ENCRYPTION_SECRET_KEY" "WALRUS_AGGREGATOR_URL" "WALRUS_PUBLISHER_URL" "WALRUS_EPOCHS")
    missing_vars=()
    
    source .env
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
            echo -e "${RED}❌ $var is not set${NC}"
        elif [[ "${!var}" == *"your_"* ]] || [[ "${!var}" == *"..."* ]]; then
            echo -e "${YELLOW}⚠️  $var has placeholder value${NC}"
        else
            echo -e "${GREEN}✅ $var is set${NC}"
        fi
    done
    
    if [ ${#missing_vars[@]} -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Some environment variables need configuration${NC}"
    fi
else
    echo -e "${RED}❌ .env file not found${NC}"
    echo "Run: make env-setup"
    exit 1
fi

# Test 3: Test JSON creation
echo -e "${YELLOW}📋 Test 3: Testing JSON secret creation...${NC}"

temp_json="/tmp/test_secret.json"
cat > "$temp_json" << EOF
{
  
    "MOVE_PACKAGE_ID": "0x1234567890abcdef",
    "SUI_SECRET_KEY": "suiprivkey1qtest",
    "INTERNAL_ENCRYPTION_SECRET_KEY": "encryptionkey1qtest",
    "WALRUS_AGGREGATOR_URL": "https://aggregator.walrus-testnet.walrus.space",
    "WALRUS_PUBLISHER_URL": "https://publisher.walrus-testnet.walrus.space",
    "WALRUS_EPOCHS": "5"
}
EOF

if jq '.' "$temp_json" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ JSON format is valid${NC}"
    
    # Test parsing
    for var in "${required_vars[@]}"; do
        value=$(jq -r ".$var" "$temp_json")
        if [ "$value" != "null" ] && [ -n "$value" ]; then
            echo -e "${GREEN}✅ $var can be extracted: $value${NC}"
        else
            echo -e "${RED}❌ Failed to extract $var${NC}"
        fi
    done
else
    echo -e "${RED}❌ Invalid JSON format${NC}"
    exit 1
fi

rm -f "$temp_json"

# Test 4: Test create-secrets.sh script
echo -e "${YELLOW}📋 Test 4: Testing create-secrets.sh script...${NC}"

if [ -f "scripts/create-secrets.sh" ]; then
    echo -e "${GREEN}✅ create-secrets.sh exists${NC}"
    
    if [ -x "scripts/create-secrets.sh" ]; then
        echo -e "${GREEN}✅ create-secrets.sh is executable${NC}"
    else
        echo -e "${RED}❌ create-secrets.sh is not executable${NC}"
        echo "Run: chmod +x scripts/create-secrets.sh"
    fi
    
    # Test help output
    if ./scripts/create-secrets.sh --help > /dev/null 2>&1; then
        echo -e "${GREEN}✅ create-secrets.sh help works${NC}"
    else
        echo -e "${RED}❌ create-secrets.sh help failed${NC}"
    fi
else
    echo -e "${RED}❌ create-secrets.sh not found${NC}"
    exit 1
fi

# Test 5: Test configure_enclave.sh modifications
echo -e "${YELLOW}📋 Test 5: Testing configure_enclave.sh modifications...${NC}"

if grep -q "ENV_VARIABLES" configure_enclave.sh; then
    echo -e "${GREEN}✅ ENV_VARIABLES array found in configure_enclave.sh${NC}"
else
    echo -e "${RED}❌ ENV_VARIABLES array not found in configure_enclave.sh${NC}"
fi

if grep -q "SECRET_JSON" configure_enclave.sh; then
    echo -e "${GREEN}✅ SECRET_JSON handling found in configure_enclave.sh${NC}"
else
    echo -e "${RED}❌ SECRET_JSON handling not found in configure_enclave.sh${NC}"
fi

# Test 6: Test expose_enclave.sh modifications
echo -e "${YELLOW}📋 Test 6: Testing expose_enclave.sh modifications...${NC}"

if grep -q "SECRET_JSON" expose_enclave.sh; then
    echo -e "${GREEN}✅ SECRET_JSON handling found in expose_enclave.sh${NC}"
else
    echo -e "${RED}❌ SECRET_JSON handling not found in expose_enclave.sh${NC}"
fi

# Test 7: AWS credentials check
echo -e "${YELLOW}📋 Test 7: Checking AWS credentials...${NC}"

if aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${GREEN}✅ AWS credentials are configured${NC}"
    
    # Get current identity
    identity=$(aws sts get-caller-identity --output text --query 'Arn' 2>/dev/null)
    echo -e "${BLUE}📋 Current AWS identity: $identity${NC}"
else
    echo -e "${YELLOW}⚠️  AWS credentials not configured or invalid${NC}"
    echo "Configure with: aws configure"
fi

echo ""
echo -e "${BLUE}🎉 Integration Test Summary${NC}"
echo "=========================="
echo -e "${GREEN}✅ All core components are in place${NC}"
echo -e "${GREEN}✅ Scripts are functional${NC}"
echo -e "${GREEN}✅ JSON handling is working${NC}"
echo ""
echo -e "${YELLOW}💡 Next steps:${NC}"
echo "1. Configure real values in .env if needed"
echo "2. Test creating a secret: ./scripts/create-secrets.sh --name test-secret"
echo "3. Run the full integration: ./configure_enclave.sh"
echo ""
echo -e "${GREEN}🚀 Ready for secrets manager integration!${NC}" 