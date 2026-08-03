#!/usr/bin/env tsx
/**
 * Manual hardware-in-the-loop validation tool for STO-17 (Phase 1 sign-off). Wires the
 * telnet client, httpConfig client, and domain layer together against a **real** Stoker
 * device and logs everything to the console — there's no REST API (Phase 2) yet to hang
 * this off of, so it runs standalone.
 *
 * Usage (from packages/server/):
 *   npx tsx scripts/validateHardware.ts config --host 192.168.1.50
 *   npx tsx scripts/validateHardware.ts stream --host 192.168.1.50 [--watchdog-ms 60000] [--reconnect-ms 180000]
 *   npx tsx scripts/validateHardware.ts push --host 192.168.1.50 --device E70000116F279030 --target-temp 226
 *
 * See docs/hardware-validation.md (Linear STO-17) for the full sign-off checklist this
 * tool supports: login/streaming, config read, config write, reconnect/watchdog, and an
 * extended soak test.
 */

import { fetchConfig, pushSettings } from '../src/hardware/httpConfig/stokerConfigClient.js';
import type { RawDevice, RawProbeDevice } from '../src/hardware/httpConfig/types.js';
import { StokerTelnetClient } from '../src/hardware/telnet/stokerTelnetClient.js';
import { DomainEventBus } from '../src/domain/eventBus.js';
import { PitMonitor } from '../src/domain/pitMonitor.js';
import { ConnectionMonitor } from '../src/domain/connectionMonitor.js';
import { AlarmEvaluator } from '../src/domain/alerts/alarmEvaluator.js';
import type { Device, PitProbe, Blower } from '@stoker-web/shared-types';

function parseArgs(argv: string[]): { command: string; options: Record<string, string> } {
  const [command, ...rest] = argv;
  const options: Record<string, string> = {};

  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`Malformed argument near "${flag ?? ''}" — expected --flag value pairs`);
    }
    options[flag.slice(2)] = value;
  }

  return { command: command ?? '', options };
}

function log(label: string, data: unknown): void {
  console.log(`[${new Date().toISOString()}] ${label}`, JSON.stringify(data));
}

/** Assembles fetched raw devices into the shared-types Device shape pushSettings expects. */
function toApiDevices(rawDevices: RawDevice[]): Device[] {
  const byId = new Map(rawDevices.map((d) => [d.id, d]));

  return rawDevices.map((raw): Device => {
    if (raw.type === 'fan') {
      return { id: raw.id, name: raw.name, type: 'fan', fanOn: raw.fanOn, totalRuntime: 0 };
    }

    const probe = raw as RawProbeDevice;
    const base = {
      id: probe.id,
      name: probe.name,
      type: 'probe' as const,
      targetTemp: probe.targetTemp,
      alarmLow: probe.alarmLow,
      alarmHigh: probe.alarmHigh,
      alarmType: probe.alarmType,
      currentTemp: probe.currentTemp,
    };

    if (!probe.blowerId) return base;

    const blowerRaw = byId.get(probe.blowerId);
    if (!blowerRaw || blowerRaw.type !== 'fan') return base;

    const blower: Blower = {
      id: blowerRaw.id,
      name: blowerRaw.name,
      type: 'fan',
      fanOn: blowerRaw.fanOn,
      totalRuntime: 0,
    };
    return { ...base, blower } satisfies PitProbe;
  });
}

async function runConfig(host: string): Promise<void> {
  console.log(`Fetching stoker.json from ${host} ...`);
  const devices = await fetchConfig(host);
  console.log(`Parsed ${devices.length} device(s):`);
  for (const d of devices) log('device', d);
}

async function runPush(host: string, deviceId: string, targetTemp: number): Promise<void> {
  const raw = await fetchConfig(host);
  const target = raw.find((d) => d.id === deviceId);
  if (!target) throw new Error(`Device ${deviceId} not found in stoker.json`);
  if (target.type !== 'probe') throw new Error(`Device ${deviceId} is not a probe`);

  const apiDevices = toApiDevices(raw);
  const apiTarget = apiDevices.find((d) => d.id === deviceId) as Extract<Device, { type: 'probe' }>;
  const updated: Device = { ...apiTarget, targetTemp };

  console.log(`Current targetTemp: ${target.targetTemp}. Pushing new targetTemp: ${targetTemp}`);
  await pushSettings(host, [updated]);
  console.log('Push accepted. Re-fetching to confirm...');

  const after = await fetchConfig(host);
  const confirmed = after.find((d) => d.id === deviceId) as RawProbeDevice | undefined;
  log('device after push', confirmed);

  if (confirmed?.targetTemp !== targetTemp) {
    console.warn(
      `WARNING: device reports targetTemp=${confirmed?.targetTemp}, expected ${targetTemp}. ` +
        'The device may need a moment to apply the change, or the push may not have taken.',
    );
  }
}

async function runStream(host: string, watchdogMs: number, reconnectMs: number): Promise<void> {
  const bus = new DomainEventBus();
  const pitMonitor = new PitMonitor(bus);
  const connectionMonitor = new ConnectionMonitor(bus);
  const alarmEvaluator = new AlarmEvaluator();

  bus.subscribe('data-point', (e) => log('data-point', e));
  bus.subscribe('blower-state', (e) => log('blower-state', e));
  bus.subscribe('connection-state', (e) => log('connection-state (domain)', e));
  bus.subscribe('config-change', (e) => log('config-change', e));
  bus.subscribe('alarm', (e) => log('ALARM', e));

  console.log(`Loading device config from http://${host}/stoker.json ...`);
  const rawDevices = await fetchConfig(host);
  pitMonitor.loadDeviceRegistry(rawDevices);
  console.log(`Loaded ${rawDevices.length} device(s). Connecting telnet to ${host}:23 ...`);

  const probesById = new Map(
    rawDevices.filter((d): d is RawProbeDevice => d.type === 'probe').map((d) => [d.id, d]),
  );

  const client = new StokerTelnetClient({ host, port: 23, watchdogTimeoutMs: watchdogMs, reconnectIntervalMs: reconnectMs });

  client.on('connection-state', (state: string) => {
    log('telnet connection-state', state);
    connectionMonitor.handleTelnetState(state as 'connected' | 'disconnected' | 'reconnecting');
  });

  client.on('data-point', (point) => {
    pitMonitor.handleRawDataPoint(point);

    const probe = probesById.get(point.deviceId);
    if (probe) {
      const alarm = alarmEvaluator.evaluate(
        {
          id: probe.id,
          alarmType: probe.alarmType,
          alarmHigh: probe.alarmHigh,
          alarmLow: probe.alarmLow,
          targetTemp: probe.targetTemp,
        },
        point.tempF,
      );
      if (alarm) bus.publish({ type: 'alarm', ...alarm });
    }
  });

  client.start();

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    client.stop();
    connectionMonitor.shutdown();
    process.exit(0);
  });

  console.log('Streaming. Press Ctrl+C to stop.');
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  const host = options.host;
  if (!host) throw new Error('--host <stoker-ip> is required');

  switch (command) {
    case 'config':
      await runConfig(host);
      break;
    case 'push': {
      const deviceId = options.device;
      const targetTemp = Number(options['target-temp']);
      if (!deviceId || Number.isNaN(targetTemp)) {
        throw new Error('push requires --device <id> and --target-temp <number>');
      }
      await runPush(host, deviceId, targetTemp);
      break;
    }
    case 'stream':
      await runStream(
        host,
        Number(options['watchdog-ms'] ?? 60_000),
        Number(options['reconnect-ms'] ?? 180_000),
      );
      break;
    default:
      throw new Error(`Unknown command "${command}". Use: config | stream | push`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
