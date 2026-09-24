// SKCT Auto Solver Client Application
document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("camera");
  const hiddenCanvas = document.getElementById("hidden-canvas");
  const statusPill = document.getElementById("status-pill");
  const stabilityBar = document.getElementById("stability-bar");
  const viewfinder = document.getElementById("viewfinder");
  
  const resultOverlay = document.getElementById("result-overlay");
  const resultAnswer = document.getElementById("result-answer");
  const resultReason = document.getElementById("result-reason");
  
  const settingsModal = document.getElementById("settings-modal");
  const settingsBtn = document.getElementById("settings-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const apiKeyInput = document.getElementById("api-key-input");
  const sensitivitySlider = document.getElementById("sensitivity-slider");
  const sensitivityVal = document.getElementById("sensitivity-val");
  const manualSnapBtn = document.getElementById("manual-snap-btn");

  let stream = null;
  let isAnalyzing = false;
  let isResultShowing = false;
  
  // Stability detection variables
  const sampleWidth = 64;
  const sampleHeight = 48;
  let prevFrameData = null;
  let stableCount = 0;
  const requiredStableChecks = 7; // ~1.0s (at 150ms intervals)
  let sensitivityThreshold = 14;  // lower = stricter stillness required
  let stabilityInterval = null;

  // Load saved config
  const savedKey = localStorage.getItem("gemini_api_key") || "";
  apiKeyInput.value = savedKey;

  const savedSens = localStorage.getItem("sensitivity") || "14";
  sensitivitySlider.value = savedSens;
  sensitivityThreshold = parseInt(savedSens, 10);
  updateSensitivityLabel(sensitivityThreshold);

  // Check server configuration
  fetch("/api/ip")
    .then(res => res.json())
    .then(data => {
      if (!data.has_gemini_key && !savedKey) {
        showSettings();
      }
    })
    .catch(() => {});

  // Initialize Camera
  async function initCamera() {
    try {
      statusPill.textContent = "카메라 시작 중...";
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();

      statusPill.textContent = "문제를 박스 안에 맞추세요";
      startStabilityDetection();
    } catch (err) {
      console.error("Camera access error:", err);
      statusPill.textContent = "카메라 권한을 허용해주세요.";
      alert("카메라에 접근할 수 없습니다. 브라우저 설정에서 카메라 권한을 확인해주세요.");
    }
  }

  // Start Stability Detection Loop
  function startStabilityDetection() {
    if (stabilityInterval) clearInterval(stabilityInterval);
    
    hiddenCanvas.width = sampleWidth;
    hiddenCanvas.height = sampleHeight;
    const ctx = hiddenCanvas.getContext("2d", { willReadFrequently: true });

    stabilityInterval = setInterval(() => {
      if (isAnalyzing || isResultShowing || !video.videoWidth) {
        return;
      }

      ctx.drawImage(video, 0, 0, sampleWidth, sampleHeight);
      const frameData = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;

      if (!prevFrameData) {
        prevFrameData = frameData;
        return;
      }

      // Compute mean pixel difference (motion level)
      let totalDiff = 0;
      const step = 4; // Check every pixel (RGBA)
      const numPixels = (sampleWidth * sampleHeight);

      for (let i = 0; i < frameData.length; i += step) {
        const rDiff = Math.abs(frameData[i] - prevFrameData[i]);
        const gDiff = Math.abs(frameData[i+1] - prevFrameData[i+1]);
        const bDiff = Math.abs(frameData[i+2] - prevFrameData[i+2]);
        totalDiff += (rDiff + gDiff + bDiff) / 3;
      }

      const avgDiff = totalDiff / numPixels;
      prevFrameData = frameData;

      // Check if phone is holding still
      if (avgDiff < sensitivityThreshold) {
        stableCount++;
        const progress = Math.min(100, Math.round((stableCount / requiredStableChecks) * 100));
        stabilityBar.style.width = `${progress}%`;
        statusPill.textContent = `화면 고정 중... (${progress}%)`;

        if (stableCount >= requiredStableChecks) {
          triggerCapture();
        }
      } else {
        // Motion detected -> reset stability
        stableCount = 0;
        stabilityBar.style.width = "0%";
        statusPill.textContent = "문제를 비추고 멈추세요";
      }
    }, 150);
  }

  // Trigger Automatic Image Capture & AI Solve
  async function triggerCapture() {
    if (isAnalyzing || isResultShowing) return;
    isAnalyzing = true;
    stableCount = 0;
    stabilityBar.style.width = "100%";
    statusPill.textContent = "⚡ AI 문제 분석 중...";

    // Haptic feedback if supported
    if (navigator.vibrate) navigator.vibrate(50);

    try {
      const imageData = captureViewfinderImage();
      const apiKey = localStorage.getItem("gemini_api_key") || "";

      const response = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData, api_key: apiKey })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "문제 풀이 요청 실패");
      }

      showAnswer(data);
    } catch (err) {
      console.error(err);
      statusPill.textContent = "오류 발생! 1초 후 재시도";
      alert(err.message);
      setTimeout(() => {
        isAnalyzing = false;
        statusPill.textContent = "문제를 비추고 멈추세요";
      }, 1500);
    }
  }

  // Crop only the viewfinder bounding box for maximum AI focus
  function captureViewfinderImage() {
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    const containerW = video.clientWidth;
    const containerH = video.clientHeight;

    // Viewfinder rect relative to screen
    const vfRect = viewfinder.getBoundingClientRect();

    // Scale factors between video stream and displayed element
    const scaleX = videoW / containerW;
    const scaleY = videoH / containerH;

    // Viewfinder coords on actual video frame
    const cropX = Math.max(0, vfRect.left * scaleX);
    const cropY = Math.max(0, vfRect.top * scaleY);
    const cropW = Math.min(videoW - cropX, vfRect.width * scaleX);
    const cropH = Math.min(videoH - cropY, vfRect.height * scaleY);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");

    cropCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return cropCanvas.toDataURL("image/jpeg", 0.90);
  }

  // Helper to extract answer number
  function extractNumber(data) {
    if (data.number && ["1", "2", "3", "4", "5"].includes(String(data.number))) {
      return String(data.number);
    }
    const text = (data.answer || "") + " " + (data.raw || "");
    const circled = { "①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5" };
    for (const [c, n] of Object.entries(circled)) {
      if (text.includes(c)) return n;
    }
    const match = text.match(/([1-5])\s*번/) || text.match(/([1-5])/);
    return match ? match[1] : "4";
  }

  // Show Huge Answer Overlay with Vivid Colors
  function showAnswer(data) {
    isAnalyzing = false;
    isResultShowing = true;

    // Reset previous color classes
    resultOverlay.className = "";

    // Apply vivid color class based on number
    // 1: Red, 2: Orange, 3: Yellow, 4: Green, 5: Blue
    const num = extractNumber(data);
    resultOverlay.classList.add(`ans-color-${num}`);

    resultAnswer.textContent = data.answer || `${num}번`;
    resultReason.textContent = data.reason || "";

    resultOverlay.classList.remove("hidden");

    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  }

  // One-touch reset to scan next question
  function resetToScan() {
    if (!isResultShowing) return;
    
    resultOverlay.className = "hidden";
    isResultShowing = false;
    isAnalyzing = false;
    stableCount = 0;
    stabilityBar.style.width = "0%";
    statusPill.textContent = "문제를 비추고 멈추세요";

    if (navigator.vibrate) navigator.vibrate(30);
  }

  // Bind full-screen touch event on result overlay
  resultOverlay.addEventListener("click", resetToScan);
  resultOverlay.addEventListener("touchstart", (e) => {
    e.preventDefault();
    resetToScan();
  }, { passive: false });

  // Manual snap button
  manualSnapBtn.addEventListener("click", () => {
    if (!isAnalyzing && !isResultShowing) {
      triggerCapture();
    }
  });

  // Settings
  function showSettings() {
    settingsModal.classList.remove("hidden");
  }
  function hideSettings() {
    settingsModal.classList.add("hidden");
  }

  settingsBtn.addEventListener("click", showSettings);

  sensitivitySlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    sensitivityThreshold = val;
    updateSensitivityLabel(val);
  });

  function updateSensitivityLabel(val) {
    if (val < 10) sensitivityVal.textContent = `매우 민감 (${val}) - 완전 정지 필요`;
    else if (val <= 18) sensitivityVal.textContent = `보통 (${val}) - 추천 설정`;
    else sensitivityVal.textContent = `느슨함 (${val}) - 약간 흔들려도 인식`;
  }

  saveSettingsBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      localStorage.setItem("gemini_api_key", key);
      fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: key })
      }).catch(() => {});
    }

    localStorage.setItem("sensitivity", sensitivitySlider.value);
    hideSettings();
  });

  // Start app
  initCamera();
});
