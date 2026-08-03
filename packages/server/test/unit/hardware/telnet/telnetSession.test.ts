import { describe, expect, it } from 'vitest';
import { TelnetSession } from '../../../../src/hardware/telnet/telnetSession.js';
import {
  STOKER_CMD_LOGIN_ID,
  STOKER_CMD_LOGIN_PASSWORD,
} from '../../../../src/hardware/telnet/commands.js';

describe('TelnetSession', () => {
  it('sends the login ID once it sees the login prompt', () => {
    const session = new TelnetSession();

    const actions = session.feed('some banner\r\nlogin: ');

    expect(actions).toContainEqual({ type: 'send', data: STOKER_CMD_LOGIN_ID });
    expect(session.state).toBe('awaiting-password-prompt');
  });

  it('sends the password once it sees the password prompt', () => {
    const session = new TelnetSession();
    session.feed('login: ');

    const actions = session.feed('password: ');

    expect(actions).toContainEqual({ type: 'send', data: STOKER_CMD_LOGIN_PASSWORD });
    expect(session.state).toBe('awaiting-shell-prompt');
  });

  it('emits logged-in once the shell prompt appears', () => {
    const session = new TelnetSession();
    session.feed('login: ');
    session.feed('password: ');

    const actions = session.feed('tini />');

    expect(actions).toContainEqual({ type: 'logged-in' });
    expect(session.state).toBe('started');
  });

  it('handles prompts split across multiple chunks', () => {
    const session = new TelnetSession();

    session.feed('log');
    const actions = session.feed('in: ');

    expect(actions).toContainEqual({ type: 'send', data: STOKER_CMD_LOGIN_ID });
  });

  it('emits a data-point action for a valid temp line', () => {
    const session = new TelnetSession();

    const actions = session.feed(
      'DB0000116F0BEC30: 3 28.9 84 -7.5 0.2 1.2 1 27.3 81\n',
    );

    expect(actions).toContainEqual({
      type: 'data-point',
      point: { deviceId: 'DB0000116F0BEC30', tempC: 27.3, tempF: 81, fanOn: null },
    });
    expect(session.state).toBe('streaming');
  });

  it('emits invalid-line for a malformed line instead of throwing', () => {
    const session = new TelnetSession();

    const actions = session.feed('garbage line with no valid device prefix\n');

    expect(actions).toContainEqual({
      type: 'invalid-line',
      line: 'garbage line with no valid device prefix',
    });
  });

  it('detects the stoker-start acknowledgement line', () => {
    const session = new TelnetSession();

    const actions = session.feed('stkcmd: stoker: start\n');

    expect(actions).toContainEqual({ type: 'started' });
    expect(session.state).toBe('streaming');
  });

  it('detects the stoker-stop acknowledgement line', () => {
    const session = new TelnetSession();

    const actions = session.feed('stkcmd: stop\n');

    expect(actions).toContainEqual({ type: 'stopped' });
  });

  it('buffers a partial line until the newline arrives', () => {
    const session = new TelnetSession();

    const firstActions = session.feed('DB0000116F0BEC30: 3 28.9 84 -7.5 0.2 1.2 1 27.3');
    expect(firstActions).toEqual([]);

    const secondActions = session.feed(' 81\n');
    expect(secondActions).toContainEqual({
      type: 'data-point',
      point: { deviceId: 'DB0000116F0BEC30', tempC: 27.3, tempF: 81, fanOn: null },
    });
  });
});
