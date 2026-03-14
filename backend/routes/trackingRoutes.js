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
            WHERE o.id = @orderId AND (o.user_id = @userId OR @role IN ('Admin', 'Owner'))
        `, { orderId, userId: req.user.id, role: req.user.role });

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const order = result.recordset[0];

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
            'SELECT id FROM DeliveryTracking WHERE order_id = @orderId',
            { orderId }
        );

        if (existing.recordset.length === 0) {
            await query(
                `INSERT INTO DeliveryTracking (order_id, rider_name, rider_phone, rider_lat, rider_lng, estimated_arrival)
                 VALUES (@orderId, @riderName, @riderPhone, @riderLat, @riderLng, @eta)`,
                {
                    orderId,
                    riderName: rider_name || null,
                    riderPhone: rider_phone || null,
                    riderLat: rider_lat || null,
                    riderLng: rider_lng || null,
                    eta: estimated_arrival || null
                }
            );
        } else {
            await query(
                `UPDATE DeliveryTracking 
                 SET rider_name = COALESCE(@riderName, rider_name),
                     rider_phone = COALESCE(@riderPhone, rider_phone),
                     rider_lat = COALESCE(@riderLat, rider_lat),
                     rider_lng = COALESCE(@riderLng, rider_lng),
                     estimated_arrival = COALESCE(@eta, estimated_arrival),
                     updated_at = SYSUTCDATETIME()
                 WHERE order_id = @orderId`,
                {
                    orderId,
                    riderName: rider_name || null,
                    riderPhone: rider_phone || null,
                    riderLat: rider_lat || null,
                    riderLng: rider_lng || null,
                    eta: estimated_arrival || null
                }
            );
        }

        res.json({ success: true, message: 'Tracking updated.' });
    } catch (err) {
        console.error('Update tracking error:', err);
        res.status(500).json({ success: false, message: 'Failed to update tracking.' });
    }
});

module.exports = router;
