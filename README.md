# NHN
NHN 해커톤

## AERO LIVE AI proxy

The browser never holds a Gemini API key and never calls Gemini directly. AERO LIVE sends only selected game context to the Cloudflare Worker at `https://api.jukchang.com/v1/aero-live`; the Worker is the sole Gemini caller.

The public `AeroLiveAiService` interface remains unchanged:

- `generateChatBatch(context)` returns `{ chats, source }`; failed requests return an empty fallback batch.
- `classifyPlayerMessage(context)` returns the existing validated intent structure; technical failures return the existing blocked/zero-confidence result and do not become actionable input.
- `getStatus()`, `abortAll()`, and `destroy()` preserve their existing lifecycle behavior.

The Worker URL and protocol version are configured in `project/engine/script/data/scene/aero_live/aero_live_scene_constants.js`. The API client is `project/engine/script/scene/aero_live/_aero_live_api_client.js`; it keeps an ephemeral per-tab session ID only in memory and uses `credentials: 'omit'`.

For a healthy deployment, the browser Network tab should show requests only to `https://api.jukchang.com/v1/aero-live`. Seeing a Gemini API URL there means the deployment is incorrect. Failed chat generation falls back to the existing local queue; failed intent classification remains a technical failure and does not consume game progress. See `worker/README.md` for Worker-local testing and deployment notes. Never add a real API key to this repository, GitHub Actions, or the Pages artifact.
