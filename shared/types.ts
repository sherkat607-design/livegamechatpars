// Shapes of objects sent over the REST API and the real-time gateway.

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
export type ChannelType = 'text' | 'voice' | 'category' | 'announcement' | 'thread' | 'dm' | 'group_dm';
export type RelationshipType = 'friend' | 'incoming' | 'outgoing' | 'blocked';
export type NotifyLevel = 'all' | 'mentions' | 'none';
export type MessageType = 'default' | 'join' | 'pin' | 'thread_created' | 'call' | 'system';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  avatar: string | null;
  bannerColor: string | null;
  bio: string;
  customStatus: string;
  activity: string;
  /** Effective presence as other people see it. */
  status: PresenceStatus;
  createdAt: string;
}

export interface SelfUser extends PublicUser {
  email: string;
  locale: string;
  /** The status the user picked (may be "invisible"). */
  preferredStatus: PresenceStatus;
}

export interface Server {
  id: number;
  name: string;
  icon: string | null;
  description: string;
  ownerId: number;
  isPublic: boolean;
  systemChannelId: number | null;
  createdAt: string;
}

export interface Overwrite {
  targetType: 'role' | 'member';
  targetId: number;
  allow: number;
  deny: number;
}

export interface Channel {
  id: number;
  serverId: number | null;
  type: ChannelType;
  name: string;
  topic: string;
  position: number;
  parentId: number | null;
  slowmode: number;
  ownerId: number | null;
  icon: string | null;
  lastMessageId: number | null;
  archived: boolean;
  starterMessageId: number | null;
  overwrites: Overwrite[];
  recipients?: PublicUser[];
  createdAt: string;
}

export interface Role {
  id: number;
  serverId: number;
  name: string;
  color: string | null;
  position: number;
  permissions: number;
  hoist: boolean;
  mentionable: boolean;
  isDefault: boolean;
}

export interface Member {
  serverId: number;
  userId: number;
  nickname: string | null;
  roles: number[];
  joinedAt: string;
  timeoutUntil: string | null;
  user: PublicUser;
}

export interface MemberSettings {
  notifyLevel: NotifyLevel;
  muted: boolean;
}

export interface CustomEmoji {
  id: number;
  serverId: number;
  name: string;
  url: string;
  animated: boolean;
}

export interface Attachment {
  id: number;
  filename: string;
  url: string;
  contentType: string;
  size: number;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  me: boolean;
  users: number[];
}

export interface PollOption {
  text: string;
  votes: number;
}

export interface Poll {
  question: string;
  options: PollOption[];
  multi: boolean;
  expiresAt: string | null;
  totalVoters: number;
  myVotes: number[];
}

export interface MessageReference {
  id: number;
  author: PublicUser | null;
  webhookName: string | null;
  content: string;
  hasAttachments: boolean;
}

export interface Message {
  id: number;
  channelId: number;
  serverId: number | null;
  type: MessageType;
  author: PublicUser | null;
  webhook: { id: number; name: string; avatar: string | null } | null;
  content: string;
  replyTo: MessageReference | null;
  replyToId: number | null;
  thread: { id: number; name: string } | null;
  editedAt: string | null;
  pinned: boolean;
  mentionEveryone: boolean;
  mentions: number[];
  mentionRoles: number[];
  attachments: Attachment[];
  reactions: ReactionSummary[];
  poll: Poll | null;
  createdAt: string;
  /** Echo of the client-generated id used to match optimistic messages. */
  nonce?: string;
}

export interface ReadState {
  channelId: number;
  lastReadId: number;
  mentionCount: number;
}

export interface Relationship {
  user: PublicUser;
  type: RelationshipType;
}

export interface Invite {
  code: string;
  serverId: number;
  channelId: number | null;
  inviter: PublicUser | null;
  maxUses: number;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface InvitePreview {
  code: string;
  server: { id: number; name: string; icon: string | null; description: string };
  memberCount: number;
  onlineCount: number;
  inviter: PublicUser | null;
  expiresAt: string | null;
}

export interface Ban {
  user: PublicUser;
  reason: string;
  createdAt: string;
}

export interface Webhook {
  id: number;
  serverId: number;
  channelId: number;
  name: string;
  avatar: string | null;
  token: string;
  url: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  serverId: number;
  actor: PublicUser | null;
  action: string;
  targetId: number | null;
  targetType: string | null;
  reason: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface VoiceParticipant {
  userId: number;
  channelId: number;
  serverId: number | null;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  video: boolean;
  screen: boolean;
  streams: { camera?: string; screen?: string };
  joinedAt: string;
}

export interface ServerBundle {
  server: Server;
  channels: Channel[];
  roles: Role[];
  emojis: CustomEmoji[];
  member: Member;
  settings: MemberSettings;
  memberCount: number;
}

export interface ClientConfig {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  maxUploadMB: number;
}

export interface Bootstrap {
  user: SelfUser;
  servers: ServerBundle[];
  dms: Channel[];
  relationships: Relationship[];
  readStates: ReadState[];
  voiceStates: VoiceParticipant[];
  config: ClientConfig;
}

export interface DiscoverServer {
  id: number;
  name: string;
  icon: string | null;
  description: string;
  memberCount: number;
  onlineCount: number;
  joined: boolean;
}

export interface UserProfile {
  user: PublicUser;
  relationship: RelationshipType | null;
  mutualServers: { id: number; name: string; icon: string | null }[];
  mutualFriends: PublicUser[];
}

export interface SearchResult {
  total: number;
  messages: Message[];
}
