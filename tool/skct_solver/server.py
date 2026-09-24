import os
import re
import socket
import base64
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
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
    image: str # base64 data url or raw base64
    api_key: str = ""
    model: str = "" # optional model override

class ConfigRequest(BaseModel):
    gemini_api_key: str
    default_model: str = "gemini-2.0-flash"

def get_gemini_key(user_key: str = "") -> str:
    if user_key and user_key.strip():
        return user_key.strip()
    return os.getenv("GEMINI_API_KEY", "").strip()

def build_auto_instruction() -> str:
    return (
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
    )

def parse_answer(text: str):
    """
    Extracts answer number, short reason with auto-detected area, and step-by-step detail.
    """
    lines = [line.strip() for line in text.strip().split("\n") if line.strip()]
    if not lines:
        return {"answer": "?", "number": "?", "reason": "인식 실패", "detail": "", "raw": text}
    
    first_line = lines[0]
    reason = ""
    detail_lines = []

    for line in lines[1:]:
        if line.startswith("[상세풀이]") or line.startswith("상세:"):
            detail_lines.append(line.replace("[상세풀이]", "").replace("상세:", "").strip())
        else:
            if not reason:
                reason = line
            else:
                detail_lines.append(line)

    detail = "\n".join(detail_lines).strip()
    
    # Check for circled numbers
    circled_map = {"①": "1", "②": "2", "③": "3", "④": "4", "⑤": "5"}
    for c, n in circled_map.items():
        if c in first_line:
            return {"answer": f"{n}번 ({c})", "number": n, "reason": reason, "detail": detail, "raw": text}
            
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
        return {"answer": f"{num}번 ({c})" if c else f"{num}번", "number": num, "reason": reason, "detail": detail, "raw": text}
        
    return {"answer": first_line[:15], "number": "?", "reason": reason, "detail": detail, "raw": text}

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
    default_model = os.getenv("DEFAULT_MODEL", "gemini-2.0-flash")
    return {"ip": ip, "has_gemini_key": has_key, "default_model": default_model}

@app.post("/api/config")
def set_config(req: ConfigRequest):
    key = req.gemini_api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API 키를 입력해주세요.")
    with open(ENV_PATH, "w", encoding="utf-8") as f:
        f.write(f"GEMINI_API_KEY={key}\n")
        f.write(f"DEFAULT_MODEL={req.default_model}\n")
    os.environ["GEMINI_API_KEY"] = key
    os.environ["DEFAULT_MODEL"] = req.default_model
    return {"status": "success", "message": "설정이 성공적으로 저장되었습니다."}

@app.post("/api/solve")
async def solve_problem(req: SolveRequest):
    api_key = get_gemini_key(req.api_key)
    if not api_key:
        raise HTTPException(
            status_code=400, 
            detail="Gemini API Key가 등록되지 않았습니다. 우측 상단 ⚙️ 설정에서 API 키를 입력해주세요."
        )
    
    # Process base64 image
    img_data = req.image
    if "," in img_data:
        mime_type = img_data.split(",")[0].split(":")[1].split(";")[0]
        b64_data = img_data.split(",")[1]
    else:
        mime_type = "image/jpeg"
        b64_data = img_data

    system_instruction = build_auto_instruction()

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
            "maxOutputTokens": 450
        }
    }

    # Model priority list (default: gemini-2.0-flash)
    preferred_model = req.model.strip() or os.getenv("DEFAULT_MODEL", "gemini-2.0-flash")
    models = [preferred_model]
    for fallback in ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"]:
        if fallback not in models:
            models.append(fallback)

    async with httpx.AsyncClient(timeout=15.0) as client:
        last_error = None
        for model_name in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    result = resp.json()
                    candidates = result.get("candidates", [])
                    if candidates:
                        content_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                        parsed = parse_answer(content_text)
                        parsed["used_model"] = model_name
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
    import sys
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

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
    print(">> [SKCT AI 실시간 고속 문제 풀이 서버 가동]")
    print(f">> 스마트폰 접속 주소: https://{local_ip}:8443")
    print(f">> PC 로컬 접속 주소:  https://localhost:8443")
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
