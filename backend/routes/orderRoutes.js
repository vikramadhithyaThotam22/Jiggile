// ============================================================
// Jiggile - Order Routes
// Place orders with stock validation & reservation
// ============================================================
const express = require('express');
const router = express.Router();
const { query, getPool, sql } = require('../config/db');
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
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        const { items, delivery_address, delivery_lat, delivery_lng, notes } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Order must contain at least one item.'
            });
        }

        if (!delivery_address) {
            return res.status(400).json({
                success: false,
                message: 'Delivery address is required.'
            });
        }

        await transaction.begin();
        const request = new sql.Request(transaction);

        // Validate stock & calculate totals
        let totalAmount = 0;
        const orderItems = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const prodResult = await request.query(
                `SELECT id, name, selling_price, cost_price, stock_quantity 
                 FROM Products WHERE id = ${parseInt(item.product_id)} AND is_active = 1`
            );

            if (prodResult.recordset.length === 0) {
                await transaction.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Product ID ${item.product_id} not found.`
                });
            }

            const product = prodResult.recordset[0];

            if (product.stock_quantity < item.quantity) {
                await transaction.rollback();
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
        
        const orderResult = await request.query(
            `INSERT INTO Orders (user_id, order_number, total_amount, delivery_address, 
                                 delivery_lat, delivery_lng, delivery_deadline, notes)
             OUTPUT INSERTED.id, INSERTED.order_number, INSERTED.delivery_deadline
             VALUES (${req.user.id}, '${orderNumber}', ${totalAmount}, 
                     N'${delivery_address.replace(/'/g, "''")}', 
                     ${delivery_lat || 'NULL'}, ${delivery_lng || 'NULL'},
                     DATEADD(MINUTE, ${deliveryMinutes}, SYSUTCDATETIME()),
                     ${notes ? `N'${notes.replace(/'/g, "''")}'` : 'NULL'})`
        );

        const orderId = orderResult.recordset[0].id;

        // Insert order items
        for (const item of orderItems) {
            await request.query(
                `INSERT INTO OrderItems (order_id, product_id, product_name, quantity, unit_price, cost_price_snapshot)
                 VALUES (${orderId}, ${item.product_id}, N'${item.product_name.replace(/'/g, "''")}', 
                         ${item.quantity}, ${item.unit_price}, ${item.cost_price_snapshot})`
            );
        }

        // Create pending payment record
        await request.query(
            `INSERT INTO Payments (order_id, amount) VALUES (${orderId}, ${totalAmount})`
        );

        await transaction.commit();

        res.status(201).json({
            success: true,
            message: 'Order placed successfully. Proceed to payment.',
            data: {
                order_id: orderId,
                order_number: orderNumber,
                total_amount: totalAmount,
                delivery_deadline: orderResult.recordset[0].delivery_deadline,
                items: orderItems
            }
        });

    } catch (err) {
        try { await transaction.rollback(); } catch (e) {}
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
             WHERE o.user_id = @userId 
             ORDER BY o.created_at DESC`,
            { userId: req.user.id }
        );
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('My orders error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
    }
});

// GET /api/orders/:id
// Get order detail with items
router.get('/:id', authenticate, async (req, res) => {
    try {
        const orderResult = await query(
            `SELECT o.*, u.mobile as user_mobile, u.name as user_name
             FROM Orders o 
             JOIN Users u ON o.user_id = u.id
             WHERE o.id = @orderId AND (o.user_id = @userId OR @role IN ('Admin', 'Owner'))`,
            { orderId: parseInt(req.params.id), userId: req.user.id, role: req.user.role }
        );

        if (orderResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const itemsResult = await query(
            `SELECT oi.*, p.image_url 
             FROM OrderItems oi 
             LEFT JOIN Products p ON oi.product_id = p.id
             WHERE oi.order_id = @orderId`,
            { orderId: parseInt(req.params.id) }
        );

        const paymentResult = await query(
            'SELECT status, payment_method, created_at FROM Payments WHERE order_id = @orderId',
            { orderId: parseInt(req.params.id) }
        );

        res.json({
            success: true,
            data: {
                ...orderResult.recordset[0],
                items: itemsResult.recordset,
                payment: paymentResult.recordset[0] || null
            }
        });
    } catch (err) {
        console.error('Order detail error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch order.' });
    }
});

module.exports = router;
