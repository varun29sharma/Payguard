const express   = require('express');
const http      = require('http');
const { Server }= require('socket.io');
const cors      = require('cors');
const path      = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const connectDB = require('./config/db');

// Routes
const authRoutes        = require('./routes/authRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const alertRoutes       = require('./routes/alertRoutes');
const campaignRoutes    = require('./routes/campaignRoutes');
const blockListRoutes   = require('./routes/blockListRoutes');

// Campaign detector
const { detectCampaigns } = require('./services/campaignDetector');

connectDB();

const app = express();

// ── MIDDLEWARE ──────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// ── ROUTES ──────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/alerts',       alertRoutes);
app.use('/api/campaigns',    campaignRoutes);
app.use('/api/blocklist',    blockListRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── SOCKET.IO ───────────────────────────────────────────────
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

// ── CAMPAIGN DETECTION INTERVAL ─────────────────────────────
// Runs every 60 seconds to detect new attack campaigns
setInterval(() => {
  detectCampaigns(io).catch(err => console.error('Campaign detection error:', err.message));
}, 60 * 1000);

// ── START ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`PayGuard server running on port ${PORT}`));
