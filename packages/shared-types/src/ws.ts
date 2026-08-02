/**
 * WS envelope types for the `/ws` real-time push layer (Phase 3). Replaces legacy Comet
 * (browser-only) — `/ws` is explicitly multi-client (Web + Android), anonymous-subscribe
 * broadcast. Mirrors the server-side event types in
 * legacy/src/com/gbak/sweb/server/events/*.java, but as one flat discriminated union
 * instead of separate Guava EventBus classes.
 */

import type { AlarmType, Cooker, Device } from './api-v1.js';

export type ConnectionState = 'online' | 'offline' | 'reconnecting';

export interface DeviceUpdateMessage {
  type: 'device-update';
  devices: Device[];
  receivedAt: string;
}

export interface ConnectionStateMessage {
  type: 'connection-state';
  state: ConnectionState;
}

export interface WeatherUpdateMessage {
  type: 'weather-update';
  tempF: number;
  conditionText: string;
}

export interface AlarmMessage {
  type: 'alarm';
  deviceId: string;
  alarmType: AlarmType;
  currentTemp: number;
  message: string;
}

export interface ConfigChangeMessage {
  type: 'config-change';
  cookers: Cooker[];
}

export interface LogEventMessage {
  type: 'log-event';
  event: 'started' | 'stopped' | 'note-added';
  logId: string;
  cookerName: string;
}

export type WsMessage =
  | DeviceUpdateMessage
  | ConnectionStateMessage
  | WeatherUpdateMessage
  | AlarmMessage
  | ConfigChangeMessage
  | LogEventMessage;
