# External Services Setup Guide

This guide explains how to configure Nautilus to use your own external AI services instead of localhost.

## Configuration Steps

### 1. Update allowed_endpoints.yaml

Replace the placeholder domains in `src/nautilus-server/allowed_endpoints.yaml`:

```yaml
# Replace these with your actual service domains:
- your-ollama-service.yourdomain.com     # Your embedding service
- your-qdrant-service.yourdomain.com     # Your vector database
- your-llm-backend.yourdomain.com        # Your LLM service (if needed)
```

**After updating, remove the localhost endpoints:**
```yaml
# Remove these lines after external services are configured:
# - localhost:11434  # Ollama embedding service  
# - localhost:6333   # Qdrant vector database
```

### 2. Configure Environment Variables

When running `./configure_enclave.sh`, provide your external service URLs:

```bash
# Example values for external services:
OLLAMA_API_URL=https://your-ollama-service.yourdomain.com
OLLAMA_MODEL=nomic-embed-text
QDRANT_URL=https://your-qdrant-service.yourdomain.com
QDRANT_COLLECTION_NAME=nautilus_messages
```

### 3. Security Considerations

For your external services:

- ✅ Use HTTPS for all communications
- ✅ Consider API authentication (API keys, JWT tokens)
- ✅ Set up proper firewall rules
- ✅ Use internal networking when possible
- ✅ Monitor service health and logs

### 4. Service Requirements

#### Ollama Service
- Endpoint: `/api/embeddings`
- Method: `POST`
- Expected response format: `{"embedding": [float array]}`

#### Qdrant Service  
- Endpoints: `/collections/{collection}/points`
- Methods: `GET`, `POST`, `PUT`
- Standard Qdrant REST API

### 5. Testing External Services

Before deploying to enclave, test your services:

```bash
# Test Ollama
curl -X POST https://your-ollama-service.yourdomain.com/api/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model": "nomic-embed-text", "prompt": "test message"}'

# Test Qdrant
curl https://your-qdrant-service.yourdomain.com/collections
```

### 6. Deployment Flow

1. **Setup External Services**: Deploy Ollama + Qdrant + LLM backend
2. **Update Configuration**: Modify `allowed_endpoints.yaml` with your domains
3. **Run configure_enclave.sh**: Provide external service URLs as environment variables
4. **Deploy TEE**: Build and run the enclave
5. **Test**: Verify embedding operations work with external services

## Architecture Benefits

```
┌─────────────────┐    HTTPS    ┌──────────────────┐
│   Nautilus TEE  │ ─────────▶ │  Your Services   │
│   - Data Proc   │             │  - Ollama/Embed  │
│   - Blockchain  │             │  - Qdrant Vector │
│   - Encryption  │             │  - LLM Backend   │
└─────────────────┘             └──────────────────┘
```

- **Scalability**: Services can scale independently
- **Reliability**: High availability setup possible  
- **Maintenance**: Update services without affecting TEE
- **Security**: Your infrastructure, your control
- **Performance**: Dedicated resources for AI workloads

## Troubleshooting

**Connection Issues:**
- Check allowed_endpoints.yaml has correct domains
- Verify services are accessible from EC2 instance
- Check security groups and firewall rules

**Authentication Errors:**
- Verify API keys/tokens are configured
- Check service authentication requirements

**Performance Issues:**
- Monitor network latency between TEE and services
- Consider co-locating services in same region/VPC