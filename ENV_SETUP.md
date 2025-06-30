# 🔧 Environment Variables Setup Guide

Hướng dẫn cấu hình environment variables cho Nautilus server khi chạy trong Nitro enclave.

## 📋 Overview

Nautilus server cần các environment variables để hoạt động:

### **Core Environment Variables:**
- `API_KEY` - Khóa API để xác thực
- `MOVE_PACKAGE_ID` - ID của Sui Move package 
- `SUI_SECRET_KEY` - Private key cho Sui blockchain
- `WALRUS_AGGREGATOR_URL` - URL của Walrus aggregator
- `WALRUS_PUBLISHER_URL` - URL của Walrus publisher
- `WALRUS_EPOCHS` - Số epochs cho Walrus

### **Optional Variables:**
- `DEBUG` - Enable debug logging (default: false)

## 🚀 Quick Start

### **1. Setup Environment File**
```bash
make env-setup
# hoặc
./scripts/env-helper.sh setup
```

### **2. Edit Configuration**
```bash
nano .env
```

Điền các giá trị thực của bạn:
```bash
API_KEY=your_actual_api_key_here
MOVE_PACKAGE_ID=0x1234567890abcdef...
SUI_SECRET_KEY=suiprivkey1q...
WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
WALRUS_EPOCHS=5
```

### **3. Validate Configuration**
```bash
make check-env
# hoặc
./scripts/env-helper.sh validate
```

### **4. Run Enclave with Environment**
```bash
make run-with-env              # Production mode
make run-debug-with-env        # Debug mode với console
```

## 🔐 AWS Secrets Manager Integration

### **Option 1: Auto-create during configure_enclave.sh**
```bash
export KEY_PAIR=your-key-pair
./configure_enclave.sh
# Chọn 'y' cho "Do you want to use a secret?"
# Chọn 'new' để tạo secret mới
# Nhập từng environment variable khi được hỏi
```

### **Option 2: Create secret from .env file**
```bash
# Tạo secret từ .env file hiện có
./scripts/create-secrets.sh --name nautilus-env-vars --region us-east-1

# Sau đó sử dụng trong configure_enclave.sh
./configure_enclave.sh
# Chọn 'y' cho "Do you want to use a secret?"
# Chọn 'existing' và nhập ARN được trả về từ script trên
```

### **Option 3: Manual secret creation**
```bash
# Tạo JSON secret manually
aws secretsmanager create-secret \
  --name "nautilus-env-vars" \
  --secret-string '{
    "API_KEY": "your_api_key",
    "MOVE_PACKAGE_ID": "0x...", 
    "SUI_SECRET_KEY": "suiprivkey1q...",
    "WALRUS_AGGREGATOR_URL": "https://aggregator.walrus-testnet.walrus.space",
    "WALRUS_PUBLISHER_URL": "https://publisher.walrus-testnet.walrus.space",
    "WALRUS_EPOCHS": "5"
  }' \
  --region us-east-1
```

## 🛠️ Available Commands

### **Makefile Commands:**

```bash
# Environment Setup
make env-setup              # Tạo .env từ template
make check-env              # Kiểm tra cấu hình
make test-env               # Test environment locally

# Run with Environment  
make run-with-env           # Chạy với env vars
make run-debug-with-env     # Debug mode với env vars
make restart-with-env       # Restart với env vars

# Send Environment to Running Enclave
make send-env               # Gửi env vars tới enclave đang chạy

# Normal Commands (still available)
make run                    # Chạy không có env vars
make run-debug              # Debug mode không có env vars
```

### **Helper Scripts:**

```bash
# Environment Management
./scripts/env-helper.sh setup      # Tạo .env file
./scripts/env-helper.sh validate   # Validate env vars
./scripts/env-helper.sh test       # Test locally
./scripts/env-helper.sh send       # Send to enclave

# Secrets Manager Integration  
./scripts/create-secrets.sh --name my-secret --region us-east-1
```

## 🔄 Workflow Examples

### **Development Workflow**
```bash
# 1. Setup environment
make env-setup
nano .env

# 2. Test locally
make test-env
cd src/nautilus-server && cargo run

# 3. Test with enclave
make run-debug-with-env
```

### **Production Workflow** 
```bash
# 1. Prepare environment
make env-setup
nano .env

# 2. Create AWS secret
./scripts/create-secrets.sh --name prod-nautilus-env

# 3. Launch EC2 + Enclave
export KEY_PAIR=my-key
./configure_enclave.sh
# Choose existing secret, provide ARN

# 4. SSH to instance and run
ssh ec2-user@<public-ip>
cd nautilus/
make && make run
./expose_enclave.sh
```

## 📊 Environment Variables Reference

### **Required Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `API_KEY` | Authentication key cho server | `045a27812dbe456392913223221306` |
| `MOVE_PACKAGE_ID` | Sui Move package identifier | `0x1234...` |
| `SUI_SECRET_KEY` | Sui private key (bech32 format) | `suiprivkey1q...` |
| `WALRUS_AGGREGATOR_URL` | Walrus aggregator endpoint | `https://aggregator.walrus-testnet.walrus.space` |
| `WALRUS_PUBLISHER_URL` | Walrus publisher endpoint | `https://publisher.walrus-testnet.walrus.space` |
| `WALRUS_EPOCHS` | Number of epochs for Walrus | `5` |

### **Optional Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `DEBUG` | Enable debug logging | `false` |

## 🔒 Security Best Practices

### **Environment Variables**
- ❌ Never commit real API keys to git
- ✅ Use .env file for local development  
- ✅ Use AWS Secrets Manager for production
- ✅ Rotate API keys regularly

### **AWS Secrets Manager**
- ✅ Store all sensitive vars in single JSON secret
- ✅ Use proper IAM roles with minimal permissions
- ✅ Enable secret rotation where possible
- ✅ Use different secrets for different environments

### **Enclave Security**
- ✅ Secrets injected via VSOCK only
- ✅ No network access except configured endpoints
- ✅ All traffic is encrypted and attested

## 🎯 Next Steps

1. **Complete setup** với `make env-setup`
2. **Configure values** trong `.env`
3. **Validate** với `make check-env`
4. **Test locally** với `make test-env`
5. **Create AWS secret** với `./scripts/create-secrets.sh`
6. **Launch enclave** với `./configure_enclave.sh`
7. **Run enclave** với `make run-with-env`

Để biết thêm chi tiết về Nautilus development, xem [UsingNautilus.md](UsingNautilus.md). 