const express   = require('express');
const http      = require('http');
const { Server }= require('socket.io');
const cors      = require('cors');
const helmet    = require('helmet');
const path      = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const connectDB = require('./config/db');

// Routes
const authRoutes        = require('./routes/authRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const alertRoutes       = require('./routes/alertRoutes');
const campaignRoutes    = require('./routes/campaignRoutes');
const blockListRoutes   = require('./routes/blockListRoutes');
const ruleRoutes        = require('./routes/ruleRoutes');
const backtestRoutes    = require('./routes/backtestRoutes');
const disputeRoutes     = require('./routes/disputeRoutes');
const muleRoutes        = require('./routes/muleRoutes');

// Campaign detector
const { detectCampaigns } = require('./services/campaignDetector');
const { detectMuleRings } = require('./services/muleDetectorService');
const { startEngineHealthMonitor, getEngineHealth } = require('./services/engineHealthService');
const ruleConfigService = require('./services/ruleConfigService');
const { errorHandler } = require('./middleware/errorHandler');
const { socketAuthMiddleware } = require('./middleware/socketAuth');
const { attachSocketBridge } = require('./events/socketBridge');
const { apiLimiter } = require('./middleware/rateLimiters');

// Seed the shared demo account so the sign-in page's demo credentials work
// out of the box (idempotent — only creates it if missing).
const seedDemoUser = async () => {
  try {
    const User = require('./models/User');
    const existing = await User.findOne({ email: 'demo@payguard.io' });
    if (!existing) {
      await User.create({ name: 'Demo Analyst', email: 'demo@payguard.io', password: 'payguard-demo', role: 'analyst' });
      console.log('Seeded demo user: demo@payguard.io');
    }
  } catch (err) {
    console.error('Demo user seed failed:', err.message);
  }
};

// Demo API key for machine-to-machine ingest (POST /api/transactions). Only
// its hash is stored; the plaintext is printed here once and documented in
// replit.md. Rotate/disable via the ApiKey collection in production.
const DEMO_API_KEY = process.env.DEMO_API_KEY || 'pg_live_demo_5f3c2a9e1b7d84a6';
const seedDemoApiKey = async () => {
  try {
    const bcrypt = require('bcryptjs');
    const ApiKey = require('./models/ApiKey');
    const existing = await ApiKey.findOne({ name: 'demo-ingest' });
    if (!existing) {
      await ApiKey.create({
        name: 'demo-ingest',
        keyHash: await bcrypt.hash(DEMO_API_KEY, 10),
        active: true,
        createdBy: 'system',
      });
      console.log(`Seeded demo API key (x-api-key): ${DEMO_API_KEY}`);
    }
  } catch (err) {
    console.error('Demo API key seed failed:', err.message);
  }
};

connectDB().then(async () => {
  await seedDemoUser();
  await seedDemoApiKey();
  // Make sure every rule exists in Mongo (with its built-in defaults) so the
  // config API and the scoring path always have a complete set to work from.
  await ruleConfigService.ensureDefaultRules().catch(err => console.error('Rule-config seed failed:', err.message));
});

const app = express();

// ── MIDDLEWARE ──────────────────────────────────────────────
// Security headers (CSP, X-Content-Type-Options, frame/embedding guards, ...).
// In development the browser talks to the API through the Vite proxy, and CSP
// only applies to document responses, so HMR is unaffected.
app.use(helmet());

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Generous backstop so no single IP can flood the API surface.
app.use('/api', apiLimiter);

// ── ROUTES ──────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/alerts',       alertRoutes);
app.use('/api/campaigns',    campaignRoutes);
app.use('/api/blocklist',    blockListRoutes);
app.use('/api/rules',        ruleRoutes);
app.use('/api/backtest',     backtestRoutes);
app.use('/api/disputes',     disputeRoutes);
app.use('/api/mules',        muleRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// System status — includes live fraud-engine health so the frontend can show
// whether scoring is running on the real engine or falling back to clear,
// plus the current rule configuration (enabled state + thresholds).
app.get('/api/system/health', async (req, res) => {
  try {
    const rules = await ruleConfigService.getRuleConfigs();
    res.json({ status: 'ok', timestamp: new Date(), engine: getEngineHealth(), rules });
  } catch (err) {
    res.json({ status: 'ok', timestamp: new Date(), engine: getEngineHealth(), rules: [] });
  }
});

// Global error handler — must be registered after all routes.
app.use(errorHandler);

// ── SOCKET.IO ───────────────────────────────────────────────
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

// Verifies the JWT on socket handshake (when present) before allowing the
// connection — see middleware/socketAuth.js.
io.use(socketAuthMiddleware);

// All domain events (new transaction, block created, alert updated, ...)
// are emitted onto the central event bus and bridged to Socket.IO here —
// controllers/services never call io.emit(...) directly anymore.
attachSocketBridge(io);

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}${socket.user ? ` (user: ${socket.user.id})` : ' (anonymous)'}`);
  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

// ── FRAUD ENGINE HEALTH MONITOR ─────────────────────────────
// Polls the Java fraud engine on an interval and emits 'engine-health' socket
// events whenever availability changes, so the UI can flag degraded mode.
startEngineHealthMonitor();

// ── CAMPAIGN DETECTION INTERVAL ─────────────────────────────
// Runs every 60 seconds to detect new attack campaigns. Emits via the event
// bus (see services/campaignDetector.js), no longer needs `io` passed in.
setInterval(() => {
  detectCampaigns().catch(err => console.error('Campaign detection error:', err.message));
}, 60 * 1000);

// ── MULE DETECTION INTERVAL ─────────────────────────────────
// Runs every 45s: finds accounts that received-and-forwarded within 24h,
// clusters them into rings by shared identity, and emits via the event bus
// (see services/muleDetectorService.js).
setInterval(() => {
  detectMuleRings().catch(err => console.error('Mule detection error:', err.message));
}, 45 * 1000);

// ── SLA BREACH MONITOR ──────────────────────────────────────
// Runs every 60s: scans open/investigating/escalated alerts for SLA
// deadlines that have passed and marks them breached with a system note.
const { checkSLABreaches } = require('./services/caseService');
setInterval(() => {
  checkSLABreaches().catch(err => console.error('SLA check error:', err.message));
}, 60 * 1000);

// ── START ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`PayGuard server running on port ${PORT}`));
