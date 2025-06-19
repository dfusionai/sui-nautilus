# 🔧 Environment Variables Setup Guide

Hướng dẫn cấu hình environment variables cho Nautilus server khi chạy trong Nitro enclave.

## 📋 Overview

Nautilus server cần các environment variables để hoạt động:

### **Rust Server Variables:**
- `API_KEY` - Khóa API để xác thực

### **Node.js Task Variables:**
- `MOVE_PACKAGE_ID` - ID của Sui Move package 
- `SUI_SECRET_KEY` - Private key cho Sui blockchain
- `WALRUS_AGGREGATOR_URL` - URL của Walrus aggregator
- `WALRUS_PUBLISHER_URL` - URL của Walrus publisher
- `WALRUS_EPOCHS` - Số epochs cho Walrus

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
make status                 # Xem trạng thái enclave
make logs                   # Xem logs
make stop                   # Dừng enclave
make clean                  # Dọn dẹp
```

### **Script Commands:**

```bash
# Environment Management
./scripts/env-helper.sh setup      # Tạo .env file
./scripts/env-helper.sh validate   # Kiểm tra cấu hình
./scripts/env-helper.sh test       # Test locally
./scripts/env-helper.sh send       # Gửi tới enclave
./scripts/env-helper.sh status     # Xem trạng thái
```

## 📝 Detailed Setup

### **Bước 1: Tạo Environment File**

```bash
# Sử dụng Makefile
make env-setup

# Hoặc sử dụng script
./scripts/env-helper.sh setup
```

Lệnh này sẽ tạo `.env` từ `env.example` template.

### **Bước 2: Cấu hình Values**

Mở `.env` và điền các giá trị thực:

```bash
# API Key cho Rust server
API_KEY=045a27812dbe456392913223221306

# Sui Configuration
MOVE_PACKAGE_ID=0x1234567890abcdef1234567890abcdef12345678
SUI_SECRET_KEY=suiprivkey1qg...

# Walrus URLs
WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
WALRUS_EPOCHS=5

# Optional debug
DEBUG=false
```

### **Bước 3: Validate Configuration**

```bash
make check-env
```

Sẽ kiểm tra:
- ✅ File `.env` tồn tại
- ✅ Tất cả required variables được set
- ✅ Không có placeholder values

### **Bước 4: Test Locally (Optional)**

```bash
make test-env
```

Test environment variables locally trước khi chạy trong enclave.

### **Bước 5: Run với Environment**

```bash
# Production mode
make run-with-env

# Debug mode với console output
make run-debug-with-env
```

## 🔄 Workflow Examples

### **Development Workflow:**

```bash
# 1. Setup lần đầu
make env-setup
nano .env                   # Edit values

# 2. Validate
make check-env

# 3. Test locally
make test-env

# 4. Build và run
make                        # Build enclave
make run-debug-with-env     # Run in debug mode

# 5. Check logs
make logs
```

### **Production Workflow:**

```bash
# 1. Setup environment
make env-setup
nano .env

# 2. Validate
make check-env

# 3. Build và deploy
make clean                  # Clean previous builds
make                        # Build fresh
make run-with-env           # Run in production mode

# 4. Monitor
make status
```

### **Restart với Environment:**

```bash
# Restart trong production mode
make restart-with-env

# Restart trong debug mode  
make restart-debug-with-env
```

## 🔐 Security Best Practices

### **Environment File Security:**

- ✅ `.env` files are in `.gitignore` 
- ✅ Never commit real secrets to git
- ✅ Use different `.env` for dev/staging/prod
- ✅ Rotate keys regularly

### **Enclave Security:**

- Environment variables được gửi qua VSOCK secure channel
- Variables chỉ available trong enclave runtime
- Không có access từ host sau khi gửi

## 🐛 Troubleshooting

### **Environment Issues:**

```bash
# Check if .env exists
ls -la .env

# Validate configuration
make check-env

# Test locally first
make test-env

# Check script permissions
chmod +x scripts/env-helper.sh
```

### **Enclave Issues:**

```bash
# Check enclave status
make status

# Check logs
make logs

# Restart enclave
make restart-with-env

# Clean restart
make clean
make run-with-env
```

### **Common Errors:**

**1. "Environment file not found"**
```bash
make env-setup
nano .env
```

**2. "No running enclave found"**
```bash
make run-with-env
```

**3. "jq command not found"**
```bash
# Ubuntu/Debian
sudo apt-get install jq

# macOS
brew install jq
```

**4. "socat command not found"**
```bash
# Ubuntu/Debian
sudo apt-get install socat

# macOS  
brew install socat
```

## 📚 Environment Variables Reference

### **Required Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `API_KEY` | Authentication key cho Rust server | `045a27812dbe456392913223221306` |
| `MOVE_PACKAGE_ID` | Sui Move package identifier | `0x1234...` |
| `SUI_SECRET_KEY` | Sui private key (bech32 format) | `suiprivkey1q...` |
| `WALRUS_AGGREGATOR_URL` | Walrus aggregator endpoint | `https://aggregator.walrus-testnet.walrus.space` |
| `WALRUS_PUBLISHER_URL` | Walrus publisher endpoint | `https://publisher.walrus-testnet.walrus.space` |
| `WALRUS_EPOCHS` | Number of epochs for Walrus | `5` |

### **Optional Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `DEBUG` | Enable debug logging | `false` |

## 🎯 Next Steps

1. **Complete setup** với `make env-setup`
2. **Configure values** trong `.env`
3. **Validate** với `make check-env`
4. **Test locally** với `make test-env`
5. **Run enclave** với `make run-with-env`

Để biết thêm chi tiết về Nautilus development, xem [UsingNautilus.md](UsingNautilus.md). 