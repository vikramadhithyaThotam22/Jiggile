// ============================================================
// Jiggile - Delivery Tracking Routes
// Real-time GPS + ETA for active deliveries
// ============================================================
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/tracking/:orderId
// Get real-time tracking data for an order (authenticated)
router.get('/:orderId', authenticate, async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId);

        // Get order with tracking data
        const result = await query(`
            SELECT o.id, o.order_number, o.status, o.delivery_address,
                   o.delivery_lat, o.delivery_lng, o.delivery_deadline,
                   o.created_at, o.dispatched_at,
                   dt.rider_name, dt.rider_phone, dt.rider_lat, dt.rider_lng,
                   dt.estimated_arrival, dt.updated_at as tracking_updated_at
            FROM Orders o
            LEFT JOIN DeliveryTracking dt ON o.id = dt.order_id
            WHERE o.id = $1 AND (o.user_id = $2 OR $3 IN ('Admin', 'Owner'))
        `, [orderId, req.user.id, req.user.role]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const order = result.rows[0];

        // Calculate remaining time
        let remainingSeconds = null;
        if (order.delivery_deadline) {
            remainingSeconds = Math.max(0, 
                Math.floor((new Date(order.delivery_deadline) - new Date()) / 1000)
            );
        }

        res.json({
            success: true,
            data: {
                ...order,
                remaining_seconds: remainingSeconds,
                delivery_time_minutes: parseInt(process.env.DELIVERY_TIME_MINUTES) || 10
            }
        });
    } catch (err) {
        console.error('Tracking error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch tracking.' });
    }
});

// POST /api/tracking/:orderId
// Update rider location (Admin/rider only)
router.post('/:orderId', authenticate, authorize('Admin', 'Owner'), async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId);
        const { rider_name, rider_phone, rider_lat, rider_lng, estimated_arrival } = req.body;

        // Upsert tracking record
        const existing = await query(
            'SELECT id FROM DeliveryTracking WHERE order_id = $1',
            [orderId]
        );

        if (existing.rows.length === 0) {
            await query(
                `INSERT INTO DeliveryTracking (order_id, rider_name, rider_phone, rider_lat, rider_lng, estimated_arrival)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [orderId, rider_name || null, rider_phone || null,
                 rider_lat || null, rider_lng || null, estimated_arrival || null]
            );
        } else {
            await query(
                `UPDATE DeliveryTracking 
                 SET rider_name = COALESCE($1, rider_name),
                     rider_phone = COALESCE($2, rider_phone),
                     rider_lat = COALESCE($3, rider_lat),
                     rider_lng = COALESCE($4, rider_lng),
                     estimated_arrival = COALESCE($5, estimated_arrival),
                     updated_at = NOW()
                 WHERE order_id = $6`,
                [rider_name || null, rider_phone || null,
                 rider_lat || null, rider_lng || null,
                 estimated_arrival || null, orderId]
            );
        }

        res.json({ success: true, message: 'Tracking updated.' });
    } catch (err) {
        console.error('Update tracking error:', err);
        res.status(500).json({ success: false, message: 'Failed to update tracking.' });
    }
});

module.exports = router;
