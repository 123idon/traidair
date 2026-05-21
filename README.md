# TraidAIr 🚀

AI 기반 단타 트레이딩 대시보드 & 모의 HTS

## 기능
- 📊 장 전 시장 체크 대시보드 (나스닥·선물·VIX·환율)
- 🤖 Claude AI 실시간 장 전 분석 (시장 방향·섹터·리스크·전략)
- 📈 HTS — 캔들차트 + 보조지표 (MA·RSI·MACD·볼린저·VWAP)
- 🏦 호가창 · 체결창 · 주문창
- ⏯ 모의투자 배속 재생 (x1~x64) + 일시정지
- ⚙ 수수료·손절 한도·비중 설정
- 🛡 뇌동매매 감지 · 손실 한도 경고
- 📓 AI 매매일지 자동 생성 (Claude Sonnet)

## 로컬 실행
```bash
node build.js   # src/ → trading-*.html 생성
node server.js  # 포트 3000
```

## 코드 구조
```
src/
  hts/                  # 메인 HTS 페이지
    template.html       # HTML 골격 (placeholder 포함)
    style.css           # CSS
    body.html           # HTML body 마크업
    script.js           # JS
  dashboard/            # 대시보드 페이지 (같은 구조)
build.js                # src/ → trading-*.html 합성. 외부 의존성 없음
server.js               # HTTP 서버 + KIS/Claude/DART 프록시
trading-hts.html        # 빌드 산출물 (커밋됨, 직접 수정 금지)
trading-dashboard.html  # 빌드 산출물 (커밋됨, 직접 수정 금지)
```

## 개발 흐름
1. `src/hts/*` 또는 `src/dashboard/*` 안에서 CSS/HTML/JS 수정
2. `node build.js` 실행 → `trading-*.html` 재생성
3. `node server.js`로 확인
4. 커밋 시 빌드 산출물(`trading-*.html`)도 같이 커밋 (Railway가 빌드 실패해도 기존 파일 서빙)

Railway 배포 시 `nixpacks.toml`이 `node build.js`를 자동 실행.

## 주의
- **`trading-hts.html` / `trading-dashboard.html`은 빌드 산출물.** 직접 편집하면 다음 빌드에서 덮어쓰임.
- 항상 `src/` 안에서 작업.

