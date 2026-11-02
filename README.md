# TraidAIr 🚀

단타 트레이딩 대시보드 & 모의 HTS (매매 판단·계산은 전부 로컬 코드)

## 기능
- 📊 장 전 시장 체크 대시보드 (나스닥·선물·VIX·환율)
- 📈 HTS — 캔들차트 + 보조지표 (MA·RSI·MACD·볼린저·VWAP)
- 🏦 호가창 · 체결창 · 주문창
- ⏯ 모의투자 배속 재생 (x1~x64) + 일시정지
- ⚙ 수수료·손절 한도·비중 설정 (매매 파라미터는 `params.json`)
- 🛡 뇌동매매 감지 · 손실 한도 경고
- 📓 매매일지 기본 저장 (로컬 통계)
- 📋 질문 복사 — 분석·상담·일지 평가가 필요한 곳에서는 화면 데이터를 담은 질문을 만들어 보여주고, 사용자가 복사해 claude.ai에 붙여넣는다. **앱은 LLM API를 호출하지 않는다.**

## 로컬 실행
```bash
node build.js                              # src/dashboard → trading-dashboard.html 생성
APP_PASSWORD=testpw PORT=3998 node server.js
```

## 코드 구조
```
trading-hts.html        # HTS 정본 — 직접 편집 (빌드하지 않음)
params.json             # 진입·리스크·청산·스캘핑 파라미터 단일 출처 (서버가 window.__PARAMS 로 주입)
server.js               # HTTP 서버 + KIS/DART 프록시 (외부 의존성 없음)
src/dashboard/          # 대시보드 원본 (template.html, style.css, body.html, script.js)
trading-dashboard.html  # 대시보드 빌드 산출물 (커밋됨, 직접 수정 금지)
build.js                # src/dashboard → trading-dashboard.html. 외부 의존성 없음
src/hts/                # 죽은 코드 — 빌드·수정하지 말 것 (trading-hts.html 이 정본)
test/*.test.js          # node 단독 실행 테스트
```

## 개발 흐름
1. HTS 는 `trading-hts.html` 을 직접 수정, 대시보드는 `src/dashboard/*` 수정 후 `node build.js`
2. 검증 (수정할 때마다 한 번에)
   - `node --check server.js`
   - `for t in test/*.test.js; do node $t; done` — `test/no_llm.test.js` 가 LLM 호출 흔적 0건, 인라인 스크립트 문법, onclick 대상 함수 존재, 대시보드 빌드 동기화까지 검사
3. 로컬 실행 후 브라우저로 로그인해 pageerror 0건·`/api/claude` 요청 0건 확인
4. 커밋 시 빌드 산출물(`trading-dashboard.html`)도 같이 커밋

Railway 배포 시 `nixpacks.toml`이 `node build.js`를 자동 실행.

## 데이터 저장
- 사용자 데이터(모의계좌·일지 등, `userdata.json`)와 KIS 토큰 캐시는 `DATA_DIR` 에 저장한다.
  순서: `DATA_DIR` → `RAILWAY_VOLUME_MOUNT_PATH` → OS 임시 폴더(재배포 시 초기화, 로그에 `STORAGE EPHEMERAL`).
- Railway 에서는 Volume 을 `/app/data` 에 연결하고 Variables 에 `DATA_DIR=/app/data` 를 넣는다.
  `DATA_DIR` 을 지정했는데 쓸 수 없으면 서버는 시작을 거부한다(조용히 임시 폴더로 넘어가지 않음).
- 쓰기는 원자적(임시 파일 → rename, 직전본 `.bak`). 파일이 손상돼 있으면 덮어쓰지 않고 저장을 거부한다.
- KIS 키 등 비밀값은 디스크·GitHub 에 쓰지 않는다 — Railway Variables 에만 둔다. 배포 확인은 `/api/version` 의 `htmlSize` 가 커밋된 `trading-hts.html` 크기와 같은지로 한다.

## 주의
- 매매 판단·계산 경로에서 LLM API 호출 금지. 새 AI 기능이 필요하면 `copyAsk(제목, 질문)` 으로 질문 복사 버튼을 만든다.
- 종목 하드코딩·폴백 금지. 후보가 없으면 관망.
- 과거 날짜 리플레이·백테스트에서 실시간 순위 사용 금지 (`_kstToday()` 와 비교).
- 실계좌 주문은 `LIVE_ORDER_ENABLED=1` 일 때만.
