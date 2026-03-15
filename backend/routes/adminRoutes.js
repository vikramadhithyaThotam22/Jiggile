// ============================================================
// Jiggile - Admin Dashboard Routes
// RBAC: Owner-only for profit data
// ============================================================
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

// All admin routes require authentication + Admin/Owner role
router.use(authenticate);
router.use(authorize('Admin', 'Owner'));

// GET /api/admin/dashboard
// Today's summary: orders, revenue, profit (profit = Owner only)
router.get('/dashboard', async (req, res) => {
    try {
        // Today's orders & revenue
        const todayStats = await query(`
            SELECT 
                COUNT(*) as total_orders,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) as delivered_orders,
                SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending_orders,
                SUM(CASE WHEN status IN ('SentToWarehouse', 'Packing') THEN 1 ELSE 0 END) as processing_orders,
                SUM(CASE WHEN status = 'OutForDelivery' THEN 1 ELSE 0 END) as out_for_delivery
            FROM Orders 
            WHERE created_at::DATE = (NOW() AT TIME ZONE 'UTC')::DATE
        `);

        const stats = todayStats.rows[0];

        // Profit calculation (OWNER ONLY)
        let profit = null;
        if (req.user.role === 'Owner') {
            const profitResult = await query(`
                SELECT COALESCE(SUM((oi.unit_price - oi.cost_price_snapshot) * oi.quantity), 0) as net_profit
                FROM OrderItems oi
                JOIN Orders o ON oi.order_id = o.id
                WHERE o.created_at::DATE = (NOW() AT TIME ZONE 'UTC')::DATE
                  AND o.status NOT IN ('Cancelled')
            `);
            profit = profitResult.rows[0].net_profit;
        }

        // Total customers
        const customerCount = await query(
            "SELECT COUNT(*) as total FROM Users WHERE role = 'Customer'"
        );

        res.json({
            success: true,
            data: {
                today: {
                    ...stats,
                    net_profit: profit // null for non-Owner
                },
                total_customers: parseInt(customerCount.rows[0].total)
            }
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ success: false, message: 'Failed to load dashboard.' });
    }
});

// GET /api/admin/monthly-growth
// Monthly revenue & profit trends (past 6 months)
router.get('/monthly-growth', async (req, res) => {
    try {
        let profitColumn = '0 as net_profit';
        if (req.user.role === 'Owner') {
            profitColumn = `COALESCE((
                SELECT SUM((oi.unit_price - oi.cost_price_snapshot) * oi.quantity)
                FROM OrderItems oi 
                JOIN Orders o2 ON oi.order_id = o2.id
                WHERE EXTRACT(YEAR FROM o2.created_at) = EXTRACT(YEAR FROM o.created_at)
                  AND EXTRACT(MONTH FROM o2.created_at) = EXTRACT(MONTH FROM o.created_at)
                  AND o2.status NOT IN ('Cancelled')
            ), 0) as net_profit`;
        }

        const result = await query(`
            SELECT 
                EXTRACT(YEAR FROM o.created_at)::INT as year,
                EXTRACT(MONTH FROM o.created_at)::INT as month,
                TO_CHAR(MIN(o.created_at), 'Mon YYYY') as month_label,
                COUNT(*) as total_orders,
                COALESCE(SUM(o.total_amount), 0) as revenue,
                ${profitColumn}
            FROM Orders o
            WHERE o.created_at >= NOW() - INTERVAL '6 months'
              AND o.status NOT IN ('Cancelled')
            GROUP BY EXTRACT(YEAR FROM o.created_at), EXTRACT(MONTH FROM o.created_at)
            ORDER BY year ASC, month ASC
        `);

        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Monthly growth error:', err);
        res.status(500).json({ success: false, message: 'Failed to load growth data.' });
    }
});

// GET /api/admin/low-stock
// Products below their low_stock_threshold
router.get('/low-stock', async (req, res) => {
    try {
        const result = await query(`
            SELECT p.id, p.name, p.stock_quantity, p.low_stock_threshold,
                   p.selling_price, c.name as category_name,
                   CASE WHEN p.stock_quantity <= 0 THEN 'Out of Stock'
                        ELSE 'Low Stock' END as alert_type
            FROM Products p
            JOIN Categories c ON p.category_id = c.id
            WHERE p.is_active = TRUE 
              AND p.stock_quantity <= p.low_stock_threshold
            ORDER BY p.stock_quantity ASC
        `);

        res.json({
            success: true,
            data: result.rows,
            total_alerts: result.rows.length
        });
    } catch (err) {
        console.error('Low stock error:', err);
        res.status(500).json({ success: false, message: 'Failed to load stock alerts.' });
    }
});

// GET /api/admin/orders
// All orders for admin management
router.get('/orders', async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        let paramIndex = 1;

        let whereClause = '';
        if (status) {
            whereClause = `WHERE o.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }

        params.push(parseInt(limit));
        params.push(offset);

        const result = await query(`
            SELECT o.id, o.order_number, o.status, o.total_amount,
                   o.delivery_address, o.delivery_deadline,
                   o.created_at, o.approved_at, o.delivered_at,
                   u.name as customer_name, u.mobile as customer_mobile,
                   (SELECT COUNT(*) FROM OrderItems WHERE order_id = o.id) as item_count
            FROM Orders o
            JOIN Users u ON o.user_id = u.id
            ${whereClause}
            ORDER BY o.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, params);

        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Admin orders error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
    }
});

// PATCH /api/admin/orders/:id/status
// Update order status (manual steps: Packing → OutForDelivery → Delivered)
router.patch('/orders/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const orderId = parseInt(req.params.id);

        const validTransitions = {
            'SentToWarehouse': 'Packing',
            'Packing': 'OutForDelivery',
            'OutForDelivery': 'Delivered'
        };

        // Verify current status
        const current = await query(
            'SELECT status FROM Orders WHERE id = $1',
            [orderId]
        );

        if (current.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const currentStatus = current.rows[0].status;
        const expectedNext = validTransitions[currentStatus];

        if (status !== expectedNext) {
            return res.status(400).json({
                success: false,
                message: `Cannot transition from "${currentStatus}" to "${status}". Expected: "${expectedNext}".`
            });
        }

        // Build timestamp update
        let timestampField = '';
        if (status === 'Packing') timestampField = ', packed_at = NOW()';
        if (status === 'OutForDelivery') timestampField = ', dispatched_at = NOW()';
        if (status === 'Delivered') timestampField = ', delivered_at = NOW()';

        await query(
            `UPDATE Orders SET status = $1, updated_at = NOW() 
             ${timestampField} WHERE id = $2`,
            [status, orderId]
        );

        console.log(`📦 Order #${orderId}: ${currentStatus} → ${status}`);

        res.json({
            success: true,
            message: `Order updated to "${status}".`,
            data: { order_id: orderId, previous_status: currentStatus, new_status: status }
        });
    } catch (err) {
        console.error('Status update error:', err);
        res.status(500).json({ success: false, message: 'Failed to update status.' });
    }
});

// GET /api/admin/products
// Admin product management with cost prices visible
router.get('/products', async (req, res) => {
    try {
        const result = await query(`
            SELECT p.*, c.name as category_name
            FROM Products p
            JOIN Categories c ON p.category_id = c.id
            ORDER BY p.category_id, p.name
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Admin products error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch products.' });
    }
});

module.exports = router;
