/**
 * Golf Swing Analyzer - Pose detection and swing analysis engine
 * Uses MediaPipe Pose to track body landmarks and analyze golf swing mechanics.
 */

class SwingAnalyzer {
  constructor() {
    this.pose = null;
    this.frames = [];
    this.isTracking = false;
    this.onPoseResult = null;

    // Landmark indices (MediaPipe Pose)
    this.LANDMARKS = {
      NOSE: 0,
      LEFT_SHOULDER: 11,
      RIGHT_SHOULDER: 12,
      LEFT_ELBOW: 13,
      RIGHT_ELBOW: 14,
      LEFT_WRIST: 15,
      RIGHT_WRIST: 16,
      LEFT_HIP: 23,
      RIGHT_HIP: 24,
      LEFT_KNEE: 25,
      RIGHT_KNEE: 26,
      LEFT_ANKLE: 27,
      RIGHT_ANKLE: 28,
    };
  }

  async initialize() {
    this.pose = new Pose({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`,
    });

    this.pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.pose.onResults((results) => this._handleResults(results));
    await this.pose.initialize();
  }

  _handleResults(results) {
    if (this.onPoseResult) {
      this.onPoseResult(results);
    }

    if (this.isTracking && results.poseLandmarks) {
      this.frames.push({
        timestamp: Date.now(),
        landmarks: results.poseLandmarks.map((lm) => ({ ...lm })),
      });
    }
  }

  startTracking() {
    this.frames = [];
    this.isTracking = true;
  }

  stopTracking() {
    this.isTracking = false;
  }

  async sendFrame(videoElement) {
    if (this.pose) {
      await this.pose.send({ image: videoElement });
    }
  }

  // ===== Utility Methods =====

  _getAngle(a, b, c) {
    const radians =
      Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs((radians * 180) / Math.PI);
    if (angle > 180) angle = 360 - angle;
    return angle;
  }

  _getDistance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  _getMidpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
  }

  // Average landmarks over a range of frames to reduce noise
  _averageLandmarks(startIdx, endIdx) {
    const count = endIdx - startIdx;
    if (count <= 0) return this.frames[startIdx].landmarks;

    const avg = this.frames[startIdx].landmarks.map((lm) => ({
      x: 0, y: 0, z: 0, visibility: 0,
    }));

    for (let i = startIdx; i < endIdx; i++) {
      const lms = this.frames[i].landmarks;
      for (let j = 0; j < lms.length; j++) {
        avg[j].x += lms[j].x / count;
        avg[j].y += lms[j].y / count;
        avg[j].z += (lms[j].z || 0) / count;
        avg[j].visibility += (lms[j].visibility || 0) / count;
      }
    }
    return avg;
  }

  // Get the shoulder line angle (rotation in the camera plane)
  _shoulderLineAngle(landmarks) {
    const L = this.LANDMARKS;
    const ls = landmarks[L.LEFT_SHOULDER];
    const rs = landmarks[L.RIGHT_SHOULDER];
    return Math.atan2(ls.y - rs.y, ls.x - rs.x) * (180 / Math.PI);
  }

  // Get the hip line angle
  _hipLineAngle(landmarks) {
    const L = this.LANDMARKS;
    const lh = landmarks[L.LEFT_HIP];
    const rh = landmarks[L.RIGHT_HIP];
    return Math.atan2(lh.y - rh.y, lh.x - rh.x) * (180 / Math.PI);
  }

  // ===== Main Analysis =====

  analyzeSwing() {
    if (this.frames.length < 10) {
      return {
        error: true,
        message:
          'Not enough frames captured. Please ensure you are visible in the camera and try a longer recording.',
      };
    }

    // Step 1: Detect key phase frames using wrist trajectory
    const phaseFrames = this._findPhaseFrames();

    // Step 2: Calculate metrics using averaged data at each phase
    const metrics = this._calculateMetrics(phaseFrames);

    // Step 3: Detect which phases were present
    const phases = this._detectPhases(phaseFrames);

    // Step 4: Generate critique and tips
    const critique = this._generateCritique(metrics, phases);
    const tips = this._generateTips(metrics, phases);

    // Step 5: Calculate score
    const score = this._calculateScore(metrics, phases);

    return { phases, metrics, critique, tips, score, frameCount: this.frames.length };
  }

  _findPhaseFrames() {
    const L = this.LANDMARKS;
    const total = this.frames.length;

    // Calculate wrist midpoint y-position for each frame
    const wristY = this.frames.map((f) => {
      const lw = f.landmarks[L.LEFT_WRIST];
      const rw = f.landmarks[L.RIGHT_WRIST];
      return (lw.y + rw.y) / 2;
    });

    // Smooth the wrist trajectory with a moving average (window=5) to reduce noise
    const smoothed = [];
    const window = Math.min(5, Math.floor(total / 3));
    for (let i = 0; i < total; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - window); j <= Math.min(total - 1, i + window); j++) {
        sum += wristY[j];
        count++;
      }
      smoothed.push(sum / count);
    }

    // Find the TOP of backswing: lowest y-value (highest point on screen)
    // Only look in the first 70% of frames
    let topIdx = 0;
    let topY = Infinity;
    const searchEnd = Math.floor(total * 0.7);
    for (let i = Math.floor(total * 0.1); i < searchEnd; i++) {
      if (smoothed[i] < topY) {
        topY = smoothed[i];
        topIdx = i;
      }
    }

    // Find IMPACT: highest y-value (lowest point) AFTER the top
    let impactIdx = topIdx;
    let impactY = -Infinity;
    for (let i = topIdx; i < total; i++) {
      if (smoothed[i] > impactY) {
        impactY = smoothed[i];
        impactIdx = i;
      }
    }

    // Address: average of first few frames (before backswing starts)
    const addressEnd = Math.max(1, Math.floor(topIdx * 0.3));
    const addressIdx = Math.floor(addressEnd / 2);

    // Follow-through: frames after impact
    const followIdx = Math.min(total - 1, impactIdx + Math.floor((total - impactIdx) * 0.5));

    return {
      addressStart: 0,
      addressEnd: addressEnd,
      addressIdx: addressIdx,
      topIdx: topIdx,
      impactIdx: impactIdx,
      followIdx: followIdx,
      total: total,
    };
  }

  _detectPhases(pf) {
    const detected = {
      address: false,
      backswing: false,
      top: false,
      downswing: false,
      impact: false,
      'follow-through': false,
    };

    // Address: detected if we have frames before backswing starts
    if (pf.addressEnd > 0) detected.address = true;

    // Backswing: detected if top is clearly after address
    if (pf.topIdx > pf.addressEnd) detected.backswing = true;

    // Top: detected if it's not at the very beginning or end
    if (pf.topIdx > 2 && pf.topIdx < pf.total - 2) detected.top = true;

    // Downswing: detected if impact is after top
    if (pf.impactIdx > pf.topIdx + 1) detected.downswing = true;

    // Impact: detected if we found it
    if (pf.impactIdx > pf.topIdx) detected.impact = true;

    // Follow-through: frames exist after impact
    if (pf.impactIdx < pf.total - 2) detected['follow-through'] = true;

    return detected;
  }

  _calculateMetrics(pf) {
    const L = this.LANDMARKS;
    const metrics = {};

    // Get averaged landmarks at each key phase (average over ~5 frames for stability)
    const avgRadius = 3;
    const addressLM = this._averageLandmarks(
      Math.max(0, pf.addressIdx - avgRadius),
      Math.min(pf.addressEnd, pf.addressIdx + avgRadius)
    );
    const topLM = this._averageLandmarks(
      Math.max(0, pf.topIdx - avgRadius),
      Math.min(pf.total, pf.topIdx + avgRadius)
    );
    const impactLM = this._averageLandmarks(
      Math.max(0, pf.impactIdx - avgRadius),
      Math.min(pf.total, pf.impactIdx + avgRadius)
    );
    const followLM = this._averageLandmarks(
      Math.max(0, pf.followIdx - avgRadius),
      Math.min(pf.total, pf.followIdx + avgRadius)
    );

    // --- Shoulder Rotation ---
    // Measure change in shoulder line angle from address to top of backswing
    const shoulderAtAddress = this._shoulderLineAngle(addressLM);
    const shoulderAtTop = this._shoulderLineAngle(topLM);
    const shoulderRotation = Math.abs(shoulderAtTop - shoulderAtAddress);

    metrics.shoulderRotation = {
      value: Math.round(shoulderRotation),
      unit: '°',
      rating: shoulderRotation >= 25 ? 'good' : shoulderRotation >= 12 ? 'warning' : 'needs-work',
      detail:
        shoulderRotation >= 25
          ? 'Good shoulder rotation'
          : shoulderRotation >= 12
          ? 'Moderate shoulder turn - try to rotate your upper body more'
          : 'Limited shoulder turn - focus on turning your back toward the target',
    };

    // --- Hip Rotation ---
    // Measure change in hip line from address to top
    const hipAtAddress = this._hipLineAngle(addressLM);
    const hipAtTop = this._hipLineAngle(topLM);
    const hipRotation = Math.abs(hipAtTop - hipAtAddress);

    metrics.hipRotation = {
      value: Math.round(hipRotation),
      unit: '°',
      rating: hipRotation >= 12 ? 'good' : hipRotation >= 5 ? 'warning' : 'needs-work',
      detail:
        hipRotation >= 12
          ? 'Good hip rotation'
          : hipRotation >= 5
          ? 'Some hip turn - allow your hips to rotate more freely'
          : 'Very limited hip rotation - your lower body needs to engage more',
    };

    // --- Spine Angle at Address ---
    const shoulderMid = this._getMidpoint(addressLM[L.LEFT_SHOULDER], addressLM[L.RIGHT_SHOULDER]);
    const hipMid = this._getMidpoint(addressLM[L.LEFT_HIP], addressLM[L.RIGHT_HIP]);
    const spineAngle = Math.abs(
      Math.atan2(shoulderMid.y - hipMid.y, shoulderMid.x - hipMid.x) * (180 / Math.PI)
    );
    const spineFromVertical = Math.abs(90 - spineAngle);

    metrics.spineAngle = {
      value: Math.round(spineFromVertical),
      unit: '°',
      rating:
        spineFromVertical >= 10 && spineFromVertical <= 45
          ? 'good'
          : spineFromVertical >= 5 && spineFromVertical <= 55
          ? 'warning'
          : 'needs-work',
      detail:
        spineFromVertical >= 10 && spineFromVertical <= 45
          ? 'Good spine angle at address'
          : spineFromVertical < 10
          ? 'Standing too upright - bend more from your hips'
          : 'Bent over too much - stand a bit taller at address',
    };

    // --- Spine Angle Consistency (maintenance through the swing) ---
    const shoulderMidTop = this._getMidpoint(topLM[L.LEFT_SHOULDER], topLM[L.RIGHT_SHOULDER]);
    const hipMidTop = this._getMidpoint(topLM[L.LEFT_HIP], topLM[L.RIGHT_HIP]);
    const spineAtTop = Math.abs(
      Math.atan2(shoulderMidTop.y - hipMidTop.y, shoulderMidTop.x - hipMidTop.x) * (180 / Math.PI)
    );
    const spineChange = Math.abs(spineAngle - spineAtTop);

    // --- Knee Flex at Address ---
    // Average both knees
    const leftKneeAngle = this._getAngle(
      addressLM[L.LEFT_HIP], addressLM[L.LEFT_KNEE], addressLM[L.LEFT_ANKLE]
    );
    const rightKneeAngle = this._getAngle(
      addressLM[L.RIGHT_HIP], addressLM[L.RIGHT_KNEE], addressLM[L.RIGHT_ANKLE]
    );
    const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
    const kneeFlex = 180 - avgKneeAngle;

    metrics.kneeFlex = {
      value: Math.round(kneeFlex),
      unit: '°',
      rating:
        kneeFlex >= 8 && kneeFlex <= 45
          ? 'good'
          : kneeFlex >= 3 && kneeFlex <= 55
          ? 'warning'
          : 'needs-work',
      detail:
        kneeFlex >= 8 && kneeFlex <= 45
          ? 'Good athletic knee flex'
          : kneeFlex < 8
          ? 'Knees too straight - add some athletic flex'
          : 'Too much knee bend - straighten up slightly',
    };

    // --- Head Stability ---
    // Track head position across all frames, using median to ignore outliers
    const headPositions = this.frames.map((f) => ({
      x: f.landmarks[L.NOSE].x,
      y: f.landmarks[L.NOSE].y,
    }));

    // Use the average of the first few frames as reference (address position)
    const refFrames = Math.min(5, Math.floor(this.frames.length * 0.15));
    let refX = 0, refY = 0;
    for (let i = 0; i < refFrames; i++) {
      refX += headPositions[i].x / refFrames;
      refY += headPositions[i].y / refFrames;
    }

    // Calculate drift distances, then use the 90th percentile (ignore spikes)
    const drifts = headPositions.map((h) =>
      Math.sqrt((h.x - refX) ** 2 + (h.y - refY) ** 2)
    );
    drifts.sort((a, b) => a - b);
    const p90Drift = drifts[Math.floor(drifts.length * 0.9)];

    metrics.headMovement = {
      value: p90Drift < 0.05 ? 'Stable' : p90Drift < 0.09 ? 'Slight' : 'Excessive',
      unit: '',
      rating: p90Drift < 0.05 ? 'good' : p90Drift < 0.09 ? 'warning' : 'needs-work',
      detail:
        p90Drift < 0.05
          ? 'Great head stability through the swing'
          : p90Drift < 0.09
          ? 'Some head movement - try to keep your head steadier'
          : 'Significant head movement - focus on rotating around a fixed point',
    };

    // --- Weight Transfer ---
    // Measure hip center shift from address to follow-through
    const addressHipCenter = (addressLM[L.LEFT_HIP].x + addressLM[L.RIGHT_HIP].x) / 2;
    const followHipCenter = (followLM[L.LEFT_HIP].x + followLM[L.RIGHT_HIP].x) / 2;
    const weightShift = Math.abs(followHipCenter - addressHipCenter);

    metrics.weightTransfer = {
      value: weightShift > 0.03 ? 'Good' : weightShift > 0.015 ? 'Partial' : 'Minimal',
      unit: '',
      rating: weightShift > 0.03 ? 'good' : weightShift > 0.015 ? 'warning' : 'needs-work',
      detail:
        weightShift > 0.03
          ? 'Good weight transfer to the front foot'
          : weightShift > 0.015
          ? 'Some weight shift detected - exaggerate the move to your front foot'
          : 'Limited weight transfer - practice stepping into your swing',
    };

    // Store spine consistency as internal metric for scoring
    metrics._spineConsistency = spineChange;

    return metrics;
  }

  _generateCritique(metrics, phases) {
    const sections = [];
    const goodPoints = [];
    const improvePoints = [];
    const criticalPoints = [];

    Object.entries(metrics).forEach(([key, m]) => {
      if (key.startsWith('_')) return; // skip internal metrics
      if (m.rating === 'good') goodPoints.push(m.detail);
      else if (m.rating === 'warning') improvePoints.push(m.detail);
      else criticalPoints.push(m.detail);
    });

    // Phase-based feedback
    if (!phases.address) {
      improvePoints.push(
        'Could not clearly detect your address position. Stand still briefly before swinging.'
      );
    }
    if (!phases['follow-through']) {
      improvePoints.push(
        'Follow-through seems incomplete. Finish with your belt buckle facing the target.'
      );
    }

    if (goodPoints.length > 0) {
      sections.push({ type: 'good', title: 'What You\'re Doing Well', points: goodPoints });
    }
    if (improvePoints.length > 0) {
      sections.push({ type: 'improve', title: 'Areas to Improve', points: improvePoints });
    }
    if (criticalPoints.length > 0) {
      sections.push({ type: 'critical', title: 'Key Issues to Address', points: criticalPoints });
    }

    return sections;
  }

  _generateTips(metrics, phases) {
    const tips = [];

    if (metrics.shoulderRotation.rating !== 'good') {
      tips.push({
        title: 'Shoulder Turn Drill',
        description:
          'Hold a club across your shoulders and practice turning back until the club points at the ball. Feel the stretch in your back muscles.',
      });
    }

    if (metrics.hipRotation.rating !== 'good') {
      tips.push({
        title: 'Hip Engagement Drill',
        description:
          'Place a chair against your lead hip at address. On the backswing, your trail hip should turn away. On the downswing, bump the chair with your lead hip.',
      });
    }

    if (metrics.headMovement.rating !== 'good') {
      tips.push({
        title: 'Head Stability Drill',
        description:
          'Have a friend hold a club gently on top of your head while you make slow swings. Your head should stay in contact throughout.',
      });
    }

    if (metrics.weightTransfer.rating !== 'good') {
      tips.push({
        title: 'Step Drill for Weight Transfer',
        description:
          'On the downswing, step your lead foot toward the target before striking. This exaggerates proper weight transfer.',
      });
    }

    if (metrics.spineAngle.rating !== 'good') {
      tips.push({
        title: 'Spine Angle Practice',
        description:
          'Stand with your back against a wall, bend forward from your hips until you feel athletic. Your rear stays on the wall.',
      });
    }

    if (metrics.kneeFlex.rating !== 'good') {
      tips.push({
        title: 'Athletic Stance Drill',
        description:
          'Stand with feet shoulder-width apart, flex your knees slightly as if sitting on a bar stool. Let arms hang naturally.',
      });
    }

    tips.push({
      title: 'Tempo Training',
      description:
        'Count "1" on the backswing and "2" on the downswing. A 3:1 ratio is ideal. Use a metronome at 72 BPM.',
    });

    return tips;
  }

  _calculateScore(metrics, phases) {
    // Weighted scoring system - each metric contributes based on importance
    const weights = {
      shoulderRotation: 20,
      hipRotation: 15,
      spineAngle: 15,
      kneeFlex: 12,
      headMovement: 20,
      weightTransfer: 18,
    };

    let totalWeight = 0;
    let weightedScore = 0;

    Object.entries(weights).forEach(([key, weight]) => {
      const m = metrics[key];
      if (!m) return;
      totalWeight += weight;

      if (m.rating === 'good') weightedScore += weight * 1.0;
      else if (m.rating === 'warning') weightedScore += weight * 0.6;
      else weightedScore += weight * 0.25;
    });

    // Base score from metrics (0-100 range)
    let score = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 50;

    // Bonus for spine consistency (up to +5)
    if (metrics._spineConsistency !== undefined) {
      if (metrics._spineConsistency < 8) score += 5;
      else if (metrics._spineConsistency < 15) score += 2;
    }

    // Bonus for having all phases detected (up to +5)
    const phaseCount = Object.values(phases).filter(Boolean).length;
    score += (phaseCount / 6) * 5;

    // Round and clamp
    return Math.round(Math.min(100, Math.max(0, score)));
  }

  // Draw pose on canvas
  drawPose(results, canvasCtx, canvasWidth, canvasHeight) {
    canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (!results.poseLandmarks) return;

    const connections = [
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
      [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
      [25, 27], [26, 28],
    ];

    canvasCtx.strokeStyle = 'rgba(64, 145, 108, 0.7)';
    canvasCtx.lineWidth = 3;
    connections.forEach(([a, b]) => {
      const lmA = results.poseLandmarks[a];
      const lmB = results.poseLandmarks[b];
      canvasCtx.beginPath();
      canvasCtx.moveTo(lmA.x * canvasWidth, lmA.y * canvasHeight);
      canvasCtx.lineTo(lmB.x * canvasWidth, lmB.y * canvasHeight);
      canvasCtx.stroke();
    });

    results.poseLandmarks.forEach((lm, i) => {
      if (lm.visibility < 0.5) return;
      canvasCtx.beginPath();
      canvasCtx.arc(lm.x * canvasWidth, lm.y * canvasHeight, 5, 0, 2 * Math.PI);
      canvasCtx.fillStyle = i <= 10 ? '#d4a843' : '#40916c';
      canvasCtx.fill();
      canvasCtx.strokeStyle = 'white';
      canvasCtx.lineWidth = 1.5;
      canvasCtx.stroke();
    });
  }
}
