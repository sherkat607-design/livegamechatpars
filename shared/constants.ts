// Limits shared by server validation and client UI.

export const LIMITS = {
  usernameMin: 2,
  usernameMax: 32,
  displayNameMax: 32,
  passwordMin: 8,
  passwordMax: 128,
  bioMax: 190,
  customStatusMax: 128,
  activityMax: 128,
  serverNameMax: 100,
  serverDescriptionMax: 300,
  channelNameMax: 100,
  topicMax: 1024,
  roleNameMax: 100,
  messageMax: 4000,
  attachmentsPerMessage: 10,
  pinsPerChannel: 50,
  reactionsPerMessage: 20,
  emojisPerServer: 50,
  emojiMaxBytes: 256 * 1024,
  imageMaxBytes: 5 * 1024 * 1024,
  groupDmMax: 10,
  pollQuestionMax: 300,
  pollOptionMax: 55,
  pollOptionsMin: 2,
  pollOptionsMax: 10,
  pollMaxHours: 168,
  slowmodeMax: 21600,
  timeoutMaxDays: 28,
  nicknameMax: 32,
  searchPageSize: 25,
  messagePageSize: 50,
} as const;

/** Usernames: lowercase latin letters, digits, dot and underscore. */
export const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;

/** Custom emoji names. */
export const EMOJI_NAME_RE = /^[a-zA-Z0-9_]{2,32}$/;

/** Mention and emoji tokens inside message content. */
export const TOKEN = {
  user: /<@(\d+)>/g,
  role: /<@&(\d+)>/g,
  channel: /<#(\d+)>/g,
  emoji: /<(a?):([a-zA-Z0-9_]{2,32}):(\d+)>/g,
} as const;

export const INVITE_MAX_AGES = [0, 1800, 3600, 21600, 43200, 86400, 604800] as const;
export const INVITE_MAX_USES = [0, 1, 5, 10, 25, 50, 100] as const;
