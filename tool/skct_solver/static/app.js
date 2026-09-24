// SKCT AI Auto Solver - Fullscreen 100% & Smart Quota Guard v5
document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("camera");
  const hiddenCanvas = document.getElementById("hidden-canvas");
  const statusPill = document.getElementById("status-pill");
  const stabilityBar = document.getElementById("stability-bar");
  const startCamPrompt = document.getElementById("start-cam-prompt");
  const startCamBtn = document.getElementById("start-cam-btn");
  
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

  const modeToggleBtn = document.getElementById("mode-toggle-btn");
  const modeLabel = document.getElementById("mode-label");
  const manualSnapBtn = document.getElementById("manual-snap-btn");
  const installAppBtn = document.getElementById("install-app-btn");
  const toast = document.getElementById("toast");

  // Global Settings Controls
  window.openSettingsModal = function(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    settingsModal.classList.remove("hidden");
  };
  window.closeSettingsModal = function(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    settingsModal.classList.add("hidden");
  };

  // State variables
  let stream = null;
  let isAnalyzing = false;
  let isResultShowing = false;
  let isCooldown = false;
  let isAutoMode = localStorage.getItem("skct_mode") !== "manual"; // Default: true (Auto)
  let currentModel = localStorage.getItem("skct_model") || "gemini-2.0-flash";

  let lastSolvedData = null;
  let wakeLock = null;
  let deferredInstallPrompt = null;

  // Stability detection variables (150ms intervals)
  const sampleWidth = 64;
  const sampleHeight = 48;
  let prevFrameData = null;
  let stableCount = 0;
  const requiredStableChecks = 9; // ~1.35s stillness required (prevents rapid firing)
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
  updateModeUI();

  // Mode Toggle (Auto / Manual)
  modeToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    isAutoMode = !isAutoMode;
    localStorage.setItem("skct_mode", isAutoMode ? "auto" : "manual");
    updateModeUI();
    showToast(isAutoMode ? "⚡ 자동 감지 모드: 1.3초 멈추면 풀이" : "📸 수동 셔터 모드: 셔터 버튼 누르면 풀이");
  });

  function updateModeUI() {
    if (isAutoMode) {
      modeLabel.textContent = "자동";
      modeToggleBtn.style.color = "#00ff88";
      modeToggleBtn.style.borderColor = "rgba(0, 255, 136, 0.4)";
      manualSnapBtn.textContent = "📸 셔터 (수동)";
    } else {
      modeLabel.textContent = "수동";
      modeToggleBtn.style.color = "#ffbb00";
      modeToggleBtn.style.borderColor = "rgba(255, 187, 0, 0.5)";
      manualSnapBtn.textContent = "📸 지금 풀기";
      stabilityBar.style.width = "0%";
      statusPill.textContent = "문제를 비추고 [📸 지금 풀기]를 누르세요";
    }
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

  // WakeLock: Keep screen on
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
    }, 2500);
  }

  // Multi-tier Fallback Camera Initialization
  async function initCamera() {
    if (stream) return;

    statusPill.textContent = "📷 카메라 권한 연결 중...";

    const constraintTiers = [
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      },
      {
        video: {
          facingMode: "environment"
        },
        audio: false
      },
      {
        video: true,
        audio: false
      }
    ];

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusPill.textContent = "⚠️ 카메라 미지원 브라우저";
      alert("현재 브라우저에서는 카메라 접근이 지원되지 않습니다. Chrome 또는 Safari로 접속해주세요.");
      return;
    }

    let lastCameraError = null;

    for (const constraints of constraintTiers) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.setAttribute("muted", "true");
        video.setAttribute("autoplay", "true");
        await video.play();

        if (startCamPrompt) startCamPrompt.classList.add("hidden");
        
        if (savedKey) {
          statusPill.textContent = isAutoMode ? "문제를 화면에 비추고 멈추세요" : "문제를 비추고 [📸 지금 풀기]를 누르세요";
        } else {
          statusPill.textContent = "⚙️ 우측 상단에서 API 키를 입력하세요";
        }
        startStabilityDetection();
        return;
      } catch (err) {
        lastCameraError = err;
      }
    }

    console.error("Camera access failed all tiers:", lastCameraError);
    statusPill.textContent = "⚠️ 아래 버튼을 눌러 카메라를 켜세요";
    if (startCamPrompt) startCamPrompt.classList.remove("hidden");
  }

  if (startCamBtn) {
    startCamBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      initCamera();
    });
  }

  // Stability Detection Loop
  function startStabilityDetection() {
    if (stabilityInterval) clearInterval(stabilityInterval);
    
    hiddenCanvas.width = sampleWidth;
    hiddenCanvas.height = sampleHeight;
    const ctx = hiddenCanvas.getContext("2d", { willReadFrequently: true });

    stabilityInterval = setInterval(() => {
      // Don't auto-capture if manual mode, cooldown, analyzing, result showing, or camera not ready
      if (!isAutoMode || isCooldown || isAnalyzing || isResultShowing || !video.videoWidth) {
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
        if (localStorage.getItem("gemini_api_key")) {
          statusPill.textContent = "문제를 화면에 비추고 멈추세요";
        } else {
          statusPill.textContent = "⚙️ 우측 상단에서 API 키를 입력하세요";
        }
      }
    }, 150);
  }

  // Trigger Image Capture & Direct AI Solve
  async function triggerCapture() {
    if (isAnalyzing || isResultShowing || isCooldown) return;
    
    const apiKey = localStorage.getItem("gemini_api_key") || "";
    if (!apiKey) {
      showToast("우측 상단 ⚙️ 설정에서 API 키를 먼저 입력해주세요.");
      window.openSettingsModal();
      return;
    }

    isAnalyzing = true;
    stableCount = 0;
    stabilityBar.style.width = "100%";
    statusPill.textContent = "⚡ AI 영역 자동 판별 및 풀이 중...";

    if (navigator.vibrate) navigator.vibrate(50);

    try {
      const base64Data = captureFullscreenImageOnlyData();
      const result = await solveWithGeminiDirect(base64Data, apiKey, currentModel);
      lastSolvedData = result;
      showAnswer(result);
    } catch (err) {
      console.error(err);
      
      let userErrMsg = err.message || "";
      if (userErrMsg.includes("quota") || userErrMsg.includes("429") || userErrMsg.includes("ResourceExhausted")) {
        userErrMsg = "⏳ Google Gemini 무료 호출 한도(분당 15회)에 일시 도달했습니다.\n약 20초만 쉬었다가 다시 시도해 주세요.";
      }
      
      statusPill.textContent = "⚠️ 풀이 중단 (2초 후 리셋)";
      alert(userErrMsg);

      // Start 4-second cooldown to protect rate limits
      startCooldown(4000);
      setTimeout(() => {
        isAnalyzing = false;
        resetToScan();
      }, 2000);
    }
  }

  // Cooldown Manager (prevents API spamming)
  function startCooldown(durationMs = 3000) {
    isCooldown = true;
    setTimeout(() => {
      isCooldown = false;
    }, durationMs);
  }

  // 100% Fullscreen Camera Capture (가로/세로 박스 잘림 없이 화면 전체 통째로 캡처)
  function captureFullscreenImageOnlyData() {
    const videoW = video.videoWidth || 1280;
    const videoH = video.videoHeight || 720;

    // Optimal resizing (Max 1280px to save token quota and 2x speed)
    const maxDim = 1280;
    let targetW = videoW;
    let targetH = videoH;

    if (targetW > maxDim || targetH > maxDim) {
      if (targetW >= targetH) {
        targetH = Math.round((targetH * maxDim) / targetW);
        targetW = maxDim;
      } else {
        targetW = Math.round((targetW * maxDim) / targetH);
        targetH = maxDim;
      }
    }

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = targetW;
    cropCanvas.height = targetH;
    const cropCtx = cropCanvas.getContext("2d");

    // Capture entire frame 100%
    cropCtx.drawImage(video, 0, 0, videoW, videoH, 0, 0, targetW, targetH);
    const dataUrl = cropCanvas.toDataURL("image/jpeg", 0.85);
    return dataUrl.split(",")[1];
  }

  // Client-side Direct Call to Google Gemini REST API with Fallback Rotation
  async function solveWithGeminiDirect(base64Image, apiKey, modelName) {
    const systemPrompt = `당신은 대한민국 최고 수준의 인적성(SKCT) 전 영역 초고속 실전 문제 풀이 전문가입니다.
제공된 문제 이미지를 보는 즉시 스스로 문제의 영역(창의수리, 수열추리, 자료해석, 언어추리/명제, 언어이해 등)을 '자동 판별'하고, 해당 영역의 최적 공식을 적용하여 100% 신뢰도의 정답 번호와 핵심 근거를 도출하세요.

[영역별 자동 적용 전략]
- 수열추리: 계차(등차/등비), 군수열(2/3개 묶음), 피보나치, 교대/건너뛰기 규칙 즉시 파악
- 창의수리: 소금물, 거속시, 일률, 원가·정가, 확률·경우의 수, 방정식 수립 및 빠른 계산
- 자료해석: 표/그래프의 행·열 단위, 각주(※) 필수 반영, 가평균 십자곱셈으로 분수 대소 비교 및 증감률 판별
- 언어추리/명제: 대우명제(~q -> ~p), 삼단논법, 조건추리 속성 매칭(표 배치), 진실게임 모순 검증
- 언어이해: 지문 핵심 주제, 사실 일치/불일치, 빈칸 어휘 문맥 추론

[출력 규격 - 사족 없이 엄수]
1행: 정답: [1~5]번 ([①~⑤])  (예: '정답: 4번 (④)')
2행: [자동판별영역] 수험생이 1초 만에 납득할 수 있는 결정적 1줄 풀이/근거 (예: '[수열추리] 계차 +3, +6, +12 등비 규칙' 또는 '[자료해석] 2023년 증가율이 35%로 가장 높음')
3행: [상세풀이] 단계별 풀이 요약

인사말이나 불필요한 서론/결론 문장을 일절 포함하지 마세요.`;

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
        maxOutputTokens: 400
      }
    };

    // Priority model rotation (if 429 quota hits, automatically tries alternate model pool)
    const modelsToTry = [
      modelName || "gemini-2.0-flash",
      "gemini-1.5-flash", // Separate quota bucket from 2.0!
      "gemini-2.5-flash"
    ];
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
          const errMsg = errData.error?.message || `HTTP ${response.status}`;
          lastError = errMsg;
          console.warn(`Model ${m} failed (${response.status}): ${errMsg}, trying next fallback...`);
          // If it's not quota error (e.g. invalid API key), don't loop endlessly
          if (response.status === 400 && errMsg.includes("API_KEY_INVALID")) {
            throw new Error("유효하지 않은 API 키입니다. Google AI Studio에서 올바른 키를 입력해주세요.");
          }
        }
      } catch (e) {
        lastError = e.message;
        if (e.message.includes("유효하지 않은 API 키")) throw e;
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
      const reverseMap = { "1": "①", "2": "②", "3": "③", "4": "④", "⑤": "⑤" };
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
    if (!isResultShowing && !isAnalyzing) return;
    
    resultOverlay.className = "hidden";
    detailModal.classList.add("hidden");
    isResultShowing = false;
    isAnalyzing = false;
    stableCount = 0;
    stabilityBar.style.width = "0%";

    // Start 2.5s cooldown after closing result to prevent accidental instant re-trigger
    startCooldown(2500);

    statusPill.textContent = isAutoMode ? "문제를 화면에 비추고 멈추세요" : "문제를 비추고 [📸 지금 풀기]를 누르세요";

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

  // Manual snap button (Always functional)
  manualSnapBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!isAnalyzing && !isResultShowing) {
      triggerCapture();
    }
  });

  // Settings Modal Controls
  settingsBtn.addEventListener("click", window.openSettingsModal);
  closeSettingsBtn.addEventListener("click", window.closeSettingsModal);

  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      window.closeSettingsModal();
    }
  });
  detailModal.addEventListener("click", (e) => {
    if (e.target === detailModal) {
      detailModal.classList.add("hidden");
    }
  });

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

  saveSettingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const key = apiKeyInput.value.trim();
    const selModel = modelSelect.value;
    currentModel = selModel;
    localStorage.setItem("skct_model", selModel);

    if (key) {
      localStorage.setItem("gemini_api_key", key);
      showToast("⚙️ API 키가 안전하게 저장되었습니다!");
      if (stream) {
        statusPill.textContent = isAutoMode ? "문제를 화면에 비추고 멈추세요" : "문제를 비추고 [📸 지금 풀기]를 누르세요";
      }
    }

    localStorage.setItem("sensitivity", sensitivitySlider.value);
    window.closeSettingsModal();
  });

  // Start Camera
  initCamera();
});
