// ============================================================
// Jiggile - SQL Server Connection Pool
// Uses parameterized queries ONLY (SQL injection prevention)
// ============================================================
const sql = require('mssql');
require('dotenv').config();

const config = {
    server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
    database: process.env.DB_NAME || 'JiggileDB',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Use Windows Authentication if no user/password provided
if (!config.user) {
    delete config.user;
    delete config.password;
    config.options.trustedConnection = true;
}

let pool = null;

async function getPool() {
    if (!pool) {
        try {
            pool = await sql.connect(config);
            console.log('✅ Connected to SQL Server:', config.database);
        } catch (err) {
            console.error('❌ SQL Server connection failed:', err.message);
            throw err;
        }
    }
    return pool;
}

// Helper: Execute parameterized query
async function query(queryString, params = {}) {
    const p = await getPool();
    const request = p.request();
    
    // Bind parameters safely (prevents SQL injection)
    for (const [key, value] of Object.entries(params)) {
        if (value && typeof value === 'object' && value.type) {
            request.input(key, value.type, value.value);
        } else {
            request.input(key, value);
        }
    }
    
    return request.query(queryString);
}

module.exports = { sql, getPool, query };
