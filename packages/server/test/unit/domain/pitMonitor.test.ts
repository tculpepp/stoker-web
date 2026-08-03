import { describe, expect, it } from 'vitest';
import { PitMonitor } from '../../../src/domain/pitMonitor.js';
import { DomainEventBus, type DomainEvent } from '../../../src/domain/eventBus.js';
import type { RawDevice } from '../../../src/hardware/httpConfig/types.js';

function collect(bus: DomainEventBus, type: DomainEvent['type']): DomainEvent[] {
  const events: DomainEvent[] = [];
  bus.subscribe(type, (e) => events.push(e));
  return events;
}

describe('PitMonitor', () => {
  it('does not publish an event on the first sighting of a device', () => {
    const bus = new DomainEventBus();
    const events = collect(bus, 'data-point');
    const monitor = new PitMonitor(bus);

    monitor.handleRawDataPoint(
      { deviceId: 'DB0000116F0BEC30', tempC: 27, tempF: 81, fanOn: null },
      new Date('2026-08-02T21:00:00Z'),
    );

    expect(events).toEqual([]);
    expect(monitor.getCurrentTemp('DB0000116F0BEC30')).toMatchObject({ tempF: 81 });
  });

  it('publishes data-point when the temp changes on a later reading', () => {
    const bus = new DomainEventBus();
    const events = collect(bus, 'data-point');
    const monitor = new PitMonitor(bus);

    monitor.handleRawDataPoint(
      { deviceId: 'DB0000116F0BEC30', tempC: 27, tempF: 81, fanOn: null },
      new Date('2026-08-02T21:00:00Z'),
    );
    monitor.handleRawDataPoint(
      { deviceId: 'DB0000116F0BEC30', tempC: 27.5, tempF: 81.5, fanOn: null },
      new Date('2026-08-02T21:05:00Z'),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tempF: 81.5 });
  });

  it('does not publish when the reading is unchanged and fresh', () => {
    const bus = new DomainEventBus();
    const events = collect(bus, 'data-point');
    const monitor = new PitMonitor(bus);

    monitor.handleRawDataPoint(
      { deviceId: 'DB0000116F0BEC30', tempC: 27, tempF: 81, fanOn: null },
      new Date('2026-08-02T21:00:00Z'),
    );
    monitor.handleRawDataPoint(
      { deviceId: 'DB0000116F0BEC30', tempC: 27, tempF: 81, fanOn: null },
      new Date('2026-08-02T21:00:10Z'),
    );

    expect(events).toEqual([]);
  });

  it('force-publishes when the cached reading is stale, even if unchanged', () => {
    const bus = new DomainEventBus();
    const events = collect(bus, 'data-point');
    const monitor = new PitMonitor(bus);

    monitor.handleRawDataPoint(
      { deviceId: 'DB0000116F0BEC30', tempC: 27, tempF: 81, fanOn: null },
      new Date('2026-08-02T21:00:00Z'),
    );
    monitor.handleRawDataPoint(
      { deviceId: 'DB0000116F0BEC30', tempC: 27, tempF: 81, fanOn: null },
      new Date('2026-08-02T21:02:00Z'),
    );

    expect(events).toHaveLength(1);
  });

  it('resolves a pit probe blower via the device registry and tracks runtime', () => {
    const bus = new DomainEventBus();
    const blowerEvents = collect(bus, 'blower-state');
    const monitor = new PitMonitor(bus);

    const registry: RawDevice[] = [
      {
        id: 'E70000116F279030',
        name: 'Pit',
        type: 'probe',
        targetTemp: 225,
        alarmLow: 200,
        alarmHigh: 250,
        alarmType: 'ALARM_FIRE',
        currentTemp: 0,
        blowerId: 'E70000116F279031',
      },
      { id: 'E70000116F279031', name: 'Blower', type: 'fan', fanOn: false },
    ];
    monitor.loadDeviceRegistry(registry);

    // First sighting: fan on — cached, no event, onSince recorded.
    monitor.handleRawDataPoint(
      { deviceId: 'E70000116F279030', tempC: 100, tempF: 212, fanOn: true },
      new Date('2026-08-02T21:00:00Z'),
    );
    expect(blowerEvents).toEqual([]);
    expect(monitor.getBlowerState('E70000116F279031')).toMatchObject({ fanOn: true, totalRuntimeMs: 0 });

    // Fan turns off 90s later — runtime accumulates, event published under the blower's own ID.
    monitor.handleRawDataPoint(
      { deviceId: 'E70000116F279030', tempC: 100, tempF: 212, fanOn: false },
      new Date('2026-08-02T21:01:30Z'),
    );

    expect(blowerEvents).toHaveLength(1);
    expect(blowerEvents[0]).toMatchObject({ deviceId: 'E70000116F279031', fanOn: false });
    expect(monitor.getBlowerState('E70000116F279031')).toMatchObject({ totalRuntimeMs: 90_000 });
  });

  it('publishes config-change when the device registry loads', () => {
    const bus = new DomainEventBus();
    const events = collect(bus, 'config-change');
    const monitor = new PitMonitor(bus);

    monitor.loadDeviceRegistry([]);

    expect(events).toHaveLength(1);
  });
});
