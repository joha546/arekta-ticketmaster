import { EventEmitter } from 'node:events';

export type AppEvents = {
  'reservation.confirmed': { reservationId: string; userId: string };
  'reservation.cancelled': { reservationId: string; userId: string };
  'showtime.reminder': { showtimeId: string; userId: string };
};

type EventKey = keyof AppEvents;

class TypedEventBus {
  private readonly emitter = new EventEmitter();

  emit<K extends EventKey>(event: K, payload: AppEvents[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  on<K extends EventKey>(event: K, listener: (payload: AppEvents[K]) => void): void {
    this.emitter.on(event, listener);
  }

  off<K extends EventKey>(event: K, listener: (payload: AppEvents[K]) => void): void {
    this.emitter.off(event, listener);
  }
}

export const eventBus = new TypedEventBus();
