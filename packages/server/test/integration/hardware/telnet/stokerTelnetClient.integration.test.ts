/**
 * Integration test against a mock TCP telnet-device fixture (net.Server), standing in
 * for the real Stoker firmware per plan.md's testing note. Wire strings below are
 * hardcoded independently of src/hardware/telnet/commands.ts on purpose — this test
 * should fail if commands.ts ever drifts from the literal bytes the firmware expects.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StokerTelnetClient } from '../../../../src/hardware/telnet/stokerTelnetClient.js';

class MockStokerDevice {
  server: Server;
  port = 0;
  sendDataOnStart = true;

  private constructor(server: Server) {
    this.server = server;
  }

  static async start(): Promise<MockStokerDevice> {
    return new Promise((resolve) => {
      const server = createServer();
      const device = new MockStokerDevice(server);
      server.on('connection', (socket) => device.handleConnection(socket));
      server.listen(0, '127.0.0.1', () => {
        device.port = (server.address() as { port: number }).port;
        resolve(device);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handleConnection(socket: Socket): void {
    let buffer = '';
    socket.write('\r\nlogin: ');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      if (buffer.includes('root\r\n')) {
        buffer = '';
        socket.write('password: ');
      } else if (buffer.includes('tini\r\n')) {
        buffer = '';
        socket.write('tini />');
      } else if (buffer.includes('bbq -t\n')) {
        buffer = '';
        if (this.sendDataOnStart) {
          socket.write(
            'E70000116F279030: 2 28.1 82.6 -6.9 0.2 1.1 0.9 25.9 78.6 PID: NORM tgt:26.1 blwr:on\n',
          );
        }
      }
    });
  }
}

describe('StokerTelnetClient (integration, mock TCP device)', () => {
  let device: MockStokerDevice;
  let client: StokerTelnetClient;

  beforeEach(async () => {
    device = await MockStokerDevice.start();
  });

  afterEach(async () => {
    client?.stop();
    await device.stop();
  });

  it('completes the login sequence and emits a data-point from the mock device', async () => {
    client = new StokerTelnetClient({ host: '127.0.0.1', port: device.port });

    const dataPoint = await new Promise((resolve) => {
      client.on('data-point', resolve);
      client.start();
    });

    expect(dataPoint).toEqual({
      deviceId: 'E70000116F279030',
      tempC: 25.9,
      tempF: 78.6,
      fanOn: true,
    });
  });

  it('emits connection-state connected once a data-point proves the stream is live', async () => {
    client = new StokerTelnetClient({ host: '127.0.0.1', port: device.port });

    const state = await new Promise((resolve) => {
      client.on('connection-state', resolve);
      client.start();
    });

    expect(state).toBe('connected');
    expect(client.isConnected()).toBe(true);
  });

  it('watchdog tears the connection down after the device goes silent', async () => {
    client = new StokerTelnetClient({
      host: '127.0.0.1',
      port: device.port,
      watchdogTimeoutMs: 100,
      reconnectIntervalMs: 1_000_000, // isolate the watchdog from the periodic reconnect timer
    });

    const states: string[] = [];
    client.on('connection-state', (s) => states.push(s));

    // Device sends exactly one data-point on start, then goes silent — no further
    // temps stream, so the watchdog should fire once its timeout elapses.
    await new Promise((resolve) => {
      client.on('data-point', resolve);
      client.start();
    });
    expect(states).toEqual(['connected']);

    await vi.waitFor(() => expect(states).toEqual(['connected', 'reconnecting', 'disconnected']), {
      timeout: 2000,
    });
    expect(client.isConnected()).toBe(false);
  });
});
