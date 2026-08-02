# /api/v1/* Schema (Phase 0.5 — new contract)

Authoritative human-readable reference for the new REST contract. Mirrored as TypeScript
types in `packages/shared-types/src/api-v1.ts` (REST) and `src/ws.ts` (WS push) — those
files are what code actually imports; keep both in sync with this doc. Example payloads
live in `docs/fixtures/*.json`.

This is **not** wire-compatible with the legacy Android app's `/api/v1/*` (see
`legacy/src/com/gbak/sweb/server/rest/RestServices.java` for that ground truth) or with
the legacy GWT-RPC surface (`legacy/src/com/gbak/sweb/client/StokerCoreService.java`,
`server/StokerCoreServiceImpl.java`). Both the Vue browser client and the Android rewrite
build against this contract together — there is no existing implementation of it to stay
compatible with, so nothing here needs to preserve legacy quirks.

## Endpoints

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | none | `LoginRequest` | `LoginResponse` |
| GET | `/api/v1/cookers` | bearer | — | `CookersResponse` |
| GET | `/api/v1/devices` | bearer | — | `DevicesResponse` |
| PATCH | `/api/v1/devices` | bearer | `PatchDevicesRequest` | 204 |
| GET | `/api/v1/config` | bearer | — | `ConfigResponse` |
| PUT | `/api/v1/config/cookers` | bearer | `UpdateCookersRequest` | 204 |
| GET | `/api/v1/alerts/config` | bearer | — | `AlertConfig` |
| PUT | `/api/v1/alerts/config` | bearer | `AlertConfig` | 204 |
| GET | `/api/v1/logs?cooker=<name>` | bearer | `cooker` query param, optional (omit for all cookers) | `LogsResponse` |
| POST | `/api/v1/logs` | bearer | `StartLogRequest` | `StartLogResponse` (201) |
| POST | `/api/v1/logs/{logId}/stop` | bearer | — | 204 |
| POST | `/api/v1/logs/notes` | bearer | `AddLogNotesRequest` | 204 |
| GET | `/api/v1/logs/{logId}/readings` | bearer | — | `LogReadingsResponse` |

All endpoints except `POST /api/v1/auth/login` require `Authorization: Bearer <token>`.
Read-only GETs are bearer-gated too (unlike the legacy REST API, which left GETs open) —
one uniform auth `preHandler` on every route, no per-route opt-in. Bad/missing token →
401 with `ApiErrorResponse`.

## What changed from the legacy contract, and why

| Aspect | Legacy | New | Why |
|---|---|---|---|
| Numeric probe fields | JSON strings (`"targetTemp": "225"`) | real `number` | Legacy quirk existed only because old Android code parsed it that way; no reason to keep with both clients rewritten. |
| Cookers list | bare array on `/cookers`, wrapped elsewhere (`ConfigurationSettings.cookerList`) | always `{ cookers: Cooker[] }` | Consistency — one shape for "list of cookers" everywhere. |
| Dates | assumed epoch-millis, never confirmed | ISO-8601 strings | Human-readable, unambiguous, no serializer-default guessing. |
| Auth | REST: per-request cleartext+bcrypt; RPC: session cookie — two models | `POST /api/v1/auth/login` → `{token, expiresAt}`; bearer token on mutating + read routes | One model instead of two; token has an expiry instead of living forever. |
| Config | RPC-only (`getDeviceConfiguration`/`updateStokerWebConfig`) | `GET /api/v1/config`, `PUT /api/v1/config/cookers` | RPC is retired; REST must carry everything the Vue Configuration dialog needs. |
| Per-probe settings | REST `POST /api/v1/devices` + RPC `updateTempAndAlarmSettings()` (two paths) | unified `PATCH /api/v1/devices` | One path instead of two overlapping ones. |
| Alert config | RPC-only (`getAlertConfiguration`/`setAlertConfiguration`) | `GET/PUT /api/v1/alerts/config` (StokerAlarm fields only) | RPC retired; `TempAlert`/`TimedAlert`/`ConnectionOrConfigChangeAlert` were non-functional stubs, not carried forward. |
| Log list | `/logs/cooker` + `/logs/cooker/{cooker}` | `GET /api/v1/logs?cooker=<name>` | One endpoint, optional filter, instead of two paths. |
| Graph data | RPC-only (`getNewGraphDataPoints`/`getAllGraphDataPoints`) | `GET /api/v1/logs/{logId}/readings` | RPC retired; needed by both Vue LiveGraph and Android log detail. |
| Start/stop log | same path, PUT=start/POST=stop (verb-overloaded) | `POST /api/v1/logs` (start) → `logId`; `POST /api/v1/logs/{logId}/stop` | Distinct paths instead of same path with different verbs meaning different things. |
| Notes | `PUT /api/v1/logs/note` | `POST /api/v1/logs/notes` `{note, logIds[]}` | Naming/verb consistency with the rest of the surface. |
| Reattach-to-log | RPC `attachToExistingLog` | dropped | DB-backed open sessions auto-resume on reconnect — no manual reattach needed. |
| WS | Comet, browser-only | `/ws`, explicitly multi-client (Web + Android), anonymous-subscribe broadcast | Android is now a second real-time consumer, not just the browser. |

## Dropped entirely (confirmed zero callers)

`GET /api/v1/Stoker.json`, `GET /api/v1/configuration` (replaced by `/api/v1/config`),
`GET /api/v1/devices/{id}` (single-device fetch — client-side filter of `/devices`
instead), `GET /api/v1/logs/count`.

## WS message types (`packages/shared-types/src/ws.ts`)

`/ws` broadcasts a flat discriminated union on `type`: `device-update`,
`connection-state`, `weather-update`, `alarm`, `config-change`, `log-event`. See `ws.ts`
for exact payload shapes per type. Any connected client (Web or Android) receives every
message — there's no per-client filtering or subscription handshake.

## Verification checklist (Phase 2)

- [ ] Contract tests in `packages/server/test/contract/*.test.ts` validate every endpoint
      above against `docs/fixtures/*.json`.
- [ ] Contract test asserting probe numeric fields are real JSON numbers, not strings.
- [ ] Contract test asserting `/api/v1/cookers` returns `{ cookers: [...] }`, not a bare array.
- [ ] Contract test asserting every mutating + read route 401s without a valid bearer token.
- [ ] WS test asserting two simultaneous clients both receive the same broadcast (Phase 3).
