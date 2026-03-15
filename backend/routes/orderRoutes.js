// ============================================================
// Jiggile - Order Routes
// Place orders with stock validation & reservation
// ============================================================
const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');

// Generate unique order number: JIG-YYYYMMDD-XXXX
function generateOrderNumber() {
    const date = new Date();
    const dateStr = date.getFullYear().toString() +
        (date.getMonth() + 1).toString().padStart(2, '0') +
        date.getDate().toString().padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `JIG-${dateStr}-${rand}`;
}

// POST /api/orders
// Place a new order (authenticated customers)
router.post('/', authenticate, async (req, res) => {
    const client = await getClient();

    try {
        const { items, delivery_address, delivery_lat, delivery_lng, notes } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            client.release();
            return res.status(400).json({
                success: false,
                message: 'Order must contain at least one item.'
            });
        }

        if (!delivery_address) {
            client.release();
            return res.status(400).json({
                success: false,
                message: 'Delivery address is required.'
            });
        }

        await client.query('BEGIN');

        // Validate stock & calculate totals
        let totalAmount = 0;
        const orderItems = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const prodResult = await client.query(
                `SELECT id, name, selling_price, cost_price, stock_quantity 
                 FROM Products WHERE id = $1 AND is_active = TRUE`,
                [parseInt(item.product_id)]
            );

            if (prodResult.rows.length === 0) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(400).json({
                    success: false,
                    message: `Product ID ${item.product_id} not found.`
                });
            }

            const product = prodResult.rows[0];

            if (product.stock_quantity < item.quantity) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(400).json({
                    success: false,
                    message: `"${product.name}" has only ${product.stock_quantity} units in stock.`
                });
            }

            orderItems.push({
                product_id: product.id,
                product_name: product.name,
                quantity: parseInt(item.quantity),
                unit_price: product.selling_price,
                cost_price_snapshot: product.cost_price
            });

            totalAmount += product.selling_price * parseInt(item.quantity);
        }

        // Create order
        const orderNumber = generateOrderNumber();
        const deliveryMinutes = parseInt(process.env.DELIVERY_TIME_MINUTES) || 10;
        
        const orderResult = await client.query(
            `INSERT INTO Orders (user_id, order_number, total_amount, delivery_address, 
                                 delivery_lat, delivery_lng, delivery_deadline, notes)
             VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '${deliveryMinutes} minutes', $7)
             RETURNING id, order_number, delivery_deadline`,
            [req.user.id, orderNumber, totalAmount, delivery_address,
             delivery_lat || null, delivery_lng || null, notes || null]
        );

        const orderId = orderResult.rows[0].id;

        // Insert order items
        for (const item of orderItems) {
            await client.query(
                `INSERT INTO OrderItems (order_id, product_id, product_name, quantity, unit_price, cost_price_snapshot)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [orderId, item.product_id, item.product_name, 
                 item.quantity, item.unit_price, item.cost_price_snapshot]
            );
        }

        // Create pending payment record
        await client.query(
            `INSERT INTO Payments (order_id, amount) VALUES ($1, $2)`,
            [orderId, totalAmount]
        );

        await client.query('COMMIT');
        client.release();

        res.status(201).json({
            success: true,
            message: 'Order placed successfully. Proceed to payment.',
            data: {
                order_id: orderId,
                order_number: orderNumber,
                total_amount: totalAmount,
                delivery_deadline: orderResult.rows[0].delivery_deadline,
                items: orderItems
            }
        });

    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        client.release();
        console.error('Create order error:', err);
        res.status(500).json({ success: false, message: 'Failed to create order.' });
    }
});

// GET /api/orders/my
// Get authenticated user's orders
router.get('/my', authenticate, async (req, res) => {
    try {
        const result = await query(
            `SELECT o.id, o.order_number, o.status, o.total_amount, 
                    o.delivery_address, o.delivery_deadline,
                    o.created_at, o.approved_at, o.delivered_at,
                    (SELECT COUNT(*) FROM OrderItems WHERE order_id = o.id) as item_count
             FROM Orders o 
             WHERE o.user_id = $1 
             ORDER BY o.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('My orders error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
    }
});

// GET /api/orders/:id
// Get order detail with items
router.get('/:id', authenticate, async (req, res) => {
    try {
        const orderId = parseInt(req.params.id);
        
        const orderResult = await query(
            `SELECT o.*, u.mobile as user_mobile, u.name as user_name
             FROM Orders o 
             JOIN Users u ON o.user_id = u.id
             WHERE o.id = $1 AND (o.user_id = $2 OR $3 IN ('Admin', 'Owner'))`,
            [orderId, req.user.id, req.user.role]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const itemsResult = await query(
            `SELECT oi.*, p.image_url 
             FROM OrderItems oi 
             LEFT JOIN Products p ON oi.product_id = p.id
             WHERE oi.order_id = $1`,
            [orderId]
        );

        const paymentResult = await query(
            'SELECT status, payment_method, created_at FROM Payments WHERE order_id = $1',
            [orderId]
        );

        res.json({
            success: true,
            data: {
                ...orderResult.rows[0],
                items: itemsResult.rows,
                payment: paymentResult.rows[0] || null
            }
        });
    } catch (err) {
        console.error('Order detail error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch order.' });
    }
});

module.exports = router;
