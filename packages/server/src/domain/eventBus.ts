/**
 * Typed domain event bus (← Guava `EventBus` usage throughout legacy `server/`). Feeds
 * the DB log-writer, the WS gateway (Phase 3), and the alert evaluator — nothing in this
 * layer talks to hardware or the DB directly, it only publishes/subscribes.
 */

import { EventEmitter } from 'node:events';
import type { AlarmType } from '@stoker-web/shared-types';
import type { ConnectionState } from '@stoker-web/shared-types';

export type DomainEvent =
  | { type: 'data-point'; deviceId: string; tempC: number; tempF: number; collectedAt: string }
  | { type: 'blower-state'; deviceId: string; fanOn: boolean; collectedAt: string }
  | { type: 'connection-state'; state: ConnectionState }
  | { type: 'config-change' }
  | {
      type: 'alarm';
      deviceId: string;
      alarmType: AlarmType;
      currentTemp: number;
      message: string;
    };

type DomainEventType = DomainEvent['type'];
type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

export class DomainEventBus extends EventEmitter {
  publish(event: DomainEvent): void {
    this.emit(event.type, event);
  }

  subscribe<T extends DomainEventType>(
    type: T,
    handler: (event: DomainEventOf<T>) => void,
  ): void {
    this.on(type, handler as (event: DomainEvent) => void);
  }
}
