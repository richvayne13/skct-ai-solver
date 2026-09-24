# ⚡ SKCT AI Auto Solver Mobile App

스마트폰 카메라로 인적성 문제를 비추면, 셔터 버튼을 누르지 않고도 **손의 흔들림 멈춤을 감지하여 자동으로 문제를 인식하고 Gemini 2.0 Flash 비전 AI로 초고속 풀이 후 초대형 정답 번호를 화면에 띄워주는** 모바일 웹앱입니다.

---

## 🌟 주요 기능
1. **무터치 자동 문제 캡처 (흔들림 멈춤 감지)**:
   - 문제를 가이드 박스(뷰파인더)에 맞추고 폰이 1초간 정지하면 셔터를 누르지 않아도 자동 캡처 & AI 분석 진행.
2. **뷰파인더 영역 고해상도 자동 크롭**:
   - 가이드 박스 안의 문제 영역만 크롭하여 AI로 전송하므로 정확도 및 인식률 극대화.
3. **초대형 정답 번호 표시**:
   - 정답 번호(예: `4번 (④)`)를 화면 가득 130px 크기의 네온 폰트로 표시.
4. **원터치 다음 문제 전환**:
   - 화면 아무 곳이나 가볍게 한 번 터치하면 즉시 다음 문제 감지 모드로 리셋.
5. **자체 서명 HTTPS SSL 인증서 내장**:
   - 모바일 브라우저의 카메라 보안 정책(HTTPS 필수)을 위해 자체 SSL 인증서를 자동 생성 및 서빙.

---

## 🚀 빠른 시작 (실행 방법)

### 1. 필수 요구사항
* Python 3.10+
* 동일한 Wi-Fi 공유기에 연결된 PC와 스마트폰

### 2. 패키지 설치
```bash
pip install fastapi uvicorn httpx python-dotenv pillow cryptography
```

### 3. 서버 실행
```bash
cd tool/skct_solver
# Windows
run.bat
# 또는 직접 실행
python server.py
```

### 4. 스마트폰으로 접속
1. 서버 콘솔에 표시되는 로컬 IP 주소로 스마트폰 브라우저(Chrome 추천)에서 접속:
   - 예: `https://<PC-내부-IP>:8443`
2. 사설 인증서 경고 화면에서 **[고급]** -> **[접속하기 / 안전하지 않음으로 이동]** 1회 클릭.
3. 우측 상단 ⚙️ 설정에서 [Google AI Studio](https://aistudio.google.com/app/apikey) 무료 Gemini API 키 입력.
4. 문제를 비추고 1초간 가만히 있으면 자동 풀이 시작!

---

## 📂 프로젝트 구조
```text
├── README.md
├── rules.md
├── .gitignore
├── context/
├── result/
│   ├── 260924_implementation_plan.md   # 초기 설계 계획서
│   └── 260924_result_report.md          # 상세 결과 보고서
└── tool/
    └── skct_solver/
        ├── run.bat                      # 원클릭 실행 스크립트
        ├── cert_generator.py            # HTTPS SSL 인증서 자동 생성기
        ├── server.py                    # FastAPI 백엔드 (Gemini 연동)
        └── static/                      # 모바일 웹 프론트엔드
            ├── index.html
            ├── style.css
            └── app.js
```
