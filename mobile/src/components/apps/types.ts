import { HapticPattern } from '../../bus/contracts';

export interface PendingApp {
  id: string;
  name: string;
  reason?: string;
  requestedAt: string;
}

export interface ConnectedApp {
  id: string;
  name: string;
  lastUsed: string;
  permissions?: string;
}

export interface RecentBuzz {
  id: string;
  source_app: string;
  pattern: HapticPattern;
  label: string;
  timestamp: string;
}
