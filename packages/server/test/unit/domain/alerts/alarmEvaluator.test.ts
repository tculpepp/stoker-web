import { describe, expect, it } from 'vitest';
import { AlarmEvaluator, type AlarmProbe } from '../../../../src/domain/alerts/alarmEvaluator.js';

const fireProbe: AlarmProbe = {
  id: 'E70000116F279030',
  alarmType: 'ALARM_FIRE',
  alarmHigh: 250,
  alarmLow: 200,
  targetTemp: 0,
};

const foodProbe: AlarmProbe = {
  id: 'DB0000116F0BEC30',
  alarmType: 'ALARM_FOOD',
  alarmHigh: 0,
  alarmLow: 0,
  targetTemp: 203,
};

describe('AlarmEvaluator', () => {
  it('fires a high-temp alarm when above alarmHigh', () => {
    const evaluator = new AlarmEvaluator();

    const result = evaluator.evaluate(fireProbe, 260, new Date('2026-08-02T21:00:00Z'));

    expect(result).toMatchObject({ deviceId: fireProbe.id, alarmType: 'ALARM_FIRE' });
    expect(result?.message).toContain('High Temperature');
  });

  it('fires a low-temp alarm when below alarmLow', () => {
    const evaluator = new AlarmEvaluator();

    const result = evaluator.evaluate(fireProbe, 150, new Date('2026-08-02T21:00:00Z'));

    expect(result?.message).toContain('Low Temperature');
  });

  it('does not fire within the threshold band', () => {
    const evaluator = new AlarmEvaluator();

    expect(evaluator.evaluate(fireProbe, 225, new Date('2026-08-02T21:00:00Z'))).toBeNull();
  });

  it('fires a food alarm once above target temp', () => {
    const evaluator = new AlarmEvaluator();

    const result = evaluator.evaluate(foodProbe, 205, new Date('2026-08-02T21:00:00Z'));

    expect(result?.message).toContain('Food target temperature');
  });

  it('does not fire for NONE alarm type', () => {
    const evaluator = new AlarmEvaluator();
    const probe: AlarmProbe = { ...fireProbe, alarmType: 'NONE' };

    expect(evaluator.evaluate(probe, 999, new Date('2026-08-02T21:00:00Z'))).toBeNull();
  });

  it('suppresses a repeat alarm within the 10-minute window', () => {
    const evaluator = new AlarmEvaluator();
    const t0 = new Date('2026-08-02T21:00:00Z');

    expect(evaluator.evaluate(fireProbe, 260, t0)).not.toBeNull();
    const repeat = evaluator.evaluate(fireProbe, 262, new Date(t0.getTime() + 5 * 60_000));

    expect(repeat).toBeNull();
  });

  it('fires again once the repeat-suppression window has passed', () => {
    const evaluator = new AlarmEvaluator();
    const t0 = new Date('2026-08-02T21:00:00Z');

    expect(evaluator.evaluate(fireProbe, 260, t0)).not.toBeNull();
    const later = evaluator.evaluate(fireProbe, 260, new Date(t0.getTime() + 11 * 60_000));

    expect(later).not.toBeNull();
  });

  it('respects a custom repeat-suppression window', () => {
    const evaluator = new AlarmEvaluator(1);
    const t0 = new Date('2026-08-02T21:00:00Z');

    expect(evaluator.evaluate(fireProbe, 260, t0)).not.toBeNull();
    const suppressed = evaluator.evaluate(fireProbe, 260, new Date(t0.getTime() + 30_000));
    const allowed = evaluator.evaluate(fireProbe, 260, new Date(t0.getTime() + 61_000));

    expect(suppressed).toBeNull();
    expect(allowed).not.toBeNull();
  });

  it('suppresses independently per device, not globally', () => {
    const evaluator = new AlarmEvaluator();
    const t0 = new Date('2026-08-02T21:00:00Z');

    expect(evaluator.evaluate(fireProbe, 260, t0)).not.toBeNull();
    const otherDevice = evaluator.evaluate(foodProbe, 210, new Date(t0.getTime() + 1000));

    expect(otherDevice).not.toBeNull();
  });
});
