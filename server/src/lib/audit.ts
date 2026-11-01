import type { Db } from '../db';
import { auditLogs } from '../db/schema';

export type AuditAction =
  | 'server_update'
  | 'channel_create'
  | 'channel_update'
  | 'channel_delete'
  | 'overwrite_update'
  | 'overwrite_delete'
  | 'role_create'
  | 'role_update'
  | 'role_delete'
  | 'member_kick'
  | 'member_ban'
  | 'member_unban'
  | 'member_timeout'
  | 'member_update'
  | 'member_role_add'
  | 'member_role_remove'
  | 'member_voice_update'
  | 'invite_create'
  | 'invite_delete'
  | 'emoji_create'
  | 'emoji_update'
  | 'emoji_delete'
  | 'webhook_create'
  | 'webhook_update'
  | 'webhook_delete'
  | 'message_delete'
  | 'message_pin'
  | 'message_unpin'
  | 'thread_update'
  | 'ownership_transfer';

export async function audit(
  db: Db,
  entry: {
    serverId: number;
    actorId: number | null;
    action: AuditAction;
    targetId?: number | null;
    targetType?: string | null;
    reason?: string;
    details?: Record<string, unknown> | null;
  },
) {
  await db.insert(auditLogs).values({
    serverId: entry.serverId,
    actorId: entry.actorId,
    action: entry.action,
    targetId: entry.targetId ?? null,
    targetType: entry.targetType ?? null,
    reason: entry.reason ?? '',
    details: entry.details ?? null,
  });
}
