/**
 * Golf Swing Analyzer - Main Application
 * Full-screen camera UI with record → analyze/retake → results flow.
 */

(function () {
  'use strict';

  // DOM - Camera
  const cameraFeed = document.getElementById('camera-feed');
  const poseCanvas = document.getElementById('pose-canvas');
  const canvasCtx = poseCanvas.getContext('2d');
  const recordingIndicator = document.getElementById('recording-indicator');
  const countdownEl = document.getElementById('countdown');

  // DOM - Screens
  const cameraScreen = document.getElementById('camera-screen');
  const analysisScreen = document.getElementById('analysis-screen');
  const libraryScreen = document.getElementById('library-screen');
  const sharedView = document.getElementById('shared-view');

  // DOM - Camera controls
  const preCameraControls = document.getElementById('pre-camera-controls');
  const recordControls = document.getElementById('record-controls');
  const stopControls = document.getElementById('stop-controls');
  const postRecordControls = document.getElementById('post-record-controls');

  const btnStartCamera = document.getElementById('btn-start-camera');
  const btnRecord = document.getElementById('btn-record');
  const btnStop = document.getElementById('btn-stop');
  const btnAnalyze = document.getElementById('btn-analyze');
  const btnRetake = document.getElementById('btn-retake');
  const btnFlipCamera = document.getElementById('btn-flip-camera');
  const btnZoomToggle = document.getElementById('btn-zoom-toggle');
  const zoomPicker = document.getElementById('zoom-picker');
  const zoomBadge = document.getElementById('zoom-badge');

  const fileUpload = document.getElementById('file-upload');
  const fileUploadAlt = document.getElementById('file-upload-alt');

  // DOM - Analysis
  const playbackVideo = document.getElementById('playback-video');
  const loadingAnalysis = document.getElementById('loading-analysis');
  const poseMetrics = document.getElementById('pose-metrics');
  const swingPhases = document.getElementById('swing-phases');
  const critiqueSection = document.getElementById('critique-section');
  const tipsSection = document.getElementById('tips-section');

  // DOM - Welcome / Skill
  const welcomeScreen = document.getElementById('welcome-screen');
  const skillScreen = document.getElementById('skill-screen');

  // State
  let analyzer = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let poseTrackingInterval = null;
  let cameraActive = false;
  let usingFrontCamera = true;
  let lastAnalysisResults = null;
  let zoomPickerVisible = false;
  let skillLevel = 'amateur'; // 'amateur', 'kornferry', 'pga'

  // Zoom state
  let currentZoom = 1;
  let minZoom = 1;
  let maxZoom = 1;
  let supportsZoom = false;

  // ===== Welcome & Skill Level Flow =====
  function startWelcomeFlow() {
    // After 2 seconds, dissolve welcome into skill selection
    setTimeout(() => {
      welcomeScreen.classList.add('fade-out');
      skillScreen.classList.remove('hidden');
      setTimeout(() => {
        welcomeScreen.classList.add('hidden');
      }, 800);
    }, 2000);
  }

  function selectSkillLevel(level) {
    skillLevel = level;
    // Dissolve skill screen into camera
    skillScreen.classList.add('fade-out');
    cameraScreen.classList.remove('hidden');
    setTimeout(() => {
      skillScreen.classList.add('hidden');
    }, 600);
  }

  // Skill level button listeners
  document.querySelectorAll('.skill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectSkillLevel(btn.dataset.level);
    });
  });

  // ===== Screen Navigation =====
  function showScreen(screen) {
    cameraScreen.classList.add('hidden');
    analysisScreen.classList.add('hidden');
    libraryScreen.classList.add('hidden');
    sharedView.classList.add('hidden');
    screen.classList.remove('hidden');
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
    } catch (err) {
      console.warn('Pose detection could not initialize:', err.message);
    }
  }

  // ===== Camera =====
  async function startCamera() {
    try {
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

      // Switch to record controls
      preCameraControls.classList.add('hidden');
      recordControls.classList.remove('hidden');
      btnFlipCamera.classList.remove('hidden');
      btnZoomToggle.classList.remove('hidden');

      if (analyzer && analyzer.pose) {
        startPoseTracking();
      }
    } catch (err) {
      console.error('Camera error:', err);
      btnStartCamera.textContent = 'Start Camera';
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
    } else {
      supportsZoom = false;
      minZoom = 0.5;
      maxZoom = 3;
      currentZoom = 1;
    }
    updateZoomUI();
  }

  function setZoom(level) {
    currentZoom = Math.max(minZoom, Math.min(maxZoom, level));

    if (supportsZoom) {
      const track = mediaStream.getVideoTracks()[0];
      if (track) {
        track.applyConstraints({ advanced: [{ zoom: currentZoom }] }).catch(() => {
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
    // Update badge
    zoomBadge.textContent = `${currentZoom.toFixed(1)}x`;

    // Update active state on zoom options
    document.querySelectorAll('.zoom-opt').forEach((btn) => {
      const val = parseFloat(btn.dataset.zoom);
      btn.classList.toggle('active', Math.abs(currentZoom - val) < 0.1);
    });
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

  function toggleZoomPicker() {
    zoomPickerVisible = !zoomPickerVisible;
    zoomPicker.classList.toggle('hidden', !zoomPickerVisible);
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
    // Hide zoom picker if open
    zoomPicker.classList.add('hidden');
    zoomPickerVisible = false;

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
    recordControls.classList.add('hidden');
    stopControls.classList.remove('hidden');
    btnFlipCamera.classList.add('hidden');
    btnZoomToggle.classList.add('hidden');

    setTimeout(() => {
      if (isRecording) stopRecording();
    }, 15000);
  }

  function showCountdown() {
    return new Promise((resolve) => {
      let count = 3;
      countdownEl.classList.remove('hidden');
      countdownEl.textContent = count;

      const interval = setInterval(() => {
        count--;
        if (count > 0) {
          countdownEl.textContent = count;
          countdownEl.style.animation = 'none';
          void countdownEl.offsetHeight;
          countdownEl.style.animation = 'countdown-pop 0.5s ease-out';
        } else {
          countdownEl.classList.add('hidden');
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
    stopControls.classList.add('hidden');

    // Show analyze / retake buttons
    postRecordControls.classList.remove('hidden');
  }

  function onRecordingStopped() {
    console.log(`Recording complete: ${recordedChunks.length} chunks, ${analyzer ? analyzer.frames.length : 0} pose frames`);
  }

  // ===== Analysis =====
  async function runAnalysis() {
    // Switch to analysis screen
    showScreen(analysisScreen);
    window.scrollTo(0, 0);

    // Set up playback video
    if (recordedChunks.length > 0) {
      const mimeType = recordedChunks[0].type || 'video/webm';
      const blob = new Blob(recordedChunks, { type: mimeType });
      playbackVideo.src = URL.createObjectURL(blob);
    }

    // Show loading
    loadingAnalysis.classList.remove('hidden');
    poseMetrics.classList.add('hidden');
    swingPhases.classList.add('hidden');
    critiqueSection.classList.add('hidden');
    tipsSection.classList.add('hidden');
    document.getElementById('save-share-section').classList.add('hidden');

    await new Promise((r) => setTimeout(r, 1500));

    let results;
    if (analyzer && analyzer.frames.length >= 10) {
      results = analyzer.analyzeSwing(skillLevel);
    } else {
      results = generateFallbackAnalysis();
    }

    // Scale score based on skill level
    if (results.score !== null) {
      results.score = scaleScoreForLevel(results.score, skillLevel);
    }
    results.skillLevel = skillLevel;

    lastAnalysisResults = results;
    loadingAnalysis.classList.add('hidden');
    displayResults(results);

    // Show save & share buttons
    if (!results.error) {
      document.getElementById('save-share-section').classList.remove('hidden');
      document.getElementById('save-status').classList.add('hidden');
      document.getElementById('btn-save').disabled = false;
      document.getElementById('btn-save').textContent = 'Save Swing';
    }
  }

  // Scale raw score based on skill level
  // Amateur: forgiving (raw score used roughly as-is)
  // KornFerry: 100 amateur ~ 50 KF. Much harder to score well.
  // PGA: 100 KF ~ 35 PGA. Elite-level expectations.
  function scaleScoreForLevel(rawScore, level) {
    let scaled;
    if (level === 'amateur') {
      // Generous: inflate slightly so beginners feel encouraged
      scaled = Math.round(Math.min(100, rawScore * 1.1 + 5));
    } else if (level === 'kornferry') {
      // A 100 amateur = ~50 KF. Scale: score * 0.5
      // But allow truly great swings to reach 70-80
      scaled = Math.round(rawScore * 0.5);
    } else if (level === 'pga') {
      // A 100 KF = ~35 PGA. A 100 amateur = ~18 PGA.
      // Only a perfect swing by Scottie/Rory standards hits 90+
      scaled = Math.round(rawScore * 0.2);
    } else {
      scaled = rawScore;
    }
    return Math.min(100, Math.max(0, scaled));
  }

  function getSkillLabel(level) {
    if (level === 'kornferry') return 'Korn Ferry';
    if (level === 'pga') return 'PGA Tour';
    return 'Amateur';
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
        { title: 'Setup & Alignment', description: 'Ensure your feet are shoulder-width apart, knees slightly flexed, and spine tilted forward from the hips. Your arms should hang naturally below your shoulders.' },
        { title: 'Backswing Checkpoint', description: 'At the top of your backswing, your lead arm should be relatively straight, your back should face the target, and your weight should be loaded on your trail foot.' },
        { title: 'Impact Position', description: 'At impact, your hips should be open to the target, weight shifting to your lead foot, hands ahead of the ball, and your head behind the ball.' },
        { title: 'Follow-Through', description: 'A complete follow-through has your belt buckle facing the target, weight fully on your lead foot, and your trail foot up on its toe. Hold this finish for balance.' },
        { title: 'Tempo Training', description: 'Count "1" on the backswing and "2" on the downswing. A good swing tempo ratio is about 3:1. Use a metronome app set to 72 BPM for practice.' },
      ],
    };
  }

  function displayResults(results) {
    if (results.error) {
      critiqueSection.classList.remove('hidden');
      document.getElementById('critique-content').innerHTML = `<p>${results.message}</p>`;
      return;
    }

    displayMetrics(results.metrics);
    poseMetrics.classList.remove('hidden');

    displayPhases(results.phases);
    swingPhases.classList.remove('hidden');

    displayCritique(results.critique, results.score);
    critiqueSection.classList.remove('hidden');

    displayTips(results.tips);
    tipsSection.classList.remove('hidden');
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
      const label = getSkillLabel(skillLevel);
      html += `<div style="text-align:center">`;
      html += `<span class="score-badge">Swing Score: ${score}/100</span>`;
      html += `<div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-top:4px;">Scored on <strong style="color:var(--gold-light);">${label}</strong> standard</div>`;
      html += `</div>`;
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
      html += `<div class="tip-card"><h4>${tip.title}</h4><p>${tip.description}</p></div>`;
    });
    container.innerHTML = html;
  }

  // ===== Save Swing =====
  async function saveSwing() {
    const btnSave = document.getElementById('btn-save');
    const saveStatus = document.getElementById('save-status');
    btnSave.disabled = true;
    btnSave.textContent = 'Saving...';

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

      const response = await fetch('/api/swings', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        btnSave.textContent = 'Saved!';
        saveStatus.textContent = 'Swing saved to your library!';
        saveStatus.className = '';
        saveStatus.classList.remove('hidden');
      } else {
        throw new Error(data.error || 'Save failed');
      }
    } catch (err) {
      console.error('Save error:', err);
      btnSave.textContent = 'Save Swing';
      btnSave.disabled = false;
      saveStatus.textContent = 'Could not save. Please try again.';
      saveStatus.className = 'error';
      saveStatus.classList.remove('hidden');
    }
  }

  // ===== Share Swing =====
  async function shareSwing() {
    const btnSave = document.getElementById('btn-save');
    let swingId = null;

    if (!btnSave.disabled || !btnSave.textContent.includes('Saved')) {
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
          btnSave.textContent = 'Saved!';
          btnSave.disabled = true;
        }
      } catch (err) {
        alert('Could not save swing for sharing. Please try again.');
        return;
      }
    }

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

    if (navigator.share) {
      try {
        await navigator.share({ title: 'My Golf Swing', text: shareText, url: shareUrl });
      } catch (err) {
        if (err.name !== 'AbortError') copyToClipboard(shareUrl);
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
      prompt('Copy this link to share your swing:', text);
    });
  }

  // ===== Library =====
  function showLibrary() {
    showScreen(libraryScreen);
    loadLibrary();
  }

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
          : '<span class="no-video">&#9971;</span>';

        return `
          <div class="swing-card" data-id="${swing.id}">
            <div class="swing-card-thumb">${videoThumb}</div>
            <div class="swing-card-info">
              <div class="swing-card-date">${date}</div>
              <div class="swing-card-score">${score}</div>
            </div>
            <div class="swing-card-actions">
              <button onclick="window._viewSwing('${swing.id}')" title="View">&#128065;</button>
              <button onclick="window._shareSwingById('${swing.id}')" title="Share">&#128228;</button>
              <button onclick="window._deleteSwing('${swing.id}')" title="Delete">&#128465;</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      listEl.innerHTML = '<div style="text-align:center;color:#ff6b6b;padding:20px;">Could not load swings.</div>';
    }
  }

  window._viewSwing = async function (id) {
    try {
      const response = await fetch(`/api/swings/${id}`);
      const data = await response.json();
      if (!data.swing) return;

      const swing = data.swing;

      showScreen(sharedView);

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
        analysisEl.innerHTML = '<p style="color:var(--green-pale);">No analysis data available.</p>';
      }
    } catch (err) {
      alert('Could not load swing.');
    }
  };

  window._shareSwingById = function (id) {
    const shareUrl = `${window.location.origin}/share/${id}`;
    if (navigator.share) {
      navigator.share({ title: 'Golf Swing', text: 'Check out this golf swing!', url: shareUrl });
    } else {
      copyToClipboard(shareUrl);
      alert('Share link copied to clipboard!');
    }
  };

  window._deleteSwing = async function (id) {
    if (!confirm('Delete this swing?')) return;
    try {
      await fetch(`/api/swings/${id}`, { method: 'DELETE' });
      loadLibrary();
    } catch (err) {
      alert('Could not delete swing.');
    }
  };

  async function loadSharedSwing(id) {
    showScreen(sharedView);
    try {
      const response = await fetch(`/api/swings/${id}`);
      const data = await response.json();
      if (!data.swing) {
        document.getElementById('shared-analysis').innerHTML = '<p style="color:var(--green-pale);">Swing not found.</p>';
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
        analysisEl.innerHTML = '<p style="color:var(--green-pale);">No analysis data available.</p>';
      }
    } catch (err) {
      document.getElementById('shared-analysis').innerHTML = '<p style="color:#ff6b6b;">Could not load shared swing.</p>';
    }
  }

  function renderAnalysisHTML(analysis) {
    let html = '';

    if (analysis.score !== null) {
      const label = analysis.skillLevel ? getSkillLabel(analysis.skillLevel) : 'Amateur';
      html += `<div style="text-align:center">`;
      html += `<span class="score-badge">Swing Score: ${analysis.score}/100</span>`;
      html += `<div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-top:4px;">Scored on <strong style="color:var(--gold-light);">${label}</strong> standard</div>`;
      html += `</div>`;
    }

    if (analysis.metrics) {
      html += '<h3>Pose Tracking Data</h3>';
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

    if (analysis.critique) {
      html += '<h3>AI Coach Feedback</h3>';
      analysis.critique.forEach((section) => {
        html += `<div class="critique-category ${section.type}"><h4>${section.title}</h4><ul>`;
        section.points.forEach((p) => { html += `<li>${p}</li>`; });
        html += '</ul></div>';
      });
    }

    if (analysis.tips) {
      html += '<h3>Drills & Practice Tips</h3>';
      analysis.tips.forEach((tip) => {
        html += `<div class="tip-card"><h4>${tip.title}</h4><p>${tip.description}</p></div>`;
      });
    }

    return html;
  }

  // ===== Reset / Retake =====
  function retake() {
    // Go back to camera with record controls
    postRecordControls.classList.add('hidden');
    recordControls.classList.remove('hidden');
    btnFlipCamera.classList.remove('hidden');
    btnZoomToggle.classList.remove('hidden');

    canvasCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);

    if (analyzer) {
      analyzer.frames = [];
    }
    recordedChunks = [];
    lastAnalysisResults = null;
  }

  function backToCamera() {
    showScreen(cameraScreen);

    // Reset analysis UI
    poseMetrics.classList.add('hidden');
    swingPhases.classList.add('hidden');
    critiqueSection.classList.add('hidden');
    tipsSection.classList.add('hidden');
    document.getElementById('save-share-section').classList.add('hidden');
    loadingAnalysis.classList.add('hidden');

    // Reset to record controls
    postRecordControls.classList.add('hidden');
    stopControls.classList.add('hidden');

    if (cameraActive) {
      recordControls.classList.remove('hidden');
      btnFlipCamera.classList.remove('hidden');
      btnZoomToggle.classList.remove('hidden');
    } else {
      preCameraControls.classList.remove('hidden');
    }

    canvasCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);

    if (analyzer) {
      analyzer.frames = [];
    }
    recordedChunks = [];
    lastAnalysisResults = null;

    // Revoke playback URL
    if (playbackVideo.src) {
      URL.revokeObjectURL(playbackVideo.src);
      playbackVideo.src = '';
    }
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

    preCameraControls.classList.add('hidden');
    recordControls.classList.add('hidden');

    // Store as recorded chunks for analysis
    recordedChunks = [];
    file.arrayBuffer().then((buffer) => {
      recordedChunks = [new Blob([buffer], { type: file.type })];
    });

    if (analyzer && analyzer.pose) {
      analyzer.frames = [];
      analyzer.startTracking();

      cameraFeed.addEventListener('play', () => { startPoseTracking(); }, { once: true });
      cameraFeed.addEventListener('ended', () => {
        analyzer.stopTracking();
        stopPoseTracking();
        postRecordControls.classList.remove('hidden');
      }, { once: true });
    } else {
      cameraFeed.addEventListener('ended', () => {
        postRecordControls.classList.remove('hidden');
      }, { once: true });
      setTimeout(() => {
        postRecordControls.classList.remove('hidden');
      }, 5000);
    }

    // Reset the input so the same file can be selected again
    event.target.value = '';
  }

  // ===== Event Listeners =====
  btnStartCamera.addEventListener('click', async () => {
    btnStartCamera.textContent = 'Starting...';
    btnStartCamera.disabled = true;
    await initAnalyzer();
    await startCamera();
  });

  btnRecord.addEventListener('click', startRecording);
  btnStop.addEventListener('click', stopRecording);
  btnAnalyze.addEventListener('click', runAnalysis);
  btnRetake.addEventListener('click', retake);
  btnFlipCamera.addEventListener('click', flipCamera);
  btnZoomToggle.addEventListener('click', toggleZoomPicker);

  document.getElementById('btn-save').addEventListener('click', saveSwing);
  document.getElementById('btn-share').addEventListener('click', shareSwing);
  document.getElementById('btn-back-to-camera').addEventListener('click', backToCamera);
  document.getElementById('btn-library-shortcut').addEventListener('click', showLibrary);
  document.getElementById('btn-library-back').addEventListener('click', () => {
    showScreen(cameraScreen);
  });

  fileUpload.addEventListener('change', handleFileUpload);
  fileUploadAlt.addEventListener('change', handleFileUpload);

  // Zoom options
  document.querySelectorAll('.zoom-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      setZoom(parseFloat(btn.dataset.zoom));
      // Auto-hide picker after selection
      setTimeout(() => {
        zoomPicker.classList.add('hidden');
        zoomPickerVisible = false;
      }, 300);
    });
  });

  // Close zoom picker when tapping elsewhere
  document.addEventListener('click', (e) => {
    if (zoomPickerVisible && !zoomPicker.contains(e.target) && e.target !== btnZoomToggle && !btnZoomToggle.contains(e.target)) {
      zoomPicker.classList.add('hidden');
      zoomPickerVisible = false;
    }
  });

  // Check for shared swing URL on load
  function checkSharedSwing() {
    const match = window.location.pathname.match(/^\/share\/(\w+)$/);
    if (match) {
      // Skip welcome flow for shared links
      welcomeScreen.classList.add('hidden');
      skillScreen.classList.add('hidden');
      loadSharedSwing(match[1]);
      return true;
    }
    return false;
  }

  // Start the app
  if (!checkSharedSwing()) {
    startWelcomeFlow();
  }
})();
