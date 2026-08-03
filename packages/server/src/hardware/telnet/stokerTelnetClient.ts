/**
 * Telnet I/O wrapper (← StokerTelnetController.java): owns the `net.Socket`, the
 * reconnect timer (every 3 min while disconnected — same cadence as legacy's
 * `m_startTimer.scheduleAtFixedRate(..., 180000)`), and a dead-connection watchdog
 * (60s with no data-point forces a reconnect, replacing legacy's ~65s
 * `TelnetMonitorTimerTask`). Delegates all prompt/line parsing to the pure
 * `TelnetSession` state machine in telnetSession.ts.
 */

import { EventEmitter } from 'node:events';
import { connect, type Socket } from 'node:net';
import { TelnetSession, type TelnetAction } from './telnetSession.js';
import { STOKER_CMD_START } from './commands.js';

export interface StokerTelnetClientOptions {
  host: string;
  port: number;
  /** ms between reconnect attempts while disconnected (default 180_000, matches legacy). */
  reconnectIntervalMs?: number;
  /** ms of no data-point before the watchdog forces a reconnect (default 60_000). */
  watchdogTimeoutMs?: number;
}

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

/**
 * Emits `'connection-state'` with a `ConnectionState` and `'data-point'` with a
 * `ParsedDataPoint`. Left untyped on the base `EventEmitter` (consistent with
 * domain/eventBus.ts) rather than via `on`/interface declaration merging.
 */
export class StokerTelnetClient extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private readonly reconnectIntervalMs: number;
  private readonly watchdogTimeoutMs: number;

  private socket: Socket | null = null;
  private session = new TelnetSession();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private stopped = true;

  constructor(options: StokerTelnetClientOptions) {
    super();
    this.host = options.host;
    this.port = options.port;
    this.reconnectIntervalMs = options.reconnectIntervalMs ?? 180_000;
    this.watchdogTimeoutMs = options.watchdogTimeoutMs ?? 60_000;
  }

  start(): void {
    this.stopped = false;
    this.connectOnce();
    this.reconnectTimer = setInterval(() => {
      if (!this.connected) this.connectOnce();
    }, this.reconnectIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardown();
  }

  isConnected(): boolean {
    return this.connected;
  }

  private connectOnce(): void {
    if (this.socket || this.stopped) return;

    this.session = new TelnetSession();
    const socket = connect(this.port, this.host);
    this.socket = socket;

    socket.on('data', (buf: Buffer) => this.handleData(buf.toString('utf8')));
    socket.on('error', () => this.teardown());
    socket.on('close', () => this.teardown());
  }

  private handleData(chunk: string): void {
    for (const action of this.session.feed(chunk)) this.applyAction(action);
  }

  private applyAction(action: TelnetAction): void {
    switch (action.type) {
      case 'send':
        this.socket?.write(action.data);
        break;
      case 'logged-in':
        // Shell is ready — (re)start the continuous temp broadcast. Sending the start
        // command unconditionally (rather than legacy's snapshot-then-maybe-restart
        // dance) is simpler and always converges on the same STREAMING end state.
        this.socket?.write(STOKER_CMD_START);
        break;
      case 'data-point':
        this.markConnected();
        this.emit('data-point', action.point);
        break;
      case 'started':
      case 'stopped':
      case 'invalid-line':
        break;
    }
  }

  private markConnected(): void {
    if (!this.connected) {
      this.connected = true;
      this.emit('connection-state', 'connected');
    }
    this.resetWatchdog();
  }

  private resetWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      this.emit('connection-state', 'reconnecting');
      this.teardown();
    }, this.watchdogTimeoutMs);
  }

  private teardown(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    if (this.connected) {
      this.connected = false;
      this.emit('connection-state', 'disconnected');
    }
  }
}
