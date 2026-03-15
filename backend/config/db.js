// ============================================================
// Jiggile - PostgreSQL Connection Pool (Supabase)
// Uses parameterized queries ONLY (SQL injection prevention)
// Compatible with Supabase Transaction Pooler (no prepared stmts)
// ============================================================
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('connect', () => {
    console.log('✅ Connected to Supabase PostgreSQL');
});

pool.on('error', (err) => {
    console.error('❌ PostgreSQL connection error:', err.message);
});

// Helper: Execute parameterized query
// Uses $1, $2, ... style parameters
// queryMode: 'simple' disables prepared statements for Supabase Transaction Pooler
async function query(text, params = []) {
    const result = await pool.query({ text, values: params, rowMode: undefined });
    return result;
}

// Get a client from the pool (for transactions)
async function getClient() {
    const client = await pool.connect();
    return client;
}

module.exports = { pool, query, getClient };
