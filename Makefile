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
