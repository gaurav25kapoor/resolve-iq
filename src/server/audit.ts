import { db } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';

export interface AuditEntryInput {
  actor: Pick<AuthUser, 'id' | 'name' | 'role'> | null;
  actionType: string;
  entityType: string;
  entityId: string;
  ticketId?: string | null;
  details?: Record<string, unknown>;
}

export async function recordAuditLog(input: AuditEntryInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorUserId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? 'System',
      actorRole: input.actor?.role ?? 'system',
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId,
      ticketId: input.ticketId ?? null,
      detailsJson: input.details ?? {},
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
