/**
 * Wire-compatible types for the /api/v1/* REST surface, mirrored from the legacy
 * Jersey/Jackson DTOs in legacy/src/com/gbak/sweb/common/json/*.java. The Android app
 * (bitbucket.org/garybak/stokerweb-android) depends on this exact shape — do not
 * normalize the quirks below without updating Android in a coordinated release.
 *
 * TODO(Phase 2): the legacy server used old Jackson (org.codehaus.jackson) whose default
 * Date serialization is epoch milliseconds, not ISO-8601 — EpochMillis below assumes this.
 * Confirm against golden-fixture responses captured from the running legacy/ app before
 * relying on it.
 */

/** Epoch-millisecond timestamp, per legacy Jackson's default Date serialization. */
export type EpochMillis = number;

export type AlarmType = 'NONE' | 'ALARM_FOOD' | 'ALARM_FIRE';

export interface LoginData {
  username: string;
  password: string;
}

export interface ServerRequest<T> {
  login: LoginData;
  data: T;
  hash?: string;
  submitTime: EpochMillis;
}

export interface ServerResponse<T> {
  success: boolean;
  data?: T;
  messages: string[];
  date: EpochMillis;
}

/**
 * Device discriminated union. Wire field is "type": "probe" | "fan", with "probe"
 * further discriminated by "pit" via a nested check (legacy Jackson @JsonSubTypes).
 * `id` is always upper-cased server-side (SDevice.setID) — preserve on write.
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

/**
 * NOTE numeric-looking fields are strings on the wire (legacy Probe.java types them
 * String, not int/float) — do not "fix" this to real JSON numbers, Android's parser
 * expects strings.
 */
export interface Probe extends DeviceBase {
  type: 'probe';
  targetTemp: string;
  /** wire key "alarmLow", legacy field name lowerTempAlarm */
  alarmLow: string;
  /** wire key "alarmHigh", legacy field name upperTempAlarm */
  alarmHigh: string;
  alarmType: AlarmType;
  currentTemp: string;
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

/** Serializes as a BARE JSON ARRAY (legacy CookerList extends ArrayList<Cooker>) — do not wrap. */
export type CookerList = Cooker[];

export interface ConfigurationSettings {
  cookerList: Cooker[];
  deviceList: Device[];
}

export interface LogItemCount {
  /** cookerName -> count */
  logItemCount: Record<string, number>;
}

export interface DeviceDataList {
  devices: Device[];
  receivedDate: EpochMillis;
  logCount: LogItemCount;
}

export interface LogItem {
  logName: string;
  cookerName: string;
  startDate: EpochMillis;
  deviceList: Device[];
}

export interface LogItemList {
  logList: LogItem[];
  receivedDate: EpochMillis;
}

export interface LogNote {
  note: string;
  logList: string[];
}
