/**
 * Threshold-alarm evaluator (← StokerAlarm.java, the only functional legacy alert type —
 * TempAlert/TimedAlert/ConnectionOrConfigChangeAlert were non-functional stubs, not
 * ported). ALARM_FIRE fires on high or low threshold breach; ALARM_FOOD fires once the
 * target temp is reached.
 *
 * Repeat-suppression is fixed at 10 minutes, single source of truth (fixes the legacy
 * bug where the code fallback constant was 5 min but the properties-file default was
 * 10 — see plan.md's known-bugs list). Suppression here is tracked **per device**, not
 * globally — legacy's `lastAlertDate` was a single field shared across every probe, so
 * one probe's alert would suppress every other probe's alert for the next repeat
 * window. Nothing suggests that cross-device silencing was intentional; per-device
 * suppression is the sensible read of "repeat-suppression window," not a preserved
 * legacy bug.
 */

import type { AlarmType } from '@stoker-web/shared-types';

export interface AlarmProbe {
  id: string;
  alarmType: AlarmType;
  alarmHigh: number;
  alarmLow: number;
  targetTemp: number;
}

export interface AlarmResult {
  deviceId: string;
  alarmType: AlarmType;
  currentTemp: number;
  message: string;
}

const DEFAULT_REPEAT_SUPPRESSION_MINUTES = 10;

export class AlarmEvaluator {
  private readonly repeatSuppressionMs: number;
  private readonly lastAlertAt = new Map<string, Date>();

  constructor(repeatSuppressionMinutes: number = DEFAULT_REPEAT_SUPPRESSION_MINUTES) {
    this.repeatSuppressionMs = repeatSuppressionMinutes * 60_000;
  }

  evaluate(probe: AlarmProbe, currentTemp: number, now: Date = new Date()): AlarmResult | null {
    const breach = this.detectBreach(probe, currentTemp);
    if (!breach) return null;

    const last = this.lastAlertAt.get(probe.id);
    if (last && now.getTime() - last.getTime() < this.repeatSuppressionMs) {
      return null;
    }

    this.lastAlertAt.set(probe.id, now);
    return breach;
  }

  private detectBreach(probe: AlarmProbe, currentTemp: number): AlarmResult | null {
    if (probe.alarmType === 'ALARM_FIRE') {
      if (currentTemp > probe.alarmHigh) {
        return {
          deviceId: probe.id,
          alarmType: 'ALARM_FIRE',
          currentTemp,
          message: `High Temperature Alarm on ${probe.id}`,
        };
      }
      if (currentTemp < probe.alarmLow) {
        return {
          deviceId: probe.id,
          alarmType: 'ALARM_FIRE',
          currentTemp,
          message: `Low Temperature Alarm on ${probe.id}`,
        };
      }
    } else if (probe.alarmType === 'ALARM_FOOD') {
      if (currentTemp > probe.targetTemp) {
        return {
          deviceId: probe.id,
          alarmType: 'ALARM_FOOD',
          currentTemp,
          message: `Food target temperature alarm on ${probe.id}`,
        };
      }
    }

    return null;
  }
}
