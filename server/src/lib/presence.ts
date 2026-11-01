import type { PresenceStatus } from '@shared/types';

/** In-memory record of who is connected, and how they appear to others. */
export class PresenceTracker {
  private sockets = new Map<number, Set<string>>();
  private idle = new Set<string>();
  private preferred = new Map<number, PresenceStatus>();

  /** Returns true when this is the user's first connection. */
  connect(userId: number, socketId: string, preferred: string): boolean {
    let set = this.sockets.get(userId);
    const first = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(socketId);
    this.preferred.set(userId, normalize(preferred));
    return first;
  }

  /** Returns true when the user has no connections left. */
  disconnect(userId: number, socketId: string): boolean {
    this.idle.delete(socketId);
    const set = this.sockets.get(userId);
    if (!set) return true;
    set.delete(socketId);
    if (set.size === 0) {
      this.sockets.delete(userId);
      return true;
    }
    return false;
  }

  setIdle(socketId: string, idle: boolean) {
    if (idle) this.idle.add(socketId);
    else this.idle.delete(socketId);
  }

  setPreferred(userId: number, status: string) {
    this.preferred.set(userId, normalize(status));
  }

  isOnline(userId: number): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  onlineCount(userIds: number[]): number {
    return userIds.filter((id) => this.isOnline(id) && this.statusOf(id) !== 'offline').length;
  }

  /** Status as seen by other users. */
  statusOf(userId: number): PresenceStatus {
    const set = this.sockets.get(userId);
    if (!set || set.size === 0) return 'offline';
    const pref = this.preferred.get(userId) ?? 'online';
    if (pref === 'invisible') return 'offline';
    if (pref === 'online' && [...set].every((s) => this.idle.has(s))) return 'idle';
    return pref;
  }
}

function normalize(status: string): PresenceStatus {
  return status === 'idle' || status === 'dnd' || status === 'invisible' ? status : 'online';
}
