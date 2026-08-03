/**
 * Raw wire shapes for `stoker.json`, mirroring
 * legacy/src/com/gbak/sweb/server/monitors/stoker/config/json/{Stoker,StokerOuter,Sensor,Blower}.java.
 * Deliberately separate from `packages/shared-types/src/api-v1.ts` — this is the flat
 * hardware-reported state, not the assembled cooker/device model the API exposes; the
 * domain layer (domain/pitMonitor.ts) turns these into DB rows and API responses.
 */

export interface StokerJsonSensor {
  id: string;
  name: string;
  /** Alarm type ordinal as a string: "0" NONE, "1" ALARM_FOOD, "2" ALARM_FIRE. */
  al: string;
  ta: number;
  th: number;
  tl: number;
  tc: number;
  /** Device ID of the attached blower, if this sensor is a pit probe. */
  blower: string | null;
}

export interface StokerJsonBlower {
  id: string;
  name: string;
  on: string;
}

export interface StokerJsonResponse {
  stoker: {
    sensors: StokerJsonSensor[];
    blowers: StokerJsonBlower[] | null;
  };
}

export type RawAlarmType = 'NONE' | 'ALARM_FOOD' | 'ALARM_FIRE';

export interface RawProbeDevice {
  id: string;
  name: string;
  type: 'probe';
  targetTemp: number;
  alarmLow: number;
  alarmHigh: number;
  alarmType: RawAlarmType;
  currentTemp: number;
  /** Upper-cased device ID of the attached blower, or null for a plain food probe. */
  blowerId: string | null;
}

export interface RawFanDevice {
  id: string;
  name: string;
  type: 'fan';
  fanOn: boolean;
}

export type RawDevice = RawProbeDevice | RawFanDevice;
