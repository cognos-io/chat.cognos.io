# syntax=docker/dockerfile:1

FROM golang:1.22 AS builder

WORKDIR /app

COPY go.mod go.sum ./

# Download all dependencies. Dependencies will be cached if the go.mod and go.sum files are not changed
RUN go mod download

# Copy the source from the current directory to the Working Directory inside the container
COPY . .

# Build the Go app
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o api ./cmd/api

FROM alpine:latest

RUN apk --no-cache add ca-certificates

# Create a group and user
RUN addgroup -g 1001 -S appuser && \
    adduser -u 1001 -S appuser -G appuser

# Set the working directory to appuser home directory
WORKDIR /home/appuser/

# Copy the Pre-built binary file from the previous stage
COPY --from=builder /app/api .

# Change the ownership of the /home/appuser/ directory to the root group
RUN mkdir -p /home/appuser/pb_data && \
    chown -R appuser:root /home/appuser/ && \
    chmod -R g=u /home/appuser/ && \
    # Allow the root group to run the application
    chmod g=u /etc/passwd

# This ensures that the application can be run by any arbitrary user ID
USER appuser

EXPOSE 8090

CMD ["/home/appuser/api", "serve", "--http=0.0.0.0:8090"]

