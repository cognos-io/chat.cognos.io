_default:
    @just --list

# Install dependencies and languages with mise
install-mise:
    @mise install

# Install all dev dependencies
install-dev: install-mise
    @pnpm install
    @lefthook install

# Generates a self-signed certificate for the development server
mkcert:
    @if [ ! -f /tmp/cognos.crt ]; then \
        mkcert -cert-file=/tmp/cognos.crt -key-file=/tmp/cognos.key localhost 127.0.0.1 cognos.local; \
    fi

# Run the Go tests
[working-directory("backend")]
go-test:
    @go test ./...

[working-directory("backend")]
_go-fmt:
    @go fmt ./...

_markdown-fmt:
    @rumdl fmt .

# Format files
[parallel]
fmt: _go-fmt _markdown-fmt

# Run storybook for the frontend components
storybook:
    @pnpm --filter @cognos/ui-angular storybook

# Run the frontend dev server
[working-directory("frontend")]
frontend: mkcert
    @pnpm start --host cognos.local --port 4200 --ssl --ssl-cert /tmp/cognos.crt --ssl-key /tmp/cognos.key

# Run the backend API with live reload
[working-directory("backend")]
backend: mkcert
    @go run github.com/cosmtrek/air@v1.50.0 \
        --build.cmd "go build -o=/tmp/bin/api ./cmd/api" \
        --build.bin "/tmp/bin/api" \
        --build.args_bin "serve --dev --dir ./pb_data" \
        --build.delay "100" \
        --build.exclude_dir "db/migrations" \
        --build.include_ext "go,tpl,tmpl,html,css,scss,js,ts,sql,jpeg,jpg,gif,png,bmp,svg,webp,ico" \
        --misc.clean_on_exit "true"

# Run the backend API with live reload against test data
[working-directory("backend")]
backend-test:
    @go run github.com/cosmtrek/air@v1.50.0 \
        --build.cmd "go build -o=/tmp/bin/api ./cmd/api" \
        --build.bin "/tmp/bin/api" \
        --build.args_bin "serve --dev --dir ./testdata/pb_data" \
        --build.delay "100" \
        --build.exclude_dir "db/migrations" \
        --build.include_ext "go,tpl,tmpl,html,css,scss,js,ts,sql,jpeg,jpg,gif,png,bmp,svg,webp,ico" \
        --misc.clean_on_exit "true"

# Run the OpenAI-shaped mock AI provider on 127.0.0.1:18080 (no real upstream needed)
[working-directory("backend")]
mock-ai:
    @go run ./cmd/mock-ai-provider

# Run frontend, backend and the mock AI provider together
[parallel]
dev: frontend backend mock-ai

dev-test:
    @just _dev backend-test

# Run the Playwright end-to-end tests on isolated ports/data.
[working-directory("e2e")]
e2e: mkcert
    @pnpm exec playwright test

# Run only the API e2e specs. Skips the frontend build/static serving.
[working-directory("e2e")]
e2e-api: mkcert
    @E2E_SKIP_FRONTEND=1 pnpm exec playwright test api.spec

# Open the Playwright UI runner
[working-directory("e2e")]
e2e-ui: mkcert
    @pnpm exec playwright test --ui

# Install Playwright browsers (one-time setup)
[working-directory("e2e")]
e2e-install:
    @pnpm exec playwright install --with-deps

# Clears out local data
dev-clean:
    @rm -rf backend/pb_data/
