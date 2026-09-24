import os
import re
import socket
import base64
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import uvicorn
from cert_generator import ensure_ssl_certificates

# Load .env
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(ENV_PATH)

app = FastAPI(title="SKCT Auto Solver")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SolveRequest(BaseModel):
    image: str # data:image/jpeg;base64,... or raw base64
    api_key: str = ""

class ConfigRequest(BaseModel):
    gemini_api_key: str

def get_gemini_key(user_key: str = "") -> str:
    if user_key and user_key.strip():
        return user_key.strip()
    key = os.getenv("GEMINI_API_KEY", "").strip()
    return key

def parse_answer(text: str):
    """
    Extracts the answer number (e.g., 1, 2, 3, 4, 5, or ①, ②, ③, ④, ⑤) and short reason.
    """
    lines = [line.strip() for line in text.strip().split("\n") if line.strip()]
    if not lines:
        return {"answer": "?", "reason": "인식 실패", "raw": text}
    
    first_line = lines[0]
    reason = lines[1] if len(lines) > 1 else ""
    
    # Check for circled numbers
    circled_map = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
    for c, n in circled_map.items():
        if c in first_line:
            return {"answer": f"{n}번 ({c})", "number": n, "reason": reason, "raw": text}
            
    # Check for digit numbers
    match = re.search(r'([1-5])\s*번', first_line)
    if not match:
        match = re.search(r'정답\s*[:：]?\s*([1-5])', first_line)
    if not match:
        match = re.search(r'([1-5])', first_line)
        
    if match:
        num = match.group(1)
        reverse_map = {"1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤"}
        c = reverse_map.get(num, "")
        return {"answer": f"{num}번 ({c})" if c else f"{num}번", "number": num, "reason": reason, "raw": text}
        
    return {"answer": first_line[:10], "number": "?", "reason": reason, "raw": text}

@app.get("/api/ip")
def get_server_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        ip = "127.0.0.1"
    has_key = bool(get_gemini_key())
    return {"ip": ip, "has_gemini_key": has_key}

@app.post("/api/config")
def set_config(req: ConfigRequest):
    key = req.gemini_api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API 키를 입력해주세요.")
    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.write(f"GEMINI_API_KEY={key}\n")
    os.environ["GEMINI_API_KEY"] = key
    return {"status": "success", "message": "Gemini API 키가 저장되었습니다."}

@app.post("/api/solve")
async def solve_problem(req: SolveRequest):
    api_key = get_gemini_key(req.api_key)
    if not api_key:
        raise HTTPException(
            status_code=400, 
            detail="Gemini API Key가 등록되지 않았습니다. 우측 상단 설정에서 API 키를 입력해주세요."
        )
    
    # Process base64 image
    img_data = req.image
    if "," in img_data:
        mime_type = img_data.split(",")[0].split(":")[1].split(";")[0]
        b64_data = img_data.split(",")[1]
    else:
        mime_type = "image/jpeg"
        b64_data = img_data

    system_instruction = (
        "당신은 대한민국 최고 수준의 인적성(SKCT, GSAT, NCS, LEET 등) 모든 영역 문제 풀이 수석 전문가입니다.\n"
        "제공된 이미지의 문제를 정밀 분석하여 100% 신뢰도의 정답 번호를 도출하세요.\n\n"
        "[영역별 특화 해결 지침]\n"
        "1. 수리/응용수리: 문제의 수치, 단위, 방정식을 정확히 수립하고 분수/백분율/경우의 수를 오차 없이 계산\n"
        "2. 수열 추리: 숫자 간의 차이(계차), 곱셈/나눗셈 비율, 피보나치, 거듭제곱, 교차/군수열 규칙 즉시 파악\n"
        "3. 언어/언어추리: 지문의 핵심 전제, 일치/불일치 선지의 미세한 단어 왜곡, 빈칸 전후 문맥 엄밀 비교\n"
        "4. 논리추리/명제: 대우명제, 삼단논법(어모어/부호 공식), 조건추리(경우의 수 표 배치), 참/거짓 모순 검증\n"
        "5. 자료해석: 표/그래프의 행·열 제목, 단위, 각주(※) 조건 필수 반영, 비례식 및 증감률 크기 비교 정확 판별\n\n"
        "[출력 형식 엄수 - 오직 2줄만 출력]\n"
        "1행: 반드시 [정답: X번 (X)] 형식으로 작성 (예: '정답: 4번 (④)')\n"
        "2행: 수험생이 납득할 수 있는 가장 결정적인 1줄 풀이/공식 (예: '계차수열 +3, +6, +12 등비규칙' 또는 '전제1 대우와 전제2 연결 성립')\n\n"
        "사족, 인사말, 서론/결론 없이 오직 위 2행만 출력하세요."
    )

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": system_instruction},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": b64_data
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 300
        }
    }

    # Try gemini-2.0-flash first, then fallback to gemini-1.5-flash
    models = ["gemini-2.0-flash", "gemini-1.5-flash"]
    async with httpx.AsyncClient(timeout=15.0) as client:
        last_error = None
        for model in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    result = resp.json()
                    candidates = result.get("candidates", [])
                    if candidates:
                        content_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                        parsed = parse_answer(content_text)
                        return parsed
                else:
                    last_error = f"API Error ({resp.status_code}): {resp.text}"
            except Exception as e:
                last_error = str(e)

        raise HTTPException(status_code=500, detail=f"Gemini API 호출 실패: {last_error}")

# Mount static files
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

def main():
    cert_path, key_path = ensure_ssl_certificates(os.path.dirname(__file__))
    
    # Get IP for console guide
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"

    print("=" * 60)
    print("🚀 [SKCT AI 고속 문제 풀이 앱 서버 가동]")
    print(f"📱 스마트폰 접속 주소: https://{local_ip}:8443")
    print(f"💻 PC 로컬 접속 주소:  https://localhost:8443")
    print("=" * 60)
    print("※ 스마트폰 접속 시 '연결이 비공개로 설정되지 않았습니다' 경고가 뜨면")
    print("   [고급] -> [접속하기 / 안전하지 않음으로 이동]을 1회 눌러주세요.")
    print("=" * 60)

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8443,
        ssl_certfile=cert_path,
        ssl_keyfile=key_path,
        log_level="info"
    )

if __name__ == "__main__":
    main()
