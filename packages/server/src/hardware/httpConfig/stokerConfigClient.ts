/**
 * HTTP device-config client (← StokerHardwareDevice.pullJSonConfig()/update()):
 * GET `http://<host>/stoker.json`, POST `http://<host>/stoker.Post_Handler` with
 * URL-encoded `al/n1/n2/sw/ta/th/tl` fields — exact same wire format as the legacy
 * server used, distinct from this app's own `/api/v1` DTOs.
 */

import type { AlarmType, Device } from '@stoker-web/shared-types';
import type { RawAlarmType, RawDevice, StokerJsonResponse } from './types.js';

const ALARM_TYPE_BY_ORDINAL: RawAlarmType[] = ['NONE', 'ALARM_FOOD', 'ALARM_FIRE'];
const ALARM_ORDINAL_BY_TYPE: Record<AlarmType, number> = {
  NONE: 0,
  ALARM_FOOD: 1,
  ALARM_FIRE: 2,
};

function parseAlarmType(raw: string): RawAlarmType {
  const ordinal = Number(raw);
  return ALARM_TYPE_BY_ORDINAL[ordinal] ?? 'NONE';
}

export async function fetchConfig(host: string): Promise<RawDevice[]> {
  const res = await fetch(`http://${host}/stoker.json`);
  if (!res.ok) {
    throw new Error(`stoker.json request failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as StokerJsonResponse;
  const devices: RawDevice[] = [];

  for (const blower of body.stoker.blowers ?? []) {
    devices.push({
      id: blower.id.toUpperCase(),
      name: blower.name,
      type: 'fan',
      fanOn: blower.on === 'on',
    });
  }

  for (const sensor of body.stoker.sensors) {
    devices.push({
      id: sensor.id.toUpperCase(),
      name: sensor.name,
      type: 'probe',
      targetTemp: sensor.ta,
      alarmLow: sensor.tl,
      alarmHigh: sensor.th,
      alarmType: parseAlarmType(sensor.al),
      currentTemp: sensor.tc,
      blowerId: sensor.blower ? sensor.blower.toUpperCase() : null,
    });
  }

  return devices;
}

function alPostField(id: string, alarmType: AlarmType): string {
  return `al${encodeURIComponent(id)}=${encodeURIComponent(String(ALARM_ORDINAL_BY_TYPE[alarmType]))}`;
}

function taPostField(id: string, targetTemp: number): string {
  return `ta${encodeURIComponent(id)}=${encodeURIComponent(String(targetTemp))}`;
}

/** th/tl only carry a real value when the alarm type is ALARM_FIRE — otherwise "n/a", matching legacy. */
function thPostField(id: string, alarmType: AlarmType, alarmHigh: number): string {
  const value = alarmType === 'ALARM_FIRE' ? String(alarmHigh) : 'n/a';
  return `th${encodeURIComponent(id)}=${encodeURIComponent(value)}`;
}

function tlPostField(id: string, alarmType: AlarmType, alarmLow: number): string {
  const value = alarmType === 'ALARM_FIRE' ? String(alarmLow) : 'n/a';
  return `tl${encodeURIComponent(id)}=${encodeURIComponent(value)}`;
}

function n1PostField(id: string, name: string): string {
  return `n1${encodeURIComponent(id)}=${encodeURIComponent(name)}`;
}

function n2PostField(id: string, name: string): string {
  return `n2${encodeURIComponent(id)}=${encodeURIComponent(name)}`;
}

function swPostField(probeId: string, blowerId: string | null): string {
  return `sw${encodeURIComponent(probeId)}=${encodeURIComponent(blowerId ?? 'None')}`;
}

function devicePostFields(device: Device): string[] {
  if (device.type === 'fan') {
    return [n2PostField(device.id, device.name)];
  }

  const blowerId = 'blower' in device && device.blower ? device.blower.id : null;

  return [
    alPostField(device.id, device.alarmType),
    n1PostField(device.id, device.name),
    swPostField(device.id, blowerId),
    taPostField(device.id, device.targetTemp),
    thPostField(device.id, device.alarmType, device.alarmHigh),
    tlPostField(device.id, device.alarmType, device.alarmLow),
  ];
}

/** Pushes updated settings to the device — same wire format `PATCH /api/v1/devices` accepts. */
export async function pushSettings(host: string, devices: Device[]): Promise<void> {
  const body = devices.flatMap(devicePostFields).join('&');

  const res = await fetch(`http://${host}/stoker.Post_Handler`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new Error(`stoker.Post_Handler request failed: ${res.status} ${res.statusText}`);
  }
}
