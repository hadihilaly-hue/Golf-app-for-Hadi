/**
 * Golf Swing Analyzer - Main Application
 * Handles camera, recording, and UI interactions.
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
      // App still works without pose - just won't have skeleton overlay
    }
  }

  // ===== Camera =====
  async function startCamera() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      cameraFeed.srcObject = mediaStream;
      cameraActive = true;

      btnStartCamera.classList.add('hidden');
      btnRecord.classList.remove('hidden');

      // Start pose tracking loop
      if (analyzer && analyzer.pose) {
        startPoseTracking();
      }
    } catch (err) {
      alert('Could not access camera. Please allow camera permissions and try again.');
      console.error('Camera error:', err);
    }
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
    }, 100); // ~10 fps for pose tracking
  }

  function stopPoseTracking() {
    if (poseTrackingInterval) {
      clearInterval(poseTrackingInterval);
      poseTrackingInterval = null;
    }
  }

  // ===== Recording =====
  async function startRecording() {
    // 3-2-1 countdown
    await showCountdown();

    recordedChunks = [];

    const options = { mimeType: 'video/webm;codecs=vp9' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm';
    }

    mediaRecorder = new MediaRecorder(mediaStream, options);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.onstop = onRecordingStopped;

    mediaRecorder.start(100); // Collect data every 100ms
    isRecording = true;

    // Start tracking poses for analysis
    if (analyzer) analyzer.startTracking();

    // Update UI
    recordingIndicator.classList.remove('hidden');
    btnRecord.classList.add('hidden');
    btnStop.classList.remove('hidden');

    // Auto-stop after 15 seconds
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
          // Re-trigger animation
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

    // Update UI
    recordingIndicator.classList.add('hidden');
    btnStop.classList.add('hidden');
    btnAnalyze.classList.remove('hidden');
    btnReset.classList.remove('hidden');
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

    btnAnalyze.classList.add('hidden');

    // Small delay so user sees loading
    await new Promise((r) => setTimeout(r, 1500));

    let results;
    if (analyzer && analyzer.frames.length >= 10) {
      results = analyzer.analyzeSwing();
    } else {
      // Fallback: provide general tips if pose detection didn't work
      results = generateFallbackAnalysis();
    }

    loadingAnalysis.classList.add('hidden');
    displayResults(results);
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

    // Score
    if (results.score !== null) {
      const scoreHTML = `<div style="text-align:center"><span class="score-badge">Swing Score: ${results.score}/100</span></div>`;
      document.getElementById('critique-content').innerHTML = scoreHTML;
    }

    // Metrics
    displayMetrics(results.metrics);
    poseMetrics.classList.remove('hidden');

    // Phases
    displayPhases(results.phases);
    swingPhases.classList.remove('hidden');

    // Critique
    displayCritique(results.critique, results.score);
    critiqueSection.classList.remove('hidden');

    // Tips
    displayTips(results.tips);
    tipsSection.classList.remove('hidden');

    // Scroll to results
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
        if (detected) {
          el.classList.add('detected');
        } else {
          el.classList.remove('detected');
        }
      }
    });
  }

  function displayCritique(critique, score) {
    const container = document.getElementById('critique-content');
    let html = '';

    if (score !== null) {
      html += `<div style="text-align:center"><span class="score-badge">Swing Score: ${score}/100</span></div>`;
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

  // ===== Reset =====
  function resetApp() {
    // Hide analysis
    analysisSection.classList.add('hidden');
    btnAnalyze.classList.add('hidden');
    btnReset.classList.add('hidden');
    btnRecord.classList.remove('hidden');

    // Clear canvas
    canvasCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);

    // Reset analyzer frames
    if (analyzer) {
      analyzer.frames = [];
    }
    recordedChunks = [];
  }

  // ===== File Upload =====
  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Stop live camera if active
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

    // Analyze uploaded video by tracking poses while playing
    if (analyzer && analyzer.pose) {
      analyzer.frames = [];
      analyzer.startTracking();

      cameraFeed.addEventListener(
        'play',
        () => {
          startPoseTracking();
        },
        { once: true }
      );

      cameraFeed.addEventListener(
        'ended',
        () => {
          analyzer.stopTracking();
          stopPoseTracking();
          btnAnalyze.classList.remove('hidden');
          btnReset.classList.remove('hidden');
        },
        { once: true }
      );
    } else {
      // No pose tracking - show analyze button after a short delay
      cameraFeed.addEventListener(
        'ended',
        () => {
          btnAnalyze.classList.remove('hidden');
          btnReset.classList.remove('hidden');
        },
        { once: true }
      );
      // Also show after 5 seconds in case video doesn't end
      setTimeout(() => {
        btnAnalyze.classList.remove('hidden');
        btnReset.classList.remove('hidden');
      }, 5000);
    }
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
  btnReset.addEventListener('click', resetApp);
  fileUpload.addEventListener('change', handleFileUpload);
})();
