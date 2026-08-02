# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Stoker-web monitors and controls a physical Stoker BBQ power draft controller from a
browser (temp graphs, logging, PDF cook reports, email alerts, weather). **This repo is
mid-rewrite** from a 10+ year old Java/GWT app to Node.js/TypeScript (Fastify) + Vue 3.
Read `plan.md` in full before doing any work here — it has the locked-in tech decisions,
three confirmed bugs to fix (not preserve, with exact file:line), a phase-by-phase task
breakdown, legacy-file → new-file mappings, and a Progress Log with the current phase
status (check that log for what's actually done vs. planned).

The old app was `git mv`'d intact into `legacy/` and is kept runnable as the reference
implementation — for hardware-in-the-loop validation and as ground truth for the exact
telnet/HTTP wire protocol (talks to unchangeable firmware) and the `/api/v1/*` REST
schema (must stay byte-compatible with the companion Android app in sibling repo
`../stokerweb-android`, which is only updated in a later, separate effort).

## Build / dev commands (new stack — npm workspaces, run from repo root)

- `npm install` — installs all workspace packages
- `npm run dev:server` — Fastify dev server (`packages/server`, `tsx watch`)
- `npm run dev:web` — Vite dev server (`packages/web`, Vue 3)
- `npm run build` — builds `shared-types` → `server` → `web` in that order (dependency
  order matters: server/web both depend on `shared-types`'s `dist/`)
- `npm test` — runs server + web Vitest suites
- `npm run lint` — eslint over `.ts`/`.vue` (see `eslint.config.js`; `legacy/`, `dist/`,
  `node_modules/` excluded)
- `npm run typecheck` — `tsc`/`vue-tsc` `--noEmit` for server + web
- Single package: `npm run test -w @stoker-web/server`, `npm run dev -w @stoker-web/web`, etc.
- Single test file: `npm run test -w @stoker-web/server -- path/to/file.test.ts` (Vitest)

Code style: Prettier (`semi: true`, `singleQuote: true`, `printWidth: 100`,
`trailingComma: all`), TS `strict` + `noUncheckedIndexedAccess` (`tsconfig.base.json`).

## Architecture (new stack)

- `packages/shared-types` — TS types mirroring the `/api/v1` wire schema
  (`src/api-v1.ts`), consumed by both server and web.
- `packages/server` — Fastify + TypeScript backend (`src/app.ts`/`src/server.ts`,
  `src/api/routes/`). Per `plan.md`'s target layout, will grow: telnet hardware client
  (`hardware/telnet/`), HTTP device-config client (`hardware/httpConfig/`), domain event
  bus + alerts (`domain/`), DB via Drizzle/SQLite (`db/`), WS gateway (`realtime/`), PDF
  reports (`reports/`), weather (`weather/`) — each with a legacy-file cross-reference in
  `plan.md`.
- `packages/web` — Vue 3 + Vite + Pinia frontend (`src/components`, `src/dialogs`,
  `src/stores`, `src/ws`, `src/api`).
- `docs/api-v1-schema.md` — frozen REST schema doc (18 DTOs from legacy
  `common/json/*.java`); source for contract tests. Any change to `/api/v1/*` shapes
  must stay Android-compatible.
- `legacy/` — the original Java/GWT app, unchanged except for its new location; see
  below. Don't add new features here — port forward into `packages/` instead.

## Legacy app reference (`legacy/`) — Java/GWT

Kept runnable in parallel as the source of truth for exact protocol/schema behavior.
Paths below are relative to `legacy/`.

**Build**: Ant + GWT 2.4.0 (old toolchain, Java source/target 1.6). No Maven/Gradle.
- `ant javac` — compile server/shared Java to `war/WEB-INF/classes`
- `ant gwtc` / `ant build` — GWT-compile client Java to JS
- `ant war` — produce `stokerweb.war` (depends on `build` + `addUser`)
- `ant common` — build `stokerweb-common.jar` (shared model classes for Android client)
- `ant addUser` — build standalone `addUser.jar` (CLI to create login credentials)
- `ant release` — full release zip; `ant clean` — remove build output

`build.xml` hardcodes `gwt.dir`/`gwt.sdk` to a Windows path — override with
`-Dgwt.sdk=... -Dgwt.dir=...`. Third-party jars are checked into `war/WEB-INF/lib`, not
fetched by a package manager. No test runner target; the one test
(`test/sweb/StokerWebTest.java`) is a `GWTTestCase`, run via GWT's JUnit integration.

**Running**: `runStokerweb.jar` (war + embedded Jetty) or deploy `stokerweb.war` to
Tomcat/Jetty. Runtime config/logs live outside the war in `STOKERWEB_DIR` (must contain
`stokerweb.properties` + `login.properties`; `.orig` templates in `war/`). `addUser.jar`
creates login credentials in that directory.

**Architecture** — GWT split under `src/com/gbak/sweb/`:
- `client/` — GWT client, compiled to JS. Entry point `client/StokerWeb.java`. UI via
  SmartGWT + UiBinder (`*.ui.xml`), Highcharts/dygraphs for graphs.
- `server/` — servlets, Guice bindings, hardware polling, alerts, reports.
- `shared/` — model/DTO classes used by both client and server.
- `common/` — subset of shared JSON model classes packaged into `stokerweb-common.jar`
  for the Android client (`ant common` target).

**Dependency injection**: Guice, wired in `server/DispatchServletModule.java`, bootstrapped
by `server/StokerWebServletConfig.java` (registered in `web.xml`). `web.xml` itself has
almost everything commented out — Guice's `serve()`/`filter()` calls are the real servlet
mappings (GWT-RPC at `/stokerweb/stoke`, Comet push at `/stokerweb/comet`, reports at
`/stokerweb/report`, Jersey REST under `/api/*`).

**Data flow, hardware → browser**:
1. `server/data/telnet/StokerTelnetController.java` polls the Stoker over telnet.
2. `server/parser/stoker/SDataPointHelper.java` parses responses into
   `shared/model/data/*DataPoint` objects.
3. `server/monitors/stoker/StokerPitMonitor.java` turns polled data into events
   published on a Guice-bound Guava `EventBus`.
4. `server/alerts/AlertsManagerImpl.java` + `conditions/*` evaluate alert rules
   (`TempAlert`, `StokerAlarm`, `TimedAlert`, `ConnectionOrConfigChangeAlert`); matches go
   through `alerts/delivery/*` via `Messenger`.
5. Live updates reach the browser via Comet, not client polling.
6. Client-initiated calls (settings, cooker config, log actions) use GWT-RPC
   (`client/StokerCoreService(Async)` → `server/StokerCoreServiceImpl.java`).

**Logging of cook sessions**: `server/log/LogManagerImpl.java` +
`server/log/file/StokerFile.java` read/write flat pipe-delimited log files (not a DB);
`server/log/file/ListLogFiles.java` enumerates them. PDF reports via JasperReports from
`war/reports/CookReport.jrxml`, driven by `server/report/ReportData.java` and served by
`server/ReportServlet.java`.

**Config**: `server/StokerWebProperties.java` loads `stokerweb.properties` from
`STOKERWEB_DIR`. `server/config/StokerWebConfiguration.java` +
`server/config/stoker/StokerHardwareDevice.java` hold the runtime hardware/config model.

**Auth**: `server/security/User.java` + `BCrypt.java` for password hashing,
`server/security/LoginProperties.java` reads/writes `login.properties`.
`server/security/admin/AddUser.java` is the standalone CLI (`addUser.jar`).
