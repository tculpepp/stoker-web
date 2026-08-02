# Stoker-Web Rewrite: Java/GWT → Node.js + Vue 3

## Context

Stoker-web is a 10+ year old Java/GWT app (`com.gbak.sweb`) that monitors and controls a physical "Stoker" BBQ temperature controller over telnet, with browser UI, email/browser alerts, PDF cook reports, and a companion Android app. The stack (GWT 2.4.0, Guice, GWT-Comet, SmartGWT, Ant/Java 1.6) is obsolete and hard to maintain. Goal: full rewrite to a modern stack while preserving (a) the physical-hardware telnet/HTTP protocol exactly, since it talks to unchangeable firmware, and (b) the `/api/v1/*` JSON REST schema exactly, since the Android app (bitbucket.org/garybak/stokerweb-android) depends on it and will only be updated in a later, separate effort. No existing test suite exists (verified repo-wide) — this rewrite is also the first time this app gets real test coverage.

Research (3 parallel Explore passes) inventoried the full API surface, server domain logic, and client UI feature set. Ground truth below reflects verified file:line citations, not assumptions. The old app has since been moved to `legacy/` (see Phase 0) — file paths below are relative to `legacy/`.

**Decisions locked in with the user:**
- Backend: Node.js + TypeScript. Frontend: Vue 3 + TypeScript.
- GWT-RPC (`/stokerweb/stoke`) and GWT-Comet (`/stokerweb/comet`) are retired entirely — **confirmed by reading the actual Android source**: it only calls `/api/v1/devices`, `/cookers`, `/logs`, `/logs/cooker`, `/logs/note` (grep of `StokerWebDataService.java`/`SWUtil.java` shows zero GWT-RPC/Comet references). Real-time browser push moves to WebSocket.
- `/api/v1/*` schema (field names, bare-array `CookerList`, numeric-fields-as-strings in Probe DTOs, per-request cleartext-credential+bcrypt auth) is preserved byte-for-byte for now — Android update is a separate future effort.
- Known bugs get fixed, not preserved:
  1. `legacy/src/com/gbak/sweb/server/log/file/LogFileFormatter.java:111` — `prefix.compareTo(":w") == 0` should be `"w:"` (the correct constant `strWeatherPrefix = "w:"` exists at line 65 but isn't used here) — weather log lines never round-trip in the old app.
  2. `LogFileFormatter.java:554` — `float celsius = (5/9) * (f - 32);` — integer division bug, always yields 0.
  3. Alarm-repeat-minutes: code fallback constant is 5 (`StokerWebConstants.java:48`), properties-file default is 10 (`stokerweb.properties.orig:20`) — use 10 as the single source of truth, no separate hardcoded fallback.
  4. Two RPC methods (`updateStokerWebConfig`, `setAlertConfiguration`) skip the login guard that sibling methods have — new API enforces auth uniformly via a single middleware, applied to every mutating route.
- Weather: Yahoo Weather (confirmed defunct) → National Weather Service (`api.weather.gov`, free, no key, US-only — matches existing zip-code-based config).
- Cook-session logs: currently flat pipe-delimited text files — migrate into a real DB via one-time import script; all new logging goes to DB.
- Infra: containerize (Docker), add a real DB.

---

## Technology Choices

- **Database: SQLite** (`better-sqlite3`, WAL mode). This is a single-instance, self-hosted app next to one physical BBQ device — no scaling/multi-tenant need. SQLite = zero extra container/process, trivial backup (one file), plenty of throughput for once-a-minute log ticks. Design the repository layer behind an interface so Postgres is a drop-in swap later if ever needed.
- **ORM: Drizzle** — TypeScript-first, SQL-like, first-class `better-sqlite3` support, built-in migrations (`drizzle-kit`).
- **Backend framework: Fastify** — built-in JSON-schema request/response validation (directly pins the exact `/api/v1/*` wire shapes, doubling as contract-test fixtures), native async/await, WebSocket via `@fastify/websocket` in the same process/port.
- **Real-time push: WebSocket**, single `/ws` endpoint, discriminated-union envelope `{type, payload}` mirroring the old Comet message types (`probeData`, `blowerData`, `connectionState`, `weather`, `deviceState`, `alarm`, `logEvent`).
- **Telnet client:** Node `net.Socket` with an explicit line-buffered state machine (`AWAITING_LOGIN_PROMPT → AWAITING_PASSWORD_PROMPT → AWAITING_SHELL_PROMPT → STARTED → STREAMING`), replacing the old fragile substring-index matching while sending the exact same wire commands.
- **PDF reports:** Playwright (headless Chromium) rendering an HTML/CSS + Chart.js template to PDF — replaces JasperReports/iText with something testable and iterable as plain HTML.
- **Auth:** `bcryptjs` — verify early that it accepts existing `$2a$`-prefixed hashes from `login.properties` as-is (spike in Phase 1), so no forced password reset.

---

## Repository Layout (monorepo)

```
legacy/                     # old Java/GWT app (git mv'd here in Phase 0) — kept runnable for parallel validation
packages/
  shared-types/             # TS types mirroring the /api/v1 wire schema, shared by server+web
  server/                   # Node + TypeScript backend
    src/
      hardware/telnet/      # StokerTelnetClient, commands, lineParser  (← StokerTelnetController.java, StokerTelnetCommands.java, SDataPointHelper.java)
      hardware/httpConfig/  # stoker.json GET + stoker.Post_Handler POST (← StokerHardwareDevice.java)
      domain/               # pitMonitor, connectionMonitor, alerts/, eventBus (← StokerPitMonitor, ConnectionMonitor, StokerAlarm)
      logging/              # DB log writer/reader + legacyFormat/ parser used only by the importer (← LogManagerImpl, LogFileFormatter)
      weather/              # nwsClient.ts (← YahooWeatherJsonServerHelper.java)
      reports/              # reportData.ts + pdf/cookReportRenderer.ts (← ReportData.java, CookReport.jrxml)
      api/routes|schemas|auth/  # Fastify REST layer (← RestServices.java, common/json/*)
      realtime/wsGateway.ts # (← CometMessenger.java, ClientMessenger.java)
      db/                   # Drizzle schema, migrations, repositories
      config/env.ts         # (← StokerWebProperties.java)
    scripts/importLegacyLogs.ts
    test/{unit,contract,integration}/
  web/                      # Vue 3 + TypeScript frontend
    src/{components,dialogs,stores,ws,api}/
    test/ (Vitest + Playwright)
docker/{server,web}.Dockerfile, docker-compose.yml
docs/api-v1-schema.md        # frozen schema doc, source for contract tests
docs/migration-guide.md      # STOKERWEB_DIR → new config/DB migration
```

---

## Phases

### Phase 0 — Scaffolding (~3-5 days) — IN PROGRESS
`git mv` old source into `legacy/` — done. npm workspaces monorepo set up: `packages/shared-types` (API-v1 TS types), `packages/server` (Fastify+TS+Vitest, `/healthz` route working), `packages/web` (Vue3+Vite+Pinia+Vitest, app shell mounting). `docs/api-v1-schema.md` drafted from the 18 legacy DTOs. Remaining: CI workflow, Drizzle/tsup/Playwright wiring, ESLint/Prettier verification, Docker skeleton.

### Phase 1 — Domain Core: Hardware Integration + Persistence (~2-3 weeks, highest risk)
Highest risk because it talks to unchangeable firmware with zero existing tests to validate against — plan explicit hardware-in-the-loop validation, not just fixture tests.

- **DB schema** (Drizzle): `devices`, `cookers`, `cooker_probe_assignments`, `users`, `alert_config`, `log_sessions`, `log_device_roster` (mirrors old `c:` header lines), `log_readings`, `log_blower_events`, `log_notes`, `log_weather_snapshots`. Must be final before Phase 4 (log migration) starts.
- **Telnet client** (← `StokerTelnetController.java`): login `root`/`tini`, `stoker_ip`/`stoker_port` (default 23), `bbq -t` start (`StokerTelnetCommands.java`), reconnect timer every 3 min, 60s dead-connection watchdog — same protocol, cleaner state machine.
- **Line parser** (← `SDataPointHelper.java`): 16-hex-char device ID + colon at index 16, token 9 = Celsius, token 10 = Fahrenheit, tokens 11+ = `key:value` (`blwr:on`/`blwr:off`). Fix the Celsius-recompute bug at the source here.
- **HTTP device-config client** (← `StokerHardwareDevice.pullJSonConfig()`/settings-push): GET `http://<stoker_ip>/stoker.json`, POST `http://<stoker_ip>/stoker.Post_Handler` with URL-encoded `al/n1/n2/sw/ta/th/tl` — exact same wire format, distinct from the app's own `/api/v1` DTOs.
- **Domain event bus**: typed `EventEmitter` replacing Guava EventBus (`DataPointEvent`, `BlowerEvent`, `ConfigChangeEvent`, `StateChangeEvent`, `WeatherChangeEvent`), feeding the DB log-writer, the WS gateway (Phase 3), and the alert evaluator.
- **Pit monitor / connection monitor** (← `StokerPitMonitor.java`, `ConnectionMonitor.java`): live current-temps cache, cumulative blower runtime, reconnect-timeout watchdog (`timeout_to_extended_disconnect`/`timeout_to_reconnect`, defaults 30/15 min).
- **Alerts** (← `StokerAlarm.java`, the only functional alert type): high/low/target thresholds, repeat-suppression fixed to 10 minutes (single source of truth, no fallback constant). Email via `nodemailer`; browser-alert delivery now emits onto the domain bus for Phase 3's WS gateway. `TempAlert`/`TimedAlert`/`ConnectionOrConfigChangeAlert` were non-functional stubs in the old app — **not required for parity**, note as optional future work only.
- **Config**: keep a `STOKERWEB_DIR`-equivalent env var pointing at a directory with one config file (stoker IP/port, SMTP, weather zip, timeouts); move mutable app config (cooker/probe assignments, alert enable/disable, users) into the DB so it's UI-editable. One-time migration script seeds new config + `users` table from old `stokerweb.properties`/`login.properties`/`CookerConfig.json`.

**Testing:** unit tests for line parser (valid/malformed/boundary fixtures), Celsius conversion, alarm threshold/repeat-window logic (fake clock). Integration tests against a mock TCP telnet-device fixture for reconnect/watchdog logic. **Manual hardware-in-the-loop sign-off** running new client against the real Stoker device side-by-side with the old Java app before closing this phase.

### Phase 2 — REST API Layer + Contract Tests (~2 weeks)
Blocked on schema being nailed down first — draft `docs/api-v1-schema.md` (18 DTOs from `common/json/*.java`) before writing Fastify schemas or contract tests, so they can't drift apart.

Recreate every endpoint from `RestServices.java`:
- `GET /api/v1/configuration` → `{cookerList, deviceList}`; `GET /api/v1/cookers` → bare `Cooker[]` array (preserve the inconsistency vs. `configuration`); `GET /api/v1/devices`, `/devices/{id}` (comma-separated IDs, upper-cased) → `DeviceDataList{devices, receivedDate, logCount}`, polymorphic Probe/PitProbe/Blower via `type` discriminator, **numeric fields as JSON strings** (`targetTemp`, `alarmLow`/`alarmHigh`, `currentTemp`) — single most Android-breaking detail if missed, needs an explicit contract test; `POST /api/v1/devices` (auth); `GET /api/v1/logs/cooker`, `/logs/cooker/{cooker}`, `/logs/count`; `PUT /api/v1/logs/note` (auth); `PUT /api/v1/logs` (start, auth), `POST /api/v1/logs` (stop, auth); `GET /api/v1` welcome string. `GET /api/v1/Stoker.json` (hardcoded legacy data) — confirm truly unused (not found in Android grep) before dropping; flag as a decision point rather than silently deleting.
- **Auth middleware**: one reusable Fastify `preHandler` applied uniformly to every mutating route — fixes the old missing-guard bug while preserving the auth *model* (cleartext-per-request + bcrypt, no session/token) that Android currently sends.
- `GET /stokerweb/report?logFile=...` (← `ReportServlet.java`): robust query parsing via Fastify instead of the old fragile `substring(8)`; confirmed browser-only (not called by Android) — lower compatibility risk.

**Testing:** **golden-fixture contract tests** — capture real responses from the running `legacy/` app for every endpoint and assert new-server responses match byte-for-byte shape (not hand-derived expectations, which could encode a misunderstanding). Auth tests for 401 shape and uniform-guard regression. Smoke-test the actual Android app (or a scripted replay of its exact requests) against the new server.

### Phase 3 — Real-Time Push Layer (~1 week)
Single `/ws` endpoint, envelope types mapped 1:1 from old Comet messages (see Technology Choices). Config-update event **no longer forces a full page reload** — Vue store reactively patches state instead (intentional behavior improvement, needs its own regression test asserting no reload). Subscribes only to the domain event bus — no direct hardware coupling.

**Testing:** unit tests for event-bus-event → WS-message mapping; integration test with a WS client harness; manual verification that config-update doesn't reload the page.

### Phase 4 — Log Migration Tooling (~1 week, depends on Phase 1 schema being final)
Legacy parser (← `LogFileFormatter.java`) for `<STOKERWEB_DIR>/<logs_dir>/cookLogs/<yyyy>/<MM>/<yyyyMMdd_HH_mm_name>.log`, type-prefixed lines `c:`/`d:`/`b:`/`n:`/`w:` — fixing both bugs here recovers previously-unreadable weather data from historical logs. Enumerate files (mirrors `ListLogFiles.java`), bulk-insert into the new schema. Idempotent/resumable (checksum manifest). CLI with `--dry-run` for safe pre-flight against a copy of production `STOKERWEB_DIR`.

**Testing:** fixture-based unit tests (clean log, weather-lines log proving the bug fix, fan-cycle-heavy log, multi-note log) asserting correct DB rows; idempotency test (run twice, no duplicates); aggregate-stat comparison (duration, total blower runtime, reading count) against real historical logs from the user's actual deployment if available.

### Phase 5 — Vue Frontend (~3-4 weeks, largest phase)
Component-by-component replication per the UI inventory — explicitly **not** replicating confirmed-dead elements (Profiles dropdown, `StokerMenu`, `DynamicProbeComponent`, `HighstockLineGraph`/dygraphs, `DownloadIFrame`, disabled Temp/Time-alert Add buttons).

- Header (logo, connection status, Sign in/out, Reports, Configuration, Update — gated on login).
- `CookerCard.vue` (← `CookerComponent.java`): editable name, Alerts button, Logs cluster (New/Manage/End/Note) + dropdown, hidden unless logged in.
- `ProbeGauge.vue` (← `ProbeComponent`/`GaugeDisplay`/`InstantTempDisplay`/`DigitDisplayBinder`/`FanStatus`): digital/analog toggle, fan status+runtime clock, collapsible settings (target temp, alarm type with conditional high/low visibility) — staged locally, pushed only on header "Update" click (preserve batched-update UX).
- `LiveGraph.vue` (← `HighChartLineGraph.java`): Highcharts, dual-axis temp+blower, live from WS.
- `WeatherBar.vue`: read-only, WS-driven.
- Dialogs: Login, AlertsSettings, Alert (+ `Alarm1.wav` sound), NewLog, NewNote, LogFileChooser (now DB-backed instead of filesystem walk), GeneralMessage, Configuration (drag-and-drop device→cooker-slot assignment — evaluate `vue-draggable-plus` vs. hand-rolled).
- Pinia stores per domain area (connection/cooker/device/log/alert/weather), each owning REST-fetch + WS-patch logic; shared typed API client via `packages/shared-types`.

**Testing:** Vitest+Vue Test Utils component unit tests (gauge formatting, alarm-type conditional fields, staged-update batching); Playwright e2e for golden paths: login, view live temps (mock WS), start/stop a log, view a report, configure alerts.

**Can start in parallel** with Phases 3/4 once Phase 2 schemas are frozen — no hard dependency on log migration.

### Phase 6 — PDF Cook Reports (~1 week, parallel with Phase 5)
`reportData.ts` (← `ReportData.java`/`ReportDataSource.java`/`TableDataSource.java`) derives chart series + config-change/note table + summary stats (duration, fan cycles, total runtime) from the **new DB schema** — a straightforward query instead of a file re-parse. HTML template replicating `CookReport.jrxml` layout, rendered via Playwright to PDF at the same URL shape (query param may change from `?logFile=` to `?sessionId=` since flat filenames no longer exist post-migration — low risk, browser-only).

**Testing:** snapshot-test derived report data against Phase 4 migration fixtures; Playwright test that PDF renders without errors.

### Phase 7 — Deployment/Containerization (~3-5 days)
Single container/process: Fastify serves both API and static Vite build (simpler than a separate nginx container for a single-instance app). SQLite file + config on a mounted volume. `GET /healthz`. Document that the container needs LAN reachability to the Stoker device's IP (telnet + local HTTP) — host networking or explicit routing, not default bridge NAT.

**Testing:** `docker compose up` smoke test against the mock telnet fixture in CI; manual real-hardware validation before calling deployment done.

### Phase 8 — Cutover/Rollout (~1 week, mostly process)
1. Note: the physical Stoker device likely accepts only one telnet session at a time — parallel-run needs either a brief ownership toggle or validation via the mock device plus a short real-hardware maintenance window. Flag to user before scheduling.
2. Dry-run then real run of `importLegacyLogs.ts` against production `STOKERWEB_DIR` (non-destructive to source files — rollback always possible).
3. Migrate config (`stokerweb.properties`/`login.properties`/`CookerConfig.json` → new config + DB).
4. Verify Android app against new server's `/api/v1/*` (should be a non-event given Phase 2's contract tests).
5. Cut over DNS/reverse-proxy from old Tomcat/Jetty; keep old deployment available for a 1-2 week rollback window before decommissioning `legacy/`.
6. Post-cutover monitoring: WS reconnect churn, alert-delivery success, telnet reconnect frequency.

---

## Risk Summary

| Risk | Phase | Mitigation |
|---|---|---|
| Telnet/HTTP hardware protocol subtly wrong | 1 | Mock device for CI + mandatory manual hardware sign-off |
| `/api/v1/*` schema drift breaks Android | 2 | Golden-fixture contract tests from real old-app responses |
| bcrypt hash incompatibility forces password reset | 1 | Early spike verifying `$2a$` hashes work in `bcryptjs` |
| Log migration data loss/corruption | 4 | Dry-run, idempotent re-runs, aggregate-stat comparison, non-destructive to source |
| Telnet single-connection contention during cutover | 8 | Explicit maintenance-window plan |
| PDF pipeline (Playwright+Chromium) image size | 6, 7 | Flag trade-off; `pdfkit` documented as lighter fallback |

## Verification / Testing Approach

- Every phase ships with its own test suite (unit/integration/contract as specified above) — CI from Phase 0 onward.
- Central compatibility guarantee: Phase 2's golden-fixture contract tests, captured from the actual running `legacy/` app, are the mechanism that proves Android compatibility — not manual inspection.
- Real hardware and the real Android app are both explicitly brought into the loop at defined checkpoints (end of Phase 1, end of Phase 2, Phase 8) rather than assumed safe from fixtures alone.

## Critical Files (ground truth for implementation)

- `legacy/src/com/gbak/sweb/server/rest/RestServices.java`, `legacy/src/com/gbak/sweb/common/json/*.java` (18 DTOs) — REST schema, Phase 2.
- `legacy/src/com/gbak/sweb/server/data/telnet/StokerTelnetController.java`, `legacy/src/com/gbak/sweb/server/parser/stoker/SDataPointHelper.java` — hardware protocol, Phase 1.
- `legacy/src/com/gbak/sweb/server/log/file/LogFileFormatter.java` — log format + confirmed bugs (lines 111, 554), Phases 1/4.
- `legacy/src/com/gbak/sweb/server/alerts/conditions/StokerAlarm.java`, `legacy/src/com/gbak/sweb/server/StokerWebConstants.java` — alert logic + repeat-window bug, Phase 1.
- `bitbucket.org/garybak/stokerweb-android` — `StokerWebDataService.java`, `SWUtil.java` — confirmed Android API usage (only `/api/v1/*`).

---

## Progress Log

- **Phase 0 (in progress):** legacy source moved to `legacy/`. Monorepo scaffolded: root workspace config, `packages/shared-types` (built, API-v1 types), `packages/server` (Fastify skeleton, `/healthz`, unit test passing), `packages/web` (Vue3/Vite/Pinia skeleton). `docs/api-v1-schema.md` drafted. Remaining: CI, Docker skeleton, verify web test pipeline.
