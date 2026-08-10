# AERO LIVE Gemini Worker

`nhn-aero-live-api` is the only component that calls Gemini. The GitHub Pages game sends a small, validated game context to `POST /v1/aero-live`; this Worker builds the Gemini request and returns only contract-validated JSON.

## Local setup

Use Node.js 20 or later.

```sh
cd worker
npm install
npm test
```

For a local Worker session, create `worker/.dev.vars` from `.dev.vars.example`, fill in only your own local test secret, and keep that file untracked. Then run:

```sh
npx wrangler dev
```

The example file intentionally contains a placeholder only. Never place a real Gemini key in this repository, a commit, GitHub Actions, or a Pages artifact.

## Deploy

`wrangler.jsonc` declares `GEMINI_API_KEY` as a required Worker secret. In the `worker` directory, register it interactively, then deploy:

```sh
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

No key value belongs in a command, source file, or `wrangler.jsonc`.

The production route is the Custom Domain `api.jukchang.com` (`custom_domain: true`). The domain must be active in the same Cloudflare account and its DNS must be Cloudflare-managed before the first deployment. `workers.dev` remains enabled for initial Worker testing; the game itself calls only:

```text
https://api.jukchang.com/v1/aero-live
```

The only allowed browser Origin is exactly `https://querido-fue.github.io`. There is no wildcard Origin and no credentialed CORS mode.

The browser endpoint and proxy version are configured in `project/engine/script/data/scene/aero_live/aero_live_scene_constants.js`. In a healthy Pages deployment, the browser Network tab shows `https://api.jukchang.com/v1/aero-live` only; a Gemini API URL in the browser means the deployment is incorrect. Chat failures use the game's existing local fallback path, while intent failures remain non-actionable technical failures.

## Request context contract

The Worker discards every unrecognized context key and creates a new safe object before calling `AeroLiveLlmContract`.

| Lane | Minimum selected fields used by `AeroLiveLlmContract` |
| --- | --- |
| `chat` | `topicId`, `topicTitle`, `topicConcept`, `beatId`, `beatIndex`, `beatCount`, `heroText`, `mood`, `activeEvent.{id,kind,text,tone}`, `opinion`, `referenceChats[].{sentiment,text}`, `fallbackChats[].{viewerId,sentiment,text}`, `viewerIds[]` |
| `intent` | `message`, `topic`, `heroText`, `coreChatText`, `coreChatViewerId`, `viewerIds[]` |

The browser never sends a Gemini model, endpoint, `systemInstruction`, `generationConfig`, or a finished Gemini request body. The Worker fixes the existing game models by lane: chat uses `gemini-3.6-flash`; intent uses `gemini-3.5-flash-lite`.

## Rate limits

The three `ratelimits` entries in `wrangler.jsonc` are the adjustment point:

- `AERO_LIVE_SESSION_LIMITER`: 18 requests/minute for each `X-Game-Session` and lane.
- `AERO_LIVE_IP_LIMITER`: 90 requests/minute for each `CF-Connecting-IP` and lane.
- `AERO_LIVE_INVALID_LIMITER`: 20 invalid requests/minute per IP.

This gives a normal tab enough room for beat chat and player inputs, while a disposable session still meets a slower IP backstop. All bindings use separate namespace IDs; change `namespace_id` values to unused positive integers if they collide with an existing namespace in the Cloudflare account. A limited request receives `429` and `Retry-After: 60`.

## Health check and rollback

After deployment:

```sh
curl https://api.jukchang.com/health
```

The expected payload has `ok: true`, service `aero-live-api`, and version `aero-live-proxy-v1`.

If a deployment fails after release, use the Cloudflare Workers dashboard's Versions & deployments page or, from this directory, roll back to the prior deployed version:

```sh
npx wrangler rollback
```

Rollback changes the active Worker only; it does not change the secret or the rate-limit bindings. Re-run the health check afterward.
