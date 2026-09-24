// SKCT AI Auto Solver - Standalone Smartphone PWA App
document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("camera");
  const hiddenCanvas = document.getElementById("hidden-canvas");
  const statusPill = document.getElementById("status-pill");
  const stabilityBar = document.getElementById("stability-bar");
  const viewfinder = document.getElementById("viewfinder");
  
  // Results
  const resultOverlay = document.getElementById("result-overlay");
  const resultAnswer = document.getElementById("result-answer");
  const resultReason = document.getElementById("result-reason");
  const viewDetailBtn = document.getElementById("view-detail-btn");
  
  // Detail Modal
  const detailModal = document.getElementById("detail-modal");
  const closeDetailBtn = document.getElementById("close-detail-btn");
  const closeDetailActionBtn = document.getElementById("close-detail-action-btn");
  const modalAnsBadge = document.getElementById("modal-ans-badge");
  const modalModelBadge = document.getElementById("modal-model-badge");
  const modalReasonText = document.getElementById("modal-reason-text");
  const modalDetailText = document.getElementById("modal-detail-text");

  // Settings Modal
  const settingsModal = document.getElementById("settings-modal");
  const settingsBtn = document.getElementById("settings-btn");
  const closeSettingsBtn = document.getElementById("close-settings-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const apiKeyInput = document.getElementById("api-key-input");
  const modelSelect = document.getElementById("model-select");
  const sensitivitySlider = document.getElementById("sensitivity-slider");
  const sensitivityVal = document.getElementById("sensitivity-val");

  const aspectBtn = document.getElementById("aspect-btn");
  const aspectLabel = document.getElementById("aspect-label");
  const manualSnapBtn = document.getElementById("manual-snap-btn");
  const installAppBtn = document.getElementById("install-app-btn");
  const toast = document.getElementById("toast");

  // State variables
  let stream = null;
  let isAnalyzing = false;
  let isResultShowing = false;
  let currentModel = localStorage.getItem("skct_model") || "gemini-2.0-flash";
  let currentAspectIdx = 0; // 0: standard, 1: wide, 2: tall
  const aspectClasses = ["aspect-standard", "aspect-wide", "aspect-tall"];
  const aspectNames = ["표준", "가로형", "세로형"];

  let lastSolvedData = null;
  let wakeLock = null;
  let deferredInstallPrompt = null;

  // Stability detection variables
  const sampleWidth = 64;
  const sampleHeight = 48;
  let prevFrameData = null;
  let stableCount = 0;
  const requiredStableChecks = 7; // ~1.0s (at 150ms intervals)
  let sensitivityThreshold = 14;
  let stabilityInterval = null;

  // Load Saved Settings
  const savedKey = localStorage.getItem("gemini_api_key") || "";
  apiKeyInput.value = savedKey;

  const savedSens = localStorage.getItem("sensitivity") || "14";
  sensitivitySlider.value = savedSens;
  sensitivityThreshold = parseInt(savedSens, 10);
  updateSensitivityLabel(sensitivityThreshold);

  modelSelect.value = currentModel;

  // Prompt for API key if missing
  if (!savedKey) {
    setTimeout(showSettings, 600);
  }

  // Register PWA Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }

  // PWA Install prompt handling
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installAppBtn) installAppBtn.classList.remove("hidden");
  });

  if (installAppBtn) {
    installAppBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === "accepted") {
          installAppBtn.classList.add("hidden");
          showToast("📲 홈 화면에 앱이 설치되었습니다!");
        }
        deferredInstallPrompt = null;
      }
    });
  }

  // Keep screen on while using camera (WakeLock API)
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (_) {}
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestWakeLock();
  });
  requestWakeLock();

  // Toast Helper
  let toastTimer = null;
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.remove("hidden");
    toastTimer = setTimeout(() => {
      toast.classList.add("hidden");
    }, 2200);
  }

  // Aspect ratio toggle
  aspectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    currentAspectIdx = (currentAspectIdx + 1) % 3;
    viewfinder.className = aspectClasses[currentAspectIdx];
    aspectLabel.textContent = aspectNames[currentAspectIdx];
    showToast(`박스 비율: ${aspectNames[currentAspectIdx]}`);
  });

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
      statusPill.textContent = "카메라 권한 필요";
      alert("카메라 권한을 허용해주세요. 주소창 자물쇠 아이콘을 눌러 카메라 권한을 켤 수 있습니다.");
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
      const step = 4; // RGBA
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
        stableCount = 0;
        stabilityBar.style.width = "0%";
        statusPill.textContent = "문제를 비추고 멈추세요";
      }
    }, 150);
  }

  // Trigger Automatic Image Capture & Direct AI Solve
  async function triggerCapture() {
    if (isAnalyzing || isResultShowing) return;
    
    const apiKey = localStorage.getItem("gemini_api_key") || "";
    if (!apiKey) {
      showToast("우측 상단 ⚙️ 설정에서 API 키를 먼저 입력해주세요.");
      showSettings();
      return;
    }

    isAnalyzing = true;
    stableCount = 0;
    stabilityBar.style.width = "100%";
    statusPill.textContent = "⚡ AI 영역 자동 판별 및 풀이 중...";

    if (navigator.vibrate) navigator.vibrate(50);

    try {
      const base64Data = captureViewfinderImageOnlyData();
      const result = await solveWithGeminiDirect(base64Data, apiKey, currentModel);
      lastSolvedData = result;
      showAnswer(result);
    } catch (err) {
      console.error(err);
      statusPill.textContent = "오류 발생! 1초 후 재시도";
      alert("AI 풀이 오류: " + err.message);
      setTimeout(() => {
        isAnalyzing = false;
        statusPill.textContent = "문제를 비추고 멈추세요";
      }, 1500);
    }
  }

  // Crop viewfinder area
  function captureViewfinderImageOnlyData() {
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    const containerW = video.clientWidth;
    const containerH = video.clientHeight;

    const vfRect = viewfinder.getBoundingClientRect();

    const scaleX = videoW / containerW;
    const scaleY = videoH / containerH;

    const cropX = Math.max(0, vfRect.left * scaleX);
    const cropY = Math.max(0, vfRect.top * scaleY);
    const cropW = Math.min(videoW - cropX, vfRect.width * scaleX);
    const cropH = Math.min(videoH - cropY, vfRect.height * scaleY);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");

    cropCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const dataUrl = cropCanvas.toDataURL("image/jpeg", 0.90);
    return dataUrl.split(",")[1]; // Return raw base64 data
  }

  // Client-side Direct Call to Google Gemini REST API
  async function solveWithGeminiDirect(base64Image, apiKey, modelName) {
    const systemPrompt = (
      "당신은 대한민국 최고 수준의 인적성(SKCT) 전 영역 초고속 실전 문제 풀이 전문가입니다.\n"
      "제공된 문제 이미지를 보는 즉시 스스로 문제의 영역(창의수리, 수열추리, 자료해석, 언어추리/명제, 언어이해 등)을 '자동 판별'하고, "
      "해당 영역의 최적 공식을 적용하여 100% 신뢰도의 정답 번호와 핵심 근거를 도출하세요.\n\n"
      "[영역별 자동 적용 전략]\n"
      "- 수열추리: 계차(등차/등비), 군수열(2/3개 묶음), 피보나치, 교대/건너뛰기 규칙 즉시 파악\n"
      "- 창의수리: 소금물, 거속시, 일률, 원가·정가, 확률·경우의 수, 방정식 수립 및 빠른 계산\n"
      "- 자료해석: 표/그래프의 행·열 단위, 각주(※) 필수 반영, 가평균 십자곱셈으로 분수 대소 비교 및 증감률 판별\n"
      "- 언어추리/명제: 대우명제(~q -> ~p), 삼단논법, 조건추리 속성 매칭(표 배치), 진실게임 모순 검증\n"
      "- 언어이해: 지문 핵심 주제, 사실 일치/불일치, 빈칸 어휘 문맥 추론\n\n"
      "[출력 규격 - 사족 없이 엄수]\n"
      "1행: 정답: [1~5]번 ([①~⑤])  (예: '정답: 4번 (④)')\n"
      "2행: [자동판별영역] 수험생이 1초 만에 납득할 수 있는 결정적 1줄 풀이/근거 (예: '[수열추리] 계차 +3, +6, +12 등비 규칙' 또는 '[자료해석] 2023년 증가율이 35%로 가장 높음')\n"
      "3행: [상세풀이] 단계별 풀이 요약\n\n"
      "인사말이나 불필요한 서론/결론 문장을 일절 포함하지 마세요."
    );

    const payload = {
      contents: [
        {
          parts: [
            { text: systemPrompt },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 450
      }
    };

    const modelsToTry = [modelName || "gemini-2.0-flash", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
    const uniqueModels = [...new Set(modelsToTry)];
    let lastError = null;

    for (const m of uniqueModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const resJson = await response.json();
          const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const parsed = parseClientAnswer(text);
          parsed.used_model = m;
          return parsed;
        } else {
          const errData = await response.json().catch(() => ({}));
          lastError = errData.error?.message || `HTTP ${response.status}`;
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    throw new Error(lastError || "Gemini API 응답 실패");
  }

  // Client answer parser
  function parseClientAnswer(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return { answer: "?", number: "?", reason: "인식 실패", detail: "", raw: text };

    const firstLine = lines[0];
    let reason = "";
    const detailLines = [];

    for (const line of lines.slice(1)) {
      if (line.startsWith("[상세풀이]") || line.startsWith("상세:")) {
        detailLines.push(line.replace("[상세풀이]", "").replace("상세:", "").trim());
      } else {
        if (!reason) reason = line;
        else detailLines.push(line);
      }
    }

    const circledMap = { "①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5" };
    for (const [c, n] of Object.entries(circledMap)) {
      if (firstLine.includes(c)) {
        return { answer: `${n}번 (${c})`, number: n, reason, detail: detailLines.join("\n"), raw: text };
      }
    }

    const match = firstLine.match(/([1-5])\s*번/) || firstLine.match(/정답\s*[:：]?\s*([1-5])/) || firstLine.match(/([1-5])/);
    if (match) {
      const num = match[1];
      const reverseMap = { "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤" };
      const c = reverseMap[num] || "";
      return { answer: c ? `${num}번 (${c})` : `${num}번`, number: num, reason, detail: detailLines.join("\n"), raw: text };
    }

    return { answer: firstLine.slice(0, 15), number: "?", reason, detail: detailLines.join("\n"), raw: text };
  }

  // Extract number for color
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

    resultOverlay.className = "";

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
    detailModal.classList.add("hidden");
    isResultShowing = false;
    isAnalyzing = false;
    stableCount = 0;
    stabilityBar.style.width = "0%";
    statusPill.textContent = "문제를 비추고 멈추세요";

    if (navigator.vibrate) navigator.vibrate(30);
  }

  // Bind click on result overlay for one-touch reset
  resultOverlay.addEventListener("click", resetToScan);

  // Detail Modal Actions
  viewDetailBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!lastSolvedData) return;
    
    modalAnsBadge.textContent = lastSolvedData.answer || "정답";
    modalModelBadge.textContent = lastSolvedData.used_model || currentModel;
    modalReasonText.textContent = lastSolvedData.reason || "핵심 근거 없음";
    modalDetailText.textContent = lastSolvedData.detail || "상세 풀이 과정이 생성되지 않았습니다.";

    detailModal.classList.remove("hidden");
  });

  closeDetailBtn.addEventListener("click", () => {
    detailModal.classList.add("hidden");
  });

  closeDetailActionBtn.addEventListener("click", () => {
    resetToScan();
  });

  // Manual snap button
  manualSnapBtn.addEventListener("click", (e) => {
    e.stopPropagation();
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

  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showSettings();
  });
  closeSettingsBtn.addEventListener("click", hideSettings);

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
    const selModel = modelSelect.value;
    currentModel = selModel;
    localStorage.setItem("skct_model", selModel);

    if (key) {
      localStorage.setItem("gemini_api_key", key);
    }

    localStorage.setItem("sensitivity", sensitivitySlider.value);
    showToast("⚙️ 설정이 안전하게 저장되었습니다.");
    hideSettings();
  });

  // Start app
  initCamera();
});
