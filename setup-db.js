// Quick script to push schema.sql directly to Supabase
// Usage: node setup-db.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ⚠️ PASTE YOUR SUPABASE DATABASE_URL BELOW
const DATABASE_URL = process.env.DATABASE_URL || 'YOUR_SUPABASE_DATABASE_URL_HERE';

if (DATABASE_URL === 'YOUR_SUPABASE_DATABASE_URL_HERE') {
    console.log('\n❌ Please set your DATABASE_URL first!');
    console.log('   Get it from: Supabase Dashboard → Settings → Database → Connection string (URI)\n');
    console.log('   Then run: set DATABASE_URL=postgresql://... && node setup-db.js\n');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
});
// Disable prepared statements for Supabase Transaction Pooler compatibility
pool.on('connect', (client) => {
    client.query('SET statement_timeout = 30000');
});

async function run() {
    console.log('\n🚀 Connecting to Supabase...');
    
    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    try {
        const client = await pool.connect();
        console.log('✅ Connected to Supabase PostgreSQL!\n');
        
        console.log('📦 Running schema.sql...');
        await client.query(sql);
        
        console.log('✅ Schema created successfully!\n');
        
        // Verify tables
        const tables = await client.query(`
            SELECT tablename FROM pg_tables 
            WHERE schemaname = 'public' 
            ORDER BY tablename
        `);
        console.log('📊 Tables created:');
        tables.rows.forEach(t => console.log('   ✓ ' + t.tablename));
        
        // Verify seed data
        const cats = await client.query('SELECT COUNT(*) as c FROM categories');
        const prods = await client.query('SELECT COUNT(*) as c FROM products');
        const users = await client.query('SELECT COUNT(*) as c FROM users');
        console.log(`\n🌱 Seed data: ${cats.rows[0].c} categories, ${prods.rows[0].c} products, ${users.rows[0].c} user(s)`);
        
        client.release();
        console.log('\n🎉 Database setup complete! You can now deploy to Vercel.\n');
    } catch (err) {
        console.error('\n❌ Error:', err.message);
        if (err.message.includes('already exists')) {
            console.log('💡 Tables might already exist. That\'s OK!\n');
        }
    }
    
    await pool.end();
}

run();
