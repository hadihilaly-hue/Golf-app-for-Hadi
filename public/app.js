/**
 * Golf Swing Analyzer - Main Application
 * Handles camera, recording, UI interactions, saving, sharing, and library.
 */

(function () {
  'use strict';

  // DOM Elements
  const cameraFeed = document.getElementById('camera-feed');
  const poseCanvas = document.getElementById('pose-canvas');
  const canvasCtx = poseCanvas.getContext('2d');
  const recordingIndicator = document.getElementById('recording-indicator');
  const countdown = document.getElementById('countdown');

  const btnStartCamera = document.getElementById('btn-start-camera');
  const btnRecord = document.getElementById('btn-record');
  const btnStop = document.getElementById('btn-stop');
  const btnAnalyze = document.getElementById('btn-analyze');
  const btnReset = document.getElementById('btn-reset');
  const fileUpload = document.getElementById('file-upload');

  const analysisSection = document.getElementById('analysis-section');
  const loadingAnalysis = document.getElementById('loading-analysis');
  const poseMetrics = document.getElementById('pose-metrics');
  const swingPhases = document.getElementById('swing-phases');
  const critiqueSection = document.getElementById('critique-section');
  const tipsSection = document.getElementById('tips-section');

  // State
  let analyzer = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let poseTrackingInterval = null;
  let cameraActive = false;
  let usingFrontCamera = true;
  let lastAnalysisResults = null; // Store for saving
  let currentPage = 'record';
  let playerLevel = 'amateur'; // 'amateur', 'kornferry', or 'pga'

  // ===== Welcome Screen Flow =====
  (function initWelcomeScreen() {
    const overlay = document.getElementById('welcome-overlay');
    const welcomeTitle = document.getElementById('welcome-title');
    const levelSelect = document.getElementById('level-select');
    const appEl = document.getElementById('app');

    // After 2 seconds, dissolve the title and show level select
    setTimeout(() => {
      welcomeTitle.classList.add('fade-out');
      setTimeout(() => {
        welcomeTitle.classList.add('hidden');
        levelSelect.classList.remove('hidden');
      }, 800);
    }, 2000);

    // Level button click handlers
    document.querySelectorAll('.level-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        playerLevel = btn.dataset.level;
        // Dissolve the entire overlay and reveal the app
        overlay.classList.add('fade-out');
        setTimeout(() => {
          overlay.classList.add('hidden');
          appEl.classList.remove('hidden');
        }, 1000);
      });
    });
  })();

  // ===== Page Navigation =====
  const recordPage = document.querySelector('main');
  const libraryPage = document.getElementById('library-page');
  const sharedView = document.getElementById('shared-view');

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      switchPage(page);
    });
  });

  function switchPage(page) {
    currentPage = page;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');

    // Hide all page content
    document.getElementById('video-container').classList.toggle('hidden', page !== 'record');
    document.getElementById('controls').classList.toggle('hidden', page !== 'record');
    document.getElementById('upload-section').classList.toggle('hidden', page !== 'record');
    if (page !== 'record') analysisSection.classList.add('hidden');
    libraryPage.classList.toggle('hidden', page !== 'library');
    sharedView.classList.add('hidden');

    if (page === 'library') {
      loadLibrary();
    }
  }

  // Check for shared swing URL
  function checkSharedSwing() {
    const match = window.location.pathname.match(/^\/share\/(\w+)$/);
    if (match) {
      loadSharedSwing(match[1]);
      return true;
    }
    return false;
  }

  // ===== Initialize Analyzer =====
  async function initAnalyzer() {
    analyzer = new SwingAnalyzer();
    try {
      await analyzer.initialize();
      analyzer.onPoseResult = (results) => {
        poseCanvas.width = cameraFeed.videoWidth || 640;
        poseCanvas.height = cameraFeed.videoHeight || 480;
        analyzer.drawPose(results, canvasCtx, poseCanvas.width, poseCanvas.height);
      };
      console.log('Pose analyzer initialized');
    } catch (err) {
      console.warn('Pose detection could not initialize:', err.message);
    }
  }

  // ===== Camera =====
  let currentZoom = 1;
  let minZoom = 1;
  let maxZoom = 1;
  let supportsZoom = false;

  async function startCamera() {
    try {
      // Stop existing stream if switching cameras
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }

      const facingMode = usingFrontCamera ? 'user' : 'environment';
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }
      cameraFeed.srcObject = mediaStream;
      cameraActive = true;

      updateCameraMirror();
      detectZoomCapabilities();

      btnStartCamera.classList.add('hidden');
      btnRecord.classList.remove('hidden');
      document.getElementById('btn-flip-camera').classList.remove('hidden');
      document.getElementById('zoom-controls').classList.remove('hidden');

      if (analyzer && analyzer.pose) {
        startPoseTracking();
      }
    } catch (err) {
      console.error('Camera error:', err);
      btnStartCamera.innerHTML = '<span class="icon">📷</span> Start Camera';
      btnStartCamera.disabled = false;

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert('Camera permission was denied. To fix this:\n\n1. Open Settings on your iPhone\n2. Scroll down to Safari\n3. Make sure "Camera" is set to "Allow"\n4. Come back and tap Start Camera again');
      } else {
        alert('Could not access camera. Please make sure your device has a camera and try again.');
      }
    }
  }

  function detectZoomCapabilities() {
    const track = mediaStream.getVideoTracks()[0];
    if (!track) return;

    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (capabilities.zoom) {
      supportsZoom = true;
      minZoom = capabilities.zoom.min || 1;
      maxZoom = capabilities.zoom.max || 1;
      currentZoom = track.getSettings().zoom || 1;
      updateZoomUI();
    } else {
      // No native zoom - use CSS transform zoom as fallback
      supportsZoom = false;
      minZoom = 0.5;
      maxZoom = 3;
      currentZoom = 1;
      updateZoomUI();
    }
  }

  function setZoom(level) {
    currentZoom = Math.max(minZoom, Math.min(maxZoom, level));

    if (supportsZoom) {
      const track = mediaStream.getVideoTracks()[0];
      if (track) {
        track.applyConstraints({ advanced: [{ zoom: currentZoom }] }).catch(() => {
          // Fallback to CSS zoom if constraint fails
          applyCSSZoom();
        });
      }
    } else {
      applyCSSZoom();
    }
    updateZoomUI();
  }

  function applyCSSZoom() {
    const mirror = usingFrontCamera ? -1 : 1;
    cameraFeed.style.transform = `scaleX(${mirror}) scale(${currentZoom})`;
    poseCanvas.style.transform = `scaleX(${mirror}) scale(${currentZoom})`;
  }

  function updateZoomUI() {
    // Update active state on zoom buttons
    document.querySelectorAll('.zoom-btn').forEach((btn) => {
      const val = parseFloat(btn.dataset.zoom);
      btn.classList.toggle('active', Math.abs(currentZoom - val) < 0.1);
    });

    // Update slider
    const slider = document.getElementById('zoom-slider');
    if (slider) {
      slider.min = minZoom;
      slider.max = Math.min(maxZoom, 5);
      slider.step = 0.1;
      slider.value = currentZoom;
    }

    // Update label
    const label = document.getElementById('zoom-label');
    if (label) {
      label.textContent = `${currentZoom.toFixed(1)}x`;
    }
  }

  function updateCameraMirror() {
    const mirror = usingFrontCamera ? -1 : 1;
    if (!supportsZoom && currentZoom !== 1) {
      cameraFeed.style.transform = `scaleX(${mirror}) scale(${currentZoom})`;
      poseCanvas.style.transform = `scaleX(${mirror}) scale(${currentZoom})`;
    } else {
      cameraFeed.style.transform = `scaleX(${mirror})`;
      poseCanvas.style.transform = `scaleX(${mirror})`;
    }
  }

  async function flipCamera() {
    usingFrontCamera = !usingFrontCamera;
    await startCamera();
  }

  function startPoseTracking() {
    if (poseTrackingInterval) clearInterval(poseTrackingInterval);
    poseTrackingInterval = setInterval(async () => {
      if (cameraFeed.readyState >= 2 && analyzer) {
        try {
          await analyzer.sendFrame(cameraFeed);
        } catch (e) {
          // Silently ignore frame send errors
        }
      }
    }, 100);
  }

  function stopPoseTracking() {
    if (poseTrackingInterval) {
      clearInterval(poseTrackingInterval);
      poseTrackingInterval = null;
    }
  }

  // ===== Recording =====
  async function startRecording() {
    await showCountdown();

    recordedChunks = [];

    let mimeType = '';
    const types = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
    for (const type of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }
    const options = mimeType ? { mimeType } : {};

    mediaRecorder = new MediaRecorder(mediaStream, options);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.onstop = onRecordingStopped;

    mediaRecorder.start(100);
    isRecording = true;

    if (analyzer) analyzer.startTracking();

    recordingIndicator.classList.remove('hidden');
    btnRecord.classList.add('hidden');
    btnStop.classList.remove('hidden');
    document.getElementById('btn-flip-camera').classList.add('hidden');

    setTimeout(() => {
      if (isRecording) stopRecording();
    }, 15000);
  }

  function showCountdown() {
    return new Promise((resolve) => {
      let count = 3;
      countdown.classList.remove('hidden');
      countdown.textContent = count;

      const interval = setInterval(() => {
        count--;
        if (count > 0) {
          countdown.textContent = count;
          countdown.style.animation = 'none';
          void countdown.offsetHeight;
          countdown.style.animation = 'countdown-pop 0.5s ease-out';
        } else {
          countdown.classList.add('hidden');
          clearInterval(interval);
          resolve();
        }
      }, 800);
    });
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecording = false;

    if (analyzer) analyzer.stopTracking();

    recordingIndicator.classList.add('hidden');
    btnStop.classList.add('hidden');
    btnAnalyze.classList.remove('hidden');
    btnReset.classList.remove('hidden');
    document.getElementById('btn-flip-camera').classList.remove('hidden');
  }

  function onRecordingStopped() {
    console.log(`Recording complete: ${recordedChunks.length} chunks, ${analyzer ? analyzer.frames.length : 0} pose frames`);
  }

  // ===== Analysis =====
  async function runAnalysis() {
    analysisSection.classList.remove('hidden');
    loadingAnalysis.classList.remove('hidden');
    poseMetrics.classList.add('hidden');
    swingPhases.classList.add('hidden');
    critiqueSection.classList.add('hidden');
    tipsSection.classList.add('hidden');
    document.getElementById('save-share-section').classList.add('hidden');

    btnAnalyze.classList.add('hidden');

    await new Promise((r) => setTimeout(r, 1500));

    let results;
    if (analyzer && analyzer.frames.length >= 10) {
      results = analyzer.analyzeSwing(playerLevel);
    } else {
      results = generateFallbackAnalysis();
    }

    lastAnalysisResults = results;
    loadingAnalysis.classList.add('hidden');
    displayResults(results);

    // Show save & share buttons
    if (!results.error) {
      document.getElementById('save-share-section').classList.remove('hidden');
      document.getElementById('save-status').classList.add('hidden');
      document.getElementById('btn-save').disabled = false;
      document.getElementById('btn-save').innerHTML = '<span class="icon">💾</span> Save Swing';
    }
  }

  function generateFallbackAnalysis() {
    return {
      error: false,
      score: null,
      phases: {
        address: true,
        backswing: true,
        top: true,
        downswing: true,
        impact: true,
        'follow-through': true,
      },
      metrics: {
        shoulderRotation: { value: '—', unit: '', rating: 'warning', detail: 'Pose tracking unavailable - record in good lighting for best results' },
        hipRotation: { value: '—', unit: '', rating: 'warning', detail: 'Enable pose tracking for hip analysis' },
        spineAngle: { value: '—', unit: '', rating: 'warning', detail: 'Enable pose tracking for spine analysis' },
        kneeFlex: { value: '—', unit: '', rating: 'warning', detail: 'Enable pose tracking for knee analysis' },
        headMovement: { value: '—', unit: '', rating: 'warning', detail: 'Enable pose tracking for head stability analysis' },
        weightTransfer: { value: '—', unit: '', rating: 'warning', detail: 'Enable pose tracking for weight transfer analysis' },
      },
      critique: [
        {
          type: 'improve',
          title: 'General Swing Tips',
          points: [
            'Make sure the camera can see your full body from head to feet.',
            'Good lighting helps the AI track your body better.',
            'Stand about 8-10 feet from the camera for the best analysis.',
            'Film from a face-on or down-the-line angle for best results.',
          ],
        },
      ],
      tips: [
        {
          title: 'Setup & Alignment',
          description: 'Ensure your feet are shoulder-width apart, knees slightly flexed, and spine tilted forward from the hips. Your arms should hang naturally below your shoulders.',
        },
        {
          title: 'Backswing Checkpoint',
          description: 'At the top of your backswing, your lead arm should be relatively straight, your back should face the target, and your weight should be loaded on your trail foot.',
        },
        {
          title: 'Impact Position',
          description: 'At impact, your hips should be open to the target, weight shifting to your lead foot, hands ahead of the ball, and your head behind the ball.',
        },
        {
          title: 'Follow-Through',
          description: 'A complete follow-through has your belt buckle facing the target, weight fully on your lead foot, and your trail foot up on its toe. Hold this finish for balance.',
        },
        {
          title: 'Tempo Training',
          description: 'Count "1" on the backswing and "2" on the downswing. A good swing tempo ratio is about 3:1. Use a metronome app set to 72 BPM for practice.',
        },
      ],
    };
  }

  function displayResults(results) {
    if (results.error) {
      critiqueSection.classList.remove('hidden');
      document.getElementById('critique-content').innerHTML =
        `<p>${results.message}</p>`;
      return;
    }

    if (results.score !== null) {
      const levelLabels = { amateur: 'Amateur', kornferry: 'Korn Ferry', pga: 'PGA Tour' };
      const levelLabel = levelLabels[playerLevel] || 'Amateur';
      const scoreHTML = `<div style="text-align:center"><span class="score-badge">Swing Score: ${results.score}/100</span><br><span style="color:var(--gray);font-size:0.85rem;">Graded on <strong>${levelLabel}</strong> standard</span></div>`;
      document.getElementById('critique-content').innerHTML = scoreHTML;
    }

    displayMetrics(results.metrics);
    poseMetrics.classList.remove('hidden');

    displayPhases(results.phases);
    swingPhases.classList.remove('hidden');

    displayCritique(results.critique, results.score);
    critiqueSection.classList.remove('hidden');

    displayTips(results.tips);
    tipsSection.classList.remove('hidden');

    analysisSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function displayMetrics(metrics) {
    const mapping = {
      shoulderRotation: 'metric-shoulder',
      hipRotation: 'metric-hip',
      spineAngle: 'metric-spine',
      kneeFlex: 'metric-knee',
      headMovement: 'metric-head',
      weightTransfer: 'metric-weight',
    };

    Object.entries(mapping).forEach(([key, elementId]) => {
      const el = document.getElementById(elementId);
      if (el && metrics[key]) {
        el.textContent = `${metrics[key].value}${metrics[key].unit}`;
        el.className = `metric-value ${metrics[key].rating}`;
        el.title = metrics[key].detail;
      }
    });
  }

  function displayPhases(phases) {
    Object.entries(phases).forEach(([phase, detected]) => {
      const el = document.querySelector(`.phase[data-phase="${phase}"]`);
      if (el) {
        if (detected) el.classList.add('detected');
        else el.classList.remove('detected');
      }
    });
  }

  function displayCritique(critique, score) {
    const container = document.getElementById('critique-content');
    let html = '';

    if (score !== null) {
      const levelLabels = { amateur: 'Amateur', kornferry: 'Korn Ferry', pga: 'PGA Tour' };
      const levelLabel = levelLabels[playerLevel] || 'Amateur';
      html += `<div style="text-align:center"><span class="score-badge">Swing Score: ${score}/100</span><br><span style="color:var(--gray);font-size:0.85rem;">Graded on <strong>${levelLabel}</strong> standard</span></div>`;
    }

    critique.forEach((section) => {
      html += `<div class="critique-category ${section.type}">`;
      html += `<h4>${section.title}</h4>`;
      html += '<ul>';
      section.points.forEach((point) => {
        html += `<li>${point}</li>`;
      });
      html += '</ul></div>';
    });

    container.innerHTML = html;
  }

  function displayTips(tips) {
    const container = document.getElementById('tips-content');
    let html = '';
    tips.forEach((tip) => {
      html += `<div class="tip-card">`;
      html += `<h4>${tip.title}</h4>`;
      html += `<p>${tip.description}</p>`;
      html += `</div>`;
    });
    container.innerHTML = html;
  }

  // ===== Save Swing =====
  async function saveSwing() {
    const btnSave = document.getElementById('btn-save');
    const saveStatus = document.getElementById('save-status');
    btnSave.disabled = true;
    btnSave.innerHTML = '<span class="icon">⏳</span> Saving...';

    try {
      const formData = new FormData();

      // Attach recorded video if available
      if (recordedChunks.length > 0) {
        const mimeType = recordedChunks[0].type || 'video/webm';
        const ext = mimeType.includes('mp4') ? '.mp4' : '.webm';
        const blob = new Blob(recordedChunks, { type: mimeType });
        formData.append('video', blob, `swing${ext}`);
      }

      // Attach analysis data
      if (lastAnalysisResults) {
        formData.append('analysis', JSON.stringify(lastAnalysisResults));
      }

      const response = await fetch('/api/swings', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        btnSave.innerHTML = '<span class="icon">✅</span> Saved!';
        saveStatus.textContent = 'Swing saved to your library!';
        saveStatus.className = '';
        saveStatus.classList.remove('hidden');
      } else {
        throw new Error(data.error || 'Save failed');
      }
    } catch (err) {
      console.error('Save error:', err);
      btnSave.innerHTML = '<span class="icon">💾</span> Save Swing';
      btnSave.disabled = false;
      saveStatus.textContent = 'Could not save. Please try again.';
      saveStatus.className = 'error';
      saveStatus.classList.remove('hidden');
    }
  }

  // ===== Share Swing =====
  async function shareSwing() {
    // First save if not saved yet
    const btnSave = document.getElementById('btn-save');
    let swingId = null;

    if (!btnSave.disabled || !btnSave.innerHTML.includes('Saved')) {
      // Need to save first
      try {
        const formData = new FormData();
        if (recordedChunks.length > 0) {
          const mimeType = recordedChunks[0].type || 'video/webm';
          const ext = mimeType.includes('mp4') ? '.mp4' : '.webm';
          const blob = new Blob(recordedChunks, { type: mimeType });
          formData.append('video', blob, `swing${ext}`);
        }
        if (lastAnalysisResults) {
          formData.append('analysis', JSON.stringify(lastAnalysisResults));
        }
        const response = await fetch('/api/swings', { method: 'POST', body: formData });
        const data = await response.json();
        if (data.success) {
          swingId = data.swing.id;
          btnSave.innerHTML = '<span class="icon">✅</span> Saved!';
          btnSave.disabled = true;
        }
      } catch (err) {
        alert('Could not save swing for sharing. Please try again.');
        return;
      }
    }

    // Get the swing ID from the library if we didn't just save
    if (!swingId) {
      try {
        const response = await fetch('/api/swings');
        const data = await response.json();
        if (data.swings.length > 0) {
          swingId = data.swings[0].id;
        }
      } catch (err) {
        // ignore
      }
    }

    const shareUrl = `${window.location.origin}/share/${swingId}`;
    const shareText = lastAnalysisResults && lastAnalysisResults.score
      ? `Check out my golf swing! Score: ${lastAnalysisResults.score}/100`
      : 'Check out my golf swing analysis!';

    // Use native share if available (iOS Safari)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'My Golf Swing',
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          copyToClipboard(shareUrl);
        }
      }
    } else {
      copyToClipboard(shareUrl);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      const saveStatus = document.getElementById('save-status');
      saveStatus.textContent = 'Share link copied to clipboard!';
      saveStatus.className = '';
      saveStatus.classList.remove('hidden');
    }).catch(() => {
      // Fallback for older browsers
      prompt('Copy this link to share your swing:', text);
    });
  }

  // ===== Library =====
  async function loadLibrary() {
    const listEl = document.getElementById('library-list');
    const emptyEl = document.getElementById('library-empty');
    listEl.innerHTML = '<div style="text-align:center;color:var(--green-pale);padding:20px;">Loading...</div>';
    emptyEl.classList.add('hidden');

    try {
      const response = await fetch('/api/swings');
      const data = await response.json();

      if (data.swings.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
      }

      listEl.innerHTML = data.swings.map((swing) => {
        const date = new Date(swing.date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit',
        });
        const score = swing.analysis && swing.analysis.score !== null
          ? `Score: ${swing.analysis.score}/100`
          : 'No score';
        const videoThumb = swing.videoFilename
          ? `<video src="/uploads/${swing.videoFilename}" muted preload="metadata"></video>`
          : '<span class="no-video">🏌️</span>';

        return `
          <div class="swing-card" data-id="${swing.id}">
            <div class="swing-card-thumb">${videoThumb}</div>
            <div class="swing-card-info">
              <div class="swing-card-date">${date}</div>
              <div class="swing-card-score">${score}</div>
            </div>
            <div class="swing-card-actions">
              <button onclick="window._viewSwing('${swing.id}')" title="View">👁️</button>
              <button onclick="window._shareSwingById('${swing.id}')" title="Share">📤</button>
              <button onclick="window._deleteSwing('${swing.id}')" title="Delete">🗑️</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      listEl.innerHTML = '<div style="text-align:center;color:var(--red);padding:20px;">Could not load swings.</div>';
    }
  }

  // View a saved swing
  window._viewSwing = async function (id) {
    try {
      const response = await fetch(`/api/swings/${id}`);
      const data = await response.json();
      if (!data.swing) return;

      const swing = data.swing;

      // Hide library, show shared view
      libraryPage.classList.add('hidden');
      sharedView.classList.remove('hidden');

      const video = document.getElementById('shared-video');
      if (swing.videoFilename) {
        video.src = `/uploads/${swing.videoFilename}`;
        video.classList.remove('hidden');
      } else {
        video.classList.add('hidden');
      }

      const analysisEl = document.getElementById('shared-analysis');
      if (swing.analysis) {
        analysisEl.innerHTML = renderAnalysisHTML(swing.analysis);
      } else {
        analysisEl.innerHTML = '<p>No analysis data available.</p>';
      }
    } catch (err) {
      alert('Could not load swing.');
    }
  };

  // Share a saved swing by ID
  window._shareSwingById = function (id) {
    const shareUrl = `${window.location.origin}/share/${id}`;
    if (navigator.share) {
      navigator.share({ title: 'Golf Swing', text: 'Check out this golf swing!', url: shareUrl });
    } else {
      copyToClipboard(shareUrl);
      alert('Share link copied to clipboard!');
    }
  };

  // Delete a swing
  window._deleteSwing = async function (id) {
    if (!confirm('Delete this swing?')) return;
    try {
      await fetch(`/api/swings/${id}`, { method: 'DELETE' });
      loadLibrary();
    } catch (err) {
      alert('Could not delete swing.');
    }
  };

  // Load a shared swing from URL
  async function loadSharedSwing(id) {
    // Hide record page elements
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('controls').classList.add('hidden');
    document.getElementById('upload-section').classList.add('hidden');
    sharedView.classList.remove('hidden');

    try {
      const response = await fetch(`/api/swings/${id}`);
      const data = await response.json();
      if (!data.swing) {
        document.getElementById('shared-analysis').innerHTML = '<p>Swing not found.</p>';
        return;
      }

      const swing = data.swing;
      const video = document.getElementById('shared-video');
      if (swing.videoFilename) {
        video.src = `/uploads/${swing.videoFilename}`;
        video.classList.remove('hidden');
      } else {
        video.classList.add('hidden');
      }

      const analysisEl = document.getElementById('shared-analysis');
      if (swing.analysis) {
        analysisEl.innerHTML = renderAnalysisHTML(swing.analysis);
      } else {
        analysisEl.innerHTML = '<p>No analysis data available.</p>';
      }
    } catch (err) {
      document.getElementById('shared-analysis').innerHTML = '<p>Could not load shared swing.</p>';
    }
  }

  // Render analysis as HTML (reused for library view and share view)
  function renderAnalysisHTML(analysis) {
    let html = '';

    if (analysis.score !== null) {
      html += `<div style="text-align:center"><span class="score-badge">Swing Score: ${analysis.score}/100</span></div>`;
    }

    // Metrics
    if (analysis.metrics) {
      html += '<h3 style="color:#2d6a4f;margin:16px 0 8px;border-bottom:2px solid #95d5b2;padding-bottom:4px;">Pose Tracking Data</h3>';
      html += '<div class="metrics-grid">';
      const labels = {
        shoulderRotation: 'Shoulder Rotation',
        hipRotation: 'Hip Rotation',
        spineAngle: 'Spine Angle',
        kneeFlex: 'Knee Flex',
        headMovement: 'Head Movement',
        weightTransfer: 'Weight Transfer',
      };
      Object.entries(labels).forEach(([key, label]) => {
        const m = analysis.metrics[key];
        if (m) {
          html += `<div class="metric-card"><span class="metric-label">${label}</span>`;
          html += `<span class="metric-value ${m.rating}">${m.value}${m.unit}</span></div>`;
        }
      });
      html += '</div>';
    }

    // Critique
    if (analysis.critique) {
      html += '<h3 style="color:#2d6a4f;margin:16px 0 8px;border-bottom:2px solid #95d5b2;padding-bottom:4px;">AI Coach Feedback</h3>';
      analysis.critique.forEach((section) => {
        html += `<div class="critique-category ${section.type}"><h4>${section.title}</h4><ul>`;
        section.points.forEach((p) => { html += `<li>${p}</li>`; });
        html += '</ul></div>';
      });
    }

    // Tips
    if (analysis.tips) {
      html += '<h3 style="color:#2d6a4f;margin:16px 0 8px;border-bottom:2px solid #95d5b2;padding-bottom:4px;">Drills & Practice Tips</h3>';
      analysis.tips.forEach((tip) => {
        html += `<div class="tip-card"><h4>${tip.title}</h4><p>${tip.description}</p></div>`;
      });
    }

    return html;
  }

  // ===== Reset =====
  function resetApp() {
    analysisSection.classList.add('hidden');
    btnAnalyze.classList.add('hidden');
    btnReset.classList.add('hidden');
    btnRecord.classList.remove('hidden');

    canvasCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);

    if (analyzer) {
      analyzer.frames = [];
    }
    recordedChunks = [];
    lastAnalysisResults = null;
  }

  // ===== File Upload =====
  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      stopPoseTracking();
      cameraActive = false;
    }

    const url = URL.createObjectURL(file);
    cameraFeed.srcObject = null;
    cameraFeed.src = url;
    cameraFeed.muted = true;
    cameraFeed.loop = false;
    cameraFeed.play();

    btnStartCamera.classList.add('hidden');
    btnRecord.classList.add('hidden');

    if (analyzer && analyzer.pose) {
      analyzer.frames = [];
      analyzer.startTracking();

      cameraFeed.addEventListener('play', () => { startPoseTracking(); }, { once: true });
      cameraFeed.addEventListener('ended', () => {
        analyzer.stopTracking();
        stopPoseTracking();
        btnAnalyze.classList.remove('hidden');
        btnReset.classList.remove('hidden');
      }, { once: true });
    } else {
      cameraFeed.addEventListener('ended', () => {
        btnAnalyze.classList.remove('hidden');
        btnReset.classList.remove('hidden');
      }, { once: true });
      setTimeout(() => {
        btnAnalyze.classList.remove('hidden');
        btnReset.classList.remove('hidden');
      }, 5000);
    }
  }

  // ===== Event Listeners =====
  btnStartCamera.addEventListener('click', async () => {
    btnStartCamera.innerHTML = '<span class="icon">⏳</span> Starting...';
    btnStartCamera.disabled = true;
    await initAnalyzer();
    await startCamera();
  });

  btnRecord.addEventListener('click', startRecording);
  btnStop.addEventListener('click', stopRecording);
  btnAnalyze.addEventListener('click', runAnalysis);
  btnReset.addEventListener('click', resetApp);
  fileUpload.addEventListener('change', handleFileUpload);
  document.getElementById('btn-flip-camera').addEventListener('click', flipCamera);
  document.getElementById('btn-save').addEventListener('click', saveSwing);
  document.getElementById('btn-share').addEventListener('click', shareSwing);

  // Zoom controls
  document.querySelectorAll('.zoom-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setZoom(parseFloat(btn.dataset.zoom));
    });
  });
  document.getElementById('zoom-slider').addEventListener('input', (e) => {
    setZoom(parseFloat(e.target.value));
  });

  // On load, check for shared swing URL
  checkSharedSwing();
})();
