IMAGE ?= agent-lifecycle-runtime:local

.PHONY: build run test

build:
	docker build -t $(IMAGE) .

run: build
	docker run --rm -p 8080:8080 $(IMAGE)

test: build
	docker run --rm --entrypoint python3 $(IMAGE) /opt/agent/run-analysis.py --help
