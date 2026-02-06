# Golf Swing Analyzer

AI-powered golf swing analyzer that uses your camera and pose detection to critique your golf swing and help you improve.

## Features

- **Live Camera Feed** - Film yourself directly from your browser
- **Pose Detection** - Real-time body tracking using MediaPipe Pose
- **Swing Phase Detection** - Identifies Address, Backswing, Top, Downswing, Impact, and Follow-Through
- **Key Metrics** - Measures shoulder rotation, hip rotation, spine angle, knee flex, head stability, and weight transfer
- **AI Critique** - Categorized feedback on what you're doing well and what needs work
- **Practice Drills** - Targeted drill suggestions based on your specific areas for improvement
- **Video Upload** - Alternatively upload a pre-recorded swing video
- **Swing Score** - Overall score out of 100

## Quick Start

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

## How to Use

1. Click **Start Camera** and allow camera access
2. Position yourself so your full body is visible (head to feet)
3. Click **Record Swing** - you'll get a 3-2-1 countdown
4. Perform your golf swing (recording auto-stops after 15 seconds)
5. Click **Analyze My Swing** to get your feedback

## Tips for Best Results

- Stand **8-10 feet** from the camera
- Use **good lighting** (face a window or light source)
- Film from a **face-on** or **down-the-line** angle
- Wear **fitted clothing** so the pose tracker can see your body
- Make sure your **full body** is in frame

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Pose Detection**: MediaPipe Pose (runs in-browser)
- **Server**: Node.js + Express
- **Recording**: MediaRecorder API (WebM)
