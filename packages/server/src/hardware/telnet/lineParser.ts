/**
 * Pure line parser for the Stoker telnet temp-stream, ported from
 * legacy/src/com/gbak/sweb/server/parser/stoker/SDataPointHelper.java.
 *
 * Wire format (whitespace-tokenized, case-insensitive): a 16-hex-char device ID
 * followed by ':', then space-separated tokens where token 9 is Celsius, token 10 is
 * Fahrenheit, and any tokens after 10 are `key:value` pairs — only `blwr:on`/`blwr:off`
 * is meaningful here. Example:
 * `e70000116f279030: 2 28.1 82.6 -6.9 0.2 1.1 0.9 25.9 78.6 PID: NORM tgt:26.1 error:1.2 drive:0 istate:0 on:1 off:9 blwr:off`
 *
 * Unlike the legacy version, this returns data instead of resolving the pit-probe →
 * blower device-ID mapping itself — that requires the device registry loaded from
 * hardware/httpConfig, which is a domain-layer concern (see domain/pitMonitor.ts).
 */

export class InvalidDataPointError extends Error {
  constructor(line: string) {
    super(`Invalid data point: [${line}]`);
    this.name = 'InvalidDataPointError';
  }
}

export interface ParsedDataPoint {
  /** Upper-cased 16-hex-char device ID. */
  deviceId: string;
  tempC: number;
  tempF: number;
  /** null if the line carried no `blwr:` token (i.e. this device has no attached fan). */
  fanOn: boolean | null;
}

export function parseStokerLine(line: string): ParsedDataPoint {
  const lower = line.toLowerCase();
  const colonPos = lower.indexOf(':');

  if (colonPos !== 16) {
    throw new InvalidDataPointError(line);
  }

  const deviceId = lower.slice(0, colonPos).toUpperCase();
  const tokens = lower.trim().split(/\s+/);

  let tempC = 0;
  let tempF = 0;
  let fanOn: boolean | null = null;

  tokens.forEach((token, i) => {
    const tokenIndex = i + 1;

    if (tokenIndex === 9) {
      tempC = Number(token);
    } else if (tokenIndex === 10) {
      tempF = Number(token);
    } else if (tokenIndex > 10 && token.startsWith('blwr:')) {
      fanOn = token.slice(5) === 'on';
    }
  });

  return { deviceId, tempC, tempF, fanOn };
}
