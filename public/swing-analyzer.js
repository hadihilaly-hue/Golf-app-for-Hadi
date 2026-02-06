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

  // ===== Analysis Methods =====

  analyzeSwing() {
    if (this.frames.length < 10) {
      return {
        error: true,
        message:
          'Not enough frames captured. Please ensure you are visible in the camera and try a longer recording.',
      };
    }

    const phases = this._detectPhases();
    const metrics = this._calculateMetrics();
    const critique = this._generateCritique(metrics, phases);
    const tips = this._generateTips(metrics, phases);
    const score = this._calculateScore(metrics);

    return { phases, metrics, critique, tips, score, frameCount: this.frames.length };
  }

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
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }

  _detectPhases() {
    const detected = {
      address: false,
      backswing: false,
      top: false,
      downswing: false,
      impact: false,
      'follow-through': false,
    };

    if (this.frames.length < 10) return detected;

    const L = this.LANDMARKS;
    const totalFrames = this.frames.length;

    // Track wrist positions over time to detect swing phases
    const wristPositions = this.frames.map((f) => {
      const lw = f.landmarks[L.LEFT_WRIST];
      const rw = f.landmarks[L.RIGHT_WRIST];
      return this._getMidpoint(lw, rw);
    });

    // Track shoulder line angles
    const shoulderAngles = this.frames.map((f) => {
      const ls = f.landmarks[L.LEFT_SHOULDER];
      const rs = f.landmarks[L.RIGHT_SHOULDER];
      return Math.atan2(ls.y - rs.y, ls.x - rs.x) * (180 / Math.PI);
    });

    // Find highest wrist position (top of backswing)
    let highestY = Infinity;
    let topFrameIdx = 0;
    wristPositions.forEach((wp, i) => {
      if (wp.y < highestY) {
        highestY = wp.y;
        topFrameIdx = i;
      }
    });

    // Find lowest wrist position near middle-to-end (impact zone)
    let lowestY = -Infinity;
    let impactFrameIdx = topFrameIdx;
    for (let i = topFrameIdx; i < totalFrames; i++) {
      if (wristPositions[i].y > lowestY) {
        lowestY = wristPositions[i].y;
        impactFrameIdx = i;
      }
    }

    // Assign phases based on frame positions
    const addressEnd = Math.floor(totalFrames * 0.1);
    const backswingEnd = topFrameIdx;
    const downswingEnd = impactFrameIdx;

    // Address: first ~10% of frames where golfer is relatively still
    if (addressEnd > 0) {
      const firstWrist = wristPositions[0];
      const addressWrist = wristPositions[Math.min(addressEnd, totalFrames - 1)];
      const movement = this._getDistance(firstWrist, addressWrist);
      if (movement < 0.15) detected.address = true;
    }

    // Backswing: wrists moving up
    if (topFrameIdx > addressEnd) {
      detected.backswing = true;
    }

    // Top of backswing
    if (topFrameIdx > 0 && topFrameIdx < totalFrames - 1) {
      detected.top = true;
    }

    // Downswing
    if (impactFrameIdx > topFrameIdx) {
      detected.downswing = true;
    }

    // Impact
    if (impactFrameIdx > topFrameIdx && impactFrameIdx < totalFrames) {
      detected.impact = true;
    }

    // Follow-through: frames after impact
    if (impactFrameIdx < totalFrames - 3) {
      detected['follow-through'] = true;
    }

    return detected;
  }

  _calculateMetrics() {
    const L = this.LANDMARKS;
    const metrics = {};

    // Sample key frames
    const startFrame = this.frames[0];
    const midIdx = Math.floor(this.frames.length / 2);
    const midFrame = this.frames[midIdx];
    const endFrame = this.frames[this.frames.length - 1];

    // --- Shoulder Rotation ---
    const startShoulderAngle = this._getAngle(
      startFrame.landmarks[L.LEFT_HIP],
      startFrame.landmarks[L.LEFT_SHOULDER],
      startFrame.landmarks[L.RIGHT_SHOULDER]
    );
    const midShoulderAngle = this._getAngle(
      midFrame.landmarks[L.LEFT_HIP],
      midFrame.landmarks[L.LEFT_SHOULDER],
      midFrame.landmarks[L.RIGHT_SHOULDER]
    );
    const shoulderRotation = Math.abs(midShoulderAngle - startShoulderAngle);
    metrics.shoulderRotation = {
      value: Math.round(shoulderRotation),
      unit: '°',
      rating: shoulderRotation > 70 ? 'good' : shoulderRotation > 45 ? 'warning' : 'needs-work',
      detail:
        shoulderRotation > 70
          ? 'Great shoulder turn!'
          : shoulderRotation > 45
          ? 'Decent rotation, could turn more'
          : 'Limited shoulder turn - try to rotate more',
    };

    // --- Hip Rotation ---
    const startHipAngle = this._getAngle(
      startFrame.landmarks[L.LEFT_KNEE],
      startFrame.landmarks[L.LEFT_HIP],
      startFrame.landmarks[L.RIGHT_HIP]
    );
    const midHipAngle = this._getAngle(
      midFrame.landmarks[L.LEFT_KNEE],
      midFrame.landmarks[L.LEFT_HIP],
      midFrame.landmarks[L.RIGHT_HIP]
    );
    const hipRotation = Math.abs(midHipAngle - startHipAngle);
    metrics.hipRotation = {
      value: Math.round(hipRotation),
      unit: '°',
      rating: hipRotation > 35 ? 'good' : hipRotation > 20 ? 'warning' : 'needs-work',
      detail:
        hipRotation > 35
          ? 'Good hip turn'
          : hipRotation > 20
          ? 'Moderate hip rotation'
          : 'Hips are too static - engage your lower body more',
    };

    // --- Spine Angle (tilt) ---
    const shoulderMid = this._getMidpoint(
      startFrame.landmarks[L.LEFT_SHOULDER],
      startFrame.landmarks[L.RIGHT_SHOULDER]
    );
    const hipMid = this._getMidpoint(
      startFrame.landmarks[L.LEFT_HIP],
      startFrame.landmarks[L.RIGHT_HIP]
    );
    const spineAngle =
      Math.abs(Math.atan2(shoulderMid.y - hipMid.y, shoulderMid.x - hipMid.x) * (180 / Math.PI));
    const spineFromVertical = Math.abs(90 - spineAngle);
    metrics.spineAngle = {
      value: Math.round(spineFromVertical),
      unit: '°',
      rating:
        spineFromVertical > 15 && spineFromVertical < 40
          ? 'good'
          : spineFromVertical >= 10 && spineFromVertical <= 50
          ? 'warning'
          : 'needs-work',
      detail:
        spineFromVertical > 15 && spineFromVertical < 40
          ? 'Good spine tilt at address'
          : 'Adjust your spine angle - aim for 20-35° forward tilt',
    };

    // --- Knee Flex ---
    const kneeAngle = this._getAngle(
      startFrame.landmarks[L.LEFT_HIP],
      startFrame.landmarks[L.LEFT_KNEE],
      startFrame.landmarks[L.LEFT_ANKLE]
    );
    const kneeFlex = 180 - kneeAngle;
    metrics.kneeFlex = {
      value: Math.round(kneeFlex),
      unit: '°',
      rating: kneeFlex > 15 && kneeFlex < 40 ? 'good' : kneeFlex >= 10 ? 'warning' : 'needs-work',
      detail:
        kneeFlex > 15 && kneeFlex < 40
          ? 'Good knee flex'
          : kneeFlex < 15
          ? 'Knees too straight - add more flex'
          : 'Too much knee bend - stand a bit taller',
    };

    // --- Head Movement (stability) ---
    const headPositions = this.frames.map((f) => f.landmarks[L.NOSE]);
    let maxHeadDrift = 0;
    const refHead = headPositions[0];
    headPositions.forEach((h) => {
      const drift = this._getDistance(refHead, h);
      if (drift > maxHeadDrift) maxHeadDrift = drift;
    });
    metrics.headMovement = {
      value: maxHeadDrift < 0.03 ? 'Stable' : maxHeadDrift < 0.06 ? 'Slight' : 'Excessive',
      unit: '',
      rating: maxHeadDrift < 0.03 ? 'good' : maxHeadDrift < 0.06 ? 'warning' : 'needs-work',
      detail:
        maxHeadDrift < 0.03
          ? 'Excellent head stability!'
          : maxHeadDrift < 0.06
          ? 'Minor head movement detected'
          : 'Too much head movement - focus on keeping your head still',
    };

    // --- Weight Transfer ---
    const startLeftHip = startFrame.landmarks[L.LEFT_HIP];
    const startRightHip = startFrame.landmarks[L.RIGHT_HIP];
    const endLeftHip = endFrame.landmarks[L.LEFT_HIP];
    const endRightHip = endFrame.landmarks[L.RIGHT_HIP];
    const startCenter = (startLeftHip.x + startRightHip.x) / 2;
    const endCenter = (endLeftHip.x + endRightHip.x) / 2;
    const weightShift = Math.abs(endCenter - startCenter);
    metrics.weightTransfer = {
      value: weightShift > 0.04 ? 'Good' : weightShift > 0.02 ? 'Partial' : 'Minimal',
      unit: '',
      rating: weightShift > 0.04 ? 'good' : weightShift > 0.02 ? 'warning' : 'needs-work',
      detail:
        weightShift > 0.04
          ? 'Good weight transfer through the swing'
          : weightShift > 0.02
          ? 'Some weight transfer - try to shift more to your front foot'
          : 'Very little weight transfer detected - practice shifting weight',
    };

    return metrics;
  }

  _generateCritique(metrics, phases) {
    const sections = [];

    // What's good
    const goodPoints = [];
    const improvePoints = [];
    const criticalPoints = [];

    Object.entries(metrics).forEach(([key, m]) => {
      if (m.rating === 'good') goodPoints.push(m.detail);
      else if (m.rating === 'warning') improvePoints.push(m.detail);
      else criticalPoints.push(m.detail);
    });

    if (goodPoints.length > 0) {
      sections.push({
        type: 'good',
        title: 'What You\'re Doing Well',
        points: goodPoints,
      });
    }

    if (improvePoints.length > 0) {
      sections.push({
        type: 'improve',
        title: 'Areas to Improve',
        points: improvePoints,
      });
    }

    if (criticalPoints.length > 0) {
      sections.push({
        type: 'critical',
        title: 'Key Issues to Address',
        points: criticalPoints,
      });
    }

    // Phase-based feedback
    if (!phases.address) {
      improvePoints.push(
        'Could not clearly detect your address position. Make sure to stand still briefly before swinging.'
      );
    }
    if (!phases['follow-through']) {
      improvePoints.push(
        'Follow-through seems incomplete. Focus on finishing your swing with your belt buckle facing the target.'
      );
    }

    return sections;
  }

  _generateTips(metrics, phases) {
    const tips = [];

    if (metrics.shoulderRotation.rating !== 'good') {
      tips.push({
        title: 'Shoulder Turn Drill',
        description:
          'Hold a club across your shoulders and practice turning back until the club points at the ball. Feel the stretch in your back muscles. Aim for 90° of shoulder rotation.',
      });
    }

    if (metrics.hipRotation.rating !== 'good') {
      tips.push({
        title: 'Hip Engagement Drill',
        description:
          'Place a chair against your lead hip at address. On the backswing, your trail hip should turn away from the chair. On the downswing, bump the chair with your lead hip to start the sequence.',
      });
    }

    if (metrics.headMovement.rating !== 'good') {
      tips.push({
        title: 'Head Stability Drill',
        description:
          'Have a friend hold a club head gently on top of your head while you make slow swings. Your head should stay in contact. This trains you to rotate around a fixed point.',
      });
    }

    if (metrics.weightTransfer.rating !== 'good') {
      tips.push({
        title: 'Step Drill for Weight Transfer',
        description:
          'Take your normal stance, then on the downswing, actually step your lead foot toward the target before striking. This exaggerates the feel of proper weight transfer.',
      });
    }

    if (metrics.spineAngle.rating !== 'good') {
      tips.push({
        title: 'Spine Angle Practice',
        description:
          'Stand with your back against a wall, then bend forward from your hips (not your waist) until you feel athletic. Your rear should stay on the wall. This is your ideal spine angle.',
      });
    }

    if (metrics.kneeFlex.rating !== 'good') {
      tips.push({
        title: 'Athletic Stance Drill',
        description:
          'Stand with feet shoulder-width apart, flex your knees slightly as if sitting on a bar stool, and let your arms hang naturally. This is your ideal knee flex for a consistent swing.',
      });
    }

    // Always include a general tip
    tips.push({
      title: 'Tempo Training',
      description:
        'Count "1" on the backswing and "2" on the downswing. A good swing tempo ratio is about 3:1 (backswing takes 3x longer than downswing). Use a metronome app set to 72 BPM for practice.',
    });

    return tips;
  }

  _calculateScore(metrics) {
    let score = 50; // Base score
    const ratings = Object.values(metrics).map((m) => m.rating);
    ratings.forEach((r) => {
      if (r === 'good') score += 8;
      else if (r === 'warning') score += 3;
      else score -= 2;
    });
    return Math.min(100, Math.max(0, score));
  }

  // Draw pose on canvas
  drawPose(results, canvasCtx, canvasWidth, canvasHeight) {
    canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (!results.poseLandmarks) return;

    // Draw connections
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

    // Draw landmarks
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
