/**
 * Drizzle schema (SQLite/better-sqlite3). Replaces the legacy flat-file config
 * (stokerweb.properties/login.properties/CookerConfig.json) and pipe-delimited cook
 * logs (LogFileFormatter.java) with real tables. Timestamps are stored as ISO-8601 text
 * to match the `/api/v1` contract directly (packages/shared-types/src/api-v1.ts) — no
 * epoch/ISO conversion needed at the API boundary.
 */

import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * One row per physical Stoker device (probe or fan), keyed by its hardware ID
 * (16-hex-char, always upper-cased — see hardware/telnet/lineParser.ts). `blowerDeviceId`
 * is set only on pit-probe rows (← legacy `StokerPitProbe.fanDevice`); plain food probes
 * and bare fans leave it null.
 */
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['probe', 'fan'] }).notNull(),
  targetTemp: integer('target_temp'),
  alarmLow: integer('alarm_low'),
  alarmHigh: integer('alarm_high'),
  alarmType: text('alarm_type', { enum: ['NONE', 'ALARM_FOOD', 'ALARM_FIRE'] }),
  currentTemp: real('current_temp'),
  fanOn: integer('fan_on', { mode: 'boolean' }),
  totalRuntime: integer('total_runtime'),
  blowerDeviceId: text('blower_device_id'),
});

export const cookers = sqliteTable('cookers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

/** Mirrors `Cooker.pitProbe` (role 'pit') vs `Cooker.probeList` (role 'food') membership. */
export const cookerProbeAssignments = sqliteTable(
  'cooker_probe_assignments',
  {
    cookerId: integer('cooker_id')
      .notNull()
      .references(() => cookers.id),
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    role: text('role', { enum: ['pit', 'food'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.cookerId, t.deviceId] })],
);

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  /** bcrypt hash — existing `$2a$`-prefixed legacy hashes verified compatible with bcryptjs. */
  passwordHash: text('password_hash').notNull(),
});

/**
 * Singleton row (id=1). StokerAlarm fields only — TempAlert/TimedAlert/
 * ConnectionOrConfigChangeAlert were non-functional legacy stubs, not ported.
 */
export const alertConfig = sqliteTable('alert_config', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  /** JSON-encoded string[]. */
  deliveryMethods: text('delivery_methods').notNull().default('[]'),
  /** JSON-encoded string[]. */
  availableDeliveryMethods: text('available_delivery_methods').notNull().default('[]'),
  /** Single source of truth — legacy had a 5-min code fallback vs. 10-min properties
   * default inconsistency; this schema has exactly one value, defaulting to 10. */
  repeatSuppressionMinutes: integer('repeat_suppression_minutes').notNull().default(10),
});

export const logSessions = sqliteTable('log_sessions', {
  id: text('id').primaryKey(),
  cookerName: text('cooker_name').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
});

/** Devices attached to a log at start time — mirrors legacy log files' `c:` header lines. */
export const logDeviceRoster = sqliteTable('log_device_roster', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  logId: text('log_id')
    .notNull()
    .references(() => logSessions.id),
  deviceId: text('device_id').notNull(),
  deviceName: text('device_name').notNull(),
  deviceType: text('device_type', { enum: ['probe', 'fan'] }).notNull(),
});

export const logReadings = sqliteTable('log_readings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  logId: text('log_id')
    .notNull()
    .references(() => logSessions.id),
  deviceId: text('device_id').notNull(),
  collectedAt: text('collected_at').notNull(),
  tempF: real('temp_f').notNull(),
  tempC: real('temp_c').notNull(),
});

export const logBlowerEvents = sqliteTable('log_blower_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  logId: text('log_id')
    .notNull()
    .references(() => logSessions.id),
  deviceId: text('device_id').notNull(),
  collectedAt: text('collected_at').notNull(),
  fanOn: integer('fan_on', { mode: 'boolean' }).notNull(),
});

/** One row per (note, logId) pair — a note added to multiple logs fans out to multiple rows. */
export const logNotes = sqliteTable('log_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  logId: text('log_id')
    .notNull()
    .references(() => logSessions.id),
  note: text('note').notNull(),
  createdAt: text('created_at').notNull(),
});

export const logWeatherSnapshots = sqliteTable('log_weather_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  logId: text('log_id')
    .notNull()
    .references(() => logSessions.id),
  collectedAt: text('collected_at').notNull(),
  tempF: real('temp_f').notNull(),
  conditionText: text('condition_text').notNull(),
});
