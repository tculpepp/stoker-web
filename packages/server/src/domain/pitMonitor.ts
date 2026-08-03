/**
 * Live current-temps cache + cumulative blower runtime (← StokerPitMonitor.java's
 * `addDataPoint`). Resolves a probe's attached blower via the device registry loaded
 * from hardware/httpConfig, since the telnet line only carries the probe's own ID and a
 * bare fan-on/off flag (see hardware/telnet/lineParser.ts).
 */

import type { RawDevice, RawProbeDevice } from '../hardware/httpConfig/types.js';
import type { ParsedDataPoint } from '../hardware/telnet/lineParser.js';
import type { DomainEventBus } from './eventBus.js';

interface ProbeReading {
  deviceId: string;
  tempC: number;
  tempF: number;
  collectedAt: Date;
}

interface BlowerReading {
  deviceId: string;
  fanOn: boolean;
  collectedAt: Date;
  totalRuntimeMs: number;
  /** Set while the fan is on; used to accumulate runtime on the off transition. */
  onSince: Date | null;
}

export class PitMonitor {
  private readonly bus: DomainEventBus;
  private readonly deviceRegistry = new Map<string, RawDevice>();
  private readonly probeReadings = new Map<string, ProbeReading>();
  private readonly blowerReadings = new Map<string, BlowerReading>();

  constructor(bus: DomainEventBus) {
    this.bus = bus;
  }

  /** Called after hardware/httpConfig.fetchConfig() resolves, or on config-change. */
  loadDeviceRegistry(devices: RawDevice[]): void {
    this.deviceRegistry.clear();
    for (const device of devices) this.deviceRegistry.set(device.id, device);
    this.bus.publish({ type: 'config-change' });
  }

  getCurrentTemp(deviceId: string): ProbeReading | undefined {
    return this.probeReadings.get(deviceId);
  }

  getCurrentTemps(): ProbeReading[] {
    return [...this.probeReadings.values()];
  }

  getBlowerState(deviceId: string): BlowerReading | undefined {
    return this.blowerReadings.get(deviceId);
  }

  handleRawDataPoint(point: ParsedDataPoint, collectedAt: Date = new Date()): void {
    this.updateProbeReading(point.deviceId, point.tempC, point.tempF, collectedAt);

    if (point.fanOn === null) return;

    const probeDevice = this.deviceRegistry.get(point.deviceId);
    const blowerId =
      probeDevice?.type === 'probe' ? (probeDevice as RawProbeDevice).blowerId : null;
    if (blowerId) this.updateBlowerReading(blowerId, point.fanOn, collectedAt);
  }

  private updateProbeReading(deviceId: string, tempC: number, tempF: number, collectedAt: Date) {
    const existing = this.probeReadings.get(deviceId);

    if (!existing) {
      // First-ever sighting of this device — cache it, but (matching legacy) don't
      // publish an event yet; there's nothing to compare the "change" against.
      this.probeReadings.set(deviceId, { deviceId, tempC, tempF, collectedAt });
      return;
    }

    const changed = existing.tempF !== tempF || this.isStale(existing.collectedAt, collectedAt);
    existing.tempC = tempC;
    existing.tempF = tempF;
    existing.collectedAt = collectedAt;

    if (changed) {
      this.bus.publish({
        type: 'data-point',
        deviceId,
        tempC,
        tempF,
        collectedAt: collectedAt.toISOString(),
      });
    }
  }

  private updateBlowerReading(deviceId: string, fanOn: boolean, collectedAt: Date) {
    const existing = this.blowerReadings.get(deviceId);

    if (!existing) {
      this.blowerReadings.set(deviceId, {
        deviceId,
        fanOn,
        collectedAt,
        totalRuntimeMs: 0,
        onSince: fanOn ? collectedAt : null,
      });
      return;
    }

    const changed = existing.fanOn !== fanOn || this.isStale(existing.collectedAt, collectedAt);

    if (changed) {
      if (!fanOn && existing.onSince) {
        existing.totalRuntimeMs += collectedAt.getTime() - existing.onSince.getTime();
        existing.onSince = null;
      } else if (fanOn && !existing.onSince) {
        existing.onSince = collectedAt;
      }
    }

    existing.fanOn = fanOn;
    existing.collectedAt = collectedAt;

    if (changed) {
      this.bus.publish({
        type: 'blower-state',
        deviceId,
        fanOn,
        collectedAt: collectedAt.toISOString(),
      });
    }
  }

  /** Guards against a stale cached reading masking a real change — force-refresh past 1 min. */
  private isStale(lastCollectedAt: Date, now: Date): boolean {
    return now.getTime() - lastCollectedAt.getTime() > 60_000;
  }
}
