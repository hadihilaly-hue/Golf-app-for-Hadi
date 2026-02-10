const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const IS_VERCEL = !!process.env.VERCEL;

// Use /tmp on Vercel (only writable directory), normal dirs locally
const DATA_DIR = IS_VERCEL ? '/tmp/data' : path.join(__dirname, 'data');
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// File upload config
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const uniqueName = `swing-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  },
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json({ limit: '10mb' }));

// ===== Swing Data Helpers =====
function getSwingsFile() {
  return path.join(DATA_DIR, 'swings.json');
}

function loadSwings() {
  const file = getSwingsFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function saveSwings(swings) {
  fs.writeFileSync(getSwingsFile(), JSON.stringify(swings, null, 2));
}

// ===== API Routes =====

// Upload video
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }
  res.json({
    success: true,
    filename: req.file.filename,
    size: req.file.size,
  });
});

// Save a swing (video + analysis data)
app.post('/api/swings', upload.single('video'), (req, res) => {
  const id = crypto.randomBytes(6).toString('hex');
  const analysis = req.body.analysis ? JSON.parse(req.body.analysis) : null;

  const swing = {
    id,
    date: new Date().toISOString(),
    videoFilename: req.file ? req.file.filename : null,
    analysis,
    notes: req.body.notes || '',
  };

  const swings = loadSwings();
  swings.unshift(swing); // newest first
  saveSwings(swings);

  res.json({ success: true, swing });
});

// Get all saved swings
app.get('/api/swings', (req, res) => {
  const swings = loadSwings();
  res.json({ swings });
});

// Get a single swing by ID
app.get('/api/swings/:id', (req, res) => {
  const swings = loadSwings();
  const swing = swings.find((s) => s.id === req.params.id);
  if (!swing) return res.status(404).json({ error: 'Swing not found' });
  res.json({ swing });
});

// Delete a swing
app.delete('/api/swings/:id', (req, res) => {
  let swings = loadSwings();
  const swing = swings.find((s) => s.id === req.params.id);
  if (!swing) return res.status(404).json({ error: 'Swing not found' });

  // Delete video file
  if (swing.videoFilename) {
    const videoPath = path.join(UPLOADS_DIR, swing.videoFilename);
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
  }

  swings = swings.filter((s) => s.id !== req.params.id);
  saveSwings(swings);
  res.json({ success: true });
});

// Share page - serves the main app which will load the shared swing
app.get('/share/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export for Vercel serverless
module.exports = app;

// Only start local servers when NOT running on Vercel
if (!IS_VERCEL) {
  const https = require('https');
  const { execSync } = require('child_process');

  // Generate self-signed certificate for HTTPS (required for camera access on iOS over network)
  function generateCert() {
    const certDir = path.join(__dirname, 'certs');
    const keyPath = path.join(certDir, 'key.pem');
    const certPath = path.join(certDir, 'cert.pem');

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    }

    try {
      if (!fs.existsSync(certDir)) fs.mkdirSync(certDir);
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=GolfSwingAnalyzer"`,
        { stdio: 'pipe' }
      );
      console.log('Self-signed certificate generated.');
      return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    } catch (err) {
      console.warn('Could not generate HTTPS certificate:', err.message);
      return null;
    }
  }

  // Start HTTP server - listen on 0.0.0.0 so phones on the same network can connect
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Golf Swing Analyzer (HTTP) running at http://localhost:${PORT}`);
  });

  // Start HTTPS server (needed for camera access on iPhone over network)
  const certs = generateCert();
  if (certs) {
    https.createServer(certs, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`Golf Swing Analyzer (HTTPS) running at https://localhost:${HTTPS_PORT}`);
      console.log('');
      console.log('=== FOR iPHONE ===');
      console.log(`Open Safari on your iPhone and go to:`);
      console.log(`  https://YOUR_MAC_IP:${HTTPS_PORT}`);
      console.log('');
      console.log('Safari will warn about the certificate - tap "Show Details" then "visit this website".');
      console.log('This is safe - it\'s just because the certificate is self-signed.');
    });
  }
}
