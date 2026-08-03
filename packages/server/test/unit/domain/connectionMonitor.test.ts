import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionMonitor } from '../../../src/domain/connectionMonitor.js';
import { DomainEventBus, type DomainEvent } from '../../../src/domain/eventBus.js';

describe('ConnectionMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('goes online immediately on a telnet connected event', () => {
    const bus = new DomainEventBus();
    const events: DomainEvent[] = [];
    bus.subscribe('connection-state', (e) => events.push(e));
    const monitor = new ConnectionMonitor(bus);

    monitor.handleTelnetState('connected');

    expect(monitor.getState()).toBe('online');
    expect(events).toEqual([{ type: 'connection-state', state: 'online' }]);
  });

  it('does not go offline immediately on a disconnect — waits out the extended-loss window', () => {
    const bus = new DomainEventBus();
    const events: DomainEvent[] = [];
    bus.subscribe('connection-state', (e) => events.push(e));
    const monitor = new ConnectionMonitor(bus, { extendedLossMinutes: 30 });
    monitor.handleTelnetState('connected');
    events.length = 0;

    monitor.handleTelnetState('disconnected');

    expect(events).toEqual([]);
    expect(monitor.getState()).toBe('online');
  });

  it('goes offline once the extended-loss window elapses without reconnecting', () => {
    const bus = new DomainEventBus();
    const events: DomainEvent[] = [];
    bus.subscribe('connection-state', (e) => events.push(e));
    const monitor = new ConnectionMonitor(bus, { extendedLossMinutes: 30 });
    monitor.handleTelnetState('connected');
    events.length = 0;

    monitor.handleTelnetState('disconnected');
    vi.advanceTimersByTime(30 * 60_000);

    expect(events).toEqual([{ type: 'connection-state', state: 'offline' }]);
    expect(monitor.getState()).toBe('offline');
  });

  it('cancels the extended-loss timer on reconnect before the window elapses', () => {
    const bus = new DomainEventBus();
    const events: DomainEvent[] = [];
    bus.subscribe('connection-state', (e) => events.push(e));
    const monitor = new ConnectionMonitor(bus, { extendedLossMinutes: 30 });
    monitor.handleTelnetState('connected');
    events.length = 0;

    monitor.handleTelnetState('disconnected');
    vi.advanceTimersByTime(20 * 60_000);
    monitor.handleTelnetState('connected');
    vi.advanceTimersByTime(20 * 60_000);

    // Never actually left 'online' (the extended-loss window never elapsed), so no
    // second 'online' event fires — state transitions are edge-triggered, not repeated.
    expect(events).toEqual([]);
    expect(monitor.getState()).toBe('online');
  });

  it('does not restart the extended-loss timer on repeated reconnecting events', () => {
    const bus = new DomainEventBus();
    const monitor = new ConnectionMonitor(bus, { extendedLossMinutes: 30 });
    monitor.handleTelnetState('connected');

    monitor.handleTelnetState('reconnecting');
    vi.advanceTimersByTime(15 * 60_000);
    monitor.handleTelnetState('reconnecting');
    vi.advanceTimersByTime(15 * 60_000);

    expect(monitor.getState()).toBe('offline');
  });
});
