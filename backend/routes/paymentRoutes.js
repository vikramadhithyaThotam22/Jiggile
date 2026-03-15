// ============================================================
// Jiggile - Payment Webhook & Auto-Approval Engine
// NO MANUAL APPROVAL: Payment ✓ → Approved → SentToWarehouse
// ============================================================
const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/db');

// POST /api/payments/webhook
// Simulated payment gateway webhook
// Triggers the AUTOMATIC approval sequence
router.post('/webhook', async (req, res) => {
    const client = await getClient();

    try {
        const { order_id, payment_gateway_id, status, payment_method, amount } = req.body;

        if (!order_id || !status) {
            client.release();
            return res.status(400).json({
                success: false,
                message: 'order_id and status are required.'
            });
        }

        // Only process successful payments
        if (status !== 'Success') {
            // Update payment status but don't approve
            await query(
                `UPDATE Payments SET status = $1, 
                    payment_gateway_id = $2,
                    webhook_payload = $3,
                    updated_at = NOW()
                 WHERE order_id = $4`,
                [status, payment_gateway_id || null, JSON.stringify(req.body), parseInt(order_id)]
            );

            client.release();
            return res.json({
                success: true,
                message: `Payment status updated to ${status}. No auto-approval triggered.`
            });
        }

        // ============================================================
        // AUTO-APPROVAL SEQUENCE (ALL IN ONE TRANSACTION)
        // Step 1: Update payment to Success
        // Step 2: Set order to Approved
        // Step 3: Immediately set to SentToWarehouse
        // Step 4: Deduct stock for each item
        // Step 5: Log stock changes
        // ============================================================

        await client.query('BEGIN');

        // Verify order exists and is Pending
        const orderCheck = await client.query(
            'SELECT id, status FROM Orders WHERE id = $1',
            [parseInt(order_id)]
        );

        if (orderCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        if (orderCheck.rows[0].status !== 'Pending') {
            await client.query('ROLLBACK');
            client.release();
            return res.status(400).json({
                success: false,
                message: `Order is already "${orderCheck.rows[0].status}". Cannot re-approve.`
            });
        }

        // STEP 1: Update payment to Success
        await client.query(
            `UPDATE Payments 
             SET status = 'Success', 
                 payment_gateway_id = $1,
                 payment_method = $2,
                 webhook_payload = $3,
                 updated_at = NOW()
             WHERE order_id = $4`,
            [payment_gateway_id || null, payment_method || null, 
             JSON.stringify(req.body), parseInt(order_id)]
        );

        // STEP 2 & 3: Approve → SentToWarehouse (immediate transition)
        await client.query(
            `UPDATE Orders 
             SET status = 'SentToWarehouse', 
                 approved_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [parseInt(order_id)]
        );

        // STEP 4 & 5: Deduct stock and log changes
        const orderItems = await client.query(
            'SELECT product_id, quantity FROM OrderItems WHERE order_id = $1',
            [parseInt(order_id)]
        );

        for (const item of orderItems.rows) {
            // Deduct stock
            await client.query(
                `UPDATE Products 
                 SET stock_quantity = stock_quantity - $1,
                     updated_at = NOW()
                 WHERE id = $2`,
                [item.quantity, item.product_id]
            );

            // Log stock change
            await client.query(
                `INSERT INTO StockLog (product_id, change_qty, reason, reference_id)
                 VALUES ($1, $2, 'Order approved - auto deduction', $3)`,
                [item.product_id, -item.quantity, parseInt(order_id)]
            );
        }

        await client.query('COMMIT');
        client.release();

        console.log(`\n✅ AUTO-APPROVAL: Order #${order_id} → Approved → SentToWarehouse`);
        console.log(`   Stock deducted for ${orderItems.rows.length} items.\n`);

        res.json({
            success: true,
            message: 'Payment confirmed. Order auto-approved and sent to warehouse.',
            data: {
                order_id: parseInt(order_id),
                new_status: 'SentToWarehouse',
                auto_approved: true,
                items_processed: orderItems.rows.length
            }
        });

    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        client.release();
        console.error('Payment webhook error:', err);
        res.status(500).json({ success: false, message: 'Webhook processing failed.' });
    }
});

// POST /api/payments/simulate/:orderId
// Development helper: Simulate a successful payment
router.post('/simulate/:orderId', async (req, res) => {
    // Forward to webhook with simulated success
    req.body = {
        order_id: parseInt(req.params.orderId),
        payment_gateway_id: `SIM-${Date.now()}`,
        status: 'Success',
        payment_method: 'UPI',
        amount: 0
    };

    // Re-route to webhook handler
    const webhookHandler = router.stack.find(r => r.route && r.route.path === '/webhook');
    if (webhookHandler) {
        return webhookHandler.route.stack[0].handle(req, res);
    }
});

module.exports = router;
