// ============================================================
// Jiggile - Product & Category Routes
// Real-time stock visibility for customers
// ============================================================
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');

// GET /api/categories
// Public: List all active categories
router.get('/categories', async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, image_url, sort_order 
             FROM Categories WHERE is_active = TRUE 
             ORDER BY sort_order ASC`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Categories error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch categories.' });
    }
});

// GET /api/products
// Public: List products with real-time stock status
router.get('/', async (req, res) => {
    try {
        const { category_id, search, page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let sql = `
            SELECT p.id, p.name, p.description, p.image_url, 
                   p.selling_price, p.stock_quantity, p.unit,
                   p.category_id, c.name AS category_name,
                   CASE WHEN p.stock_quantity <= 0 THEN TRUE ELSE FALSE END AS is_out_of_stock,
                   CASE WHEN p.stock_quantity <= p.low_stock_threshold AND p.stock_quantity > 0 
                        THEN TRUE ELSE FALSE END AS is_low_stock
            FROM Products p
            JOIN Categories c ON p.category_id = c.id
            WHERE p.is_active = TRUE
        `;
        
        const params = [];
        let paramIndex = 1;

        if (category_id) {
            sql += ` AND p.category_id = $${paramIndex}`;
            params.push(parseInt(category_id));
            paramIndex++;
        }

        if (search) {
            sql += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        sql += ` ORDER BY p.category_id, p.name
                 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit));
        params.push(offset);

        const result = await query(sql, params);

        // Get total count for pagination
        let countSql = 'SELECT COUNT(*) as total FROM Products p WHERE p.is_active = TRUE';
        const countParams = [];
        let countParamIndex = 1;
        
        if (category_id) {
            countSql += ` AND p.category_id = $${countParamIndex}`;
            countParams.push(parseInt(category_id));
            countParamIndex++;
        }
        if (search) {
            countSql += ` AND (p.name ILIKE $${countParamIndex} OR p.description ILIKE $${countParamIndex})`;
            countParams.push(`%${search}%`);
            countParamIndex++;
        }
        const countResult = await query(countSql, countParams);

        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countResult.rows[0].total)
            }
        });
    } catch (err) {
        console.error('Products error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch products.' });
    }
});

// GET /api/products/:id
// Public: Single product detail
router.get('/:id', async (req, res) => {
    try {
        const result = await query(
            `SELECT p.*, c.name AS category_name,
                    CASE WHEN p.stock_quantity <= 0 THEN TRUE ELSE FALSE END AS is_out_of_stock
             FROM Products p 
             JOIN Categories c ON p.category_id = c.id
             WHERE p.id = $1 AND p.is_active = TRUE`,
            [parseInt(req.params.id)]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error('Product detail error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch product.' });
    }
});

module.exports = router;
