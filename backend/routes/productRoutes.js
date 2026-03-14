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
             FROM Categories WHERE is_active = 1 
             ORDER BY sort_order ASC`
        );
        res.json({ success: true, data: result.recordset });
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
                   CASE WHEN p.stock_quantity <= 0 THEN 1 ELSE 0 END AS is_out_of_stock,
                   CASE WHEN p.stock_quantity <= p.low_stock_threshold AND p.stock_quantity > 0 
                        THEN 1 ELSE 0 END AS is_low_stock
            FROM Products p
            JOIN Categories c ON p.category_id = c.id
            WHERE p.is_active = 1
        `;
        
        const params = {};

        if (category_id) {
            sql += ' AND p.category_id = @categoryId';
            params.categoryId = parseInt(category_id);
        }

        if (search) {
            sql += ' AND (p.name LIKE @search OR p.description LIKE @search)';
            params.search = `%${search}%`;
        }

        sql += ` ORDER BY p.category_id, p.name
                 OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
        params.offset = offset;
        params.limit = parseInt(limit);

        const result = await query(sql, params);

        // Get total count for pagination
        let countSql = 'SELECT COUNT(*) as total FROM Products p WHERE p.is_active = 1';
        const countParams = {};
        if (category_id) {
            countSql += ' AND p.category_id = @categoryId';
            countParams.categoryId = parseInt(category_id);
        }
        if (search) {
            countSql += ' AND (p.name LIKE @search OR p.description LIKE @search)';
            countParams.search = `%${search}%`;
        }
        const countResult = await query(countSql, countParams);

        res.json({
            success: true,
            data: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult.recordset[0].total
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
                    CASE WHEN p.stock_quantity <= 0 THEN 1 ELSE 0 END AS is_out_of_stock
             FROM Products p 
             JOIN Categories c ON p.category_id = c.id
             WHERE p.id = @id AND p.is_active = 1`,
            { id: parseInt(req.params.id) }
        );

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        res.json({ success: true, data: result.recordset[0] });
    } catch (err) {
        console.error('Product detail error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch product.' });
    }
});

module.exports = router;
