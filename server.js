const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// File upload config
const storage = multer.diskStorage({
  destination: path.join(__dirname, 'uploads'),
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
app.use(express.json());

// Upload endpoint
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

// Start HTTP server
app.listen(PORT, () => {
  console.log(`Golf Swing Analyzer (HTTP) running at http://localhost:${PORT}`);
});

// Start HTTPS server (needed for camera access on iPhone over network)
const certs = generateCert();
if (certs) {
  https.createServer(certs, app).listen(HTTPS_PORT, () => {
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
