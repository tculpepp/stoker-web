import { describe, expect, it } from 'vitest';
import { InvalidDataPointError, parseStokerLine } from '../../../../src/hardware/telnet/lineParser.js';

describe('parseStokerLine', () => {
  it('parses a pit-probe line with a blower token', () => {
    const line =
      'E70000116F279030: 2 28.1 82.6 -6.9 0.2 1.1 0.9 25.9 78.6 PID: NORM tgt:26.1 error:1.2 drive:0 istate:0 on:1 off:9 blwr:off';

    const point = parseStokerLine(line);

    expect(point).toEqual({ deviceId: 'E70000116F279030', tempC: 25.9, tempF: 78.6, fanOn: false });
  });

  it('parses blwr:on as fanOn true', () => {
    const line = 'E70000116F279030: 2 28.1 82.6 -6.9 0.2 1.1 0.9 25.9 78.6 PID: NORM tgt:26.1 blwr:on';

    expect(parseStokerLine(line).fanOn).toBe(true);
  });

  it('returns fanOn null for a plain food probe with no fan token', () => {
    const line = 'DB0000116F0BEC30: 3 28.9 84 -7.5 0.2 1.2 1 27.3 81';

    const point = parseStokerLine(line);

    expect(point).toEqual({ deviceId: 'DB0000116F0BEC30', tempC: 27.3, tempF: 81, fanOn: null });
  });

  it('upper-cases the device ID regardless of input case', () => {
    const line = 'db0000116f0bec30: 3 28.9 84 -7.5 0.2 1.2 1 27.3 81';

    expect(parseStokerLine(line).deviceId).toBe('DB0000116F0BEC30');
  });

  it('throws InvalidDataPointError when the colon is not at index 16', () => {
    expect(() => parseStokerLine('SHORT: 1 2 3')).toThrow(InvalidDataPointError);
  });

  it('throws InvalidDataPointError for a line with no colon', () => {
    expect(() => parseStokerLine('not a stoker line at all')).toThrow(InvalidDataPointError);
  });
});
