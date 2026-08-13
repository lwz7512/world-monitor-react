# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

created at 2026/07/25

## What This Project Is

**World Monitor** is a real-time global intelligence dashboard — a TypeScript SPA (Vite + Preact/Vanilla TS) with 169+ component files, 80+ Vercel Edge API endpoints, a Tauri v2 desktop app (macOS/Windows/Linux) with a Node.js sidecar, and a Railway relay/seed service. It aggregates geopolitics, military, finance, climate, cyber, maritime, and aviation data from 65+ upstream providers into a unified interactive map and panel grid.

## Commands

```bash
npm ci                          # Deterministic install
npm run dev                     # Vite dev server (full variant)
npm run dev:tech                # Tech-focused variant
npm run dev:finance             # Finance variant
npm run typecheck               # tsc --noEmit (frontend)
npm run typecheck:api           # tsc --noEmit for API layer
npm run typecheck:all           # Both tsconfigs + Convex audit
npm run lint                    # Biome lint + safe-html check
npm run lint:fix                # Biome autofix
npm run lint:boundaries         # Enforce src/ dependency direction
npm run test:data               # Unit/integration tests (node:test, --test-concurrency=16)
npm run test:sidecar            # Sidecar + API handler tests
npm run test:e2e:full           # Playwright E2E (full variant)
make generate                   # Regenerate proto stubs + OpenAPI (requires buf + sebuf v0.11.1)
npm run worktree:bootstrap      # Fresh worktree: link env files + npm ci with /tmp cache
```

Run a single test file:
```bash
./node_modules/.bin/tsx --test tests/my-file.test.mts
node --test tests/my-file.test.mjs
```

Run a single Playwright spec:
```bash
npx playwright test e2e/my-spec.spec.ts
```

**Worktree warning**: Run heavy checks (typecheck, `test:data`, edge bundle) **sequentially** — parallel runs OOM (exit 137).

## Architecture

### System Topology

```
Browser / Desktop (SPA)
  └─ fetch /api/*
       ├─ Vercel Edge Functions (api/)  ←→  Upstash Redis
       │    └─ server/ bundled in          └─ 65+ upstream APIs
       ├─ Railway AIS Relay + Seeds
       └─ Tauri Node.js Sidecar (desktop only)
```

- **Vercel**: SPA static files + Edge Functions + middleware (bot filtering, social OG)
- **Cloudflare Worker** (`workers/`): CORS preflight for `api.worldmonitor.app`
- **Railway**: AIS WebSocket relay, market/aviation/risk seed loops, RSS proxy
- **Upstash Redis**: Four-layer cache (seed → in-memory → Redis → upstream), rate limiting, stampede protection
- **Convex**: Contact form and waitlist only
- **Tauri 2.x**: Desktop shell (Rust) + Node.js sidecar for local API routing

### Frontend (`src/`)

**Entry**: `src/main.ts` → `App.ts`. App initializes in 8 sequential phases: storage/i18n → ML worker (ONNX) → sidecar probe → bootstrap hydration → layout → UI components → data load → polling.

**Component model**: All panels extend `Panel` base class (`src/components/Panel.ts`). They render via `setContent(html)` (debounced 150ms) and use event delegation on `this.content`. No external state library — `AppContext` is a single mutable object holding map refs, panel instances, all cached data, and in-flight request state.

**Dual map system**:
- `DeckGLMap`: WebGL via deck.gl + maplibre-gl, PMTiles self-hosted basemap, Supercluster for clustering
- `GlobeMap`: 3D via globe.gl, `_kind` discriminator on a single merged data array

**Web Workers** (`src/workers/`):
- `analysis.worker.ts`: News clustering (Jaccard), cross-domain correlation
- `ml.worker.ts`: ONNX inference (`@xenova/transformers`) — embeddings, sentiment, NER, summarization
- `vector-db.ts`: IndexedDB-backed semantic search store

**Variant system**: Hostname-detected (`tech.worldmonitor.app` → tech) or localStorage on desktop. Controls default panels, map layers, refresh intervals, and theme. Config in `src/config/variants/`. Set via `VITE_VARIANT` env var at build/dev time.

**Dependency direction** (enforced by `lint:boundaries`):
```
types → config → services → components → app → App.ts
```
`types/` has zero internal imports; each layer imports only from layers to its left.

### API Layer (`api/` + `server/`)

**Edge Functions** (`api/`): Plain `.js` files deployed to Vercel Edge runtime. Self-contained — they cannot import from `../src/` or `../server/`. They import only same-directory `_*.js` helpers and npm packages. Enforced by `tests/edge-functions.test.mjs` and the pre-push esbuild bundle check.

**Gateway factory** (`server/gateway.ts`): `createDomainGateway(routes)` composes a 10-step pipeline per request: origin check → CORS → OPTIONS → API key → rate limit → route match → POST-to-GET compat → handler → ETag (FNV-1a) → cache headers.

**Domain handlers** (`server/worldmonitor/<domain>/v1/handler.ts`): Each RPC function calls `cachedFetchJson()` from `server/_shared/redis.ts` which coalesces concurrent cache misses (stampede protection). **Cache key MUST include all request-varying parameters** — omitting one causes cross-request data leakage.

**Cache tiers** (s-maxage): fast 300s · medium 600s · slow 1800s · static 7200s · daily 86400s · no-store 0s

**Shared helpers**: `_cors.js` (origin allowlist), `_rate-limit.js` (Upstash sliding window), `_api-key.js` (origin-aware key validation), `_relay.js` (Railway proxy factory).

### Proto/RPC Contract (Sebuf)

```
proto/ → buf generate → src/generated/client/ (client stubs)
                      → src/generated/server/ (message types)
                      → docs/api/             (OpenAPI specs)
```

`src/generated/` is **auto-generated — never edit by hand**. Run `make generate` after proto changes. CI (`proto-check.yml`) fails if committed output diverges from generated output.

Rules:
- GET fields require `(sebuf.http.query)` annotation
- `repeated string` fields need `parseStringArray()` in the handler
- `int64` maps to `string` in TypeScript
- New endpoints not fitting the proto contract go in `api/api-route-exceptions.json`

### Data Pipeline

**Bootstrap hydration**: `/api/bootstrap` reads all cached Redis keys in a single batch. SPA fetches two tiers concurrently (fast 3s timeout, slow 5s timeout). Hydrated values are one-shot — consumed once by `getHydratedData(key)`.

**Seed scripts** (`scripts/seed-*.mjs`): Fetch upstream → transform → `atomicPublish()` to Redis. Atomic publish: acquire SET NX lock → validate → write cache key → write `seed-meta:<key>` with `{fetchedAt, recordCount}` → release. **Every new data source MUST wire bootstrap hydration in `api/bootstrap.js` and write `seed-meta:<key>`** for health monitoring.

**Health** (`api/health.js`): Reads `seed-meta:<key>` per key, compares `fetchedAt` against `maxStaleMin`. Returns per-key OK / STALE / WARN / EMPTY.

### Desktop (`src-tauri/`)

**Tauri shell** (Rust, `src-tauri/src/main.rs`): Manages keyring (platform-native secret storage), sidecar lifecycle, and window management.

**Node.js sidecar** (`src-tauri/sidecar/local-api-server.mjs`): Dynamically loads `api/` handler modules, injects keyring secrets as env vars, monkey-patches `globalThis.fetch` to force IPv4 (many government APIs have broken IPv6 stacks).

**Fetch patching** (`src/services/runtime.ts`): On desktop, `window.fetch` is replaced. All `/api/*` calls route to sidecar with a 5-min TTL bearer token; fallback to cloud API on sidecar failure.

## Critical Conventions

- **`fetch.bind(globalThis)` is banned.** Use `(...args) => globalThis.fetch(...args)` instead.
- Edge Functions cannot use `node:http`, `node:https`, or `node:zlib`.
- Always include a `User-Agent` header in server-side fetch calls.
- Yahoo Finance requests must be staggered with 150ms delays.
- CSP must stay in sync across three locations: `index.html` `<meta>`, `vercel.json` HTTP header, and `src-tauri/tauri.conf.json`.
- Cloudflare apex-redirect exemptions (`/mcp*`, `/oauth/*`, `/.well-known/*`, `robots.txt`, `security.txt`) are load-bearing — altering them breaks MCP clients or OAuth flows.

## Testing

- **Unit/integration**: `node:test` runner, files in `tests/*.test.{mjs,mts}`
- **Sidecar/API**: `node:test`, files in `api/*.test.mjs` and `src-tauri/sidecar/*.test.mjs`
- **E2E**: Playwright (`e2e/*.spec.ts`), covers theme, circuit breakers, keyword spikes, mobile map, runtime fetch patching, and visual regression per variant
- **Edge function guardrail**: `tests/edge-functions.test.mjs` verifies no `node:` imports or cross-directory imports in `api/*.js`

## Pre-Push Hook

Runs automatically before every `git push`. Checks (diff-scoped):
1. TypeScript (`tsc --noEmit` for affected layers)
2. CJS syntax validation
3. Edge function esbuild bundle check
4. Edge function import guardrail test
5. Biome lint, boundary/safe-html/Sentry-coverage/rate-limit/premium-fetch lints
6. Markdown and MDX lint
7. Version sync check

Green-tree cache (`$GIT_DIR/wm-prepush-green`): an identical tree re-push skips all tree-dependent checks. Delete that file to force a full re-run.

## Adding a New API Endpoint

1. Define proto message in `proto/worldmonitor/<domain>/`
2. Add RPC with `(sebuf.http.config)` annotation
3. Run `make generate`
4. Create handler in `server/worldmonitor/<domain>/v1/handler.ts`
5. Use `cachedFetchJson()` — include all request-varying params in cache key
6. Wire in `api/bootstrap.js` + write `seed-meta:<key>` in seed script

## Adding a New Panel

1. Create `src/components/MyPanel.ts` extending `Panel`
2. Register in `src/config/panels.ts`
3. Add to relevant variant configs in `src/config/variants/`
4. Wire data loading in `src/app/data-loader.ts`

## Key Reference Files

- `ARCHITECTURE.md` — full system reference with diagrams
- `AGENTS.md` — agent workflow rules (merge authority, worktree hygiene, CI polling)
- `CONCEPTS.md` — project-specific vocabulary (bootstrap tiers, seed-owned keys, lever test)
- `docs/architecture.mdx` — design philosophy and decision rationale
- `docs/adding-endpoints.mdx` — endpoint addition walkthrough
- `api/api-route-exceptions.json` — endpoints exempt from proto-contract enforcement
- `tests/edge-functions.test.mjs` — edge function import guardrail
- `scripts/docs-stats.mjs` — source of truth for capability counts in ARCHITECTURE.md (run `npm run docs:stats` to update)
