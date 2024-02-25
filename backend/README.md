## Useful links

- [How I write HTTP services in Go after 13 years](https://grafana.com/blog/2024/02/09/how-i-write-http-services-in-go-after-13-years/) - a collection of useful tips for those writing Go services

## Configuration

In the `configs` directory copy the `api.example.yaml` to an environment specific file (`local`, `development`, `production`) and adjust accordingly. It will be picked up and auto loaded by the `internal/config/api.go`.

## HTTPie requests

### Send a message to the OpenAI API

```
http POST https://api.openai.com/v1/chat/completions \
    Authorization:"Bearer $OPENAI_KEY" \
    model="gpt-3.5-turbo" \
    messages:='[{"role": "user", "content": "Say this is a test!"}]' \
    stream:=true
```

### Authenticate

Get a token to authenticate.

```
http POST :8090/api/collections/users/auth-with-password \
    identity="test@example.com" \
    password="password"
```

Pipe to `jq` to get the `token`.

```
http POST :8090/api/collections/users/auth-with-password \
    identity="test@example.com" \
    password="password" | jq -r .token
```

```
export AUTH_TOKEN=$(http POST :8090/api/collections/users/auth-with-password \
    identity="test@example.com" \
    password="password" | jq -r .token)
```

### Send a message to localhost

**Note:** `metadata` will be stripped off before sending to upstream OpenAI compatible API.

```
http POST :8090/v1/chat/completions \
    Authorization:"Bearer $AUTH_TOKEN" \
    model="gpt-3.5-turbo" \
    messages:='[{"role": "user", "content": "Say this is a test!"}]' \
    stream:=true \
    metadata:='{"cognos": {"conversation_id": "0524b1cc-152b-4f53-ade9-1ad8c338d2e3"}}'
```
