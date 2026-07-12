# Backend Container

Build from the repository root:

```sh
podman build -f container/backend/Containerfile -t cognos-backend .
```

Run with a read-only root filesystem:

```sh
podman run --rm \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,mode=1777 \
  --tmpfs /run/cognos:rw,noexec,nosuid,nodev,mode=1777 \
  -v cognos-backend-data:/app/pb_data:Z \
  --env-file backend/.env \
  -p 8090:8090 \
  cognos-backend
```

For Caddy over a Unix socket, mount the same socket directory into Caddy and set:

```sh
-e COGNOS_BACKEND_UNIX_SOCKET=/run/cognos/api.sock
```

Set `COGNOS_BACKEND_UNIX_SOCKET_MODE` if Caddy needs broader socket permissions than the default
`660`. The API listens on the socket directly; no TCP-to-socket bridge is required. The
`COGNOS_BACKEND_HTTP_ADDR` setting is only used when `COGNOS_BACKEND_UNIX_SOCKET` is unset.

The writable runtime paths are `/app/pb_data`, `/tmp`, and, for socket mode, `/run/cognos`.
