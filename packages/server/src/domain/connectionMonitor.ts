/**
 * Translates the telnet client's raw connectivity blips into a coarser online/offline
 * status for the UI/alerts (← ConnectionMonitor.java): brief reconnects don't flap the
 * status, but a continuous outage past `extendedLossMinutes` (default 30, matches legacy
 * `timeout_to_extended_disconnect`) is published as an offline transition.
 */

import type { ConnectionState } from '@stoker-web/shared-types';
import type { DomainEventBus } from './eventBus.js';

export interface ConnectionMonitorOptions {
  /** Minutes of continuous disconnection before declaring an extended loss. Default 30. */
  extendedLossMinutes?: number;
}

export class ConnectionMonitor {
  private readonly bus: DomainEventBus;
  private readonly extendedLossMs: number;
  private state: ConnectionState = 'offline';
  private extendedLossTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(bus: DomainEventBus, options: ConnectionMonitorOptions = {}) {
    this.bus = bus;
    this.extendedLossMs = (options.extendedLossMinutes ?? 30) * 60_000;
  }

  getState(): ConnectionState {
    return this.state;
  }

  /** Feed connection-state events from StokerTelnetClient (Node's own 'connected'/'disconnected'/'reconnecting'). */
  handleTelnetState(telnetState: 'connected' | 'disconnected' | 'reconnecting'): void {
    if (telnetState === 'connected') {
      this.clearExtendedLossTimer();
      this.setState('online');
      return;
    }

    // Disconnected or reconnecting — start the extended-loss clock if not already running.
    if (!this.extendedLossTimer) {
      this.extendedLossTimer = setTimeout(() => {
        this.extendedLossTimer = null;
        this.setState('offline');
      }, this.extendedLossMs);
    }
  }

  shutdown(): void {
    this.clearExtendedLossTimer();
  }

  private clearExtendedLossTimer(): void {
    if (this.extendedLossTimer) {
      clearTimeout(this.extendedLossTimer);
      this.extendedLossTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.bus.publish({ type: 'connection-state', state });
  }
}
