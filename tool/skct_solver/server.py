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
        "당신은 대한민국 최고 수준의 인적성(SKCT, GSAT, NCS, LEET 등) 문제 풀이 전문가입니다.\n"
        "제공된 문제 이미지(수리, 추리, 언어, 명제, 도형, 표 등)를 신속 정확하게 분석하고 가장 타당한 정답 번호를 도출하세요.\n\n"
        "[출력 형식 엄수]\n"
        "1행: 반드시 [정답: X번 (X)] 형식으로만 첫 줄 작성 (예: '정답: 4번 (④)')\n"
        "2행: 25자 이내의 가장 결정적인 핵심 원리/풀이 한 줄 (예: '전제1 대우명제와 전제2 연결 성립')\n\n"
        "서론, 인사말, 장황한 설명은 일체 생략하고 위 2줄만 정확히 출력하세요."
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
            "temperature": 0.1,
            "maxOutputTokens": 200
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
