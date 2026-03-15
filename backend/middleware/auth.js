// ============================================================
// Jiggile - JWT Authentication & RBAC Middleware
// ============================================================
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'jiggile-default-secret';

// Middleware: Verify JWT token
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            success: false, 
            message: 'Access denied. No token provided.' 
        });
    }

    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Token expired. Please refresh.' 
            });
        }
        return res.status(403).json({ 
            success: false, 
            message: 'Invalid token.' 
        });
    }
}

// Middleware: Role-Based Access Control
function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required.' 
            });
        }
        
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false, 
                message: 'Insufficient permissions. Required role: ' + roles.join(' or ')
            });
        }
        
        next();
    };
}

// Generate JWT tokens
function generateTokens(user) {
    const accessToken = jwt.sign(
        { id: user.id, mobile: user.mobile, role: user.role, name: user.name },
        JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRY || '1h' }
    );

    const refreshToken = jwt.sign(
        { id: user.id, mobile: user.mobile },
        process.env.JWT_REFRESH_SECRET || 'jiggile-refresh-secret',
        { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
    );

    return { accessToken, refreshToken };
}

module.exports = { authenticate, authorize, generateTokens };
