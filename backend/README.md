## Useful links

- [How I write HTTP services in Go after 13 years](https://grafana.com/blog/2024/02/09/how-i-write-http-services-in-go-after-13-years/) - a collection of useful tips for those writing Go services

## Configuration

In the `configs` directory copy the `api.example.yaml` to an environment specific file (`local`, `development`, `production`) and adjust accordingly. It will be picked up and auto loaded by the `internal/config/api.go`.

## Authentication

### Ory

We use [Ory](https://ory.sh/) cloud to manage our user authentication

#### Setup

##### Ory

1. In the [Ory console](https://console.ory.sh/), go to OAuth 2 and make note of the relevant 'Endpoints':
   - Auth URL (ends in `/oauth2/auth`)
   - Token URL (ends in `/oauth2/token`)
   - User API URL (ends in `/userinfo`)
1. Create a new OAuth2 client:
   - Set a relevant 'Client Name'
   - Set scopes are `openid` and `offline_access`
   - Add relevant redirects for `/api/oauth2-redirect`
     - e.g. `http://127.0.0.1/api/oauth2-redirect`
   - Enable skip consent screen
   - Supported OAuth2 flows
     - Grant types: `Refresh token`, `Authorization code`
     - Response types: `Code`
     - Access token type: `Inherit from global configuration`
   - Client authentication mechanism: `HTTP Basic Authorization`
1. Make a note of:
   - Client ID
   - Client Secret

##### Pocketbase

Create an OpenID Connect Auth provider in the [pocketbase settings](http://localhost:8090/_/#/settings/auth-providers), usually the 'oidc' provider.

Enter:

- Client ID
- Client Secret
- Auth URL
- Token URL
- User API URL

And set a relevant display name (e.g. `Cognos SSO`)

## Custom tools

### Generate a Public Key and Encrypted Secret Key

Useful when creating test users, we have provided a script to generate a public key and an encrypted private key for a given user.

```
go run cmd/generate-key-pair/main.go -email={{ USER_EMAIL }} -password={{ USER_VAULT_PASSWORD }}
```

The email is used for salting the hashed password

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
