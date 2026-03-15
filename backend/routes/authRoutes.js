// ============================================================
// Jiggile - Authentication Routes (OTP-Only Login)
// No passwords. Mobile OTP verification only.
// ============================================================
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { generateTokens, authenticate } = require('../middleware/auth');

// Generate a random N-digit OTP
function generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
        otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
}

// POST /api/auth/send-otp
// Sends OTP to the given mobile number (mock: logs to console)
router.post('/send-otp', async (req, res) => {
    try {
        const { mobile } = req.body;

        if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({
                success: false,
                message: 'Valid 10-digit Indian mobile number required.'
            });
        }

        // Generate OTP & hash it
        const otp = generateOTP(parseInt(process.env.OTP_LENGTH) || 6);
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60000);

        // Upsert user: create if not exists, update OTP if exists
        const existingUser = await query(
            'SELECT id FROM Users WHERE mobile = $1',
            [mobile]
        );

        if (existingUser.rows.length === 0) {
            // New user - create account
            await query(
                `INSERT INTO Users (mobile, otp_hash, otp_expires_at) 
                 VALUES ($1, $2, $3)`,
                [mobile, otpHash, expiresAt]
            );
        } else {
            // Existing user - update OTP
            await query(
                `UPDATE Users SET otp_hash = $1, otp_expires_at = $2, 
                 updated_at = NOW() WHERE mobile = $3`,
                [otpHash, expiresAt, mobile]
            );
        }

        // MOCK: Log OTP to console (replace with Twilio/MSG91 in production)
        console.log(`\n📱 OTP for ${mobile}: ${otp}\n`);

        res.json({
            success: true,
            message: 'OTP sent successfully.',
            // Only include OTP in development mode for testing
            ...(process.env.NODE_ENV === 'development' && { otp })
        });

    } catch (err) {
        console.error('Send OTP error:', err);
        res.status(500).json({ success: false, message: 'Failed to send OTP.' });
    }
});

// POST /api/auth/verify-otp
// Verifies OTP and issues JWT tokens
router.post('/verify-otp', async (req, res) => {
    try {
        const { mobile, otp } = req.body;

        if (!mobile || !otp) {
            return res.status(400).json({
                success: false,
                message: 'Mobile number and OTP are required.'
            });
        }

        // Fetch user
        const result = await query(
            'SELECT id, mobile, name, role, otp_hash, otp_expires_at FROM Users WHERE mobile = $1',
            [mobile]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found. Please request OTP first.'
            });
        }

        const user = result.rows[0];

        // Check OTP expiry
        if (new Date() > new Date(user.otp_expires_at)) {
            return res.status(400).json({
                success: false,
                message: 'OTP has expired. Please request a new one.'
            });
        }

        // Verify OTP hash
        const isValid = await bcrypt.compare(otp, user.otp_hash);
        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP.'
            });
        }

        // Generate tokens
        const tokens = generateTokens(user);

        // Store refresh token & clear OTP
        await query(
            `UPDATE Users SET refresh_token = $1, 
             otp_hash = NULL, otp_expires_at = NULL,
             updated_at = NOW() WHERE id = $2`,
            [tokens.refreshToken, user.id]
        );

        res.json({
            success: true,
            message: 'Login successful.',
            data: {
                user: { id: user.id, mobile: user.mobile, name: user.name, role: user.role },
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            }
        });

    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ success: false, message: 'Verification failed.' });
    }
});

// POST /api/auth/refresh
// Refresh access token using refresh token
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token required.'
            });
        }

        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

        // Verify token exists in DB
        const result = await query(
            'SELECT id, mobile, name, role FROM Users WHERE id = $1 AND refresh_token = $2',
            [decoded.id, refreshToken]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Invalid refresh token.'
            });
        }

        const user = result.rows[0];
        const tokens = generateTokens(user);

        // Update refresh token
        await query(
            'UPDATE Users SET refresh_token = $1, updated_at = NOW() WHERE id = $2',
            [tokens.refreshToken, user.id]
        );

        res.json({
            success: true,
            data: {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            }
        });

    } catch (err) {
        res.status(403).json({ success: false, message: 'Invalid or expired refresh token.' });
    }
});

// PUT /api/auth/profile
// Update user profile (authenticated)
router.put('/profile', authenticate, async (req, res) => {
    try {
        const { name, email, default_address, default_lat, default_lng } = req.body;

        await query(
            `UPDATE Users SET 
                name = COALESCE($1, name),
                email = COALESCE($2, email),
                default_address = COALESCE($3, default_address),
                default_lat = COALESCE($4, default_lat),
                default_lng = COALESCE($5, default_lng),
                updated_at = NOW()
             WHERE id = $6`,
            [
                name || null,
                email || null,
                default_address || null,
                default_lat || null,
                default_lng || null,
                req.user.id
            ]
        );

        res.json({ success: true, message: 'Profile updated.' });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ success: false, message: 'Update failed.' });
    }
});

module.exports = router;
