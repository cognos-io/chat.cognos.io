_default:
    @just --list

# Install dependencies and languages with mise
install-mise:
    @mise install

# Install all dev dependencies
install-dev: install-mise
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
