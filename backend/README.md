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

## Encryption benchmarks

To decide on an encryption strategy for messages we wrote benchmarks to compare the following methods:

1. 'Sealed box' asymmetric encryption using the conversations public key as the recipient. This method generates an ephemeral key pair and uses NaCl box under the hood to asymmetrically encrypt the data, including the ephemeral public key in the output. Decryption is done using the conversation secret key and the ephemeral public key.
1. 'Hybrid' encryption. This method generates a random 256bit symmetric key which is used with the NaCl secretbox to encrypt the message contents. The symmetric key is then encrypted with the same 'Sealed box' asymmetric encryption detailed above. The advantages here are that the symmetric encryption should be a lot faster than the asymmetric encryption (which is only used for a small message - the symmetric key).

Benchmarks are found in the `internal/crypto/encrypt_benchmark_test.go` file.

### Results

We compared encryption of messages (with random content) of various lengths.

Interestingly the results are not as different as I would have expected with a consistent ±10% between the methods (example output below).

```
goos: linux
goarch: amd64
pkg: github.com/cognos-io/chat.cognos.io/backend/internal/crypto
cpu: AMD Ryzen 7 3700X 8-Core Processor
BenchmarkAsymmetricEncrypt1KB-16           12063             99801 ns/op
BenchmarkAsymmetricEncrypt2KB-16           10000            112588 ns/op
BenchmarkAsymmetricEncrypt5KB-16            8796            128814 ns/op
BenchmarkAsymmetricEncrypt10KB-16           7284            180291 ns/op
BenchmarkAsymmetricEncrypt500KB-16           835           1373146 ns/op
BenchmarkAsymmetricEncrypt1MB-16             447           2585302 ns/op
BenchmarkAsymmetricEncrypt10MB-16             63          22883566 ns/op
BenchmarkSymmetricEncrypt1KB-16            11070            109244 ns/op
BenchmarkSymmetricEncrypt2KB-16            10000            108873 ns/op
BenchmarkSymmetricEncrypt5KB-16             9358            135506 ns/op
BenchmarkSymmetricEncrypt10KB-16           10000            156142 ns/op
BenchmarkSymmetricEncrypt500KB-16            801           1369121 ns/op
BenchmarkSymmetricEncrypt1MB-16              471           2517422 ns/op
BenchmarkSymmetricEncrypt10MB-16              68          18383260 ns/op
```

Worth noting that if we were **only** using symmetric encryption (and not asymmetrically encrypting the symmetric key), the results are very different:

```
BenchmarkSymmetricEncrypt1KB-16           204798              5351 ns/op
BenchmarkSymmetricEncrypt2KB-16           145189              7862 ns/op
BenchmarkSymmetricEncrypt5KB-16            99870             15468 ns/op
BenchmarkSymmetricEncrypt10KB-16           43687             26931 ns/op
BenchmarkSymmetricEncrypt500KB-16           1008           1258649 ns/op
BenchmarkSymmetricEncrypt1MB-16              436           2617675 ns/op
BenchmarkSymmetricEncrypt10MB-16              61          19730876 ns/op
```

### Conclusion

We will use the 'sealed box' asymmetric encryption approach.

While the 'hybrid' approach is a little faster it does include additional complexity having to use two encryption approaches on both the server and the client. As the difference is not huge it doesn't make sense to over complicate things at this time.

(I also have a theory that this also requires less from the source of randomness which may become a bottleneck but that's purely a hypothetical)
