// ============================================================
// JIGGILE - 10-Minute Grocery Delivery API Server
// Brand: Jiggile by Adwithya
// Deployable to Vercel as serverless function
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================

// Security headers
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false
}));

// CORS - allow all origins for public demo
app.use(cors({
    origin: true,
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { success: false, message: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

// OTP rate limiting (stricter)
const otpLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5,
    message: { success: false, message: 'Too many OTP requests. Wait 5 minutes.' }
});
app.use('/api/auth/send-otp', otpLimiter);

// ============================================================
// ROUTES
// ============================================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Jiggile API is running! 🚀',
        brand: 'Jiggile by Adwithya',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Auth routes (OTP login)
app.use('/api/auth', require('./routes/authRoutes'));

// Product routes (public browsing)
app.use('/api/products', require('./routes/productRoutes'));

// Category routes (mounted from product routes)
app.use('/api', require('./routes/productRoutes'));

// Order routes (authenticated)
app.use('/api/orders', require('./routes/orderRoutes'));

// Payment webhook (auto-approval engine)
app.use('/api/payments', require('./routes/paymentRoutes'));

// Admin dashboard (RBAC protected)
app.use('/api/admin', require('./routes/adminRoutes'));

// Delivery tracking
app.use('/api/tracking', require('./routes/trackingRoutes'));

// Serve static frontend files
app.use('/customer', express.static(path.join(__dirname, '..', 'frontend', 'customer')));
app.use('/admin', express.static(path.join(__dirname, '..', 'frontend', 'admin')));

// Root redirect to customer app
app.get('/', (req, res) => {
    res.redirect('/customer');
});

// ============================================================
// ERROR HANDLING
// ============================================================

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.url} not found.`
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'development' 
            ? err.message 
            : 'Internal server error.'
    });
});

// ============================================================
// START SERVER (only when not imported by Vercel)
// ============================================================
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════╗
║          🛒 JIGGILE API SERVER              ║
║          Powered by Adwithya                ║
╠══════════════════════════════════════════════╣
║  Port:     ${PORT}                             ║
║  Mode:     ${process.env.NODE_ENV || 'development'}                    ║
║  API:      http://localhost:${PORT}/api/health  ║
║  Customer: http://localhost:${PORT}/customer    ║
║  Admin:    http://localhost:${PORT}/admin        ║
╚══════════════════════════════════════════════╝
        `);
    });
}

module.exports = app;
