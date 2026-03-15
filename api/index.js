// ============================================================
// Vercel Serverless Entry Point
// Wraps the Express app for Vercel's serverless functions
// ============================================================
const app = require('../backend/server');

module.exports = app;
