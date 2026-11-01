import { create } from 'zustand';
import type { Message } from '@shared/types';
import type { Anchor } from '../components/ui';

export type ModalState =
  | null
  | { type: 'createServer' }
  | { type: 'invite'; serverId: number; channelId?: number }
  | { type: 'createChannel'; serverId: number; parentId?: number | null; kind?: 'text' | 'voice' | 'category' | 'announcement' }
  | { type: 'serverSettings'; serverId: number; tab?: string }
  | { type: 'channelSettings'; channelId: number; tab?: string }
  | { type: 'userSettings'; tab?: string }
  | { type: 'newDm' }
  | { type: 'poll'; channelId: number }
  | { type: 'createThread'; channelId: number; message?: Message }
  | { type: 'lightbox'; url: string; filename: string };

export type SidePanel = null | { type: 'pins' } | { type: 'search'; query?: string } | { type: 'thread'; channelId: number } | { type: 'threads' };

interface UiState {
  modal: ModalState;
  profile: { userId: number; serverId: number | null; anchor: Anchor } | null;
  memberList: boolean;
  mobileNav: boolean;
  side: SidePanel;
  replyTo: Record<number, Message | null>;
  editing: number | null;
  /** Ask a message list to scroll to (and highlight) a message. */
  jump: { channelId: number; messageId: number } | null;
  collapsed: Record<number, boolean>;
  open: (m: ModalState) => void;
  close: () => void;
  showProfile: (userId: number, serverId: number | null, anchor: Anchor) => void;
  hideProfile: () => void;
  toggleMemberList: () => void;
  setMobileNav: (v: boolean) => void;
  setSide: (p: SidePanel) => void;
  setReply: (channelId: number, m: Message | null) => void;
  setEditing: (id: number | null) => void;
  jumpTo: (channelId: number, messageId: number) => void;
  clearJump: () => void;
  toggleCollapsed: (categoryId: number) => void;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const useUi = create<UiState>((set, get) => ({
  modal: null,
  profile: null,
  memberList: load('lgcp.memberList', true),
  mobileNav: false,
  side: null,
  replyTo: {},
  editing: null,
  jump: null,
  collapsed: load('lgcp.collapsed', {}),
  open: (modal) => set({ modal, profile: null }),
  close: () => set({ modal: null }),
  showProfile: (userId, serverId, anchor) => set({ profile: { userId, serverId, anchor } }),
  hideProfile: () => set({ profile: null }),
  toggleMemberList: () => {
    const memberList = !get().memberList;
    save('lgcp.memberList', memberList);
    set({ memberList });
  },
  setMobileNav: (mobileNav) => set({ mobileNav }),
  setSide: (side) => set({ side }),
  setReply: (channelId, m) => set((s) => ({ replyTo: { ...s.replyTo, [channelId]: m } })),
  setEditing: (editing) => set({ editing }),
  jumpTo: (channelId, messageId) => set({ jump: { channelId, messageId } }),
  clearJump: () => set({ jump: null }),
  toggleCollapsed: (id) => {
    const collapsed = { ...get().collapsed, [id]: !get().collapsed[id] };
    save('lgcp.collapsed', collapsed);
    set({ collapsed });
  },
}));
