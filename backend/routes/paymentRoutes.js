// ============================================================
// Jiggile - Payment Webhook & Auto-Approval Engine
// NO MANUAL APPROVAL: Payment ✓ → Approved → SentToWarehouse
// ============================================================
const express = require('express');
const router = express.Router();
const { query, getPool, sql } = require('../config/db');

// POST /api/payments/webhook
// Simulated payment gateway webhook
// Triggers the AUTOMATIC approval sequence
router.post('/webhook', async (req, res) => {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        const { order_id, payment_gateway_id, status, payment_method, amount } = req.body;

        if (!order_id || !status) {
            return res.status(400).json({
                success: false,
                message: 'order_id and status are required.'
            });
        }

        // Only process successful payments
        if (status !== 'Success') {
            // Update payment status but don't approve
            await query(
                `UPDATE Payments SET status = @status, 
                    payment_gateway_id = @gatewayId,
                    webhook_payload = @payload,
                    updated_at = SYSUTCDATETIME()
                 WHERE order_id = @orderId`,
                {
                    status: status,
                    gatewayId: payment_gateway_id || null,
                    payload: JSON.stringify(req.body),
                    orderId: parseInt(order_id)
                }
            );

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

        await transaction.begin();
        const request = new sql.Request(transaction);

        // Verify order exists and is Pending
        const orderCheck = await request.query(
            `SELECT id, status FROM Orders WHERE id = ${parseInt(order_id)}`
        );

        if (orderCheck.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        if (orderCheck.recordset[0].status !== 'Pending') {
            await transaction.rollback();
            return res.status(400).json({
                success: false,
                message: `Order is already "${orderCheck.recordset[0].status}". Cannot re-approve.`
            });
        }

        // STEP 1: Update payment to Success
        await request.query(
            `UPDATE Payments 
             SET status = 'Success', 
                 payment_gateway_id = ${payment_gateway_id ? `'${payment_gateway_id}'` : 'NULL'},
                 payment_method = ${payment_method ? `'${payment_method}'` : 'NULL'},
                 webhook_payload = N'${JSON.stringify(req.body).replace(/'/g, "''")}',
                 updated_at = SYSUTCDATETIME()
             WHERE order_id = ${parseInt(order_id)}`
        );

        // STEP 2 & 3: Approve → SentToWarehouse (immediate transition)
        await request.query(
            `UPDATE Orders 
             SET status = 'SentToWarehouse', 
                 approved_at = SYSUTCDATETIME(),
                 updated_at = SYSUTCDATETIME()
             WHERE id = ${parseInt(order_id)}`
        );

        // STEP 4 & 5: Deduct stock and log changes
        const orderItems = await request.query(
            `SELECT product_id, quantity FROM OrderItems WHERE order_id = ${parseInt(order_id)}`
        );

        for (const item of orderItems.recordset) {
            // Deduct stock
            await request.query(
                `UPDATE Products 
                 SET stock_quantity = stock_quantity - ${item.quantity},
                     updated_at = SYSUTCDATETIME()
                 WHERE id = ${item.product_id}`
            );

            // Log stock change
            await request.query(
                `INSERT INTO StockLog (product_id, change_qty, reason, reference_id)
                 VALUES (${item.product_id}, -${item.quantity}, 
                         'Order approved - auto deduction', ${parseInt(order_id)})`
            );
        }

        await transaction.commit();

        console.log(`\n✅ AUTO-APPROVAL: Order #${order_id} → Approved → SentToWarehouse`);
        console.log(`   Stock deducted for ${orderItems.recordset.length} items.\n`);

        res.json({
            success: true,
            message: 'Payment confirmed. Order auto-approved and sent to warehouse.',
            data: {
                order_id: parseInt(order_id),
                new_status: 'SentToWarehouse',
                auto_approved: true,
                items_processed: orderItems.recordset.length
            }
        });

    } catch (err) {
        try { await transaction.rollback(); } catch (e) {}
        console.error('Payment webhook error:', err);
        res.status(500).json({ success: false, message: 'Webhook processing failed.' });
    }
});

// POST /api/payments/simulate/:orderId
// Development helper: Simulate a successful payment
router.post('/simulate/:orderId', async (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({ 
            success: false, 
            message: 'Only available in development mode.' 
        });
    }

    // Forward to webhook with simulated success
    req.body = {
        order_id: parseInt(req.params.orderId),
        payment_gateway_id: `SIM-${Date.now()}`,
        status: 'Success',
        payment_method: 'UPI',
        amount: 0 // Will use order total
    };

    // Re-route to webhook handler
    const webhookHandler = router.stack.find(r => r.route && r.route.path === '/webhook');
    if (webhookHandler) {
        return webhookHandler.route.stack[0].handle(req, res);
    }
});

module.exports = router;
