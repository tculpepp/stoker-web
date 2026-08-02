/**
 * Types for the /api/v1/* REST surface — the new contract (Phase 0.5).
 *
 * This supersedes the legacy Jersey/Jackson DTOs (legacy/src/com/gbak/sweb/common/json/*.java)
 * and absorbs the old GWT-RPC surface (legacy/src/com/gbak/sweb/client/StokerCoreService.java,
 * server/StokerCoreServiceImpl.java) that the retired GWT client used for config, alerts,
 * login, and graph data. There is no legacy implementation of this exact contract to be
 * wire-compatible with — Android and the browser client are both rewritten against it
 * together. See docs/api-v1-schema.md for the human-readable endpoint reference and
 * docs/fixtures/*.json for example payloads.
 */

export type AlarmType = 'NONE' | 'ALARM_FOOD' | 'ALARM_FIRE';

/**
 * Device discriminated union. `id` is always upper-cased server-side — preserve on write.
 */
export interface DeviceBase {
  id: string;
  name: string;
  cooker?: string;
}

export interface Blower extends DeviceBase {
  type: 'fan';
  fanOn: boolean;
  totalRuntime: number;
}

export interface Probe extends DeviceBase {
  type: 'probe';
  targetTemp: number;
  alarmLow: number;
  alarmHigh: number;
  alarmType: AlarmType;
  currentTemp: number;
}

export interface PitProbe extends Probe {
  blower?: Blower;
}

export type Device = Blower | Probe | PitProbe;

export interface Cooker {
  name: string;
  pitProbe?: PitProbe;
  probeList: Probe[];
}

/** Error body for any non-2xx response. */
export interface ApiErrorResponse {
  error: string;
}

// ---------------------------------------------------------------------------
// Auth — POST /api/v1/auth/login
// ---------------------------------------------------------------------------

export interface LoginRequest {
  username: string;
  password: string;
}

/** `expiresAt` is ISO-8601. Mutating routes take `Authorization: Bearer <token>`. */
export interface LoginResponse {
  token: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Cookers — GET /api/v1/cookers
// ---------------------------------------------------------------------------

export interface CookersResponse {
  cookers: Cooker[];
}

// ---------------------------------------------------------------------------
// Devices — GET /api/v1/devices, PATCH /api/v1/devices
// ---------------------------------------------------------------------------

export interface DevicesResponse {
  devices: Device[];
  receivedAt: string;
}

/** Unified device/probe settings push — replaces legacy's two separate paths. */
export interface PatchDevicesRequest {
  devices: Device[];
}

// ---------------------------------------------------------------------------
// Config — GET /api/v1/config, PUT /api/v1/config/cookers
// ---------------------------------------------------------------------------

/** Full cooker+device config — absorbs RPC `getDeviceConfiguration()`. */
export interface ConfigResponse {
  cookers: Cooker[];
  devices: Device[];
}

/** Absorbs RPC `updateStokerWebConfig()`. */
export interface UpdateCookersRequest {
  cookers: Cooker[];
}

// ---------------------------------------------------------------------------
// Alerts config — GET/PUT /api/v1/alerts/config
// ---------------------------------------------------------------------------

/**
 * StokerAlarm fields only — the only real alert type (TempAlert/TimedAlert/
 * ConnectionOrConfigChangeAlert are legacy stubs with zero functionality, not ported).
 * Per-probe thresholds (`alarmLow`/`alarmHigh`/`alarmType`) live on `Probe` itself and
 * are set via `PATCH /api/v1/devices`; this endpoint covers the alarm's global behavior.
 */
export interface AlertConfig {
  enabled: boolean;
  deliveryMethods: string[];
  availableDeliveryMethods: string[];
  /** Minimum minutes between repeat alerts for the same probe. */
  repeatSuppressionMinutes: number;
}

// ---------------------------------------------------------------------------
// Logs — GET /api/v1/logs, POST /api/v1/logs, POST /api/v1/logs/{logId}/stop,
//        POST /api/v1/logs/notes, GET /api/v1/logs/{logId}/readings
// ---------------------------------------------------------------------------

export interface LogSummary {
  logId: string;
  cookerName: string;
  startedAt: string;
  /** null while the log is still active. */
  endedAt: string | null;
}

export interface LogsResponse {
  logs: LogSummary[];
}

export interface StartLogRequest {
  cookerName: string;
  devices: Device[];
}

export interface StartLogResponse {
  logId: string;
}

export interface AddLogNotesRequest {
  note: string;
  logIds: string[];
}

/** One reading for one device at one point in time, from an active or completed log. */
export interface LogReading {
  collectedAt: string;
  deviceId: string;
  tempF: number;
  tempC: number;
}

export interface LogReadingsResponse {
  readings: LogReading[];
}
