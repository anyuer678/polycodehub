import { dbPool } from '../db';
import { AuthUser } from './auth';

export async function writeAudit(
  action: string,
  user: AuthUser | null,
  resourceType: string,
  resourceId: string | null,
  detail: unknown
) {
  try {
    await dbPool.query(
      `INSERT INTO audit_logs(action, actor_user_id, actor_username, resource_type, resource_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [action, user?.id || null, user?.username || null, resourceType, resourceId, JSON.stringify(detail || {})]
    );
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
