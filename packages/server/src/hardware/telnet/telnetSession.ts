/**
 * Pure protocol state machine for the Stoker telnet session — the "cleaner state
 * machine" plan.md calls for, replacing legacy's fragile byte-by-byte
 * triple-character-lookback matching (StokerTelnetController.java's streamReader()),
 * while sending the exact same wire commands/prompts (commands.ts). Kept free of
 * `net.Socket`/timers so the prompt-detection and line-parsing logic is unit-testable
 * without a real connection — see stokerTelnetClient.ts for the I/O wrapper.
 */

import {
  STOKER_CMD_LOGIN_ID,
  STOKER_CMD_LOGIN_PASSWORD,
  STOKER_CMD_TEMPS,
  STOKER_CMD_START,
  STOKER_CONDITION_START,
  STOKER_CONDITION_STOP,
  STOKER_PROMPT_LOGIN,
  STOKER_PROMPT_PASSWORD,
} from './commands.js';
import { InvalidDataPointError, parseStokerLine, type ParsedDataPoint } from './lineParser.js';

export type TelnetSessionState =
  | 'awaiting-login-prompt'
  | 'awaiting-password-prompt'
  | 'awaiting-shell-prompt'
  | 'started'
  | 'streaming';

export type TelnetAction =
  | { type: 'send'; data: string }
  | { type: 'logged-in' }
  | { type: 'started' }
  | { type: 'stopped' }
  | { type: 'data-point'; point: ParsedDataPoint }
  | { type: 'invalid-line'; line: string };

/** Shell-ready prompt looks like `tini />` — legacy matched on `>` preceded by `/`, plus "tini" present. */
const SHELL_READY_MARKERS = ['tini', ' />'];

export class TelnetSession {
  state: TelnetSessionState = 'awaiting-login-prompt';

  /**
   * Single rolling buffer shared by both prompt detection and line draining. Must stay
   * shared (not two independent buffers) — prompts don't end in '\n', so if prompt text
   * were cleared from a separate buffer while surviving in the line buffer, it would
   * silently prefix itself onto the next real data line and break its column parsing.
   */
  private buffer = '';

  /** Feed one chunk of raw socket text; returns actions the caller (client) should perform. */
  feed(chunk: string): TelnetAction[] {
    const actions: TelnetAction[] = [];

    this.buffer += chunk;

    actions.push(...this.checkPrompts());
    actions.push(...this.drainLines());

    return actions;
  }

  private checkPrompts(): TelnetAction[] {
    const actions: TelnetAction[] = [];
    const lower = this.buffer.toLowerCase();

    if (this.state === 'awaiting-login-prompt' && lower.includes(STOKER_PROMPT_LOGIN)) {
      actions.push({ type: 'send', data: STOKER_CMD_LOGIN_ID });
      this.state = 'awaiting-password-prompt';
      this.buffer = '';
    } else if (
      this.state === 'awaiting-password-prompt' &&
      lower.includes(STOKER_PROMPT_PASSWORD)
    ) {
      actions.push({ type: 'send', data: STOKER_CMD_LOGIN_PASSWORD });
      this.state = 'awaiting-shell-prompt';
      this.buffer = '';
    } else if (
      this.state === 'awaiting-shell-prompt' &&
      SHELL_READY_MARKERS.every((marker) => lower.includes(marker))
    ) {
      actions.push({ type: 'logged-in' });
      this.state = 'started';
      this.buffer = '';
    }

    return actions;
  }

  private drainLines(): TelnetAction[] {
    const actions: TelnetAction[] = [];
    let newlineIndex = this.buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      actions.push(...this.processLine(line));
      newlineIndex = this.buffer.indexOf('\n');
    }

    return actions;
  }

  private processLine(rawLine: string): TelnetAction[] {
    const line = rawLine.trim();
    if (line.length === 0) return [];

    const lower = line.toLowerCase();

    if (lower.includes(STOKER_CONDITION_STOP)) {
      this.state = 'started';
      return [{ type: 'stopped' }];
    }
    if (lower.includes(STOKER_CONDITION_START)) {
      this.state = 'streaming';
      return [{ type: 'started' }];
    }

    try {
      const point = parseStokerLine(line);
      this.state = 'streaming';
      return [{ type: 'data-point', point }];
    } catch (err) {
      if (err instanceof InvalidDataPointError) {
        return [{ type: 'invalid-line', line }];
      }
      throw err;
    }
  }

  /** Command to request the temps stream, sent once the shell is ready. */
  static requestTempsCommand(): TelnetAction {
    return { type: 'send', data: STOKER_CMD_TEMPS };
  }

  static startCommand(): TelnetAction {
    return { type: 'send', data: STOKER_CMD_START };
  }
}
