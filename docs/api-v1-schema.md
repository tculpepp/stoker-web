# /api/v1/* Frozen Schema

Authoritative source of truth for the REST API the rewrite must preserve byte-compatibly,
since the Android app (bitbucket.org/garybak/stokerweb-android) depends on it as-is.
Mirrored as TypeScript types in `packages/shared-types/src/api-v1.ts` — keep both in sync;
this doc is the human-readable reference, the TS file is what code actually imports.

Legacy source of truth: `legacy/src/com/gbak/sweb/server/rest/RestServices.java` and
`legacy/src/com/gbak/sweb/common/json/*.java`.

Status: **draft, pending Phase 2 golden-fixture capture** against the running `legacy/` app
to confirm exact wire values (especially Date serialization — see note below).

## Endpoints

| Method | Path | Auth | Request body | Response |
|---|---|---|---|---|
| GET | `/api/v1/Stoker.json` | none | — | hardcoded static JSON — confirm unused by Android before dropping (not found in Android source grep) |
| GET | `/api/v1/configuration` | none | — | `ConfigurationSettings` |
| GET | `/api/v1/cookers` | none | — | bare `Cooker[]` array (no wrapper object) |
| GET | `/api/v1/devices` | none | — | `DeviceDataList` (all devices) |
| GET | `/api/v1/devices/{id}` | none | `id` = comma-separated device IDs (case-insensitive, server upper-cases) | `DeviceDataList` (filtered) |
| POST | `/api/v1/devices` | required | `ServerRequest<DeviceDataList>` | `ServerResponse<string>`, or 401 |
| GET | `/api/v1/logs/cooker` | none | — | `LogItemList` (all cookers) |
| GET | `/api/v1/logs/cooker/{cooker}` | none | `cooker` path param | `LogItemList` (one cooker) |
| GET | `/api/v1/logs/count` | none | — | `LogItemCount` |
| PUT | `/api/v1/logs/note` | required | `ServerRequest<LogNote>` | `ServerResponse<string>` (201), or 401 |
| PUT | `/api/v1/logs` | required | `ServerRequest<LogItem>` (start a log) | `ServerResponse<string>` (201), or 401 |
| POST | `/api/v1/logs` | required | `ServerRequest<LogItem>` (stop a log; only cookerName/logName used) | `ServerResponse<string>`, or 401 |
| GET | `/api/v1` | none | — | static HTML welcome string |

`GET /stokerweb/report?logFile=<name>` also exists (PDF cook report) — browser-only,
confirmed not used by Android, lower compatibility priority. See main plan Phase 2/6.

## Auth model (preserve as-is for Android compatibility)

No session/cookie/token. Every mutating endpoint carries `{login: {username, password}}`
in the JSON body on **every request**, checked fresh against a bcrypt hash each time.
Bad credentials → HTTP 401, body `{success: false, messages: ["Invalid login ID or password"], ...}`.
Read-only GETs require no auth at all. The new server must apply this check **uniformly**
via one middleware — the legacy app had two RPC methods that skipped the guard; that gap
must not carry over into the REST auth wiring.

## Wire-format quirks to preserve exactly

1. **`CookerList` serializes as a bare JSON array**, not wrapped in `{...}`, even though
   most other list-bearing DTOs (`ConfigurationSettings.cookerList`) nest it as a field.
2. **Numeric-looking Probe fields are JSON strings**: `targetTemp`, `alarmLow` (legacy
   field `lowerTempAlarm`), `alarmHigh` (legacy field `upperTempAlarm`), `currentTemp`.
   E.g. `"targetTemp": "225"`, not `"targetTemp": 225`. This is the single most
   Android-breaking detail if missed — needs an explicit contract test.
3. **Device IDs are always upper-cased** server-side before serialization.
4. **Date fields are presumed epoch-millisecond numbers** (old Jackson `org.codehaus.jackson`
   default), not ISO-8601 strings — `submitTime`, `date`, `receivedDate`, `startDate`.
   **Unconfirmed** — must be verified against a real captured response in Phase 2 before
   the contract tests are written; do not assume without a live capture.
5. Fields not covered by any live endpoint (`LogItemCountList`, `ItemCount`, `Alert`/`AlertType`
   from `common/json/*.java`) are dead DTOs in the legacy app — omitted from
   `shared-types` unless a hidden Android call surfaces that needs them.

## Verification checklist (Phase 2)

- [ ] Capture real JSON responses from a running `legacy/` deployment for every endpoint above.
- [ ] Confirm Date field serialization format (epoch millis vs. ISO string).
- [ ] Confirm `/api/v1/Stoker.json` is truly unused by Android (re-grep Android source; decide keep/drop).
- [ ] Contract test asserting `typeof devices[0].currentTemp === 'string'` (and siblings).
- [ ] Contract test asserting `/api/v1/cookers` response is a bare array via `Array.isArray`.
