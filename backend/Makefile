# Inspiration/references
# https://gist.github.com/alexedwards/3b40775846535d0014ab1ff477e4a568

MAIN_PACKAGE_PATH := ./cmd/api
BINARY_NAME := api
# Should match the repo name in Docker Hub
DOCKER_IMAGE_NAME := docker.io/cognosio/api.cognos.io
# Can be changed to different versions easily
GO_BINARY := go
DOCKER_BINARY := docker

# ==================================================================================== #
# HELPERS
# ==================================================================================== #

## help: print this help message
.PHONY: help
help:
	@echo 'Usage:'
	@sed -n 's/^##//p' ${MAKEFILE_LIST} | column -t -s ':' |  sed -e 's/^/ /'

.PHONY: confirm
confirm:
	@echo -n 'Are you sure? [y/N] ' && read ans && [ $${ans:-N} = y ]

.PHONY: no-dirty
no-dirty:
	@git diff --exit-code

# ==================================================================================== #
# QUALITY CONTROL
# ==================================================================================== #

## tidy: format code and tidy modfile
.PHONY: tidy
tidy:
	@${GO_BINARY} fmt ./...
	@${GO_BINARY} mod tidy -v

## audit: run quality control checks
.PHONY: audit
audit:
	@${GO_BINARY} mod verify
	@${GO_BINARY} vet ./...
	@${GO_BINARY} run honnef.co/go/tools/cmd/staticcheck@latest -checks=all,-ST1000,-U1000 ./...
	@${GO_BINARY} run golang.org/x/vuln/cmd/govulncheck@latest ./...
	@${GO_BINARY} test -race -buildvcs -vet=off ./...

# ==================================================================================== #
# DEVELOPMENT
# ==================================================================================== #

## lint: run linters
.PHONY: lint
lint:
	@golangci-lint run ./...

## lint/fix: run linters and fix issues
.PHONY: lint/fix
lint/fix:
	@golangci-lint run --fix ./...

.PHONY: lines
lines: tidy
	@${GO_BINARY} run github.com/segmentio/golines@latest -w -m 88 .

## fmt: format code
.PHONY: fmt
fmt: tidy lines
	@${GO_BINARY} run mvdan.cc/gofumpt@latest -l -w .

## test: run all tests
.PHONY: test
test:
	@${GO_BINARY} test -v -race -buildvcs ./...

## test/cover: run all tests and display coverage
.PHONY: test/cover
test/cover:
	@${GO_BINARY} test -v -race -buildvcs -coverprofile=/tmp/coverage.out ./...
	@${GO_BINARY} tool cover -html=/tmp/coverage.out

## benchmark: run all benchmarks
.PHONY: benchmark
benchmark:
	@${GO_BINARY} test -run=XXXX -bench=. ./...

## build: build the application
.PHONY: build
build:
	# Include additional build steps, like TypeScript, SCSS or Tailwind compilation here...
	@${GO_BINARY} build -o=/tmp/bin/${BINARY_NAME} ${MAIN_PACKAGE_PATH}

## build/docker: build the docker image for linux/amd64,linux/arm64
.PHONY: build/docker
build/docker:
	@GIT_COMMIT=$$(git rev-parse --short HEAD) && \
	${DOCKER_BINARY} build --platform linux/amd64,linux/arm64 -t ${DOCKER_IMAGE_NAME}:$$GIT_COMMIT -t ${DOCKER_IMAGE_NAME}:latest .

## run: run the application
.PHONY: run
run: build
	/tmp/bin/${BINARY_NAME} serve

## run/docker: run the application in a non-root docker container
.PHONY: run/docker
run/docker:
	@${DOCKER_BINARY} run \
		--user $(shuf -i 2000-60000 -n 1):root \
		--publish 8090:8090 \
		${DOCKER_IMAGE_NAME}:latest

## run/test: run the application with the test database to add data for testing
.PHONY: run/test
run/test: build
	/tmp/bin/${BINARY_NAME} --dir testdata/pb_data serve

## run/live: run the application with reloading on file changes
.PHONY: run/live
run/live:
	@${GO_BINARY} run github.com/cosmtrek/air@v1.50.0 \
		--build.cmd "make build" \
		--build.bin "/tmp/bin/${BINARY_NAME}" \
		--build.args_bin "serve --dev --dir ./pb_data" \
		--build.delay "100" \
		--build.exclude_dir "db/migrations" \
		--build.include_ext "go, tpl, tmpl, html, css, scss, js, ts, sql, jpeg, jpg, gif, png, bmp, svg, webp, ico" \
		--misc.clean_on_exit "true"

## publish/docker: push the docker image to Docker Hub
.PHONY: publish/docker
publish/docker: build/docker
	@GIT_COMMIT=$$(git rev-parse --short HEAD) && \
	${DOCKER_BINARY} push ${DOCKER_IMAGE_NAME}:$$GIT_COMMIT && \
	${DOCKER_BINARY} push ${DOCKER_IMAGE_NAME}:latest

# ==================================================================================== #
# OPERATIONS
# ==================================================================================== #

## push: push changes to the remote Git repository
.PHONY: push
push: tidy audit no-dirty
	@git push

## production/deploy: deploy the application to production
.PHONY: production/deploy
production/deploy: confirm tidy audit no-dirty
	GOOS=linux GOARCH=amd64 ${GO_BINARY} build -ldflags='-s' -o=/tmp/bin/linux_amd64/${BINARY_NAME} ${MAIN_PACKAGE_PATH}
	upx -5 /tmp/bin/linux_amd64/${BINARY_NAME}
	# Include additional deployment steps here...