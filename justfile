_default:
    @just --list

# Install dependencies and languages with mise
install-mise:
    @mise install

# Install all dev dependencies
install-dev: install-mise
    @pnpm install
    @lefthook install

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
frontend:
    @pnpm start

# Run the backend API with live reload
[working-directory("backend")]
backend:
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

# Run frontend and backend together
[parallel]
dev: frontend backend

dev-test:
    @just _dev backend-test

# Run the Playwright end-to-end tests. Requires the backend running (just backend).
[working-directory("e2e")]
e2e:
    @pnpm exec playwright test

# Open the Playwright UI runner
[working-directory("e2e")]
e2e-ui:
    @pnpm exec playwright test --ui

# Install Playwright browsers (one-time setup)
[working-directory("e2e")]
e2e-install:
    @pnpm exec playwright install --with-deps

# Clears out local data
dev-clean:
    @rm -rf backend/pb_data/
