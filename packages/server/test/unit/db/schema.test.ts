import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../../src/db/schema.js';

const migrationsFolder = path.resolve(fileURLToPath(import.meta.url), '../../../../drizzle');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

describe('db schema', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it('applies all migrations and round-trips a device row', async () => {
    await db.insert(schema.devices).values({
      id: 'E70000116F279030',
      name: 'Pit',
      type: 'probe',
      targetTemp: 225,
      alarmLow: 200,
      alarmHigh: 250,
      alarmType: 'ALARM_FIRE',
      currentTemp: 228.1,
    });

    const rows = await db.select().from(schema.devices);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'E70000116F279030', alarmType: 'ALARM_FIRE' });
  });

  it('round-trips a cooker + probe assignment', async () => {
    await db.insert(schema.devices).values({ id: 'DB0000116F0BEC30', name: 'Brisket', type: 'probe' });
    const [cooker] = await db
      .insert(schema.cookers)
      .values({ name: 'Backyard Brisket' })
      .returning();

    await db.insert(schema.cookerProbeAssignments).values({
      cookerId: cooker!.id,
      deviceId: 'DB0000116F0BEC30',
      role: 'food',
    });

    const assignments = await db.select().from(schema.cookerProbeAssignments);
    expect(assignments).toEqual([{ cookerId: cooker!.id, deviceId: 'DB0000116F0BEC30', role: 'food' }]);
  });

  it('round-trips a log session with readings, blower events, and notes', async () => {
    await db.insert(schema.logSessions).values({
      id: 'log-1',
      cookerName: 'Backyard Brisket',
      startedAt: '2026-08-02T12:00:00.000Z',
      endedAt: null,
    });

    await db.insert(schema.logReadings).values({
      logId: 'log-1',
      deviceId: 'E70000116F279030',
      collectedAt: '2026-08-02T12:05:00.000Z',
      tempF: 225.4,
      tempC: 107.4,
    });
    await db.insert(schema.logBlowerEvents).values({
      logId: 'log-1',
      deviceId: 'E70000116F279031',
      collectedAt: '2026-08-02T12:05:00.000Z',
      fanOn: true,
    });
    await db.insert(schema.logNotes).values({
      logId: 'log-1',
      note: 'Wrapped in butcher paper',
      createdAt: '2026-08-02T18:00:00.000Z',
    });

    expect(await db.select().from(schema.logReadings)).toHaveLength(1);
    expect(await db.select().from(schema.logBlowerEvents)).toHaveLength(1);
    expect(await db.select().from(schema.logNotes)).toHaveLength(1);
  });

  it('defaults alert_config repeatSuppressionMinutes to 10 — single source of truth', async () => {
    await db.insert(schema.alertConfig).values({});

    const [row] = await db.select().from(schema.alertConfig);
    expect(row?.repeatSuppressionMinutes).toBe(10);
  });

  it('enforces a unique cooker name', async () => {
    await db.insert(schema.cookers).values({ name: 'Backyard Brisket' });

    await expect(db.insert(schema.cookers).values({ name: 'Backyard Brisket' })).rejects.toThrow();
  });
});
