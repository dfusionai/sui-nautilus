#!/bin/bash
# env-helper.sh - Environment Variables Helper for Nautilus

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ENV_FILE=".env"
EXAMPLE_FILE="env.example"

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  Nautilus Environment Variables Helper${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

check_requirements() {
    echo -e "${YELLOW}🔍 Checking requirements...${NC}"
    
    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}❌ jq is required but not installed${NC}"
        echo "Install it with: sudo apt-get install jq (Ubuntu) or brew install jq (macOS)"
        exit 1
    fi
    
    # Check if socat is available  
    if ! command -v socat &> /dev/null; then
        echo -e "${YELLOW}⚠️  socat not found (needed for sending env to enclave)${NC}"
        echo "Install it with: sudo apt-get install socat (Ubuntu) or brew install socat (macOS)"
    fi
    
    echo -e "${GREEN}✅ Requirements checked${NC}"
    echo ""
}

create_env_file() {
    echo -e "${YELLOW}📝 Creating environment file...${NC}"
    
    if [ -f "$ENV_FILE" ]; then
        echo -e "${YELLOW}⚠️  $ENV_FILE already exists${NC}"
        read -p "Do you want to overwrite it? (y/N): " confirm
        if [[ $confirm != [yY] ]]; then
            echo "Aborted."
            exit 0
        fi
    fi
    
    if [ ! -f "$EXAMPLE_FILE" ]; then
        echo -e "${RED}❌ $EXAMPLE_FILE not found${NC}"
        exit 1
    fi
    
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    echo -e "${GREEN}✅ Created $ENV_FILE from template${NC}"
    echo ""
    echo -e "${BLUE}📋 Please edit the following variables:${NC}"
    
    # Show variables that need to be configured
    grep -E '^[A-Z_]+=' "$ENV_FILE" | while IFS='=' read -r key value; do
        if [[ $value == *"your_"* ]] || [[ $value == *"..."* ]]; then
            echo -e "  ${YELLOW}⚠️  $key${NC} = $value"
        else
            echo -e "  ${GREEN}✅ $key${NC} = $value"
        fi
    done
    echo ""
}

validate_env() {
    echo -e "${YELLOW}🔍 Validating environment variables...${NC}"
    
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${RED}❌ $ENV_FILE not found${NC}"
        echo "Run: $0 setup"
        exit 1
    fi
    
    # Required variables for Node.js task
    required_vars=(
        
        "MOVE_PACKAGE_ID" 
        "SUI_SECRET_KEY"
        "INTERNAL_ENCRYPTION_SECRET_KEY"
        "WALRUS_AGGREGATOR_URL"
        "WALRUS_PUBLISHER_URL"
        "WALRUS_EPOCHS"
    )
    
    all_good=true
    
    for var in "${required_vars[@]}"; do
        value=$(grep "^$var=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- || echo "")
        
        if [ -z "$value" ]; then
            echo -e "${RED}❌ $var is not set${NC}"
            all_good=false
        elif [[ $value == *"your_"* ]] || [[ $value == *"..."* ]]; then
            echo -e "${YELLOW}⚠️  $var needs to be configured${NC}"
            all_good=false  
        else
            echo -e "${GREEN}✅ $var is set${NC}"
        fi
    done
    
    if $all_good; then
        echo -e "${GREEN}🎉 All environment variables are properly configured!${NC}"
    else
        echo -e "${YELLOW}📝 Edit $ENV_FILE to configure missing variables${NC}"
        exit 1
    fi
    echo ""
}

test_env_locally() {
    echo -e "${YELLOW}🧪 Testing environment variables locally...${NC}"
    
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${RED}❌ $ENV_FILE not found${NC}"
        exit 1
    fi
    
    # Load environment
    set -a
    source "$ENV_FILE"
    set +a
    
    echo -e "${BLUE}📋 Loaded variables:${NC}"

    echo "  MOVE_PACKAGE_ID: ${MOVE_PACKAGE_ID:0:20}***"
    echo "  SUI_SECRET_KEY: ${SUI_SECRET_KEY:0:15}***"
    echo "  INTERNAL_ENCRYPTION_SECRET_KEY: ${INTERNAL_ENCRYPTION_SECRET_KEY:0:8}***"
    echo "  WALRUS_AGGREGATOR_URL: $WALRUS_AGGREGATOR_URL"
    echo "  WALRUS_PUBLISHER_URL: $WALRUS_PUBLISHER_URL"
    echo "  WALRUS_EPOCHS: $WALRUS_EPOCHS"
    echo ""
    
    echo -e "${GREEN}✅ Environment test completed${NC}"
    echo -e "${BLUE}💡 You can now run: make run-with-env${NC}"
}

send_to_enclave() {
    echo -e "${YELLOW}📤 Sending environment variables to enclave...${NC}"
    
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${RED}❌ $ENV_FILE not found${NC}"
        exit 1
    fi
    
    # Check if enclave is running
    if ! sudo nitro-cli describe-enclaves | jq -e '.[] | select(.State == "RUNNING")' &>/dev/null; then
        echo -e "${RED}❌ No running enclave found${NC}"
        echo "Start enclave first with: make run"
        exit 1
    fi
    
    ENCLAVE_ID=$(sudo nitro-cli describe-enclaves | jq -r '.[] | select(.State == "RUNNING") | .EnclaveID' | head -1)
    echo -e "${BLUE}🎯 Target enclave: $ENCLAVE_ID${NC}"
    
    # Convert env file to JSON
    echo "{"
    first=true
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        if [[ $key =~ ^[[:space:]]*# ]] || [ -z "$key" ]; then
            continue
        fi
        
        if [ "$first" = false ]; then
            echo ","
        fi
        echo -n "  \"$key\": \"$value\""
        first=false
    done < <(grep -v '^#' "$ENV_FILE" | grep -v '^$')
    echo ""
    echo "}"
    
    echo -e "${GREEN}✅ Environment variables prepared for enclave${NC}"
}

show_status() {
    echo -e "${YELLOW}📊 Environment Status${NC}"
    echo ""
    
    if [ -f "$ENV_FILE" ]; then
        echo -e "${GREEN}✅ Environment file exists: $ENV_FILE${NC}"
        validate_env
    else
        echo -e "${RED}❌ Environment file not found: $ENV_FILE${NC}"
        echo -e "${BLUE}💡 Run: $0 setup${NC}"
    fi
    
    echo -e "${YELLOW}🔍 Enclave Status:${NC}"
    if sudo nitro-cli describe-enclaves | jq -e '.[] | select(.State == "RUNNING")' &>/dev/null; then
        ENCLAVE_ID=$(sudo nitro-cli describe-enclaves | jq -r '.[] | select(.State == "RUNNING") | .EnclaveID' | head -1)
        echo -e "${GREEN}✅ Enclave running: $ENCLAVE_ID${NC}"
    else
        echo -e "${YELLOW}⚠️  No running enclave found${NC}"
    fi
}

show_help() {
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  setup      Create .env file from template"
    echo "  validate   Check if all required variables are set"  
    echo "  test       Test environment variables locally"
    echo "  send       Send environment variables to running enclave"
    echo "  status     Show current environment and enclave status"
    echo "  help       Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 setup                 # Create .env file"
    echo "  $0 validate              # Check configuration"
    echo "  $0 test                  # Test locally"
    echo "  $0 send                  # Send to enclave"
}

main() {
    print_header
    
    case "${1:-help}" in
        "setup")
            check_requirements
            create_env_file
            ;;
        "validate")
            validate_env
            ;;
        "test")
            check_requirements
            test_env_locally
            ;;
        "send")
            check_requirements
            send_to_enclave
            ;;
        "status")
            show_status
            ;;
        "help"|"--help"|"-h")
            show_help
            ;;
        *)
            echo -e "${RED}❌ Unknown command: $1${NC}"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@" 