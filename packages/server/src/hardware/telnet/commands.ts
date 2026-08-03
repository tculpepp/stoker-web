/** Exact wire commands the Stoker firmware expects — do not change, talks to unchangeable hardware. */
export const STOKER_CMD_START = 'bbq -t\n';
export const STOKER_CMD_STOP = '\nbbq -k\n';
export const STOKER_CMD_TEMPS = '\nbbq -temps\n';
export const STOKER_CMD_LOGIN_ID = 'root\r\n';
export const STOKER_CMD_LOGIN_PASSWORD = 'tini\r\n';

export const STOKER_PROMPT_LOGIN = 'login:';
export const STOKER_PROMPT_PASSWORD = 'password:';
export const STOKER_CONDITION_START = 'stoker: start';
export const STOKER_CONDITION_STOP = 'stkcmd: stop';
