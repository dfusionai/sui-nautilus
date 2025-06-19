REGISTRY := local
.DEFAULT_GOAL :=
.PHONY: default
default: out/enclaveos.tar

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

.PHONY: status
status:
	@echo "🔍 Checking Nitro Enclave status..."
	sudo nitro-cli describe-enclaves

.PHONY: logs
logs:
	@echo "📄 Fetching Nitro Enclave logs..."
	@ENCLAVE_ID=$$(sudo nitro-cli describe-enclaves --output json | jq -r '.[0].EnclaveID // empty'); \
	if [ -z "$$ENCLAVE_ID" ]; then \
		echo "❌ No running enclave found"; \
	else \
		echo "📋 Enclave ID: $$ENCLAVE_ID"; \
		sudo nitro-cli console --enclave-id $$ENCLAVE_ID; \
	fi

.PHONY: stop
stop:
	@echo "🛑 Stopping Nitro Enclave..."
	@ENCLAVE_ID=$$(sudo nitro-cli describe-enclaves --output json | jq -r '.[0].EnclaveID // empty'); \
	if [ -z "$$ENCLAVE_ID" ]; then \
		echo "❌ No running enclave found"; \
	else \
		echo "🔄 Terminating enclave: $$ENCLAVE_ID"; \
		sudo nitro-cli terminate-enclave --enclave-id $$ENCLAVE_ID; \
		echo "✅ Enclave stopped successfully"; \
	fi

.PHONY: stop-all
stop-all:
	@echo "🛑 Stopping all Nitro Enclaves..."
	@ENCLAVE_IDS=$$(sudo nitro-cli describe-enclaves --output json | jq -r '.[].EnclaveID // empty'); \
	if [ -z "$$ENCLAVE_IDS" ]; then \
		echo "❌ No running enclaves found"; \
	else \
		for ENCLAVE_ID in $$ENCLAVE_IDS; do \
			echo "🔄 Terminating enclave: $$ENCLAVE_ID"; \
			sudo nitro-cli terminate-enclave --enclave-id $$ENCLAVE_ID; \
		done; \
		echo "✅ All enclaves stopped successfully"; \
	fi

.PHONY: clean
clean: stop-all
	@echo "🧹 Cleaning up build artifacts..."
	rm -rf out/
	@echo "🗑️  Cleaning up Docker containers and images..."
	docker system prune -f --filter "label=builder"
	@echo "✅ Cleanup completed"

.PHONY: restart
restart: stop run
	@echo "🔄 Enclave restarted"

.PHONY: restart-debug
restart-debug: stop run-debug
	@echo "🔄 Enclave restarted in debug mode"

.PHONY: info
info:
	@echo "ℹ️  Nitro CLI version:"
	nitro-cli --version
	@echo ""
	@echo "🖥️  System info:"
	nitro-cli describe-eif --eif-path out/nitro.eif 2>/dev/null || echo "❌ EIF file not found. Run 'make' first."

.PHONY: update
update:
	./update.sh

.PHONY: help
help:
	@echo "🚀 Nautilus Nitro Enclave Management"
	@echo ""
	@echo "📦 Build Commands:"
	@echo "  make                 Build the enclave image"
	@echo "  make clean           Clean build artifacts and stop all enclaves"
	@echo ""
	@echo "🏃 Run Commands:"
	@echo "  make run             Run enclave in production mode"
	@echo "  make run-debug       Run enclave in debug mode with console"
	@echo "  make restart         Stop and restart enclave"
	@echo "  make restart-debug   Stop and restart enclave in debug mode"
	@echo ""
	@echo "📋 Management Commands:"
	@echo "  make status          Show enclave status"
	@echo "  make logs            Show enclave logs/console"
	@echo "  make stop            Stop the running enclave"
	@echo "  make stop-all        Stop all running enclaves"
	@echo "  make info            Show nitro-cli and EIF info"
	@echo ""
	@echo "🛠️  Utility Commands:"
	@echo "  make update          Update dependencies"
	@echo "  make help            Show this help message"

