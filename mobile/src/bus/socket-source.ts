import { BusEvent } from './contracts';

export interface BusSource {
  subscribe(onEvent: (e: BusEvent) => void): () => void;
  start(): void;
  stop(): void;
}

export class SocketBusSource implements BusSource {
  subscribe(onEvent: (e: BusEvent) => void): () => void {
    throw new Error('not wired yet');
  }
  start(): void {
    throw new Error('not wired yet');
  }
  stop(): void {
    throw new Error('not wired yet');
  }
}
