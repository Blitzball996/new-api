# Codex CLI Compatibility

This document describes the changes made to new-api to support
[OpenAI Codex CLI](https://github.com/openai/codex) (v0.167.0+) as a client.

## Background

Codex CLI uses the OpenAI Responses API (`/responses`) rather than the older
`/v1/chat/completions` endpoint. It also deviates from standard HTTP conventions
in several ways that required fixes across the relay stack:

1. Sends requests to `/responses` and `/models` **without** the `/v1/` prefix.
2. First attempts a **WebSocket upgrade** (`GET /responses`) before falling back to
   HTTP POST — the GET carries no request body and no `model` query parameter.
3. The HTTP POST fallback omits the `Content-Type: application/json` header (or
   sends `application/x-www-form-urlencoded`), causing body parsers to skip the
   JSON payload.

## Changes

### `router/relay-router.go`

- Added a new root router group that registers `POST /responses`, `GET /responses`,
  and `GET /models` routes.
- A middleware in that group rewrites the path to `/v1/responses` (or `/v1/models`)
  before `Distribute()` runs, so all existing relay-mode detection and channel
  selection logic sees the correct `/v1/` prefix.
- The same middleware forces `Content-Type: application/json` on every `/responses`
  request so body parsers treat the payload as JSON regardless of what the client
  sent.

### `router/web-router.go`

- Added `/responses` and `/models` to the `NoRoute` prefix check so these paths
  are not served as the frontend React SPA.

### `relay/channel/openai/adaptor.go`

- In `GetRequestURL`, paths that still lack a `/v1/` prefix after routing are
  normalised to `/v1<path>` before being forwarded to the upstream.  This prevents
  the upstream from receiving `/responses` instead of `/v1/responses`.

### `relay/constant/relay_mode.go`

- `Path2RelayMode` now recognises `/responses` and `/responses/compact`
  (without the `/v1` prefix) in addition to the existing `/v1/responses` entries.

### `middleware/distributor.go`

- Added a dedicated `else if` branch for `/v1/responses` and `/responses` paths.
  - For **HTTP POST**: reads `model` from the query parameter or directly from the
    JSON body via `gjson`, bypassing the Content-Type guard.
  - For **WebSocket GET** (no body, no model): sets `shouldSelectChannel = false`
    so the request is not rejected with a 400 before reaching the handler.  The
    WebSocket connection fails naturally at the transport layer, causing Codex to
    retry with HTTP POST.

### `common/gin.go`

- `UnmarshalBodyReusable`: when the Content-Type is `application/x-www-form-urlencoded`
  but the raw body looks like JSON (starts with `{` or `[`), the body is parsed as
  JSON instead of form data.
- Added `looksLikeJSON` helper for the above check; also used as a final fallback
  when Content-Type is entirely absent or unrecognised.

### `relay/helper/valid_request.go`

- `GetAndValidateResponsesRequest`: when `UnmarshalBodyReusable` yields an empty
  `model` field (e.g. because Content-Type was absent), the model is taken from the
  gin context key `original_model` set by `Distribute()`.
- When both `model` and `input` are missing after the initial parse, the raw body is
  re-parsed directly via `common.Unmarshal` as a final fallback.
- `input` validation is skipped for GET requests (WebSocket upgrades have no body).

## Net result

Codex CLI can now point at a new-api instance by setting:

```toml
# ~/.codex/config.toml
model = "gpt-6-astra"          # or any model exposed by the instance
openai_base_url = "https://your-new-api-host"
```

```json
// ~/.codex/auth.json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "sk-..."
}
```
