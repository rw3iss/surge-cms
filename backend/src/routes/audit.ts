import { Router, } from 'express';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { handleRouteError, sendPaginated, } from '../utils/response';

const router = Router();

// GET / - List audit log entries with pagination and filters
router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const {
            entityType,
            action,
            userId,
            startDate,
            endDate,
            page = 1,
            limit = 50,
        } = req.query;

        const pageNum = Math.max(1, Number(page,),);
        const limitNum = Math.min(100, Math.max(1, Number(limit,),),);
        const offset = (pageNum - 1) * limitNum;

        let whereClause = 'WHERE 1=1';
        const params: unknown[] = [];

        if (entityType && typeof entityType === 'string') {
            params.push(entityType,);
            whereClause += ` AND al.entity_type = $${params.length}`;
        }

        if (action && typeof action === 'string') {
            params.push(action,);
            whereClause += ` AND al.action = $${params.length}`;
        }

        if (userId && typeof userId === 'string') {
            params.push(userId,);
            whereClause += ` AND al.user_id = $${params.length}`;
        }

        if (startDate && typeof startDate === 'string') {
            params.push(startDate,);
            whereClause += ` AND al.created_at >= $${params.length}`;
        }

        if (endDate && typeof endDate === 'string') {
            params.push(endDate,);
            whereClause += ` AND al.created_at <= $${params.length}`;
        }

        const countResult = await query(
            `SELECT COUNT(*) FROM audit_log al ${whereClause}`,
            params,
        );
        const total = parseInt(countResult.rows[0].count, 10,);

        params.push(limitNum, offset,);
        const result = await query(
            `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
              al.old_values, al.new_values, al.ip_address, al.user_agent, al.created_at,
              u.display_name as user_display_name, u.email as user_email
       FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params,
        );

        const data = result.rows.map((row,) => ({
            id: row.id,
            userId: row.user_id,
            userDisplayName: row.user_display_name,
            userEmail: row.user_email,
            action: row.action,
            entityType: row.entity_type,
            entityId: row.entity_id,
            oldValues: row.old_values,
            newValues: row.new_values,
            ipAddress: row.ip_address,
            userAgent: row.user_agent,
            createdAt: row.created_at,
        }));

        sendPaginated(res, data, pageNum, limitNum, total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch audit logs',);
    }
},);

export default router;
