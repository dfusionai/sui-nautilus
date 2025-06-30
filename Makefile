REGISTRY := local
.DEFAULT_GOAL :=
.PHONY: default
default: out/enclaveos.tar

# Environment variables file
ENV_FILE ?= .env

out:
	mkdir out

out/enclaveos.tar: out \
	$(shell git ls-files \
		src/init \
		src/aws \
        src/hello \
        src/nautilus-server \
	)
	docker build \
		--tag $(REGISTRY)/enclaveos \
		--progress=plain \
		--platform linux/amd64 \
		--output type=local,rewrite-timestamp=true,dest=out\
		-f Containerfile \
		.

# out/nitro.eif: out/enclaveos.tar

.PHONY: run
run: out/nitro.eif
	sudo nitro-cli \
		run-enclave \
		--cpu-count 2 \
		--memory 1024M \
		--eif-path out/nitro.eif

.PHONY: run-debug
run-debug: out/nitro.eif
	sudo nitro-cli \
		run-enclave \
		--cpu-count 2 \
		--memory 1024M \
		--eif-path out/nitro.eif \
		--debug-mode \
		--attach-console

.PHONY: run-with-env
run-with-env: out/nitro.eif check-env
	@echo "🔧 Loading environment variables from $(ENV_FILE)..."
	@if [ -f "$(ENV_FILE)" ]; then \
		echo "✅ Found $(ENV_FILE)"; \
		cat $(ENV_FILE) | grep -v '^#' | grep -v '^$$' > /tmp/enclave_env.json.tmp; \
		echo "{" > /tmp/enclave_env.json; \
		while IFS='=' read -r key value; do \
			if [ -n "$$key" ] && [ -n "$$value" ]; then \
				echo "  \"$$key\": \"$$value\"," >> /tmp/enclave_env.json; \
			fi; \
		done < /tmp/enclave_env.json.tmp; \
		sed '$$s/,$$//' /tmp/enclave_env.json > /tmp/enclave_env_final.json; \
		echo "}" >> /tmp/enclave_env_final.json; \
		mv /tmp/enclave_env_final.json /tmp/enclave_env.json; \
		rm -f /tmp/enclave_env.json.tmp; \
		echo "📋 Environment variables prepared:"; \
		cat /tmp/enclave_env.json | jq -r 'keys[]' | sed 's/^/  - /'; \
		sudo nitro-cli \
			run-enclave \
			--cpu-count 2 \
			--memory 1024M \
			--eif-path out/nitro.eif; \
	else \
		echo "❌ Environment file $(ENV_FILE) not found!"; \
		echo "💡 Create one by copying: cp env.example .env"; \
		exit 1; \
	fi

.PHONY: run-debug-with-env  
run-debug-with-env: out/nitro.eif check-env
	@echo "🔧 Loading environment variables from $(ENV_FILE)..."
	@if [ -f "$(ENV_FILE)" ]; then \
		echo "✅ Found $(ENV_FILE)"; \
		cat $(ENV_FILE) | grep -v '^#' | grep -v '^$$' > /tmp/enclave_env.json.tmp; \
		echo "{" > /tmp/enclave_env.json; \
		while IFS='=' read -r key value; do \
			if [ -n "$$key" ] && [ -n "$$value" ]; then \
				echo "  \"$$key\": \"$$value\"," >> /tmp/enclave_env.json; \
			fi; \
		done < /tmp/enclave_env.json.tmp; \
		sed '$$s/,$$//' /tmp/enclave_env.json > /tmp/enclave_env_final.json; \
		echo "}" >> /tmp/enclave_env_final.json; \
		mv /tmp/enclave_env_final.json /tmp/enclave_env.json; \
		rm -f /tmp/enclave_env.json.tmp; \
		echo "📋 Environment variables prepared:"; \
		cat /tmp/enclave_env.json | jq -r 'keys[]' | sed 's/^/  - /'; \
		sudo nitro-cli \
			run-enclave \
			--cpu-count 2 \
			--memory 1024M \
			--eif-path out/nitro.eif \
			--debug-mode \
			--attach-console; \
	else \
		echo "❌ Environment file $(ENV_FILE) not found!"; \
		echo "💡 Create one by copying: cp env.example .env"; \
		exit 1; \
	fi

.PHONY: clean
clean:
	sudo nitro-cli terminate-enclave --all || true
	rm -rf out/
	docker rmi $(REGISTRY)/enclaveos || true
	docker system prune -f

.PHONY: status
status:
	sudo nitro-cli describe-enclaves

.PHONY: logs
logs:
	sudo nitro-cli console --enclave-id $$(sudo nitro-cli describe-enclaves | jq -r '.[] | .EnclaveID')

.PHONY: stop
stop:
	sudo nitro-cli terminate-enclave --all

.PHONY: check-env
check-env:
	@echo "🔍 Checking environment setup..."
	@if [ ! -f "$(ENV_FILE)" ]; then \
		echo "❌ Environment file $(ENV_FILE) not found!"; \
		echo "💡 Create one by running: cp env.example .env"; \
		echo "💡 Then edit .env with your actual values"; \
		exit 1; \
	fi
	@echo "✅ Environment file found: $(ENV_FILE)"
	@echo "📋 Required variables:"
	@grep -E '^[A-Z_]+=.*' $(ENV_FILE) | cut -d'=' -f1 | sed 's/^/  ✓ /' || true
	@echo ""

.PHONY: env-setup
env-setup:
	@echo "🚀 Setting up environment variables..."
	@if [ ! -f ".env" ]; then \
		cp env.example .env; \
		echo "✅ Created .env from template"; \
		echo "📝 Please edit .env with your actual values:"; \
		echo "  - API_KEY: Your API key for authentication"; \
		echo "  - MOVE_PACKAGE_ID: Your Sui Move package ID"; \
		echo "  - SUI_SECRET_KEY: Your Sui private key"; \
		echo "  - WALRUS_*: Walrus configuration URLs"; \
		echo ""; \
		echo "🔧 Edit the file: nano .env"; \
	else \
		echo "✅ .env file already exists"; \
		echo "📋 Current configuration:"; \
		cat .env | grep -E '^[A-Z_]+=.*' | sed 's/=.*/=***/' | sed 's/^/  /' || true; \
	fi

.PHONY: send-env
send-env: check-env
	@echo "📤 Sending environment variables to running enclave..."
	@ENCLAVE_ID=$$(sudo nitro-cli describe-enclaves | jq -r '.[] | .EnclaveID' | head -1); \
	if [ -z "$$ENCLAVE_ID" ]; then \
		echo "❌ No running enclave found. Run 'make run-with-env' first."; \
		exit 1; \
	fi; \
	echo "🎯 Target enclave: $$ENCLAVE_ID"; \
	cat $(ENV_FILE) | grep -v '^#' | grep -v '^$$' > /tmp/enclave_env.json.tmp; \
	echo "{" > /tmp/enclave_env.json; \
	while IFS='=' read -r key value; do \
		if [ -n "$$key" ] && [ -n "$$value" ]; then \
			echo "  \"$$key\": \"$$value\"," >> /tmp/enclave_env.json; \
		fi; \
	done < /tmp/enclave_env.json.tmp; \
	sed '$$s/,$$//' /tmp/enclave_env.json > /tmp/enclave_env_final.json; \
	echo "}" >> /tmp/enclave_env_final.json; \
	mv /tmp/enclave_env_final.json /tmp/enclave_env.json; \
	rm -f /tmp/enclave_env.json.tmp; \
	echo "📦 Sending environment variables..."; \
	socat VSOCK-CONNECT:$$ENCLAVE_ID:7777 EXEC:"cat /tmp/enclave_env.json"; \
	rm -f /tmp/enclave_env.json; \
	echo "✅ Environment variables sent successfully!"

.PHONY: restart-with-env
restart-with-env: stop run-with-env
	@echo "🔄 Enclave restarted with environment variables"

.PHONY: restart-debug-with-env
restart-debug-with-env: stop run-debug-with-env
	@echo "🔄 Enclave restarted in debug mode with environment variables"

.PHONY: test-env
test-env: check-env
	@echo "🧪 Testing environment variables locally..."
	@cd src/nautilus-server && \
	if [ -f "../../.env" ]; then \
		export $$(cat ../../.env | grep -v '^#' | xargs); \
		echo "✅ Environment loaded"; \
		echo "📋 Testing required variables:"; \
		echo "  API_KEY: $${API_KEY:0:10}***"; \
		echo "  MOVE_PACKAGE_ID: $${MOVE_PACKAGE_ID:0:20}***"; \
		echo "  SUI_SECRET_KEY: $${SUI_SECRET_KEY:0:15}***"; \
		echo "  WALRUS_AGGREGATOR_URL: $$WALRUS_AGGREGATOR_URL"; \
		echo "  WALRUS_PUBLISHER_URL: $$WALRUS_PUBLISHER_URL"; \
		echo "  WALRUS_EPOCHS: $$WALRUS_EPOCHS"; \
		echo ""; \
		echo "🚀 You can now test locally with: cd src/nautilus-server && cargo run"; \
	else \
		echo "❌ .env file not found"; \
	fi

.PHONY: help
help:
	@echo "🚀 Nautilus Nitro Enclave Management"
	@echo ""
	@echo "📦 Build Commands:"
	@echo "  make                    Build the enclave image"
	@echo "  make clean              Clean build artifacts and stop all enclaves"
	@echo ""
	@echo "🏃 Run Commands:"
	@echo "  make run                Run enclave in production mode"
	@echo "  make run-debug          Run enclave in debug mode with console"
	@echo "  make run-with-env       Run enclave with environment variables"
	@echo "  make run-debug-with-env Run enclave in debug mode with env vars"
	@echo ""
	@echo "🔧 Environment Commands:"
	@echo "  make env-setup          Create .env file from template"
	@echo "  make check-env          Validate environment configuration"
	@echo "  make test-env           Test environment variables locally"
	@echo "  make send-env           Send env vars to running enclave"
	@echo ""
	@echo "📋 Management Commands:"
	@echo "  make status             Show enclave status"
	@echo "  make logs               Show enclave logs/console"
	@echo "  make stop               Stop all running enclaves"
	@echo "  make restart-with-env   Stop and restart with env vars"
	@echo "  make restart-debug-with-env Stop and restart in debug mode with env"
	@echo ""
	@echo "🛠️  Utility Commands:"
	@echo "  make help               Show this help message"
