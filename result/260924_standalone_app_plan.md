# [SKCT AI 실시간 문제 풀이 앱] 스마트폰 단독 설치형 PWA 앱 전환 계획서

- **작성일자**: 2026-09-24
- **작성자**: Antigravity
- **대상 프로젝트**: `skct-ai-solver`
- **핵심 목표**: PC 서버 없이 스마트폰 단독 구동, 브라우저 사설 SSL 차단(`about:blank`) 원천 해결, 홈 화면 설치형 네이티브 앱 구현

---

## 1. 전환 필요성 및 아키텍처 변화

| 구분 | 기존 로컬 PC 서버 방식 | 스마트폰 단독 PWA 앱 방식 |
| :--- | :--- | :--- |
| **PC 구동 필요 여부** | PC와 파이썬 서버 필수 | **PC 불필요 (스마트폰 단독 실행)** |
| **네트워크 제약** | 동일 Wi-Fi 공유기 필수 | **어디서든 가능 (LTE, 5G, Wi-Fi)** |
| **SSL 보안 이슈** | 사설 인증서로 모바일 차단(`about:blank`) | **구글 공인 SSL 인증서 (100% 무에러)** |
| **실행 형태** | 브라우저 주소창 노출 | **바탕화면 앱 아이콘 + 100% 전체화면** |
| **화면 꺼짐 방지** | 지원 불가 (폰 꺼짐) | **WakeLock API로 문제 풀이 중 화면 유지** |
| **AI 호출 경로** | 폰 $\to$ PC 서버 $\to$ Gemini API | **폰 $\to$ Gemini API 직접 초고속 호출** |

---

## 2. 세부 구현 계획

### [단계 1] 클라이언트 사이드 Gemini 비전 AI 직접 호출 모듈 구현
- 백엔드 중계 없이 브라우저/앱 자체에서 `fetch()`로 Google Gemini 2.0 Flash REST API 직접 통신
- AI 자체 영역 자동 판별 프롬프트 주입
- 초대형 정답 번호 및 번호별 전면 비비드 컬러(1~5번) 렌더링 유지

### [단계 2] PWA (Progressive Web App) 규격 완비
- `manifest.json`: 앱 이름, 시작 URL, `standalone` 디스플레이, 네온 스타일 앱 아이콘 정의
- `sw.js` (Service Worker): 오프라인 캐싱 및 모바일 앱 설치 트리거 지원
- `Screen Wake Lock API`: 카메라 분석 중 스마트폰 화면 절전 꺼짐 자동 방지
- iOS / Android 홈 화면 설치 배너 및 가이드 추가

### [단계 3] GitHub Pages 온라인 배포
- `richvayne13/skct-ai-solver` 리포지토리 루트에 앱 정적 파일 배치
- Git commit 및 GitHub 원격 push
- GitHub Pages 활성화 (`https://richvayne13.github.io/skct-ai-solver/`)

### [단계 4] 실물 스마트폰 접속 및 설치 검증
- 스마트폰 브라우저 접속 확인
- [홈 화면에 추가]를 통한 네이티브 앱 설치 검증
