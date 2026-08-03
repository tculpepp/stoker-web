import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchConfig, pushSettings } from '../../../../src/hardware/httpConfig/stokerConfigClient.js';
import type { StokerJsonResponse } from '../../../../src/hardware/httpConfig/types.js';
import type { Device, PitProbe } from '@stoker-web/shared-types';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as Response;
}

describe('fetchConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses blowers and a plain food probe (no attached blower)', async () => {
    const body: StokerJsonResponse = {
      stoker: {
        blowers: [{ id: 'e70000116f279031', name: 'Blower', on: 'on' }],
        sensors: [
          {
            id: 'db0000116f0bec30',
            name: 'Brisket Meat',
            al: '1',
            ta: 203,
            th: 0,
            tl: 0,
            tc: 74.1,
            blower: null,
          },
        ],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
    vi.stubGlobal('fetch', fetchMock);

    const devices = await fetchConfig('10.0.0.5');

    expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.5/stoker.json');
    expect(devices).toEqual([
      { id: 'E70000116F279031', name: 'Blower', type: 'fan', fanOn: true },
      {
        id: 'DB0000116F0BEC30',
        name: 'Brisket Meat',
        type: 'probe',
        targetTemp: 203,
        alarmLow: 0,
        alarmHigh: 0,
        alarmType: 'ALARM_FOOD',
        currentTemp: 74.1,
        blowerId: null,
      },
    ]);
  });

  it('resolves a pit probe blowerId, upper-cased', async () => {
    const body: StokerJsonResponse = {
      stoker: {
        blowers: null,
        sensors: [
          {
            id: 'e70000116f279030',
            name: 'Pit',
            al: '2',
            ta: 225,
            th: 250,
            tl: 200,
            tc: 108.9,
            blower: 'e70000116f279031',
          },
        ],
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));

    const [pit] = await fetchConfig('10.0.0.5');

    expect(pit).toMatchObject({ alarmType: 'ALARM_FIRE', blowerId: 'E70000116F279031' });
  });

  it('falls back to NONE for an unrecognized alarm ordinal', async () => {
    const body: StokerJsonResponse = {
      stoker: {
        blowers: null,
        sensors: [
          { id: 'db0000116f0bec30', name: 'Probe', al: 'nope', ta: 0, th: 0, tl: 0, tc: 0, blower: null },
        ],
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)));

    const [probe] = await fetchConfig('10.0.0.5');

    expect(probe).toMatchObject({ alarmType: 'NONE' });
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));

    await expect(fetchConfig('10.0.0.5')).rejects.toThrow('stoker.json request failed');
  });
});

describe('pushSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts al/n1/sw/ta/th/tl fields for a pit probe with ALARM_FIRE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const blower: Device = { id: 'E70000116F279031', name: 'Blower', type: 'fan', fanOn: true, totalRuntime: 0 };
    const pit: PitProbe = {
      id: 'E70000116F279030',
      name: 'Pit',
      type: 'probe',
      targetTemp: 225,
      alarmLow: 200,
      alarmHigh: 250,
      alarmType: 'ALARM_FIRE',
      currentTemp: 228,
      blower,
    };

    await pushSettings('10.0.0.5', [pit]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://10.0.0.5/stoker.Post_Handler');
    expect(init.method).toBe('POST');
    const body = init.body as string;
    expect(body).toContain('alE70000116F279030=2');
    expect(body).toContain('n1E70000116F279030=Pit');
    expect(body).toContain('swE70000116F279030=E70000116F279031');
    expect(body).toContain('taE70000116F279030=225');
    expect(body).toContain('thE70000116F279030=250');
    expect(body).toContain('tlE70000116F279030=200');
  });

  it('sends th/tl as n/a when alarm type is not ALARM_FIRE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const probe: Device = {
      id: 'DB0000116F0BEC30',
      name: 'Brisket',
      type: 'probe',
      targetTemp: 203,
      alarmLow: 0,
      alarmHigh: 0,
      alarmType: 'ALARM_FOOD',
      currentTemp: 165,
    };

    await pushSettings('10.0.0.5', [probe]);

    const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as string;
    expect(body).toContain('thDB0000116F0BEC30=n%2Fa');
    expect(body).toContain('tlDB0000116F0BEC30=n%2Fa');
    expect(body).toContain('swDB0000116F0BEC30=None');
  });

  it('posts only n2 for a bare fan device', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const fan: Device = { id: 'E70000116F279031', name: 'Blower', type: 'fan', fanOn: false, totalRuntime: 0 };

    await pushSettings('10.0.0.5', [fan]);

    const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as string;
    expect(body).toBe('n2E70000116F279031=Blower');
  });

  it('throws when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Error' }));

    const probe: Device = {
      id: 'X',
      name: 'X',
      type: 'probe',
      targetTemp: 0,
      alarmLow: 0,
      alarmHigh: 0,
      alarmType: 'NONE',
      currentTemp: 0,
    };

    await expect(pushSettings('10.0.0.5', [probe])).rejects.toThrow('stoker.Post_Handler request failed');
  });
});
