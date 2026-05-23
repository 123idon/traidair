// ═══════════════════════════════
// 멘토 페르소나 — 모든 Claude 호출 system 프롬프트로 사용
// ═══════════════════════════════
const MENTOR_SYSTEM_PROMPT = `당신은 주식 단타 전문 트레이딩 멘토이자 실전 파트너다. 20년 이상의 단타 경험을 가진 전문가로서 학습·분석·실전 조언을 모두 제공한다. 수익보다 손실 방어를 항상 우선하고 틀린 판단은 직접적으로 지적한다.

# 행동 원칙
- 틀린 판단은 직접 틀렸다고 한다. 애매한 표현 금지.
- 좋은 점보다 리스크와 문제점을 먼저 짚는다.
- 추측은 "(추정)", 확인 불가는 "확인 불가"로 명시.
- 결론 먼저, 근거는 그 다음.
- 수익보다 손실 방어가 우선.
- 단순 동조 없이 논리로 반박. 사용자 판단이 감정적으로 보이면 뇌동매매 경고를 먼저 발동.
- 투자 조언임을 인지하고 최종 판단은 본인이 내림을 전제.

# 사용자 현황
- 단타 경험 중급, 당일매매·스윙 해본 적 있음, 스캘핑은 학습 필요
- 주된 방식: 이슈/수급 기반 타점 진입 후 목표가 도달 시 익절
- 기술적 분석 보완 필요

# 리스크 기본값 (사용자가 수정 가능)
- 1회 매매 최대 비중: 자산의 20% 이하
- 종목당 최대 손실: 진입가 대비 -3%
- 일일 최대 손실: 자산의 -2%

# 매매 시간대 특성
- 스캘핑: 수초~수분, 목표 0.3~1%, 호가창·체결강도 핵심, 수수료 부담
- 당일매매: 수분~당일청산, 목표 1~5%, 장중 이슈·수급, 마감 전 청산 필수
- 스윙: 2일~수주, 목표 5~20%, 추세·이슈 지속성, 갭하락 리스크

# 보조지표 기본
- RSI 70+ 과매수 / 30- 과매도, 단타는 60 돌파 모멘텀
- MACD 12/26/9, 골든크로스 진입
- 볼린저 20/2σ, 수축 후 확장 시 돌파
- MA: 스캘핑 5/10, 당일 20/60, 스윙 60/120
- 거래량 전일 대비 300%+면 강한 수급

# 뇌동매매 감지
"빨리 들어가야 할 것 같아", "다들 사고 있는 것 같아", "본전만 오면 팔게", "물타야 할 것 같아", 손실 중 추가매수 요청, 손절 기준 낮추기, 연속 손실 후 즉각 재진입 — 이런 신호 감지되면 분석 전에 경고 먼저.

# 면책
모든 분석은 참고용. 최종 판단은 본인. 원금 손실 가능. 과거 수익이 미래를 보장 안 함.`;

// 노션 강의 페이지 ID (사용자 제공)
const NOTION_LECTURE_PAGE_ID_DEFAULT = '35a0717882e381ce8fc3d257a5c24e4b';

// AI 생성 버튼 상태 표시 헬퍼 — 클릭 시 비활성 + "생성 중..." 표시
function _btnBusy(btn, label){
  if(!btn) return ()=>{};
  const _orig = btn.innerHTML;
  const _disabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = (label||'🤖 생성 중...');
  btn.style.opacity = '0.6';
  return ()=>{ btn.innerHTML = _orig; btn.disabled = _disabled; btn.style.opacity=''; };
}

// ── 전역 에러 캐처 — 모든 JS 에러를 디버그 로그에 자동 기록 ──
window._jsErrors = window._jsErrors || [];
// ── 백그라운드 탭에서도 백테스트 진행 (Audio API로 keep-alive) ──
// 브라우저는 백그라운드 탭에서 setTimeout을 1000ms로 throttle하지만
// AudioContext가 활성이면 throttle 약화됨
(function _bgKeepAlive(){
  let _audio = null;
  function start(){
    if(_audio) return;
    try{
      _audio = new (window.AudioContext||window.webkitAudioContext)();
      const osc = _audio.createOscillator();
      const gain = _audio.createGain();
      gain.gain.value = 0; // 무음
      osc.connect(gain); gain.connect(_audio.destination);
      osc.start(0);
    }catch(e){ _audio = null; }
  }
  function stop(){
    if(_audio){ try{_audio.close();}catch(e){} _audio = null; }
  }
  // 백테스트 시작 시 keep-alive 켬, 정지 시 끔
  window._bgKeepAliveStart = start;
  window._bgKeepAliveStop = stop;
  // 페이지 visibility 변경 시 백테스트 진행 중이면 keep-alive
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden && window.backtest && backtest.running) start();
  });
})();

window.addEventListener('error', function(e){
  const info = { ts: Date.now(), msg: e.message, src: e.filename, line: e.lineno, col: e.colno };
  window._jsErrors.push(info);
  if(window._jsErrors.length > 100) window._jsErrors.shift();
  console.error('[JS ERROR]', info);
  // AI 현황 결정 로그에는 띄우지 않음 — 노이즈 방지. 🔍 디버그 패널에서만 확인 가능.
});
window.addEventListener('unhandledrejection', function(e){
  const info = { ts: Date.now(), msg: 'Promise rejected: '+(e.reason && (e.reason.message || e.reason.toString()) || 'unknown') };
  window._jsErrors.push(info);
  if(window._jsErrors.length > 100) window._jsErrors.shift();
  console.error('[PROMISE REJECT]', info);
  // AI 현황엔 안 띄움 — 사용자 화면 노이즈 방지
});

// ── 디버그 패널 — 사용자가 직접 상태 확인 가능 ──
window.debugTraidair = function debugTraidair(){
  const tk = (mock.trades||[]).length;
  const sells = (mock.trades||[]).filter(t=>t.side==='sell').length;
  const buys = tk - sells;
  const dates = [...new Set((mock.trades||[]).map(t=>t.date))].sort();
  const wgs = (WGS||[]).map((g,i)=>`WGS[${i}]=${g.length}`).join(' / ');
  const siCount = Object.keys(window._sectorInfo||{}).length;
  const journals = Object.keys(JSON.parse(localStorage.getItem('htsJournals')||'{}')).length;
  const lec = window.lectureContent ? lectureContent.length+'자' : '없음';
  const learn = (window.learningMemory||[]).length;
  const autoR = autoState.running?'✅ 작동중 (Lv'+autoState.level+')':'❌ 정지';
  const bt = (window.backtest&&backtest.running)?`✅ ${backtest.dayIdx}/${backtest.totalDays}일`:'❌ 정지';
  const msg = `
[TraidAIr 상태 진단]
━━━━━━━━━━━━━━━━━━━━━━
💰 자본: 현금 ${(mock.cash||0).toLocaleString()}원 / 보유 ${Object.keys(mock.positions||{}).length}종목

📊 매매 기록: 전체 ${tk}건 (매수 ${buys} / 매도 ${sells})
   거래일: ${dates.length}일 ${dates.length>0?'('+dates[0]+' ~ '+dates[dates.length-1]+')':''}

🤖 자동매매: ${autoR}
🚀 백테스트: ${bt}

📌 관심그룹: ${wgs}
🔥 강세섹터 종목: ${siCount}개
📓 매매일지: ${journals}일치
📚 강의: ${lec}
🎓 학습노트: ${learn}건

[진단]
${tk===0 ? '⚠ 매매 0건 — 자동매매가 안 돌았거나 진입 조건 미달.\n   백테스트 끝까지 돌렸는지 확인. autoState.cfg.brk가 true면 연속 손절로 중지됐을 수도.' :
  sells===0 ? '⚠ 매도 0건 — 매수만 했음. 마감 청산이 작동 안 함. 백테스트 끝나면 청산되는지 확인.' :
  journals===0 ? '⚠ 매매는 있는데 일지 0개 — autoSaveJournalOnTrade 실패. AI 일지 생성 버튼 눌러서 확인.' :
  '✅ 데이터 정상'}

[최근 JS 에러] (${(window._jsErrors||[]).length}건)
${(window._jsErrors||[]).slice(-5).map(e=>'• '+(e.msg||'').slice(0,80)).join('\n') || '(에러 없음)'}
━━━━━━━━━━━━━━━━━━━━━━`;
  alert(msg);
  console.log('[TraidAIr 디버그]', { mock, autoState, backtest:window.backtest, WGS, sectorInfo:window._sectorInfo, journals:JSON.parse(localStorage.getItem('htsJournals')||'{}') });
  return msg;
};

// Claude 호출 헬퍼 — 모든 호출에 멘토 시스템 프롬프트 자동 첨부
async function claudeAsk(opts){
  const body = {
    model: opts.model || 'claude-sonnet-4-5',
    max_tokens: opts.max_tokens || 600,
    system: MENTOR_SYSTEM_PROMPT,
    messages: opts.messages || [{role:'user', content: opts.prompt || ''}],
  };
  const r = await fetch('/api/claude', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body),
  });
  return await r.json();
}

// ═══════════════════════════════
// DATA══════════════
// DATA
// ═══════════════════════════════
const STOCKS=[
  // 코스피 대형주
  {tk:"005930",nm:"삼성전자",pr:71500,base:71500,sec:"반도체",cap:"대형"},
  {tk:"000660",nm:"SK하이닉스",pr:189300,base:189300,sec:"반도체",cap:"대형"},
  {tk:"005380",nm:"현대차",pr:212000,base:212000,sec:"자동차",cap:"대형"},
  {tk:"005490",nm:"POSCO홀딩스",pr:312000,base:312000,sec:"철강",cap:"대형"},
  {tk:"035420",nm:"NAVER",pr:182200,base:182200,sec:"인터넷",cap:"대형"},
  {tk:"051910",nm:"LG화학",pr:318500,base:318500,sec:"화학",cap:"대형"},
  {tk:"006400",nm:"삼성SDI",pr:285000,base:285000,sec:"2차전지",cap:"대형"},
  {tk:"003550",nm:"LG",pr:78500,base:78500,sec:"지주",cap:"대형"},
  {tk:"028260",nm:"삼성물산",pr:138500,base:138500,sec:"건설",cap:"대형"},
  {tk:"012330",nm:"현대모비스",pr:248500,base:248500,sec:"자동차부품",cap:"대형"},
  {tk:"066570",nm:"LG전자",pr:95800,base:95800,sec:"가전",cap:"대형"},
  {tk:"032830",nm:"삼성생명",pr:91800,base:91800,sec:"보험",cap:"대형"},
  {tk:"055550",nm:"신한지주",pr:45350,base:45350,sec:"금융",cap:"대형"},
  {tk:"105560",nm:"KB금융",pr:78200,base:78200,sec:"금융",cap:"대형"},
  {tk:"000270",nm:"기아",pr:98100,base:98100,sec:"자동차",cap:"대형"},
  {tk:"096770",nm:"SK이노베이션",pr:115500,base:115500,sec:"에너지",cap:"대형"},
  {tk:"003670",nm:"포스코퓨처엠",pr:198000,base:198000,sec:"2차전지",cap:"중형"},
  {tk:"247540",nm:"에코프로비엠",pr:152000,base:152000,sec:"2차전지",cap:"중형"},
  // 코스닥
  {tk:"373220",nm:"LG에너지솔루션",pr:298500,base:298500,sec:"2차전지",cap:"대형"},
  {tk:"207940",nm:"삼성바이오로직스",pr:831000,base:831000,sec:"바이오",cap:"대형"},
  {tk:"068270",nm:"셀트리온",pr:186500,base:186500,sec:"바이오",cap:"대형"},
  {tk:"035720",nm:"카카오",pr:42350,base:42350,sec:"인터넷",cap:"대형"},
  {tk:"000810",nm:"삼성화재",pr:335000,base:335000,sec:"보험",cap:"대형"},
  {tk:"086520",nm:"에코프로",pr:68500,base:68500,sec:"2차전지",cap:"중형"},
  {tk:"091990",nm:"셀트리온헬스케어",pr:45200,base:45200,sec:"바이오",cap:"중형"},
  {tk:"263750",nm:"펄어비스",pr:32500,base:32500,sec:"게임",cap:"중형"},
  {tk:"041510",nm:"에스엠",pr:58700,base:58700,sec:"엔터",cap:"중형"},
  {tk:"035900",nm:"JYP Ent.",pr:47800,base:47800,sec:"엔터",cap:"중형"},
  {tk:"122870",nm:"YG엔터테인먼트",pr:38900,base:38900,sec:"엔터",cap:"중형"},
  {tk:"278530",nm:"HLB",pr:52300,base:52300,sec:"바이오",cap:"중형"},
  {tk:"950130",nm:"엑세스바이오",pr:8500,base:8500,sec:"바이오",cap:"소형"},
  {tk:"196170",nm:"알테오젠",pr:285000,base:285000,sec:"바이오",cap:"중형"},
  {tk:"145020",nm:"휴젤",pr:198000,base:198000,sec:"바이오",cap:"중형"},
  {tk:"048260",nm:"오스템임플란트",pr:178500,base:178500,sec:"의료기기",cap:"중형"},
  {tk:"215600",nm:"신라젠",pr:3240,base:3240,sec:"바이오",cap:"소형"},
  {tk:"039030",nm:"이오테크닉스",pr:89500,base:89500,sec:"반도체장비",cap:"중형"},
  {tk:"042700",nm:"한미반도체",pr:68500,base:68500,sec:"반도체장비",cap:"중형"},
  {tk:"357780",nm:"솔브레인",pr:295000,base:295000,sec:"반도체소재",cap:"중형"},
  {tk:"095340",nm:"ISC",pr:42500,base:42500,sec:"반도체",cap:"소형"},
  {tk:"009150",nm:"삼성전기",pr:155000,base:155000,sec:"전자부품",cap:"중형"},
  {tk:"010130",nm:"고려아연",pr:498000,base:498000,sec:"비철금속",cap:"중형"},
  {tk:"326030",nm:"SK바이오팜",pr:78500,base:78500,sec:"바이오",cap:"중형"},
  {tk:"011200",nm:"HMM",pr:18250,base:18250,sec:"해운",cap:"중형"},
  {tk:"000120",nm:"CJ대한통운",pr:98500,base:98500,sec:"물류",cap:"중형"},
  {tk:"180640",nm:"한진칼",pr:62400,base:62400,sec:"항공",cap:"중형"},
  {tk:"003490",nm:"대한항공",pr:21500,base:21500,sec:"항공",cap:"중형"},
  {tk:"021240",nm:"코웨이",pr:52300,base:52300,sec:"가전",cap:"중형"},
  {tk:"259960",nm:"크래프톤",pr:218000,base:218000,sec:"게임",cap:"대형"},
];
// Phase 3-9: 관심종목 5그룹
const WG_LABELS = ['🎯 오늘 진입 후보','📊 모니터링','🚫 매매금지','🔥 테마/이슈','📝 복기 대상'];
const WG_MAX = [10, 20, 999, 15, 10];
let WGS = (()=>{
  try{
    const _raw = localStorage.getItem("htsWGS");
    if(_raw){
      const _p = JSON.parse(_raw);
      const _all = [].concat(..._p);
      // 005930/000660만 있으면 구버전 - 초기화
      if(_all.length>0 && _all.every(t=>["005930","000660","373220","035420"].includes(t))){
        localStorage.removeItem("htsWGS");
        return [[],[],[],[],[]];
      }
      return _p;
    }
    return [[],[],[],[],[]];
  }catch(e){return [[],[],[],[],[]];}
})();
let curWG = 0;
// 구버전 WL 호환
let WL = WGS[0];
function saveWL(){WGS[0]=WL;const v=JSON.stringify(WGS);localStorage.setItem("htsWGS",v);saveToServer("htsWGS",v);}
function saveWGS(){const v=JSON.stringify(WGS);localStorage.setItem("htsWGS",v);saveToServer("htsWGS",v);}
function addToWL(tk){if(!WL.includes(tk)){WL.push(tk);saveWL();renderWLGroup();}}
function removeFromWL(tk){WL=WL.filter(w=>w!==tk);WGS[0]=WL;saveWGS();renderWLGroup();}

function selWG(el,id){
  document.querySelectorAll(".wg-tab").forEach(t=>t.classList.remove("on"));
  el.classList.add("on");
  curWG=parseInt(id.replace("wg",""));
  document.querySelectorAll(".wg-body").forEach(b=>b.style.display="none");
  document.getElementById(id).style.display="block";
  const lbl=document.getElementById("wgTitle");
  const cnt=document.getElementById("wgCount");
  if(lbl)lbl.textContent=WG_LABELS[curWG];
  const cur=WGS[curWG]||[];
  const max=WG_MAX[curWG];
  if(cnt)cnt.textContent=max===999?cur.length+"개":cur.length+"/"+max;
  renderWLGroup();
}
function addCurrentToWG(){
  const tk=activeTk;
  const grp=WGS[curWG]||(WGS[curWG]=[]);
  if(grp.includes(tk)){showAlert("중복","이미 이 그룹에 있습니다.");return;}
  // 한도 체크 (WG_MAX 기준)
  const _max = WG_MAX[curWG]||10;
  if(grp.length >= _max){showAlert("초과","이 그룹은 최대 "+_max+"개까지 가능합니다.");return;}
  grp.push(tk);saveWGS();renderWLGroup();
  const stk=STOCKS.find(s=>s.tk===tk);
  addDecisionLog("["+WG_LABELS[curWG]+"] "+(stk?.nm||tk)+" 추가","","관심종목");
}
function removeFromWG(gIdx,tk){
  WGS[gIdx]=WGS[gIdx].filter(w=>w!==tk);
  if(gIdx===0)WL=WGS[0];
  saveWGS();renderWLGroup();
}
function moveToWG(fromG,tk,toG){
  WGS[fromG]=WGS[fromG].filter(w=>w!==tk);
  if(!WGS[toG])WGS[toG]=[];
  if(!WGS[toG].includes(tk))WGS[toG].push(tk);
  if(toG===0)WL=WGS[0];
  saveWGS();renderWLGroup();
}

function renderWLGroup(){
  for(var _g=0;_g<5;_g++){
    var _lid=_g===2?"banList":"wlList"+_g;
    var _el=document.getElementById(_lid);
    if(!_el)continue;
    var _grp=WGS[_g]||[];
    if(_g===2&&!_grp.length){_el.textContent="없음";continue;}
    _el.innerHTML=_grp.map(function(_tk){
      var _s=STOCKS.find(function(s){return s.tk===_tk;})||{tk:_tk,nm:_tk,pr:0,base:1,sec:""};
      var _chg=((_s.pr-_s.base)/_s.base*100).toFixed(2);
      var _up=parseFloat(_chg)>=0;
      var _col=_g===2?"var(--r)":_g===0?"var(--b)":"var(--ts)";
      var _row="";
      _row+="<div style='display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:7px;cursor:pointer;margin-bottom:1px;'>";
      _row+="<div data-stk='"+_tk+"' onclick='selectStk(this.dataset.stk)' style='display:flex;align-items:center;gap:5px;flex:1;min-width:0;'>";
      var _si=window._sectorInfo&&window._sectorInfo[_tk];
      var _badge=_si?"<span style='font-size:8px;background:var(--b);color:#fff;border-radius:3px;padding:0 3px;margin-right:2px;'>"+ _si.rank+"위</span>":"";
      _row+="<div style='font-size:9px;font-family:var(--mono);color:"+_col+";width:34px;flex-shrink:0;'>"+_badge+_tk.slice(-4)+"</div>";
      _row+="<div style='font-size:9px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>"+_s.nm+"</div>";
      _row+="<div style='font-size:9px;color:"+(_up?"var(--g)":"var(--r)")+";width:42px;text-align:right;flex-shrink:0;'>"+(_up?"+":"")+_chg+"%</div>";
      _row+="</div>";
      _row+="<div style='display:flex;gap:2px;flex-shrink:0;'>";
      if(_g!==2){
        _row+="<button data-g='"+_g+"' data-tk='"+_tk+"' onclick='moveToWG(parseInt(this.dataset.g),this.dataset.tk,2)' style='background:none;border:none;font-size:9px;cursor:pointer;color:var(--tm);'>&#x1F6AB;</button>";
      }
      _row+="<button data-g='"+_g+"' data-tk='"+_tk+"' onclick='removeFromWG(parseInt(this.dataset.g),this.dataset.tk)' style='background:none;border:none;font-size:11px;cursor:pointer;color:var(--tm);'>&times;</button>";
      _row+="</div></div>";
      return _row;
    }).join("");
  }
}
function renderWL(){renderWLGroup();}
// CANDS: 진입후보 — 점수(score) 포함, 대시보드에서 업데이트됨
let CANDS=[
  {tk:"373220",why:"기관 3일 연속 순매수",score:82},
  {tk:"207940",why:"바이오 테마 강세",score:74}
];
// 대시보드에서 후보 업데이트 시 호출
function updateCandsFromDash(candidates){
  if(!candidates||!candidates.length) return;
  CANDS = candidates.map(c=>({
    tk: c.code||c.tk||'',
    why: c.reason||c.why||'',
    score: c.score || 0
  })).filter(c=>c.tk).sort((a,b)=>b.score-a.score).slice(0,3);
  renderCands();
}

const FILTERS=[
  // 수급 조건
  {nm:"수급폭발 300%+",col:"var(--g)",cat:"수급",desc:"전일대비 거래량 300% 이상",stocks:["373220","207940","068270"]},
  {nm:"기관+외국인 동반매수",col:"var(--b)",cat:"수급",desc:"기관 3일 연속 + 외국인 당일 순매수",stocks:["005930","000660"]},
  {nm:"외국인 연속 순매수",col:"var(--b)",cat:"수급",desc:"외국인 3일 이상 연속 순매수",stocks:["005930","373220"]},
  // 차트 조건
  {nm:"장초반 모멘텀",col:"var(--a)",cat:"차트",desc:"당일 상승률 +3% 이상, 거래량 급증",stocks:["035420","051910"]},
  {nm:"눌림목 탐색",col:"var(--p)",cat:"차트",desc:"최근 5일 +10% 후 -5~-10% 조정",stocks:["207940","005380"]},
  {nm:"상한가 근접",col:"var(--r)",cat:"차트",desc:"상한가 대비 -20% 이내, 거래량 500%+",stocks:["207940"]},
  {nm:"이평선 정배열",col:"var(--g)",cat:"차트",desc:"5MA>20MA>60MA 정배열",stocks:["005930","000660","035420"]},
  // 재료 조건
  {nm:"실적 서프라이즈",col:"var(--a)",cat:"재료",desc:"어닝서프라이즈 발표 후 강세",stocks:["005930","051910"]},
  {nm:"신규 공시/수주",col:"var(--g)",cat:"재료",desc:"당일 대규모 수주/계약 공시",stocks:["373220","012450"]},
  {nm:"테마 주도주",col:"var(--r)",cat:"재료",desc:"핵심 테마 섹터 주도 종목",stocks:["207940","068270","373220"]},
  {nm:"뉴스 모멘텀",col:"var(--b)",cat:"재료",desc:"주요 뉴스 촉매 발생",stocks:["035420","035720"]},
  {nm:"정책 수혜",col:"var(--p)",cat:"재료",desc:"정부 정책 수혜 직접 해당",stocks:["012450","064350"]},
];
const NEWS=[
  {ttl:"나스닥 +1.45% · AI 반도체 강세 지속",tm:"07:32",cat:"해외",col:"var(--b)"},
  {ttl:"삼성전자 HBM4 양산 임박 보도",tm:"08:10",cat:"호재",col:"var(--g)"},
  {ttl:"원/달러 1,382원 · 수출주 수혜 기대",tm:"08:25",cat:"환율",col:"var(--a)"},
  {ttl:"LG에너지솔루션 유럽 대형 수주 공시",tm:"08:41",cat:"공시",col:"var(--b)"},
  {ttl:"셀트리온 FDA 임상 결과 오늘 발표",tm:"08:55",cat:"주의",col:"var(--r)"},
];

// ═══════════════════════════════
// UTILS & CALC
// ═══════════════════════════════
function todayStr(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}

const calcMA=(d,n)=>d.map((v,i)=>i<n-1?null:d.slice(i-n+1,i+1).reduce((a,b)=>a+b,0)/n);

function calcBB(d,n,k){const ma=calcMA(d,n);return{upper:d.map((v,i)=>{if(!ma[i])return null;const sl=d.slice(i-n+1,i+1),std=Math.sqrt(sl.reduce((a,b)=>a+(b-ma[i])**2,0)/n);return ma[i]+k*std;}),lower:d.map((v,i)=>{if(!ma[i])return null;const sl=d.slice(i-n+1,i+1),std=Math.sqrt(sl.reduce((a,b)=>a+(b-ma[i])**2,0)/n);return ma[i]-k*std;})};}

function calcRSI(d,n){const r=[];for(let i=0;i<d.length;i++){if(i<n){r.push(null);continue;}let g=0,l=0;for(let j=i-n+1;j<=i;j++){if(j<1)continue;const dv=d[j]-d[j-1];if(dv>0)g+=dv;else l-=dv;}r.push(100-100/(1+((g/n)/((l/n)||.001))));}return r;}

function calcMACD(d){const ema=(d,n)=>{const k=2/(n+1);let e=d[0];return d.map(v=>{e=v*k+e*(1-k);return e;});};const e12=ema(d,12),e26=ema(d,26);const ml=d.map((_,i)=>e12[i]-e26[i]);return{ml,sig:ema(ml,9)};}

function calcVWAP(cs){let pv=0,tv=0;return cs.map(c=>{pv+=((c.h+c.l+c.c)/3)*c.v;tv+=c.v;return Math.round(pv/tv)});}

function rng32(seed){let a=seed|0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
// 종목별 시뮬 캔들 — 현재 봉 인덱스까지만 (미래 데이터 노출 금지)
// _genSimCandles와 동일한 시드 로직 사용 — 일관된 데이터
function _peekSimCandlesFor(tk, dateStr, untilIdx){
  try{
    const stk = (typeof STOCKS!=='undefined' ? STOCKS : []).find(s=>s.tk===tk) || {tk, nm:tk, base:50000};
    let base = stk.base || 50000;
    const tkSeed = tk.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
    const intervals = parseInt((typeof sim!=='undefined' && sim.tf) || '1') || 1;
    const perDay = Math.floor(390/intervals);
    // 전일 영업일
    const prevDate = (function(){
      const d = new Date(dateStr||'');
      if(isNaN(d.getTime())) return dateStr||'';
      do{ d.setDate(d.getDate()-1); } while(d.getDay()===0 || d.getDay()===6);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();
    const genDay = (dayStr, isPrev) => {
      const seed = (parseInt((dayStr||'').replace(/-/g,'').slice(-6))||9999) + tkSeed + (isPrev?1:0);
      const rnd = rng32(seed);
      const out = [];
      for(let i=0;i<perDay;i++){
        const r1=rnd(),r2=rnd(),r3=rnd(),r4=rnd();
        const c = base*(1+(r1-.498)*.018);
        const h = c*(1+r2*.009), l = c*(1-r3*.009), o = base*(1+(r4-.5)*.007);
        const v = Math.round(40000+r1*170000);
        const hm = 9*60+i*intervals;
        out.push({t:`${String(Math.floor(hm/60)).padStart(2,'0')}:${String(hm%60).padStart(2,'0')}`,date:dayStr,isPrev:!!isPrev,o:Math.round(o),h:Math.round(Math.max(o,c,h)),l:Math.round(Math.min(o,c,l)),c:Math.round(c),v});
        base = c;
      }
      return out;
    };
    const prev = genDay(prevDate, true);
    const today = genDay(dateStr, false);
    const all = [...prev, ...today];
    // 현재 봉 인덱스까지만 (미래 봉 절대 노출 금지)
    const limit = Math.min(all.length, Math.max(0,(untilIdx||0))+1);
    return all.slice(0, limit);
  }catch(e){ return []; }
}



// ── 서버 데이터 저장/로드 (모의투자 계좌, 매매일지, 통계 영구 보존) ──
let _saveTimer = null;
function saveToServer(key, value) {
  // 즉시 localStorage에 저장 (빠른 복원)
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch(e) {}
  // 서버에 비동기 저장 (디바운스 1초)
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    fetch('/api/user-data/' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: typeof value === 'string' ? value : JSON.stringify(value) })
    }).catch(() => {});
  }, 1000);
}

async function loadFromServer() {
  try {
    const r = await fetch('/api/user-data');
    const d = await r.json();
    if (!d.ok || !d.data) return false;
    const data = d.data;
    // 각 키를 localStorage에도 동기화 (영구 보존 대상 전체)
    const keys = [
      'htsMock','htsStopOrders','htsCfg','htsWGS','htsBan','htsJournals',
      'manualJournals','personalRules','masterCL',
      'htsSectorInfo','htsAutoTks','htsAutoSyncDate','htsSectorTime',
      'htsAutoState','htsChatMsgs','htsDecisionLog','htsAiStatus',
      'htsIntra','trustScore','apiUsage','htsSimState',
      'htsLearningMemory','htsLearnedDates','htsFeatureSuggestions',
      'htsLectureContent','htsLectureUpdatedAt','htsCoachingHistory'
    ];
    keys.forEach(k => {
      if (data[k] !== undefined) {
        try { localStorage.setItem(k, data[k]); } catch(e) {}
      }
    });
    console.log('✅ 서버에서 데이터 로드됨');
    return true;
  } catch(e) {
    return false;
  }
}

function loadState(){
  const c=localStorage.getItem("htsCfg");if(c)cfg={...cfg,...JSON.parse(c)};
  const m=localStorage.getItem("htsMock");if(m){const p=JSON.parse(m);mock={...mock,...p};}
  mock.cash=mock.cash||cfg.capital;
  if(!mock.positions)mock.positions={};
  if(!mock.trades)mock.trades=[];
  const so=localStorage.getItem("htsStopOrders");
  if(so){try{stopOrders={...JSON.parse(so)};}catch(e){}}
  // 서버에서 최신 데이터 로드 (비동기, 완료 후 UI 갱신)
  loadFromServer().then(ok => {
    if(ok) {
      // 서버 데이터로 덮어쓰기
      const m2=localStorage.getItem("htsMock");
      if(m2){const p=JSON.parse(m2);mock={...mock,...p};mock.cash=mock.cash||cfg.capital;if(!mock.positions)mock.positions={};if(!mock.trades)mock.trades=[];}
      const so2=localStorage.getItem("htsStopOrders");
      if(so2){try{stopOrders={...JSON.parse(so2)};}catch(e){}}
      // 시뮬 상태(날짜/TF/현재종목) 복원
      try{
        const _ss=localStorage.getItem('htsSimState');
        if(_ss){
          const p=JSON.parse(_ss);
          if(p.date) sim.date=p.date;
          if(p.tf) sim.tf=p.tf;
          if(p.activeTk) activeTk=p.activeTk;
          const md=document.getElementById('mockDate'); if(md) md.value=sim.date;
          document.querySelectorAll('.tf-btn').forEach(b=>{b.classList.toggle('on', b.getAttribute('onclick')&&b.getAttribute('onclick').includes("'"+sim.tf+"'"));});
        }
      }catch(e){}
      // AI 채팅 복원
      try{
        const _cm=localStorage.getItem('htsChatMsgs');
        if(_cm){
          window._chatMsgs=JSON.parse(_cm);
          const m=document.getElementById('aiMsgs');
          if(m){
            m.innerHTML='';
            window._chatMsgs.forEach(function(it){
              const h=(it.content||'').replace(/\n/g,'<br>');
              const d=document.createElement('div');
              d.className='ai-msg'+(it.role==='me'?' me':'');
              d.innerHTML='<div class="ai-av '+(it.role==='ai'?'ai':'me')+'">'+(it.role==='ai'?'AI':'나')+'</div><div><div class="ai-bub">'+h+'</div><div class="ai-meta">'+(it.role==='ai'?'Claude · ':'나 · ')+(it.tm||'')+'</div></div>';
              m.appendChild(d);
            });
            m.scrollTop=m.scrollHeight;
          }
        }
      }catch(e){}
      // AI 판단 로그 복원
      try{
        const _dl=localStorage.getItem('htsDecisionLog');
        if(_dl){window._decisionLog=JSON.parse(_dl);
          const last=window._decisionLog[window._decisionLog.length-1];
          if(last) _updateAIStatusPanel&&_updateAIStatusPanel(last);
        }
      }catch(e){}
      // 자동매매 상태 복원 (running 이었으면 다시 시작)
      try{
        const _as=localStorage.getItem('htsAutoState');
        if(_as){
          const p=JSON.parse(_as);
          if(p.cfg) autoState.cfg={...autoState.cfg,...p.cfg};
          if(p.level!==undefined) autoState.level=p.level;
          if(typeof autoLevel!=='undefined' && p.autoLevel!==undefined) autoLevel=p.autoLevel;
          if(p.running){
            setTimeout(()=>{try{startAuto&&startAuto();addMsg('ai','🔄 자동매매 상태 복원됨 — 모니터링 재개');}catch(e){}},1500);
          }
        }
      }catch(e){}
      // 강세 섹터 캐시 복원 (라벨용)
      try{
        const _si=localStorage.getItem('htsSectorInfo');
        if(_si){window._sectorInfo=JSON.parse(_si);}
        renderHotSectors&&renderHotSectors();
      }catch(e){}
      // 학습 메모리 복원 (서버 → 메모리)
      try{
        const _lm=localStorage.getItem('htsLearningMemory');
        if(_lm){window.learningMemory=JSON.parse(_lm);}
        const _ld=localStorage.getItem('htsLearnedDates');
        if(_ld){window.learnedDates=JSON.parse(_ld);}
        updateLearnerStage&&updateLearnerStage();
      }catch(e){}
      renderAll();
    }
  });
}

function saveMock(){
  const mockStr = JSON.stringify(mock);
  const soStr = JSON.stringify(stopOrders);
  localStorage.setItem("htsMock", mockStr);
  localStorage.setItem("htsStopOrders", soStr);
  // 서버에 영구 저장
  saveToServer('htsMock', mockStr);
  saveToServer('htsStopOrders', soStr);
}

function renderAll(){renderWLGroup();renderCands();renderFilters();renderNews();renderPort();renderTradeLog();updCash();updCredLim();renderBanList();updateTrailPanel();checkPsychWarnings();detectSlump();renderGrowthRoadmap();}

function renderPending(){const el=document.getElementById("pendingList");if(!el)return;if(!pendingOrders.length){el.innerHTML="<div style='font-size:9px;color:var(--tm);padding:8px;'>미체결 없음</div>";return;}el.innerHTML=pendingOrders.map(o=>`<div style="padding:4px 8px;border-bottom:1px solid var(--br);display:flex;align-items:center;gap:4px;"><span style="font-size:9px;font-weight:700;color:${o.side==="buy"?"var(--g)":"var(--r)"};">${o.side==="buy"?"매수":"매도"}</span><span style="font-size:9px;flex:1;">${o.nm} ${o.price.toLocaleString()}×${o.qty}</span><span style="font-size:8px;color:var(--tm);">${o.time}</span><button onclick="cancelPending(${o.id})" style="background:var(--r);color:#fff;border:none;border-radius:3px;font-size:8px;padding:1px 4px;cursor:pointer;">취소</button></div>`).join("");}

function renderBanList(){const el=document.getElementById("banList");if(!el)return;if(!BAN_LIST.length){el.textContent="없음";return;}el.innerHTML=BAN_LIST.map(tk=>{const s=STOCKS.find(s=>s.tk===tk)||{nm:tk};return`<div style="display:flex;align-items:center;justify-content:space-between;padding:2px 0;border-bottom:1px solid var(--br);"><span style="color:var(--r);font-size:9px;">${s.nm}</span><button onclick="removeBan('${tk}')" style="background:none;border:none;color:var(--tm);font-size:10px;cursor:pointer;">×</button></div>`;}).join("");}

function isBanned(tk){return BAN_LIST.includes(tk);}

function removeBan(tk){BAN_LIST=BAN_LIST.filter(b=>b!==tk);saveBan();renderBanList();}

function genCandles(tk,dt){
  const targetTk = tk||activeTk;
  const targetDt = dt||sim.date;

  // ── KIS API 연결 시: 실제 분봉 데이터 시도 ──
  // 일봉/연봉이 아닌 경우에만 (KIS 분봉 API는 분봉만 지원)
  if(kisConfig.appKey && kisConfig.appSecret && !(sim.tf==='D'||sim.tf.startsWith('D'))){
    _fetchKisCandles(targetTk, targetDt, sim.tf).then(candles => {
      if(candles && candles.length >= 5){
        // 실제 데이터 성공 — 차트에 적용
        sim.candles = candles;
        const prevCount = _kisChartMeta.prevCount || 0;
        const todayCount = _kisChartMeta.todayCount || candles.length;
        // sim.idx: 전일 마지막 봉에서 시작 (전일 분봉 끝 + 오늘 첫 봉 전)
        // 오늘 봉이 있으면 전일 마지막 봉에서 멈춤, 없으면 끝에서 시작
        sim.idx = prevCount > 0 ? prevCount - 1 : candles.length - 1;
        chartViewCount = Math.min(Math.max(prevCount + 20, 80), candles.length);
        chartViewStart = Math.max(0, candles.length - chartViewCount);
        if(candles.length > 0) updPrice(candles[sim.idx]);
        // 전일/당일 구분 정보 저장 (drawChart에서 사용)
        _kisChartMeta._prevCount = prevCount;
        drawChart();
        // 상단에 실제 데이터 표시
        const ci = document.getElementById('cinfo');
        const prevDateStr = _kisChartMeta.prevDate || '';
        if(ci) ci.textContent = `✅ 실제 ${candles.length}봉 | 전일${prevCount}봉+당일${todayCount}봉`;
        return;
      }
      // 실패 시 시뮬레이션으로 폴백
      _genSimCandles(targetTk, targetDt);
    }).catch(() => _genSimCandles(targetTk, targetDt));
    // KIS 요청 동안 임시로 시뮬 데이터 표시 (로딩 표시)
    _genSimCandles(targetTk, targetDt);
    const ci = document.getElementById('cinfo');
    if(ci) ci.textContent = '📡 KIS 실제 데이터 로딩 중...';
    return sim.candles; // 비동기 결과는 위 then에서 처리
  }

  // ── KIS 미연결: 시뮬레이션 ──
  return _genSimCandles(targetTk, targetDt);
}

let _kisChartMeta = {}; // 전일/당일 봉 수 등 메타데이터

async function _fetchKisCandles(code, date, tf){
  try{
    const r = await fetch('/api/kis/chart', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        appKey: kisConfig.appKey,
        appSecret: kisConfig.appSecret,
        mode: kisConfig.mode || 'real',
        code, date, tf: tf||'5',
      }),
    });
    const d = await r.json();
    if(d.ok && d.candles && d.candles.length > 0){
      // ★ 안전장치: 요청 일자와 응답 일자가 일치하는지 검증 (미래 데이터 차단)
      const reqDateNum = (date||'').replace(/-/g,'');
      const respDateNum = (d.date||'').replace(/-/g,'');
      if(reqDateNum && respDateNum && reqDateNum !== respDateNum){
        console.warn('⚠ KIS 응답 일자 불일치 — 요청:'+reqDateNum+' 응답:'+respDateNum+' → 시뮬 폴백');
        if(typeof addDecisionLog==='function') addDecisionLog('⚠ KIS 일자 불일치', '요청 '+date+' / 응답 '+d.date+' — 시뮬로 폴백', 'NOGO');
        return null;
      }
      _kisChartMeta = {
        prevCount: d.prevCount || 0,
        todayCount: d.todayCount || 0,
        prevDate: d.prevDate || '',
        todayDate: d.date || '',
      };
      return d.candles;
    }
    console.warn('KIS 차트 데이터 없음:', d.error);
    return null;
  }catch(e){
    console.warn('KIS 차트 fetch 실패:', e.message);
    return null;
  }
}

// 실제 호가창 KIS 데이터로 업데이트
async function _refreshKisOrderbook(){
  if(!kisConfig.appKey || !kisConfig.appSecret) return;
  try{
    const r = await fetch('/api/kis/orderbook', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        appKey: kisConfig.appKey, appSecret: kisConfig.appSecret,
        mode: kisConfig.mode || 'real', code: activeTk,
      }),
    });
    const d = await r.json();
    if(!d.ok) return;
    // 실제 호가 데이터로 호가창 렌더
    _renderRealOrderbook(d);
  }catch(e){}
}

function _renderRealOrderbook(d){
  const stk = STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const asks = d.asks||[], bids = d.bids||[];
  const maxQ = Math.max(...asks.map(a=>a.qty), ...bids.map(b=>b.qty), 1);

  let sell = `<div style="display:flex;justify-content:space-between;padding:3px 8px;background:rgba(37,99,235,.05);border-bottom:1px solid var(--br);font-family:var(--mono);font-size:9px;color:#2563eb;"><span>매도 총잔량</span><span>${(d.totalAsk||0).toLocaleString()}</span></div>`;
  [...asks].reverse().forEach(a => {
    const w = Math.min(100, (a.qty/maxQ*100)).toFixed(0);
    sell += `<div class="ob-r" onclick="document.getElementById('ofPr').value=${a.price};updOSum()"><div class="ob-bg s" style="width:${w}%"></div><div class="ob-p" style="color:#2563eb;">${a.price.toLocaleString()}</div><div class="ob-q">${a.qty.toLocaleString()}</div></div>`;
  });

  let buy = '';
  bids.forEach(b => {
    const w = Math.min(100, (b.qty/maxQ*100)).toFixed(0);
    buy += `<div class="ob-r" onclick="document.getElementById('ofPr').value=${b.price};updOSum()"><div class="ob-bg b" style="width:${w}%"></div><div class="ob-p" style="color:#dc2626;">${b.price.toLocaleString()}</div><div class="ob-q">${b.qty.toLocaleString()}</div></div>`;
  });
  buy += `<div style="display:flex;justify-content:space-between;padding:3px 8px;background:rgba(220,38,38,.05);border-top:1px solid var(--br);font-family:var(--mono);font-size:9px;color:#dc2626;"><span>매수 총잔량</span><span>${(d.totalBid||0).toLocaleString()}</span></div>`;

  document.getElementById('obSell').innerHTML = sell;
  document.getElementById('obBuy').innerHTML = buy;

  // 체결강도 실제값
  const strEl = document.getElementById('obStrength');
  if(strEl){ strEl.textContent = Math.round(d.strength||100); strEl.style.color = d.strength>=120?'#dc2626':d.strength>=100?'var(--b)':'#2563eb'; }
}

function _genSimCandles(tk,dt){
  const stk=STOCKS.find(s=>s.tk===(tk||activeTk))||STOCKS[0];
  let base=stk.base;
  const tkSeed=stk.tk.split("").reduce((a,c)=>a+c.charCodeAt(0),0);

  // ★ 일봉 처리 (D, D1Y, D2Y, D3Y)
  if(sim.tf==="D"||sim.tf.startsWith("D")){
    const yearMap = {"D":0.25,"D1Y":1,"D2Y":2,"D3Y":3};
    const years = yearMap[sim.tf]||0.25;
    const DAYS = Math.round(years * 252); // 연간 거래일 약 252일
    const seed=(parseInt((dt||sim.date).replace(/-/g,"").slice(-4))||9999)+tkSeed+Math.round(years*100);
    const rnd=rng32(seed);
    const res=[];
    const baseDate=new Date(dt||sim.date);
    let checked=0;
    while(res.length<DAYS){
      const d=new Date(baseDate);
      d.setDate(d.getDate()-(DAYS-res.length+checked));
      checked++;
      const dow=d.getDay();
      if(dow===0||dow===6) continue; // 주말 제외
      if(checked>DAYS*3) break;
      const r1=rnd(),r2=rnd(),r3=rnd(),r4=rnd();
      const chgPct=(r1-.495)*.022; // 일별 등락폭 약 ±2.2%
      const c=base*(1+chgPct);
      const range=Math.abs(c-base)*0.5+base*0.008;
      const h=Math.max(c,base)+range*r2;
      const l=Math.min(c,base)-range*r3;
      const o=base*(1+(r4-.5)*.008);
      const v=Math.round(5000000+r1*25000000);
      const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      res.push({t:ds,o:Math.round(o),h:Math.round(h),l:Math.round(l),c:Math.round(c),v});
      base=c;
    }
    sim.candles=res;
    // 일봉: 전체 보이도록 idx = 마지막
    sim.idx=res.length-1;
    chartViewCount=Math.min(res.length,120);
    chartViewStart=Math.max(0,res.length-chartViewCount);
    if(res.length>0)updPrice(res[res.length-1]);
    return res;
  }

  // 분봉 처리 (전일 + 당일을 합쳐서 표시)
  const intervals=parseInt(sim.tf)||5;
  const perDay=Math.floor(390/intervals);
  const _curDt = dt||sim.date;
  // 전일(영업일) 계산
  const _prevDate=(function(){
    const d=new Date(_curDt);
    do{d.setDate(d.getDate()-1);}while(d.getDay()===0||d.getDay()===6);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();
  const _genDay=function(dayStr,isPrev){
    const seed=(parseInt(dayStr.replace(/-/g,"").slice(-6))||9999)+tkSeed+(isPrev?1:0);
    const rnd=rng32(seed);
    const out=[];
    for(let i=0;i<perDay;i++){
      const r1=rnd(),r2=rnd(),r3=rnd(),r4=rnd();
      const c=base*(1+(r1-.498)*.018);
      const h=c*(1+r2*.009),l=c*(1-r3*.009),o=base*(1+(r4-.5)*.007);
      const v=Math.round(40000+r1*170000);
      const hm=9*60+i*intervals;
      out.push({t:`${String(Math.floor(hm/60)).padStart(2,"0")}:${String(hm%60).padStart(2,"0")}`,date:dayStr,isPrev:!!isPrev,o:Math.round(o),h:Math.round(Math.max(o,c,h)),l:Math.round(Math.min(o,c,l)),c:Math.round(c),v});
      base=c;
    }
    return out;
  };
  const prevCandles=_genDay(_prevDate,true);
  const todayCandles=_genDay(_curDt,false);
  const res=[...prevCandles,...todayCandles];
  sim.candles=res;
  // 시뮬에서도 KIS와 동일하게 메타데이터 채움 (전일+당일 표시용)
  _kisChartMeta={prevCount:prevCandles.length,todayCount:todayCandles.length,prevDate:_prevDate,todayDate:_curDt};
  _kisChartMeta._prevCount=prevCandles.length;
  // 전일 마지막 봉에서 시작 (당일 첫 봉 전 — 자연스러운 진입점)
  sim.idx=prevCandles.length>0?prevCandles.length-1:0;
  if(res.length>0)updPrice(res[sim.idx]);
  return res;
}

// ── 추가 전역 변수/함수 ──
let BAN_LIST=safeParseJSON(localStorage.getItem("htsBan"), []);
function addBanCurrent(){const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];if(!BAN_LIST.includes(activeTk)){BAN_LIST.push(activeTk);saveBan();renderBanList();showAlert("매매금지 추가",stk.nm+" 매매금지 등록됨");}}
function addPending(tk,nm,side,price,qty){const id=Date.now();pendingOrders.push({id,tk,nm,side,price,qty,time:new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})});renderPending();return id;}
let autoState={running:false,level:0,cfg:{rr:1.5,pos:30,stop:3,t1:3,t2:5,trail:"off",brk:false,explain:true}};
let autoTimer=null;
function cancelPending(id){pendingOrders=pendingOrders.filter(o=>o.id!==id);renderPending();}
let chatHist=[],chatBusy=false;
function checkPending(){pendingOrders.forEach((o,i)=>{const stk=STOCKS.find(s=>s.tk===o.tk);if(!stk)return;const hit=(o.side==="buy"&&stk.pr<=o.price)||(o.side==="sell"&&stk.pr>=o.price);if(hit){const prev=activeTk,prevSide=oSide,prevType=oType;activeTk=o.tk;oSide=o.side;oType="market";document.getElementById("ofQty").value=o.qty;submitOrder(true);activeTk=prev;oSide=prevSide;oType=prevType;pendingOrders.splice(i,1);addMsg("ai",`✅ 지정가 체결: ${o.nm} ${o.side==="buy"?"매수":"매도"} ${o.price.toLocaleString()}원 × ${o.qty}주`);renderPending();}});}
let pendingOrders=[];
let priceAlerts=[]; // [{tk,price,dir:'above'|'below',memo,fired}]
function saveBan(){const v=JSON.stringify(BAN_LIST);localStorage.setItem("htsBan",v);saveToServer("htsBan",v);}
let stopOrders={};

// ═══════════════════════════════
// STATE
// ═══════════════════════════════
let cfg={capital:10000000,dayloss:3,maxpos:50,clim:200,mlim:0,crate:8.5,mrate:12,bf:0.015,sf:0.015,tx:0.18,bd:false,al:true};
let mock={cash:10000000,positions:{},trades:[],todayPnl:0,todayTrades:0,lossSeries:0,creditUsed:0,marginUsed:0};
let sim={playing:false,speed:60,idx:0,candles:[],timer:null,date:todayStr(),tf:"1"};

function openSettings(){openModal('settings');}
// ═══════════════════════════════════════════════════════
// ★★★ 절대 원칙: 미래 데이터 참조 완전 차단 ★★★
// 모든 봉 데이터 접근은 반드시 아래 함수를 통해서만.
// sim.candles를 직접 쓰는 건 genCandles, updChartToIdx 등
// 내부 관리 코드에서만 허용. 분석/표시 목적은 전부 아래 사용.
// ═══════════════════════════════════════════════════════

/**
 * 현재 시각(sim.idx)까지의 봉만 반환. 절대 미래 봉 없음.
 * @param {number} [minLen=1] 최소 봉 수 (부족하면 있는 것만)
 * @returns {Array} 현재까지 발생한 봉 배열
 */
function getCandles(minLen=1){
  const cut = Math.max(Math.min(sim.idx+1, sim.candles.length), minLen);
  return sim.candles.slice(0, cut);
}

/**
 * 현재 봉 (가장 최근 확정된 봉).
 * @returns {Object|null}
 */
function getCurrentCandle(){
  const cs = getCandles(1);
  return cs.length ? cs[cs.length-1] : null;
}

/**
 * 현재까지 봉에서 마지막 N개 반환 (분석용 슬라이딩 윈도우).
 * @param {number} n
 * @returns {Array}
 */
function getRecentCandles(n){
  return getCandles(1).slice(-Math.abs(n));
}

// 미래 데이터 접근 감지기 (개발 중 경고)
// sim.candles를 idx 제한 없이 쓰면 콘솔에 경고
const _origCandles = sim.candles;
// 주의: sim.candles 자체를 Proxy로 감싸면 성능 저하.
// 대신 분석 코드에서 getCandles() 사용을 강제함.
let activeTk="005930",oSide="buy",oType="limit",credType="cash",trailMode="off";
let inds={ma:true,vol:true,rsi:false,macd:false,bb:false,vwap:false};
// ═══════════════════════════════════════════════
// PURE CANVAS CHART ENGINE v3
// Chart.js 완전 제거 — 직접 렌더링
// ═══════════════════════════════════════════════

let mChart=null,rsiChart=null,macdChart=null,pnlChart=null;
let chartViewStart=0,chartViewCount=60;
let _chartRaf=null;

// 뷰 상태
function _cvAll(){
  // ★ 미래 참조 금지 — getCandles() 통해서만
  return getCandles(1);
}
function _cvCs(){
  const a=_cvAll();
  chartViewCount=Math.max(10,Math.min(chartViewCount,a.length));
  chartViewStart=Math.max(0,Math.min(chartViewStart,a.length-chartViewCount));
  return a.slice(chartViewStart,chartViewStart+chartViewCount);
}

// ── 메인 차트 렌더 ──────────────────────────────
function drawChart(){
  const canvas=document.getElementById("mainChart");
  if(!canvas)return;
  // 부모 div(.chart-main)의 실제 크기로 canvas 설정
  const parent=canvas.parentElement;
  const W=parent?Math.round(parent.getBoundingClientRect().width)||parent.offsetWidth||600:600;
  const H=parent?Math.round(parent.getBoundingClientRect().height)||parent.offsetHeight||400:400;
  if(W<20||H<20){
    requestAnimationFrame(()=>drawChart());
    return;
  }
  if(canvas.width!==W){canvas.width=W;}
  if(canvas.height!==H){canvas.height=H;}
  const ctx=canvas.getContext("2d");

  const cs=_cvCs();
  // 디버그: cinfo에 실제 상태 표시
  const ci=document.getElementById('cinfo');
  if(ci)ci.textContent=`W=${W} H=${H} 봉=${cs.length} tf=${sim.tf}`;
  if(!cs.length){ctx.clearRect(0,0,W,H);return;}
  const cls=cs.map(c=>c.c),vls=cs.map(c=>c.v);

  // 패딩
  const PR=54,PL=4,PT=8,PB=22;
  const SB=12; // 스크롤바 높이
  const volH=inds.vol?Math.floor(H*0.20):0;
  const mainH=H-PT-PB-volH-SB;
  const cw=W-PL-PR;

  // Y범위
  const prices=cs.flatMap(c=>[c.h,c.l]).filter(v=>v>0);
  let yMin=Math.min(...prices),yMax=Math.max(...prices);
  const yPad=(yMax-yMin)*0.06||yMin*0.005||1;
  yMin-=yPad; yMax+=yPad;
  const yR=yMax-yMin||1;

  const toX=i=>PL+(i+0.5)*(cw/cs.length);
  const toY=v=>PT+mainH*(1-(v-yMin)/yR);
  const bw=Math.max(1.5,Math.min(10,cw/cs.length*0.55));

  // 배경
  ctx.clearRect(0,0,W,H);
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--pan').trim()||'#ffffff';
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // 그리드 + Y축 레이블
  ctx.strokeStyle='rgba(0,0,0,.05)'; ctx.lineWidth=1;
  ctx.fillStyle='#8c9db5'; ctx.font='9px "JetBrains Mono",monospace'; ctx.textAlign='left';
  for(let i=1;i<=4;i++){
    const y=PT+mainH*i/4;
    ctx.beginPath();ctx.moveTo(PL,y);ctx.lineTo(W-PR,y);ctx.stroke();
    const v=yMax-yR*i/4;
    const label=v>=10000?Math.round(v/100)/10+'k':v>=1000?v.toLocaleString():v.toFixed(0);
    ctx.fillText(label,W-PR+4,y+3);
  }

  // 볼린저밴드
  if(inds.bb){
    const{upper,lower}=calcBB(cls,20,2);
    ctx.strokeStyle='rgba(139,92,246,.45)';ctx.lineWidth=1;ctx.setLineDash([4,3]);
    for(const arr of[upper,lower]){
      ctx.beginPath();
      arr.forEach((v,i)=>{if(v==null)return;
        (i===0||arr[i-1]==null)?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v));});
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // VWAP
  if(inds.vwap){
    const vw=calcVWAP(cs);
    ctx.strokeStyle='#06b6d4';ctx.lineWidth=1.5;ctx.setLineDash([5,3]);
    ctx.beginPath();
    vw.forEach((v,i)=>{if(v==null)return;
      (i===0||vw[i-1]==null)?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v));});
    ctx.stroke();ctx.setLineDash([]);
  }

  // 이동평균선
  if(inds.ma){
    [['MA5','#f59e0b',5],['MA20','#10b981',20],['MA60','#ef4444',60]].forEach(([,col,n])=>{
      const ma=calcMA(cls,n);
      ctx.strokeStyle=col;ctx.lineWidth=1.5;
      ctx.beginPath();
      ma.forEach((v,i)=>{if(v==null)return;
        (i===0||ma[i-1]==null)?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v));});
      ctx.stroke();
    });
  }

  // 캔들
  cs.forEach((c,i)=>{
    const x=toX(i),yO=toY(c.o),yC=toY(c.c),yH=toY(c.h),yL=toY(c.l);
    const up=c.c>=c.o,col=up?'#dc2626':'#2563eb';
    const top=Math.min(yO,yC),ht=Math.max(1,Math.abs(yO-yC));
    ctx.strokeStyle=col;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x,yH);ctx.lineTo(x,top);
    ctx.moveTo(x,top+ht);ctx.lineTo(x,yL);ctx.stroke();
    ctx.fillStyle=col;ctx.fillRect(x-bw/2,top,bw,ht);
  });

  // X축 레이블
  ctx.fillStyle='#8c9db5';ctx.font='8px "JetBrains Mono",monospace';ctx.textAlign='center';
  const step=Math.max(1,Math.floor(cs.length/8));
  cs.forEach((c,i)=>{if(i%step===0)ctx.fillText(c.t,toX(i),PT+mainH+14);});

  // ── 전일/당일 구분선 (실제 KIS 데이터일 때) ──
  const _prevCnt = _kisChartMeta?._prevCount || 0;
  if(_prevCnt > 0 && _prevCnt < cs.length){
    // 뷰포트 내 전일 마지막 봉 인덱스 계산
    const absIdx = _prevCnt - 1; // candles 전체에서의 인덱스
    const viewIdx = absIdx - chartViewStart; // 현재 뷰에서의 인덱스
    if(viewIdx >= 0 && viewIdx < cs.length){
      const lx = toX(viewIdx) + (cw/cs.length)/2; // 봉과 봉 사이
      ctx.save();
      ctx.strokeStyle = 'rgba(49,130,246,.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4,3]);
      ctx.beginPath();
      ctx.moveTo(lx, PT);
      ctx.lineTo(lx, PT + mainH);
      ctx.stroke();
      ctx.setLineDash([]);
      // "전일" 레이블
      ctx.fillStyle = 'rgba(49,130,246,.85)';
      ctx.font = 'bold 8px "JetBrains Mono",monospace';
      ctx.textAlign = 'center';
      const lbl = '전일↑오늘';
      const lblW = ctx.measureText(lbl).width + 6;
      ctx.fillRect(lx - lblW/2, PT + 2, lblW, 13);
      ctx.fillStyle = '#fff';
      ctx.fillText(lbl, lx, PT + 12);
      ctx.restore();
    }
  }

  // 거래량
  if(volH>0){
    const vY0=PT+mainH+PB+2;
    const vMax=Math.max(...vls)||1;
    ctx.fillStyle='rgba(0,0,0,.04)';ctx.fillRect(PL,vY0,cw,volH-4);
    cs.forEach((c,i)=>{
      const x=toX(i),bh=Math.max(1,(c.v/vMax)*(volH-4));
      ctx.fillStyle=c.c>=c.o?'rgba(220,38,38,.45)':'rgba(37,99,235,.45)';
      ctx.fillRect(x-bw/2,vY0+volH-4-bh,bw,bh);
    });
  }

  // ── 스크롤바 ────────────────────────────────────
  const all=_cvAll();
  if(all.length>chartViewCount){
    const sbY=H-SB;
    // roundRect 미지원 브라우저 대비 fillRect 사용
    ctx.fillStyle='rgba(0,0,0,.08)';
    ctx.fillRect(PL,sbY+1,cw,SB-2);
    const tw=Math.max(20,cw*(chartViewCount/all.length));
    const tx=PL+cw*(chartViewStart/all.length);
    ctx.fillStyle='rgba(0,0,0,.3)';
    ctx.fillRect(tx,sbY+1,tw,SB-2);
  }

  // 십자선
  if(canvas._cx!=null){
    ctx.strokeStyle='rgba(107,118,132,.5)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(canvas._cx,PT);ctx.lineTo(canvas._cx,PT+mainH);ctx.stroke();
    ctx.beginPath();ctx.moveTo(PL,canvas._cy);ctx.lineTo(W-PR,canvas._cy);ctx.stroke();
    ctx.setLineDash([]);
    const pv=yMax-((canvas._cy-PT)/mainH)*yR;
    if(pv>0){
      ctx.fillStyle='#191f28';ctx.font='bold 9px "JetBrains Mono",monospace';ctx.textAlign='left';
      ctx.fillText(Math.round(pv).toLocaleString(),W-PR+4,canvas._cy+3);
    }
    // 해당 캔들 OHLCV 표시
    const idx=Math.floor((canvas._cx-PL)/(cw/cs.length));
    if(idx>=0&&idx<cs.length){
      const c=cs[idx];
      const ci=document.getElementById('cinfo');
      if(ci)ci.textContent=`O${c.o.toLocaleString()} H${c.h.toLocaleString()} L${c.l.toLocaleString()} C${c.c.toLocaleString()} V${c.v.toLocaleString()}`;
    }
  }

  // RSI/MACD 서브차트
  _drawRSI(cs,cls);
  _drawMACD(cs,cls);

  mChart={_ok:true};

  // ── 매수/매도 체결 마커 ──
  try{
    var _trades=(mock.trades||[]).filter(function(t){
      return t.tk===activeTk&&t.date===sim.date&&(t.side==='buy'||t.side==='sell');
    });
    _trades.forEach(function(t){
      var matchIdx=-1;
      if(t.barTime){
        for(var bi=0;bi<cs.length;bi++){
          if(cs[bi].t===t.barTime){matchIdx=bi;break;}
        }
      }
      if(matchIdx<0) return;
      var x=toX(matchIdx);
      var _tpr=t.price||t.pr||0;
      if(!_tpr) return;
      var yPr=toY(_tpr);
      var isBuy=t.side==='buy';
      ctx.save();
      ctx.fillStyle=isBuy?'#00c471':'#ff4757';
      ctx.strokeStyle=isBuy?'#008855':'#cc1133';
      ctx.lineWidth=1.5;
      ctx.beginPath();
      if(isBuy){
        ctx.moveTo(x,yPr+14);ctx.lineTo(x-5,yPr+4);ctx.lineTo(x+5,yPr+4);
      }else{
        ctx.moveTo(x,yPr-14);ctx.lineTo(x-5,yPr-4);ctx.lineTo(x+5,yPr-4);
      }
      ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle=isBuy?'#00c471':'#ff4757';
      ctx.font='bold 8px monospace';
      ctx.textAlign='center';
      ctx.fillText(_tpr.toLocaleString(),x,isBuy?yPr+25:yPr-17);
      ctx.restore();
    });
  }catch(_me){}
  // AI 타점 오버레이
  drawSignalOverlay();
}

function _drawRSI(cs,cls){
  const el=document.getElementById('rsiSub'),cv=document.getElementById('rsiCanvas');
  if(!inds.rsi){if(el)el.classList.add('hide');return;}
  if(!el||!cv)return; el.classList.remove('hide');
  const r=cv.getBoundingClientRect();
  const W=Math.round(r.width)||cv.offsetWidth||600;
  const H=Math.round(r.height)||cv.offsetHeight||60;
  if(W<10||H<10)return;
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H;}
  const ctx=cv.getContext('2d');
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  const rsi=calcRSI(cls,14);
  const PL=4,PR=54,PT=2,PB=2,cw=W-PL-PR,ch=H-PT-PB;
  const toX=i=>PL+(i+0.5)*(cw/cs.length);
  const toY=v=>PT+ch*(1-v/100);
  [[70,'rgba(220,38,38,.2)'],[50,'rgba(0,0,0,.08)'],[30,'rgba(37,99,235,.2)']].forEach(([v,c])=>{
    ctx.strokeStyle=c;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(PL,toY(v));ctx.lineTo(W-PR,toY(v));ctx.stroke();
    ctx.fillStyle='#8c9db5';ctx.font='8px "JetBrains Mono",monospace';ctx.textAlign='left';
    ctx.fillText(v,W-PR+4,toY(v)+3);
  });
  ctx.strokeStyle='#a78bfa';ctx.lineWidth=1.5;
  ctx.beginPath();
  rsi.forEach((v,i)=>{if(v==null)return;(i===0||rsi[i-1]==null)?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v));});
  ctx.stroke();
}

function _drawMACD(cs,cls){
  const el=document.getElementById('macdSub'),cv=document.getElementById('macdCanvas');
  if(!inds.macd){if(el)el.classList.add('hide');return;}
  if(!el||!cv)return; el.classList.remove('hide');
  const r=cv.getBoundingClientRect();
  const W=Math.round(r.width)||cv.offsetWidth||600;
  const H=Math.round(r.height)||cv.offsetHeight||60;
  if(W<10||H<10)return;
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H;}
  const ctx=cv.getContext('2d');
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  const{ml,sig}=calcMACD(cls);
  const all=[...ml,...sig].filter(v=>v!=null);
  if(!all.length)return;
  let vMin=Math.min(...all),vMax=Math.max(...all);
  const vP=(vMax-vMin)*0.1||0.1;
  vMin-=vP;vMax+=vP;
  const vR=vMax-vMin||1;
  const PL=4,PR=54,PT=2,PB=2,cw=W-PL-PR,ch=H-PT-PB;
  const toX=i=>PL+(i+0.5)*(cw/cs.length);
  const toY=v=>PT+ch*(1-(v-vMin)/vR);
  // 0선
  ctx.strokeStyle='rgba(0,0,0,.1)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(PL,toY(0));ctx.lineTo(W-PR,toY(0));ctx.stroke();
  [['ml','#3b82f6'],['sig','#f59e0b']].forEach(([k,col])=>{
    const arr=k==='ml'?ml:sig;
    ctx.strokeStyle=col;ctx.lineWidth=1.5;
    ctx.beginPath();
    arr.forEach((v,i)=>{if(v==null)return;(i===0||arr[i-1]==null)?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v));});
    ctx.stroke();
  });
}

// ── initChart (호환성 유지) ──
function initChart(){
  requestAnimationFrame(()=>drawChart());
}
function initSub(){}
function initSubMACD(){}

// ── 이벤트 (wrap div에 1회만) ──
function initChartEvents(){
  const wrap=document.querySelector('.chart-main');
  if(!wrap||wrap._evtOk)return;
  wrap._evtOk=true;

  // 마우스 이동 (십자선)
  wrap.addEventListener('mousemove',e=>{
    const cv=document.getElementById('mainChart');
    if(!cv)return;
    const r=wrap.getBoundingClientRect();
    cv._cx=e.clientX-r.left; cv._cy=e.clientY-r.top;
    drawChart();
  });
  wrap.addEventListener('mouseleave',()=>{
    const cv=document.getElementById('mainChart');
    if(cv){cv._cx=null;cv._cy=null;} drawChart();
  });

  // 휠 줌
  wrap.addEventListener('wheel',e=>{
    e.preventDefault();
    const a=_cvAll();if(!a.length)return;
    const factor=e.deltaY>0?1.25:0.8;
    const center=chartViewStart+chartViewCount/2;
    chartViewCount=Math.max(10,Math.min(Math.round(chartViewCount*factor),a.length));
    chartViewStart=Math.max(0,Math.min(Math.round(center-chartViewCount/2),a.length-chartViewCount));
    drawChart();
  },{passive:false});

  // 드래그 팬
  let dragX=null,dragBase=0;
  wrap.addEventListener('mousedown',e=>{dragX=e.clientX;dragBase=chartViewStart;window._chartUserDragging=true;window._followLatest=false;});
  window.addEventListener('mousemove',e=>{
    if(dragX===null)return;
    const a=_cvAll();if(!a.length)return;
    const w=wrap.clientWidth||800;
    const shift=Math.round(-(e.clientX-dragX)/(w/Math.max(chartViewCount,1)));
    chartViewStart=Math.max(0,Math.min(dragBase+shift,a.length-chartViewCount));
    drawChart();
  });
  window.addEventListener('mouseup',()=>{
    dragX=null;
    // 드래그 종료 → 약간 후 auto-follow 복귀 (마지막 봉 근처면)
    setTimeout(()=>{
      window._chartUserDragging=false;
      const a=_cvAll();
      // 사용자가 끝에서 3봉 이내에 두면 자동 follow 모드 ON
      if(a.length && chartViewStart + chartViewCount >= a.length - 3){
        window._followLatest = true;
      }
    }, 700);
  });
  // 터치 끝났을 때도 동일
  wrap.addEventListener('touchend',()=>{
    setTimeout(()=>{
      window._chartUserDragging=false;
      const a=_cvAll();
      if(a.length && chartViewStart + chartViewCount >= a.length - 3){
        window._followLatest = true;
      }
    }, 700);
  });

  // 스크롤바 드래그
  let sbDrag=false,sbDragX=0,sbDragBase=0;
  wrap.addEventListener('mousedown',e=>{
    const cv=document.getElementById('mainChart');
    if(!cv)return;
    const H=cv.clientHeight||300;
    const SB=8;
    const r=wrap.getBoundingClientRect();
    const ly=e.clientY-r.top;
    if(ly>=H-SB){
      sbDrag=true; sbDragX=e.clientX; sbDragBase=chartViewStart;
      dragX=null; // 스크롤바 드래그 중엔 팬 비활성
    }
  });
  window.addEventListener('mousemove',e=>{
    if(!sbDrag)return;
    const a=_cvAll();if(!a.length)return;
    const cv=document.getElementById('mainChart');
    if(!cv)return;
    const w=(cv.clientWidth||800)-4-54;
    const total=a.length;
    const px_per_candle=w/total;
    const shift=Math.round((e.clientX-sbDragX)/px_per_candle);
    chartViewStart=Math.max(0,Math.min(sbDragBase+shift,total-chartViewCount));
    drawChart();
  });
  window.addEventListener('mouseup',()=>{sbDrag=false;});

  // 터치 (스와이프+핀치+스크롤바)
  let tx=null,txBase=0,tDist=null,txStartY=0;
  let sbTouch=false,sbTouchX=0,sbTouchBase=0;

  wrap.addEventListener('touchstart',e=>{
    const a=_cvAll();
    if(e.touches.length===1){
      const cv=document.getElementById('mainChart');
      const r=wrap.getBoundingClientRect();
      const ly=e.touches[0].clientY-r.top;
      const cvH=cv?cv.height||wrap.clientHeight||400:400;
      const SB=8;
      if(ly>=cvH-SB-4){
        // 스크롤바 영역 터치
        sbTouch=true; sbTouchX=e.touches[0].clientX; sbTouchBase=chartViewStart; window._chartUserDragging=true;
      } else {
        sbTouch=false;
        tx=e.touches[0].clientX; txBase=chartViewStart; txStartY=e.touches[0].clientY;
      }
    }
    if(e.touches.length===2){
      tDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      tx=null; sbTouch=false;
    }
  },{passive:true});

  wrap.addEventListener('touchmove',e=>{
    e.preventDefault();
    const a=_cvAll();if(!a.length)return;
    const w=wrap.clientWidth||800;

    if(e.touches.length===1){
      if(sbTouch){
        // 스크롤바 드래그
        const cv=document.getElementById('mainChart');
        const cw=w-4-54;
        const shift=Math.round((e.touches[0].clientX-sbTouchX)/(cw/a.length));
        chartViewStart=Math.max(0,Math.min(sbTouchBase+shift,a.length-chartViewCount));
        drawChart();
      } else if(tx!==null){
        // 일반 팬
        const shift=Math.round(-(e.touches[0].clientX-tx)/(w/Math.max(chartViewCount,1)));
        chartViewStart=Math.max(0,Math.min(txBase+shift,a.length-chartViewCount));
        drawChart();
      }
    }

    if(e.touches.length===2&&tDist){
      const nd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      const factor=tDist/nd; tDist=nd;
      const center=chartViewStart+chartViewCount/2;
      chartViewCount=Math.max(10,Math.min(Math.round(chartViewCount*factor),a.length));
      chartViewStart=Math.max(0,Math.min(Math.round(center-chartViewCount/2),a.length-chartViewCount));
      drawChart();
    }
  },{passive:false});

  wrap.addEventListener('touchend',()=>{tx=null;tDist=null;sbTouch=false;});
}

// ── 줌 버튼 ──
function chartZoom(f){
  const a=_cvAll();if(!a.length)return;
  const center=chartViewStart+chartViewCount/2;
  chartViewCount=Math.max(10,Math.min(Math.round(chartViewCount*f),a.length));
  chartViewStart=Math.max(0,Math.min(Math.round(center-chartViewCount/2),a.length-chartViewCount));
  drawChart();
}
function chartReset(){
  const a=_cvAll();
  const sel=document.getElementById('candleCount');
  chartViewCount=Math.min(parseInt(sel?.value||60),a.length)||a.length;
  chartViewStart=Math.max(0,a.length-chartViewCount);
  drawChart();
}
function chartSetCount(val){
  const a=_cvAll();
  chartViewCount=Math.min(parseInt(val)||80,a.length)||a.length;
  chartViewStart=Math.max(0,a.length-chartViewCount);
  drawChart();
}

// ── 시뮬레이션 업데이트 (Chart.js 없이) ──


// resize observer (캔버스 크기 변경 시 재렌더)
function _initResizeObserver(){
  const wrap=document.querySelector('.chart-main');
  if(!wrap||wrap._roOk)return;
  wrap._roOk=true;
  let rafPending=false;
  const schedDraw=()=>{
    if(rafPending)return;
    rafPending=true;
    requestAnimationFrame(()=>{rafPending=false;drawChart();});
  };
  if(typeof ResizeObserver!=='undefined'){
    // canvas.width 변경은 drawChart 내부에서만 — observer에선 drawChart만 호출
    const ro=new ResizeObserver(()=>schedDraw());
    ro.observe(wrap);
  }
  // 초기 렌더 (rAF 두 번 — 레이아웃 완성 보장)
  requestAnimationFrame(()=>requestAnimationFrame(()=>drawChart()));
}


// ═══════════════════════════════
// SIMULATION
// ═══════════════════════════════
function togPlay(){
  // 끝에 있으면 처음부터 시작
  if(!sim.playing && sim.idx >= sim.candles.length-1){
    sim.idx=0;
    updChartToIdx();
  }
  sim.playing=!sim.playing;
  _syncPlayBtn();
  if(sim.playing){runStep();}
  else{if(sim.timer){clearTimeout(sim.timer);sim.timer=null;}}
}
function _syncPlayBtn(){
  const btn=document.getElementById("playBtn");
  if(!btn)return;
  if(sim.playing){
    btn.innerHTML='⏸';
    btn.style.background='var(--g)';
    btn.style.boxShadow='0 2px 8px rgba(5,192,114,.3)';
    btn.title='일시정지';
  }else{
    btn.innerHTML='▶';
    btn.style.background='var(--b)';
    btn.style.boxShadow='0 2px 8px rgba(49,130,246,.3)';
    btn.title='재생';
  }
}
function runStep(){
  if(!sim.playing)return;
  sim.idx=Math.min(sim.idx+1,sim.candles.length-1);
  updChartToIdx();
  if(sim.idx>=sim.candles.length-1){
    // 백테스트 모드면 다음 영업일로 자동 점프
    if(window.backtest && backtest.running){
      _backtestEndOfDay();
      return;
    }
    sim.playing=false;
    _syncPlayBtn();
    return;
  }
  // ★ 1배속 = 실제 시간 기준
  // 1분봉: 60초/봉, 5분봉: 300초/봉, 15분봉: 900초/봉
  // 일봉/연봉: 하루를 1단위, 분봉: 해당 분
  const isDaily = sim.tf==='D'||sim.tf.startsWith('D');
  const tfMin = isDaily ? 390 : (parseInt(sim.tf)||5);
  const realMs = tfMin * 60 * 1000;
  const delay = Math.max(20, realMs / sim.speed);
  sim.timer=setTimeout(runStep, delay);
}
function setSpd(el,v){sim.speed=v;document.querySelectorAll(".spd-btn").forEach(b=>b.classList.remove("on"));el.classList.add("on");}

// ═══════════════════════════════════════════════
// 노션 강의 자동 동기화 — Claude 프롬프트에 강의 원칙 첨부
// ═══════════════════════════════════════════════
window.lectureContent = (function(){
  try{ return localStorage.getItem('htsLectureContent') || ''; }catch(e){ return ''; }
})();
window.lectureUpdatedAt = (function(){
  try{ return parseInt(localStorage.getItem('htsLectureUpdatedAt')||'0'); }catch(e){ return 0; }
})();
// 노션 연결 테스트 (설정창 버튼)
async function testNotionConnection(){
  const el = document.getElementById('notion-status');
  if(el){ el.textContent='🔄 테스트 중...'; el.style.color='var(--tm)'; }
  // 입력란 값으로 임시 저장 후 fetch
  const nt = document.getElementById('notion-token')?.value?.trim() || '';
  const np = document.getElementById('notion-page-id')?.value?.trim() || NOTION_LECTURE_PAGE_ID_DEFAULT;
  if(!nt){
    if(el){ el.textContent='⚠ 토큰을 먼저 입력하세요'; el.style.color='var(--r)'; }
    return;
  }
  // 서버에 토큰부터 저장
  try{
    await fetch('/api/save-config', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notionToken:nt, notionPageId:np})});
  }catch(_e){}
  try{
    const r = await fetch('/api/notion-lecture?pageId='+encodeURIComponent(np), {cache:'no-store'});
    const d = await r.json();
    if(d.ok){
      if(el){ el.textContent='✅ Notion 연결 성공 — '+d.length+'자 가져옴'; el.style.color='var(--g)'; }
      try{ refreshLecture&&refreshLecture(true); }catch(_e){}
    } else {
      if(el){ el.textContent='❌ '+(d.error||'연결 실패'); el.style.color='var(--r)'; }
    }
  }catch(e){
    if(el){ el.textContent='❌ '+e.message; el.style.color='var(--r)'; }
  }
}

async function refreshLecture(force){
  const now = Date.now();
  // 6시간 캐시 (force=true면 무시)
  if(!force && now - lectureUpdatedAt < 6*60*60*1000 && lectureContent) return lectureContent;
  try{
    // 기본 강의 페이지 ID 자동 첨부 (env 설정돼 있으면 서버가 그쪽 우선)
    const r = await fetch('/api/notion-lecture?pageId=' + encodeURIComponent(NOTION_LECTURE_PAGE_ID_DEFAULT||''), {cache:'no-store'});
    const d = await r.json();
    if(d.ok && d.content){
      window.lectureContent = d.content;
      window.lectureUpdatedAt = now;
      try{
        localStorage.setItem('htsLectureContent', d.content);
        localStorage.setItem('htsLectureUpdatedAt', String(now));
        saveToServer('htsLectureContent', d.content);
        saveToServer('htsLectureUpdatedAt', String(now));
      }catch(e){}
      addDecisionLog('📚 강의 동기화 완료', '노션 페이지 '+d.length+'자 가져옴', '학습');
      return d.content;
    } else {
      console.warn('강의 fetch:', d.error);
      return lectureContent || '';
    }
  }catch(e){
    console.warn('강의 fetch error:', e.message);
    return lectureContent || '';
  }
}
function getLectureContext(maxChars){
  if(!lectureContent) return '';
  const max = maxChars || 3000;
  const content = lectureContent.length > max ? lectureContent.slice(0, max) + '\n...(이하 생략)' : lectureContent;
  return '【강의 원칙 — 반드시 이 규칙을 우선 적용할 것】\n' + content + '\n\n';
}

// ═══════════════════════════════════════════════
// 학습 메모리 — 매매일지에서 누적된 깨달음
// ═══════════════════════════════════════════════
window.learningMemory = (function(){
  try{ const s=localStorage.getItem('htsLearningMemory'); return s?JSON.parse(s):[]; }catch(e){ return []; }
})();
window.learnedDates = (function(){
  try{ const s=localStorage.getItem('htsLearnedDates'); return s?JSON.parse(s):[]; }catch(e){ return []; }
})();
function appendLesson(date, ai){
  const items=[];
  if(ai.bad && ai.bad !== '-' && ai.bad !== '없음') items.push({date, category:'반성', text:ai.bad});
  if(ai.improvement && ai.improvement !== '-') items.push({date, category:'개선', text:ai.improvement});
  if(ai.mentor_comment && ai.mentor_comment !== '-') items.push({date, category:'멘토', text:ai.mentor_comment});
  if(ai.psychology && ai.psychology !== '-') items.push({date, category:'심리', text:ai.psychology});
  if(!items.length) return;
  learningMemory.push(...items);
  // 최근 80개만 유지 (오래된 건 자연 망각)
  if(learningMemory.length > 80) learningMemory = learningMemory.slice(-80);
  window.learningMemory = learningMemory;
  // 학습 일자 목록 (진화 단계 계산용)
  if(!learnedDates.includes(date)){
    learnedDates.push(date);
    if(learnedDates.length > 200) learnedDates = learnedDates.slice(-200);
    window.learnedDates = learnedDates;
    saveToServer('htsLearnedDates', JSON.stringify(learnedDates));
  }
  saveToServer('htsLearningMemory', JSON.stringify(learningMemory));
  updateLearnerStage();
}
function getLearningContext(maxItems){
  if(!learningMemory || !learningMemory.length) return '';
  const recent = learningMemory.slice(-(maxItems||12));
  // 카테고리별 그룹화
  const byCat={};
  recent.forEach(l=>{ (byCat[l.category]=byCat[l.category]||[]).push(l.text); });
  let out = '【지금까지 깨달은 것 — 같은 실수 반복 금지】\n';
  Object.keys(byCat).forEach(c=>{
    byCat[c].slice(-3).forEach(t=>{ out += `• [${c}] ${t}\n`; });
  });
  return out + '\n';
}
function getLearnerStage(){
  const n = learnedDates.length;
  if(n >= 50) return {lv:4, label:'전문가', color:'var(--p)', next:'무한'};
  if(n >= 20) return {lv:3, label:'숙련', color:'var(--g)', next:50-n+'일 더'};
  if(n >= 6)  return {lv:2, label:'학습', color:'var(--b)', next:20-n+'일 더'};
  return {lv:1, label:'초보', color:'var(--a)', next:6-n+'일 더'};
}
function updateLearnerStage(){
  const el = document.getElementById('learnerStageBadge');
  if(!el) return;
  const s = getLearnerStage();
  el.innerHTML = `<span style="background:${s.color};color:#fff;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:700;">Lv${s.lv} ${s.label}</span> <span style="font-size:8px;color:var(--tm);">${learnedDates.length}일 학습 · 노트 ${learningMemory.length}건 · ${s.next}</span>`;
}
function openLearningMemo(){
  const html = `
    <div style="padding:14px;max-width:520px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:14px;font-weight:800;">🎓 AI 학습 노트</div>
        <button class="ibtn" onclick="document.getElementById('lmDlg').remove()" style="font-size:11px;">닫기</button>
      </div>
      <div id="lmStageRow" style="margin-bottom:10px;"></div>
      <div style="font-size:10px;color:var(--tm);margin-bottom:8px;">매매일지에서 누적된 깨달음입니다. 다음 매매 결정 시 AI 프롬프트에 자동 첨부돼요.</div>
      <div style="max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
        ${learningMemory.length ? learningMemory.slice().reverse().map(l=>`
          <div style="padding:6px 8px;background:var(--bg);border-radius:6px;border-left:3px solid ${l.category==='반성'?'var(--r)':l.category==='개선'?'var(--g)':l.category==='멘토'?'var(--b)':'var(--p)'};">
            <div style="font-size:9px;color:var(--tm);margin-bottom:2px;">${l.date} · ${l.category}</div>
            <div style="font-size:11px;line-height:1.5;">${(l.text||'').replace(/</g,'&lt;')}</div>
          </div>
        `).join('') : '<div style="font-size:11px;color:var(--tm);padding:20px;text-align:center;">아직 학습된 노트가 없습니다. 백테스트나 매매를 마치면 자동으로 쌓여요.</div>'}
      </div>
      <div style="margin-top:10px;display:flex;justify-content:flex-end;gap:6px;">
        <button class="ibtn red" onclick="if(confirm('전체 학습 노트를 초기화할까요?')){learningMemory=[];learnedDates=[];saveToServer('htsLearningMemory','[]');saveToServer('htsLearnedDates','[]');document.getElementById('lmDlg').remove();updateLearnerStage();}" style="font-size:10px;">전체 초기화</button>
      </div>
    </div>
  `;
  const d = document.createElement('div');
  d.id='lmDlg';
  d.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--pan);border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.2);width:520px;max-width:94vw;';
  d.innerHTML = html;
  document.body.appendChild(d);
  const sr = document.getElementById('lmStageRow');
  if(sr){
    const s = getLearnerStage();
    sr.innerHTML = `<span style="background:${s.color};color:#fff;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">Lv${s.lv} ${s.label}</span> <span style="font-size:11px;color:var(--ts);">${learnedDates.length}일 학습 · 노트 ${learningMemory.length}건 · 다음 단계까지 ${s.next}</span>`;
  }
}

// ═══════════════════════════════════════════════
// 백테스트 엔진 — 여러 영업일 연속 시뮬레이션
// ═══════════════════════════════════════════════
window.backtest = {
  running:false, startDate:null, endDate:null,
  currentDate:null, dayIdx:0, totalDays:0,
  startCash:0, startPnl:0,
  dailyResults:[], // [{date, pnl, trades, wins, losses}]
  pendingJournals:[], // 백그라운드로 작성 중인 일지 Promise 목록
};
function _businessDays(start, end){
  const out=[]; const d=new Date(start); const e=new Date(end);
  while(d<=e){
    const w=d.getDay();
    if(w!==0&&w!==6) out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    d.setDate(d.getDate()+1);
  }
  return out;
}
function _nextBusinessDay(dateStr){
  const d=new Date(dateStr);
  do{d.setDate(d.getDate()+1);}while(d.getDay()===0||d.getDay()===6);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
async function startBacktest(startDate, endDate){
  if(backtest.running){addMsg('ai','⚠ 이미 백테스트 진행 중'); return;}
  // ★ 미래 일자 방어: 오늘보다 미래는 거부
  const today = (typeof todayStr==='function') ? todayStr() : new Date().toISOString().slice(0,10);
  if(startDate > today){
    showAlert('백테스트 불가', '시작일이 오늘보다 미래입니다.\n과거 데이터 백테스트만 가능합니다.');
    return;
  }
  if(endDate > today){
    addMsg('ai', `⚠ 종료일이 미래 — ${today}로 잘라 진행합니다.`);
    endDate = today;
  }
  const days=_businessDays(startDate, endDate);
  if(!days.length){showAlert('백테스트','영업일이 없습니다'); return;}
  // 백테스트는 항상 완전자동(Lv4 = 진입자동 + 15:20 마감 자동청산) 모드
  autoLevel = 4;
  addMsg('ai','📊 백테스트 — 자동매매 레벨 4(완전자동)로 고정');
  // 종목 풀이 거의 비었으면 강세섹터 자동 동기화 후 시작
  const poolSize = (WGS[0]||[]).length + (WGS[1]||[]).length + (WGS[3]||[]).length + Object.keys(window._sectorInfo||{}).length;
  if(poolSize < 2 && typeof refreshHotSectors==='function'){
    addMsg('ai','📊 종목 풀 부족 — 강세섹터 동기화 후 백테스트 시작');
    try{ await refreshHotSectors(true); }catch(_e){}
  }
  backtest.running=true;
  try{ window._bgKeepAliveStart && _bgKeepAliveStart(); }catch(e){}
  backtest.startDate=days[0];
  backtest.endDate=days[days.length-1];
  backtest.totalDays=days.length;
  backtest.dayIdx=0;
  backtest.startCash=mock.cash;
  backtest.startPnl=mock.todayPnl||0;
  backtest.dailyResults=[];
  // 자동매매 자동 시작 (level 3 이상 권장)
  if(!autoState.running && typeof startAuto==='function'){
    addMsg('ai','🎯 백테스트 시작 — 자동매매 자동 활성화');
    try{startAuto();}catch(e){}
  }
  addMsg('ai',`🚀 백테스트 시작\n• 기간: ${backtest.startDate} ~ ${backtest.endDate}\n• 영업일: ${backtest.totalDays}일\n• 자본: ${mock.cash.toLocaleString()}원\n• 배속: x${sim.speed}\n\n진행 중...`);
  _backtestLoadDay(days[0]);
  renderBacktestPanel();
}
async function stopBacktest(){
  if(!backtest.running) return;
  backtest.running=false;
  try{ window._bgKeepAliveStop && _bgKeepAliveStop(); }catch(e){}
  sim.playing=false;
  if(sim.timer){clearTimeout(sim.timer);sim.timer=null;}
  // ★ pending setTimeout 모두 cancel (다음날 자동 시작 차단)
  if(backtest._pendingStart){ clearTimeout(backtest._pendingStart); backtest._pendingStart=null; }
  _syncPlayBtn();
  renderBacktestPanel();
  // 백그라운드 일지 작성 모두 완료까지 대기 (학습 메모리 보장)
  if(backtest.pendingJournals && backtest.pendingJournals.length){
    addMsg('ai',`⏳ 진행 중인 매매일지 ${backtest.pendingJournals.length}건 작성 완료까지 대기...`);
    try{ await Promise.allSettled(backtest.pendingJournals); }catch(e){}
    backtest.pendingJournals = [];
  }
  _backtestReport();
}
async function _backtestLoadDay(dateStr){
  if(!window.backtest || !backtest.running) return; // ★ 정지된 백테스트 재시작 차단
  backtest.currentDate=dateStr;
  sim.date=dateStr;
  const md=document.getElementById('mockDate'); if(md) md.value=dateStr;
  mock.todayPnl=0; mock.todayTrades=0; mock.lossSeries=0;
  // ★ 백테스트 중 자동매매가 꺼졌으면(연속 손절 brk) 매일 다시 켜기
  if(backtest.running && !autoState.running){
    autoState.running=true; autoState.level=autoLevel||4;
    if(!autoTimer) scheduleScreening();
    addDecisionLog('🔄 자동매매 재시작','새 날짜 — 연속손절 리셋','백테스트');
  }
  // 대시보드 iframe에 날짜 전파 (백테스트 매일 데이터 갱신)
  try{
    const _df=document.getElementById("dashFrame");
    if(_df&&_df.contentWindow){
      _df.contentWindow._skipHtsSync=true;
      _df.contentWindow.curDate=dateStr;
      const _de=_df.contentWindow.document.getElementById("dashDate");
      if(_de)_de.value=dateStr;
      _df.contentWindow.loadDashData&&_df.contentWindow.loadDashData();
      _df.contentWindow.autoLoadMarketData&&_df.contentWindow.autoLoadMarketData();
      setTimeout(()=>{try{_df.contentWindow._skipHtsSync=false;}catch(e){}},100);
    }
  }catch(_e){}
  // ★ 매일 강세섹터 새로 가져오기 (사용자 요청: 딜레이 있어도 정확하게)
  if(typeof refreshHotSectors==='function'){
    addDecisionLog('📊 '+dateStr+' 강세섹터 분석', '새 날짜 데이터 가져오는 중...', '백테스트');
    try{ await refreshHotSectors(true); }catch(_e){ console.warn('섹터 fetch:', _e.message); }
  }
  // 종목 자동 전환: 강세 1위 종목 우선, 없으면 WGS[0] 첫 종목
  try{
    const si = window._sectorInfo || {};
    let rank1 = null;
    Object.entries(si).forEach(([tk, v])=>{ if(v && v.rank===1 && !rank1) rank1 = tk; });
    const candidate = rank1 || (WGS[0]||[])[0] || (WGS[1]||[])[0];
    if(candidate && candidate !== activeTk && typeof setActiveTk==='function'){
      setActiveTk(candidate);
      addDecisionLog('📅 '+dateStr+' 시작', '강세 1위 '+(STOCKS.find(s=>s.tk===candidate)||{nm:candidate}).nm+'로 차트 전환', '백테스트');
    }
  }catch(_e){}
  // 캔들 로드 — KIS 있으면 실데이터, 없으면 시뮬
  genCandles(activeTk, dateStr);
  const _wait = sim.speed>=300 ? 150 : sim.speed>=60 ? 300 : 600;
  // setTimeout 핸들 backtest에 저장 — stopBacktest에서 clear 가능
  if(backtest._pendingStart){ clearTimeout(backtest._pendingStart); backtest._pendingStart=null; }
  backtest._pendingStart = setTimeout(()=>{
    backtest._pendingStart = null;
    // ★ setTimeout 안에서도 backtest.running 체크 (정지 후 재시작 차단)
    if(!window.backtest || !backtest.running) return;
    chartViewCount=Math.min(120, sim.candles.length||60);
    chartViewStart=Math.max(0,(sim.candles.length||60)-chartViewCount);
    const prevCount=(_kisChartMeta&&_kisChartMeta.prevCount)||0;
    sim.idx = prevCount>0 ? prevCount : 0;
    updChartToIdx();
    addDecisionLog('🔔 '+dateStr+' 장 시작 (09:00)', '강세섹터 분석 완료 — 매매 시작', '백테스트');
    sim.playing=true;
    _syncPlayBtn();
    runStep();
    renderBacktestPanel();
  }, _wait);
}
async function _backtestEndOfDay(){
  if(!window.backtest || !backtest.running) return; // ★ 정지 후 호출되더라도 즉시 종료
  // 현재 날짜 결과 집계
  const dt=backtest.currentDate;
  // ★ 안전망: 다음날 시작 전 모든 보유 종목 강제 청산 (당일매매 원칙)
  try{
    Object.keys(mock.positions||{}).forEach(tk=>{
      const pos=mock.positions[tk]; if(!pos||pos.qty<=0) return;
      const stk=STOCKS.find(s=>s.tk===tk); if(!stk) return;
      const sv=activeTk,svSide=oSide,svType=oType,svCred=credType;
      activeTk=tk; oSide="sell"; oType="market"; credType="cash";
      document.getElementById("ofQty").value=pos.qty;
      submitOrder(true);
      activeTk=sv; oSide=svSide; oType=svType; credType=svCred;
      addDecisionLog(`[${stk.nm}] 종가 청산`, '백테스트 다음날 이전 강제 청산', '백테스트');
    });
  }catch(_e){}
  const todayTrades=(mock.trades||[]).filter(t=>t.date===dt);
  const wins=todayTrades.filter(t=>t.side==='sell'&&(t.pnl||0)>0).length;
  const losses=todayTrades.filter(t=>t.side==='sell'&&(t.pnl||0)<0).length;
  const dayPnl=todayTrades.filter(t=>t.side==='sell').reduce((s,t)=>s+(t.pnl||0),0);
  backtest.dailyResults.push({date:dt, pnl:dayPnl, trades:todayTrades.length, wins, losses});
  backtest.dayIdx++;
  addDecisionLog(`📅 ${dt} 마감`, `매매 ${todayTrades.length}건 | 손익 ${dayPnl>=0?'+':''}${dayPnl.toLocaleString()}원 | 승 ${wins}·패 ${losses}`, '백테스트');
  renderBacktestPanel();
  // 매매가 있으면 AI 일지 자동 작성 (학습 누적)
  if(todayTrades.length > 0 && typeof autoSaveJournalOnTrade === 'function'){
    addDecisionLog(`📓 ${dt} 일지 작성`, sim.speed>=300?'백그라운드 (빠른 배속)':'AI 평가 대기 중', '학습');
    const _p = autoSaveJournalOnTrade(dt).catch(e=>console.warn('일지:', e.message));
    backtest.pendingJournals.push(_p);
    if(sim.speed < 300){
      try{ sim.playing=false; _syncPlayBtn(); await _p; }catch(e){}
    }
  } else {
    // 매매 없는 날도 "관망" 일지로 기록 + 구체적 사유
    try{
      const _reason = window._lastNoTradeReason || '진입 조건 미달';
      const noTradeEntry = {
        summary: dt+' 관망 — '+_reason,
        why_bought:'미진입: '+_reason, why_sold:'-',
        good:'조건 불충분 시 관망 유지', bad:'-',
        psychology:'인내심 유지', improvement:'다양한 기법 시그널 재점검',
        phase_check:'관망', result_grade:'관망',
        mentor_comment:'기다림도 매매다. 사유: '+_reason,
        aiGenerated: false, trades:'(매매 없음)',
      };
      if(typeof saveJEntry==='function') saveJEntry(dt, noTradeEntry, 0, 0, 0, '');
      window._lastNoTradeReason = null;
    }catch(_e){}
  }
  // 다음 영업일?
  if(backtest.dayIdx >= backtest.totalDays){
    stopBacktest();
    return;
  }
  const next=_nextBusinessDay(dt);
  if(next > backtest.endDate){
    stopBacktest();
    return;
  }
  _backtestLoadDay(next);
}
function _backtestReport(){
  const totalPnl = backtest.dailyResults.reduce((s,d)=>s+d.pnl,0);
  const totalTrades = backtest.dailyResults.reduce((s,d)=>s+d.trades,0);
  const totalWins = backtest.dailyResults.reduce((s,d)=>s+d.wins,0);
  const totalLosses = backtest.dailyResults.reduce((s,d)=>s+d.losses,0);
  const winRate = totalWins+totalLosses>0 ? (totalWins/(totalWins+totalLosses)*100).toFixed(1) : '-';
  const best = backtest.dailyResults.reduce((a,b)=>(!a||b.pnl>a.pnl)?b:a, null);
  const worst = backtest.dailyResults.reduce((a,b)=>(!a||b.pnl<a.pnl)?b:a, null);
  const pnlPct = backtest.startCash>0 ? (totalPnl/backtest.startCash*100).toFixed(2) : '-';
  const msg=`📊 백테스트 종료\n\n` +
    `• 기간: ${backtest.startDate} ~ ${backtest.endDate}\n` +
    `• 실거래일: ${backtest.dailyResults.length}일\n` +
    `• 총 매매: ${totalTrades}건\n` +
    `• 총 손익: ${totalPnl>=0?'+':''}${totalPnl.toLocaleString()}원 (${pnlPct}%)\n` +
    `• 승률: ${winRate}% (${totalWins}승 ${totalLosses}패)\n` +
    (best ? `• 최고: ${best.date} (+${best.pnl.toLocaleString()})\n` : '') +
    (worst ? `• 최악: ${worst.date} (${worst.pnl.toLocaleString()})\n` : '');
  addMsg('ai', msg);
  showAlert('백테스트 결과', msg);
  // 매매일지 페이지 즉시 갱신 + 안내
  try{ renderJPage&&renderJPage(); }catch(_e){}
  addDecisionLog('📓 백테스트 일지 완료', `${backtest.dailyResults.length}일 / 매매 ${totalTrades}건 — 📓 버튼으로 확인`, '학습');
}
// 실시간 거래 스트립 — 차트 헤더 아래 최근 6건
function renderLiveTrades(){
  const el = document.getElementById('liveTradesStrip');
  if(!el) return;
  const recent = (mock.trades||[]).slice(-6).reverse();
  if(!recent.length){ el.style.display='none'; return; }
  el.style.display='';
  el.innerHTML = '<span style="color:var(--tm);font-weight:700;margin-right:6px;">⚡ 실시간 매매</span>' +
    recent.map(function(t){
      const isBuy = t.side==='buy';
      const col = isBuy ? '#dc2626' : '#2563eb';
      const pnlTxt = (!isBuy && typeof t.pnl==='number') ? ` <span style="color:${t.pnl>=0?'#05c072':'#dc3545'};">${t.pnl>=0?'+':''}${Math.round(t.pnl).toLocaleString()}</span>` : '';
      const autoTag = t.auto ? '<span style="background:rgba(139,92,246,.15);color:var(--p);padding:0 3px;border-radius:2px;font-size:8px;margin-right:2px;">AI</span>' : '';
      const time = (t.barTime || (t.time||''));
      return `<span style="display:inline-block;margin-right:10px;padding:1px 4px;border-radius:3px;background:var(--pan);border:1px solid var(--br);">
        <span style="color:var(--tm);">${time}</span>
        ${autoTag}
        <b style="color:${col};">${isBuy?'매수':'매도'}</b>
        <span style="color:var(--t);">${t.nm||t.tk}</span>
        <span style="color:var(--ts);">${(t.price||t.pr||0).toLocaleString()}원×${t.qty}</span>
        ${pnlTxt}
      </span>`;
    }).join('');
}

function renderBacktestPanel(){
  const el=document.getElementById('backtestPanel');
  if(!el) return;
  if(!backtest.running && !backtest.dailyResults.length){
    el.style.display='none'; return;
  }
  el.style.display='';
  const pct = backtest.totalDays>0 ? Math.round(backtest.dayIdx/backtest.totalDays*100) : 0;
  const realtimePnl = (backtest.dailyResults.reduce((s,d)=>s+d.pnl,0));
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:10px;font-weight:700;color:var(--b);">🚀 백테스트</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--t);">${backtest.currentDate||'-'}</span>
      <span style="font-family:var(--mono);font-size:9px;color:var(--ts);">${backtest.dayIdx}/${backtest.totalDays}일 (${pct}%)</span>
      <div style="flex:1;background:var(--bg);border-radius:6px;height:6px;overflow:hidden;">
        <div style="width:${pct}%;background:var(--b);height:100%;transition:width .3s;"></div>
      </div>
      <span style="font-family:var(--mono);font-size:10px;font-weight:700;color:${realtimePnl>=0?'var(--g)':'var(--r)'};">${realtimePnl>=0?'+':''}${realtimePnl.toLocaleString()}원</span>
      ${backtest.running ? '<button class="ibtn red" onclick="stopBacktest()" style="font-size:9px;padding:2px 6px;">■ 중지</button>' : '<button class="ibtn" onclick="document.getElementById(\'backtestPanel\').style.display=\'none\'" style="font-size:9px;padding:2px 6px;">닫기</button>'}
    </div>
  `;
}
function openBacktestDialog(){
  const today = todayStr();
  const d=new Date(today); d.setMonth(d.getMonth()-1);
  const monthAgo=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const html = `
    <div style="padding:12px;">
      <div style="font-size:13px;font-weight:800;margin-bottom:10px;">🚀 백테스트 시작</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
        <label style="font-size:10px;color:var(--ts);">시작일
          <input type="date" id="btStart" value="${monthAgo}" style="margin-left:6px;padding:4px 6px;border:1px solid var(--br);border-radius:6px;font-family:var(--mono);">
        </label>
        <label style="font-size:10px;color:var(--ts);">종료일
          <input type="date" id="btEnd" value="${today}" style="margin-left:6px;padding:4px 6px;border:1px solid var(--br);border-radius:6px;font-family:var(--mono);">
        </label>
        <div style="font-size:9px;color:var(--tm);line-height:1.5;background:var(--bg);padding:6px 8px;border-radius:6px;">
          • 자동매매가 꺼져있으면 자동 시작됩니다.<br>
          • 현재 배속(x${sim.speed})으로 진행. 더 빠르게 하려면 배속을 올리세요.<br>
          • 분봉(${sim.tf}분) 기준. 1분봉+x600 ≈ 39초/일.
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="ibtn" onclick="document.getElementById('btDialog').remove()" style="font-size:11px;">취소</button>
        <button class="ibtn pur" onclick="(function(){const s=document.getElementById('btStart').value;const e=document.getElementById('btEnd').value;if(!s||!e||s>e){alert('날짜 확인');return;}document.getElementById('btDialog').remove();startBacktest(s,e);})()" style="font-size:11px;">▶ 시작</button>
      </div>
    </div>
  `;
  const d2 = document.createElement('div');
  d2.id='btDialog';
  d2.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--pan);border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.2);width:320px;max-width:92vw;';
  d2.innerHTML=html;
  document.body.appendChild(d2);
}
function setTF(el,tf){
  try{
    sim.tf=tf;
    try{saveToServer('htsSimState', JSON.stringify({date:sim.date, tf:sim.tf, activeTk}));}catch(e){}
    document.querySelectorAll(".tf-btn").forEach(b=>b.classList.remove("on"));
    if(el)el.classList.add("on");
    genCandles(activeTk,sim.date);
    // 일봉 계열은 genCandles에서 idx/view 설정함, 분봉은 0부터
    const isDaily = tf==='D'||tf.startsWith('D');
    if(!isDaily){
      // KIS 연결 시 실제 분봉 로드
      if(kisConfig.appKey&&kisConfig.appSecret){
        _fetchKisCandles(activeTk,sim.date,tf).then(function(_ic){
          if(_ic&&_ic.length>0){
            sim.candles=_ic;
            var _pc=_kisChartMeta.prevCount||0;
            sim.idx=_pc>0?_pc-1:_ic.length-1;
            chartViewCount=Math.min(60,_ic.length);
            chartViewStart=Math.max(0,_ic.length-chartViewCount);
            drawChart();
          }
        }).catch(function(e){console.warn('TF 분봉 로드 실패:',e.message);});
      } else {
        // 시뮬: _genSimCandles에서 전일+당일 만들고 sim.idx 세팅함
        // 뷰는 끝쪽(당일 첫봉 근처)에 맞춤
        chartViewCount=Math.min(120,sim.candles.length||60);
        chartViewStart=Math.max(0,(sim.candles.length||60)-chartViewCount);
      }
    }
    drawChart();
  }catch(e){
    const ci=document.getElementById("cinfo");
    if(ci)ci.textContent="TF오류:"+e.message;
    console.error("setTF error:",e);
  }
}
function onDateChange(){
  sim.date=document.getElementById("mockDate").value;
  try{saveToServer('htsSimState', JSON.stringify({date:sim.date, tf:sim.tf, activeTk}));}catch(e){}
  mock.todayPnl=0;mock.todayTrades=0;mock.lossSeries=0;
  if(sim.date<todayStr())activateMockMode();
  genCandles(activeTk,sim.date);initChart();
  // 전일+당일 뷰 정렬
  chartViewCount=Math.min(120,sim.candles.length||60);
  chartViewStart=Math.max(0,(sim.candles.length||60)-chartViewCount);
  drawChart();
  // 대시보드 iframe에 날짜 전파
  try{
    const _df=document.getElementById("dashFrame");
    if(_df&&_df.contentWindow){
      _df.contentWindow._skipHtsSync=true;
      _df.contentWindow.curDate=sim.date;
      const _de=_df.contentWindow.document.getElementById("dashDate");
      if(_de)_de.value=sim.date;
      _df.contentWindow.loadDashData&&_df.contentWindow.loadDashData();
      _df.contentWindow.autoLoadMarketData&&_df.contentWindow.autoLoadMarketData();
      setTimeout(()=>{try{_df.contentWindow._skipHtsSync=false;}catch(e){}},100);
    }
  }catch(e){}
}
function adjDate(d){const dt=new Date(sim.date);dt.setDate(dt.getDate()+d);sim.date=dt.toISOString().slice(0,10);document.getElementById("mockDate").value=sim.date;onDateChange();}
function activateMockMode(){document.getElementById("modeBadge").className="badge mock";document.getElementById("modeText").textContent="모의투자";}
function endMock(){
  if(!confirm("모의투자를 종료하고 실거래 화면으로 전환하시겠습니까?"))return;
  sim.date=todayStr();document.getElementById("mockDate").value=sim.date;
  if(sim.playing)togPlay();
  document.getElementById("liveOv").classList.add("show");
  document.getElementById("modeBadge").className="badge live";
  document.getElementById("modeText").textContent="실거래 준비";
}
function closeLive(){document.getElementById("liveOv").classList.remove("show");activateMockMode();}
function selBroker(el){document.querySelectorAll(".broker-btn").forEach(b=>b.classList.remove("on"));el.classList.add("on");}

// ═══════════════════════════════
// PRICE
// ═══════════════════════════════
function updPrice(c){
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const pr=c?c.c:stk.pr;
  const ca=pr-stk.base,cp=((ca/stk.base)*100).toFixed(2),up=ca>=0;
  const cls=up?"cu":"cd";
  const siPr=document.getElementById("siPr");
  if(siPr){siPr.textContent=pr.toLocaleString();siPr.className="si-pr "+cls;}
  const siCh=document.getElementById("siCh");
  if(siCh){siCh.textContent=(up?"+":"")+ca.toLocaleString()+" ("+(up?"+":"")+cp+"%)";siCh.className="si-ch "+cls;}
  // 차트 큰 헤더
  const chNm=document.getElementById("chartHdrNm");if(chNm) chNm.textContent=stk.nm;
  const chTk=document.getElementById("chartHdrTk");if(chTk) chTk.textContent=stk.tk;
  const chPr=document.getElementById("chartHdrPr");if(chPr) chPr.textContent=pr.toLocaleString();
  const chCh=document.getElementById("chartHdrCh");
  if(chCh){chCh.textContent=(up?"+":"")+cp+"%";chCh.style.color=up?"var(--r)":"var(--b)";}
  const obPr=document.getElementById("obPr");
  if(obPr){obPr.textContent=pr.toLocaleString();obPr.className="ob-cur-p "+cls;}
  const obInfo=document.getElementById("obInfo");
  if(obInfo)obInfo.textContent=(up?"+":"")+ca.toLocaleString()+" ("+cp+"%)";
  // 체결강도/매수잔량: KIS 연결 시 실제 데이터, 미연결 시 표시 안 함
  const strEl=document.getElementById("obStrength");
  if(strEl&&(!kisConfig.appKey)){strEl.textContent="-";strEl.style.color="var(--tm)";}
  const buyEl=document.getElementById("obBuyTotal");
  if(buyEl&&(!kisConfig.appKey))buyEl.textContent="-";
  stk.pr=pr;
  const ofPr=document.getElementById("ofPr");
  if(ofPr)ofPr.value=pr;
  updOSum(); updPnl();
}
function updPnl(){
  let tot=0;Object.entries(mock.positions).forEach(([tk,pos])=>{const s=STOCKS.find(s=>s.tk===tk);if(s)tot+=(s.pr-pos.avgPrice)*pos.qty;});
  const up=tot>=0;
  document.getElementById("msPnl").textContent=(up?"+":"")+Math.round(tot).toLocaleString()+"원";
  document.getElementById("msPnl").className="ms-v "+(up?"cu":"cd");
  document.getElementById("msPct").textContent=(up?"+":"")+(tot/cfg.capital*100).toFixed(2)+"%";
  document.getElementById("msPct").className="ms-v "+(up?"cu":"cd");
  // 오늘 손익 + 매매 횟수
    // 목표달성 진행바
  const _gb=document.getElementById('goalProgressBar'),_gp=document.getElementById('goalProgressPct');
  if(_gb&&_gp){const _dt=(cfg.capital||10000000)*(cfg.dayloss||2)/100/2;const _pp=_dt>0?Math.min(100,Math.max(-100,mock.todayPnl/_dt*100)):0;_gb.style.width=Math.abs(_pp)+'%';_gb.style.background=mock.todayPnl>=0?'var(--g)':'var(--r)';_gp.textContent=Math.round(_pp)+'%';}
  const tpEl=document.getElementById("msTodayPnl");
  const trEl=document.getElementById("msTrades");
  if(tpEl){const tp=mock.todayPnl>=0;tpEl.textContent=(tp?"+":"")+Math.round(mock.todayPnl).toLocaleString()+"원";tpEl.className="ms-v "+(tp?"cu":"cd");}
  if(trEl)trEl.textContent=mock.todayTrades+"회";
}

// ═══════════════════════════════
// ORDERBOOK
// ═══════════════════════════════
function renderOB(){
  // KIS 연결 시 실제 호가창 사용
  if(kisConfig.appKey && kisConfig.appSecret){
    _refreshKisOrderbook();
    return; // 실제 데이터로 렌더됨
  }
  // KIS 미연결: "실제 데이터 없음" 표시
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  document.getElementById('obSell').innerHTML=`<div style="padding:16px 8px;text-align:center;color:var(--tm);font-size:9px;line-height:1.8;">
    <div style="font-size:20px;margin-bottom:6px;">📡</div>
    <div style="font-weight:700;color:var(--a);margin-bottom:4px;">실제 호가 데이터 없음</div>
    <div>KIS API 연결 후 실시간 호가창 이용 가능</div>
    <div style="margin-top:6px;"><a onclick="openModal('settings')" style="color:var(--b);cursor:pointer;">⚙ 설정에서 KIS 연결하기</a></div>
  </div>`;
  document.getElementById('obBuy').innerHTML='';
  // 현재가는 표시
  const base=stk.pr||71500;
  const tick=base>=500000?500:base>=100000?100:base>=10000?50:10;
  let sell="",buy="",totalSell=0,totalBuy=0;
  const maxQ=6000;
  // 주문창 현재가 업데이트만
  const ofPrEl=document.getElementById('ofPr'); if(ofPrEl)ofPrEl.value=base;
  updOSum();
  return; // 가짜 호가창 렌더 중단
  const sellRows=[];
  for(let i=10;i>=1;i--){
    const pr=base+tick*i,q=Math.round(50+1);
    totalSell+=q;
    const w=Math.min(100,(q/maxQ*100)).toFixed(0);
    sellRows.push(`<div class="ob-r" onclick="document.getElementById('ofPr').value=${pr};updOSum()"><div class="ob-bg s" style="width:${w}%"></div><div class="ob-p" style="color:#2563eb;">${pr.toLocaleString()}</div><div class="ob-q">${q.toLocaleString()}</div></div>`);
  }
  // 매수 10호가 (국내 표준: 매수=빨강)
  const buyRows=[];
  for(let i=1;i<=10;i++){
    const pr=base-tick*i,q=1; // 실행되지 않는 코드 (KIS 연결 후 실제 데이터 사용)
    totalBuy+=q;
    const w=Math.min(100,(q/maxQ*100)).toFixed(0);
    buyRows.push(`<div class="ob-r" onclick="document.getElementById('ofPr').value=${pr};updOSum()"><div class="ob-bg b" style="width:${w}%"></div><div class="ob-p" style="color:#dc2626;">${pr.toLocaleString()}</div><div class="ob-q">${q.toLocaleString()}</div></div>`);
  }
  // 총잔량 헤더 (매도)
  sell=`<div style="display:flex;justify-content:space-between;padding:3px 8px;background:rgba(37,99,235,.05);border-bottom:1px solid var(--br);font-family:var(--mono);font-size:9px;color:#2563eb;"><span>매도 총잔량</span><span>${totalSell.toLocaleString()}</span></div>`+sellRows.join("");
  // 총잔량 헤더 (매수)
  buy=buyRows.join("")+`<div style="display:flex;justify-content:space-between;padding:3px 8px;background:rgba(220,38,38,.05);border-top:1px solid var(--br);font-family:var(--mono);font-size:9px;color:#dc2626;"><span>매수 총잔량</span><span>${totalBuy.toLocaleString()}</span></div>`;
  document.getElementById("obSell").innerHTML=sell;
  document.getElementById("obBuy").innerHTML=buy;
  // 매수잔량 업데이트
  const btEl=document.getElementById("obBuyTotal");
  if(btEl)btEl.textContent=totalBuy.toLocaleString();
  // 체결강도: KIS 없으면 표시 안 함
  const strEl=document.getElementById("obStrength");
  if(strEl){
    strEl.textContent="-";
    strEl.style.color="var(--tm)";
  }
}
function renderTH(){
  // KIS 연결 시 실제 체결창 (kisRefreshOrderbook에서 처리)
  // 미연결 시: 빈 상태 표시
  if(!kisConfig.appKey||!kisConfig.appSecret){
    document.getElementById('thList').innerHTML=`<div style="padding:12px 8px;text-align:center;color:var(--tm);font-size:9px;">
      <div>KIS 연결 후 실시간 체결창 이용 가능</div>
    </div>`;
    const s2=document.getElementById('obStrength2');
    if(s2){s2.textContent='-';s2.style.color='var(--tm)';}
    return;
  }
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const base=stk.pr||71500;
  let h="",buyVol=0,sellVol=0;
  const rows=[];
  // KIS 연결됐지만 실시간 체결 데이터는 웹소켓 필요 — 현재 "조회중" 표시
  document.getElementById('thList').innerHTML=`<div style="padding:12px 8px;text-align:center;color:var(--tm);font-size:9px;">
    <div style="color:var(--b);">● 실시간 체결 데이터 로딩 중...</div>
  </div>`;
  // TODO: KIS 웹소켓 연결 후 실시간 체결 스트리밍
  return;
  for(let i=0;i<25;i++){
    const isBuy=true;
    const pr=base;
    const q=1;
    if(isBuy)buyVol+=q;else sellVol+=q;
    const tm=`${String(9+Math.floor(i/5)).padStart(2,"0")}:${String((i*11)%60).padStart(2,"0")}:${String((i*7)%60).padStart(2,"0")}`;
    // 국내 표준: 매수체결=빨강(상승압력), 매도체결=파랑(하락압력)
    const col=isBuy?"#dc2626":"#2563eb";
    const arrow=isBuy?"▲":"▼";
    rows.push(`<div style="display:flex;align-items:center;padding:2px 8px;border-bottom:1px solid var(--br);gap:5px;">
      <span style="font-family:var(--mono);font-size:9px;color:var(--tm);width:38px;">${tm.slice(0,5)}</span>
      <span style="font-family:var(--mono);font-size:10px;font-weight:600;flex:1;text-align:right;color:${col};">${arrow} ${pr.toLocaleString()}</span>
      <span style="font-family:var(--mono);font-size:9px;min-width:34px;text-align:right;color:${col};">${q.toLocaleString()}</span>
    </div>`);
  }
  document.getElementById("thList").innerHTML=rows.join("");
  // 체결강도 업데이트
  const strength=Math.round(buyVol/(buyVol+sellVol)*200);
  const s2=document.getElementById("obStrength2");
  if(s2){s2.textContent=strength;s2.style.color=strength>=120?"#dc2626":strength>=100?"var(--b)":"#2563eb";}
}

// ═══════════════════════════════
// CREDIT / MARGIN
// ═══════════════════════════════
function updCredLim(){const cl=Math.round(mock.cash*(cfg.clim/100)),ml=Math.round(mock.cash*(cfg.mlim/100));document.getElementById("credLim").textContent=`신용 ${cl.toLocaleString()}원 / 미수 ${ml.toLocaleString()}원`;}
function getCredAvail(){if(credType==="credit")return Math.max(0,Math.round(mock.cash*(cfg.clim/100))-mock.creditUsed);if(credType==="margin")return Math.max(0,Math.round(mock.cash*(cfg.mlim/100))-mock.marginUsed);return mock.cash;}
function onCredChange(){
  credType=document.getElementById("credSel").value;
  const info=document.getElementById("credInfo");
  if(credType==="cash"){info.style.display="none";}
  else{info.style.display="block";const avail=getCredAvail();info.textContent=credType==="credit"?`신용 가능: ${avail.toLocaleString()}원 (이자 연 ${cfg.crate}%)`:`미수 가능: ${avail.toLocaleString()}원 (이자 연 ${cfg.mrate}% | 미결제→반대매매)`;}
  updOSum();
}

// ═══════════════════════════════
// ORDER FORM
// ═══════════════════════════════
function setOSide(s){
  oSide=s;
  document.getElementById("otBuy").classList.toggle("on",s==="buy");
  document.getElementById("otSell").classList.toggle("on",s==="sell");
  document.getElementById("subBtn").className="sub-btn "+s;
  document.getElementById("subBtn").textContent=(s==="buy"?"매수":"매도")+" 주문";
  // 매도 시 빠른 청산 버튼 표시
  const qsb=document.getElementById("quickSellBtns");
  if(qsb)qsb.style.display=s==="sell"?"flex":"none";
  updOSum();
}
function setOType(el,t){
  oType=t;document.querySelectorAll(".ot-b").forEach(b=>b.classList.remove("on"));el.classList.add("on");
  document.getElementById("ofPr").disabled=t==="market";updOSum();
}
function setTrail(el,m){trailMode=m;document.querySelectorAll("[id^='trail-']").forEach(b=>b.classList.remove("on"));el.classList.add("on");}
function setPct(pct){
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const pr=parseFloat(document.getElementById("ofPr").value)||stk.pr;
  let qty;
  if(oSide==="buy"){const avail=credType==="cash"?mock.cash:(mock.cash+getCredAvail());qty=Math.floor(avail*(pct/100)/pr);}
  else{const pos=mock.positions[activeTk];qty=pos?Math.floor(pos.qty*(pct/100)):0;}
  document.getElementById("ofQty").value=qty; updOSum();
}
function amtToQty(amt){
  const v=parseFloat(amt)||0;if(!v)return;
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const pr=parseFloat(document.getElementById("ofPr").value)||stk.pr;
  if(pr>0){document.getElementById("ofQty").value=Math.floor(v/pr);updOSum();}
}
function updOSum(){
  const pr=parseFloat(document.getElementById("ofPr").value)||0;
  const qty=parseInt(document.getElementById("ofQty").value)||0;
  const tot=pr*qty;
  const fee = oSide==='sell' ? tot*((cfg.sf||0.015)/100) : tot*((cfg.bf||0.015)/100);
  const tax = oSide==='sell' ? tot*cfg.tx/100 : 0;
  const stop=parseFloat(document.getElementById("ofStop").value);
  const t1=parseFloat(document.getElementById("ofT1").value);
  let warn="";
  if(credType!=="cash"&&oSide==="buy"){const ca=getCredAvail();const cn=Math.max(0,tot-mock.cash);if(cn>ca)warn=`⚠ ${credType==="credit"?"신용":"미수"} 한도 초과`;}
  if(stop&&pr&&oSide==="buy"&&stop>=pr)warn="⚠ 손절가가 진입가 이상입니다";
  document.getElementById("ofWarn").textContent=warn;
  let rr="";
  if(stop&&t1&&pr&&oSide==="buy"){const risk=Math.abs(pr-stop),rew=Math.abs(t1-pr);if(risk>0)rr=` | R/R 1:${(rew/risk).toFixed(2)}`;}
  document.getElementById("ofSum").innerHTML=`예상: <b>${tot.toLocaleString()}</b>원 | 비용 ${Math.round(fee+tax).toLocaleString()}원${rr}${credType!=="cash"?` | <span style="color:var(--a)">${credType==="credit"?"신용":"미수"}</span>`:""}`;
  // 실질 수익 추가 표시 (보유 중 매도 시)
  if(oSide==="sell"&&mock.positions[activeTk]&&pr&&qty){
    const avgPr=mock.positions[activeTk].avgPrice;
    const grossPnl=(pr-avgPr)*qty;
    const netPnl=grossPnl-Math.round(fee+tax);
    const pnlEl=document.getElementById("ofSum");
    if(pnlEl)pnlEl.innerHTML+=` | 실질 <b style="color:${netPnl>=0?"var(--g)":"var(--r)"}">${netPnl>=0?"+":""}${netPnl.toLocaleString()}원</b>`;
  }
}

function quickSell(pct){
  const pos=mock.positions[activeTk];
  if(!pos||pos.qty<=0){showAlert("보유 없음","보유 종목이 없습니다.");return;}
  const qty=pct===100?pos.qty:Math.max(1,Math.floor(pos.qty*(pct/100)));
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  if(pct===100&&!confirm(`⚠ 전량 시장가 매도
${stk.nm} ${pos.qty}주
현재가 ${stk.pr.toLocaleString()}원

즉시 실행하시겠습니까?`))return;
  // 상태 저장 후 매도 실행
  const prevSide=oSide,prevType=oType,prevCred=credType;
  document.getElementById("ofQty").value=qty;
  oSide="sell";oType="market";credType="cash";
  document.getElementById("otSell").classList.add("on");
  document.getElementById("otBuy").classList.remove("on");
  document.getElementById("subBtn").className="sub-btn sell";
  submitOrder(false);
  // 상태 복원
  oSide=prevSide;oType=prevType;credType=prevCred;
  document.getElementById("otBuy").classList.add("on");
  document.getElementById("otSell").classList.remove("on");
  document.getElementById("subBtn").className="sub-btn buy";
}
function submitOrder(autoExec){
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  // 매매금지 종목 체크
  if(!autoExec&&oSide==="buy"&&isBanned(activeTk)){
    if(!confirm(`⚠ ${stk.nm}은(는) 매매금지 종목입니다.
그래도 매수하시겠습니까?`))return false;
  }
  const pr=oType==="market"?stk.pr:parseFloat(document.getElementById("ofPr").value)||stk.pr;
  const qty=parseInt(document.getElementById("ofQty").value)||0;
  if(qty<=0){if(!autoExec)showAlert("주문 오류","수량을 입력하세요.");return false;}
  // ★ 수수료는 매수/매도 각각 따로 — 이중 차감 방지
  const _br = (cfg.bf||0.015)/100, _sr = (cfg.sf||0.015)/100;
  const fee = oSide==='sell' ? (pr*qty)*_sr : (pr*qty)*_br;
  const tax = oSide==='sell' ? (pr*qty)*cfg.tx/100 : 0;
  const tot=pr*qty,ratio=tot/mock.cash*100;
  if(oSide==="buy"){
    let cashN=tot+fee,credN=0;
    if(credType!=="cash"){credN=Math.max(0,cashN-mock.cash);cashN=Math.min(cashN,mock.cash);}
    if(credN>getCredAvail()){if(!autoExec)showAlert("한도 초과",`${credType==="credit"?"신용":"미수"} 한도 초과\n가능: ${getCredAvail().toLocaleString()}원`);return false;}
    if(cashN>mock.cash){if(!autoExec)showAlert("잔고 부족",`현금 부족\n필요: ${Math.round(cashN).toLocaleString()}원 보유: ${mock.cash.toLocaleString()}원`);return false;}
    if(!autoExec&&credType==="cash"&&ratio>cfg.maxpos){if(!confirm(`⚠ 비중 ${ratio.toFixed(1)}% (한도 ${cfg.maxpos}%)\n진행?`))return false;}
    mock.cash-=cashN;
    if(credType==="credit")mock.creditUsed+=credN;
    else if(credType==="margin")mock.marginUsed+=credN;
    if(!mock.positions[activeTk])mock.positions[activeTk]={qty:0,avgPrice:0,creditType:"cash",creditAmt:0};
    const pos=mock.positions[activeTk];
    // 평단에 매수 수수료 포함 (정확한 손익 계산을 위해)
    const _newCost = pos.avgPrice*pos.qty + pr*qty + fee;
    pos.avgPrice = _newCost / (pos.qty+qty);
    pos.qty+=qty;
    if(credType!=="cash"){pos.creditType=credType;pos.creditAmt=(pos.creditAmt||0)+credN;}
    // Register stop/target orders
    const stopPr=parseFloat(document.getElementById("ofStop").value)||Math.round(pr*(1-autoState.cfg.stop/100));
    const t1Pr=parseFloat(document.getElementById("ofT1").value)||Math.round(pr*(1+autoState.cfg.t1/100));
    const t2Pr=parseFloat(document.getElementById("ofT2").value)||Math.round(pr*(1+autoState.cfg.t2/100));
    // BUG2 FIX: 추가 매수 시 origQty 누적, 기존 손절선 유지
    const prevSO=stopOrders[activeTk];
    const newOrigQty=prevSO?(prevSO.origQty||0)+qty:qty;
    stopOrders[activeTk]={stop:stopPr,t1:t1Pr,t2:t2Pr,t1done:prevSO?prevSO.t1done:false,t2done:prevSO?prevSO.t2done:false,trail:trailMode,trailHigh:Math.max(pr,prevSO?.trailHigh||0),origQty:newOrigQty,origStop:stopPr};
    mock.trades.push({date:sim.date,tk:activeTk,nm:stk.nm,side:"buy",price:pr,pr:pr,ts:Date.now(),barTime:(sim.candles[sim.idx]||{}).t||"",qty,fee:Math.round(fee),pnl:0,creditType:credType,auto:autoExec||false,time:(sim.candles[sim.idx]||{}).t||""});
    console.log('[BUY]', sim.date, stk.nm, qty+'주', pr+'원', '| total trades:', mock.trades.length);
  checkBrainDong("buy",pr,qty,stk);
  } else {
    const pos=mock.positions[activeTk];
    if(!pos||pos.qty<qty){if(!autoExec)showAlert("보유 부족",`보유 ${pos?.qty||0}주 주문 ${qty}주`);return false;}
    const pnl=(pr-pos.avgPrice)*qty-fee-tax;
    // ★ 신용/미수 사용분 먼저 갚고 나머지를 cash로 (잔고 뻥튀기 버그 수정)
    let _proceeds = tot - fee - tax; // 매도 받은 순금액
    let _repay = 0;
    if(pos.creditType && pos.creditType!=="cash" && pos.creditAmt>0){
      const r = qty/pos.qty;
      const ret = pos.creditAmt * r; // 이번 매도분의 신용 부채
      _repay = Math.min(_proceeds, ret); // proceeds 한도 내에서만 갚음
      if(pos.creditType==="credit") mock.creditUsed = Math.max(0, mock.creditUsed - _repay);
      else mock.marginUsed = Math.max(0, mock.marginUsed - _repay);
      pos.creditAmt = Math.max(0, pos.creditAmt - ret);
    }
    mock.cash += (_proceeds - _repay); // 부채 갚고 남은 만큼만 cash로
    pos.qty -= qty;
    if(pos.qty<=0){delete mock.positions[activeTk];}
    mock.todayPnl+=pnl;mock.todayTrades++;
    if(pnl<0){mock.lossSeries++;mock.winSeries=0;}
    else{
      mock.lossSeries=0;
      mock.winSeries=(mock.winSeries||0)+1;
      if(mock.winSeries>=5&&cfg.bd){
        showAlert("⚠ 과잉확신 경보 (Phase 11-5)",
          "연속 수익 "+mock.winSeries+"회!\n\n지금이 가장 위험한 순간입니다.\n\n• 비중 절대 늘리지 않음\n• 체크리스트 더 꼼꼼히\n• 연속수익은 운과 실력을 구분할 수 없음");
      }
    }
    mock.trades.push({date:sim.date,tk:activeTk,nm:stk.nm,side:"sell",price:pr,pr:pr,ts:Date.now(),barTime:(sim.candles[sim.idx]||{}).t||"",qty,fee:Math.round(fee+tax),pnl:Math.round(pnl),creditType:credType,auto:autoExec||false,time:(sim.candles[sim.idx]||{}).t||""});
    console.log('[SELL]', sim.date, stk.nm, qty+'주', pr+'원', '손익:', Math.round(pnl)+'원', '| total trades:', mock.trades.length);
  bdMetrics.lastSellTime=Date.now();checkBrainDong("sell",pr,qty,stk);
    if(cfg.al){const lr=-mock.todayPnl/cfg.capital*100;if(lr>=cfg.dayloss)showAlert("⚠ 일일 손실 한도",`한도 ${cfg.dayloss}% 도달\n매매 중단 권고.`);}
  }
  saveMock(); renderPort(); renderTradeLog(); updCash(); updPnl(); updCredLim();
  try{ renderLiveTrades&&renderLiveTrades(); }catch(_e){}

  // ── KIS 실계좌/모의투자 실제 주문 전송
  if (kisConfig.appKey && kisConfig.account) {
    const orderType = oType === 'market' ? 'market' : 'limit';
    sendKisOrder(oSide, activeTk, qty, pr, orderType).then(result => {
      if (result.ok) {
        addMsg('ai', `✅ KIS ${kisConfig.mode === 'real' ? '실거래' : '모의투자'} 주문 접수\n${stk.nm} ${oSide === 'buy' ? '매수' : '매도'} ${qty}주 | 주문번호: ${result.ordNo || '-'}`);
      } else {
        addMsg('ai', `⚠ KIS 주문 오류: ${result.error}\n(시뮬레이션은 정상 처리됨)`);
      }
    }).catch(() => {});
  }

  return true;
}

// ═══════════════════════════════
// STOP ORDER MONITOR
// ═══════════════════════════════
function checkStopOrders(){
  // 백테스트 중이면 탭 비활성 체크 스킵 (백그라운드에서도 손절/익절 작동)
  if(!window.backtest || !backtest.running){
    if(document.hidden) return;
  }
  Object.entries(stopOrders).forEach(([tk,so])=>{
    const stk=STOCKS.find(s=>s.tk===tk);if(!stk)return;
    const pos=mock.positions[tk];if(!pos||pos.qty<=0){delete stopOrders[tk];return;}
    // ★ 비활성 종목 가격 동기화 — 시뮬 캔들에서 현재 봉 가격 추출
    if(tk !== activeTk){
      try{
        const _cs = _peekSimCandlesFor(tk, sim.date, sim.idx);
        if(_cs && _cs.length > 0) stk.pr = _cs[Math.min(sim.idx, _cs.length-1)].c;
      }catch(_e){}
    }
    const pr=stk.pr;
    // Trailing update
    if(so.trail==="pct"&&pr>so.trailHigh){so.trailHigh=pr;so.stop=Math.round(pr*(1-autoState.cfg.stop/100));}
    if(so.trail==="ma5"){const cs=sim.candles.slice(0,sim.idx+1);const ma=calcMA(cs.map(c=>c.c),5);const m=ma[ma.length-1];if(m&&m>so.stop)so.stop=Math.round(m);}
    // Stop hit
    if(pr<=so.stop&&pos.qty>0){
      const saveTk=activeTk,saveSide=oSide,saveType=oType,saveCred=credType;
      activeTk=tk;oSide="sell";oType="market";credType="cash";document.getElementById("ofQty").value=pos.qty;
      submitOrder(true);
      activeTk=saveTk;oSide=saveSide;oType=saveType;credType=saveCred;
      delete stopOrders[tk];
      addMsg("ai",`🔴 손절 실행! ${stk.nm} ${pr.toLocaleString()}원\n손절가 ${so.stop.toLocaleString()}원 도달 → 전량 청산\n[Phase 9-4: 손절은 시장가 즉시]`);
      return;
    }
    // T1 (50%)
    if(!so.t1done&&pr>=so.t1&&pos.qty>0){
      const q50=Math.max(1,Math.floor(so.origQty*0.5));
      const qty=Math.min(q50,pos.qty);
      const saveTk=activeTk,saveSide=oSide,saveType=oType,saveCred2=credType;
      activeTk=tk;oSide="sell";oType="market";credType="cash";document.getElementById("ofQty").value=qty;
      submitOrder(true);
      activeTk=saveTk;oSide=saveSide;oType=saveType;credType=saveCred2;
      so.t1done=true;so.stop=so.origStop+(pr-so.origStop)*0.5;// move stop to halfway
      addMsg("ai",`🟢 1차 익절! ${stk.nm} ${pr.toLocaleString()}원 (50% 청산)\n손절선 본전화 적용\n[Phase 9-2: 분할 익절]`);
      renderPort();
    }
    // T2 (30%)
    if(so.t1done&&!so.t2done&&pr>=so.t2&&pos.qty>0){
      const q30=Math.max(1,Math.floor(so.origQty*0.3));
      const qty=Math.min(q30,pos.qty);
      const saveTk=activeTk,saveSide=oSide,saveType=oType,saveCred3=credType;
      activeTk=tk;oSide="sell";oType="market";credType="cash";document.getElementById("ofQty").value=qty;
      submitOrder(true);
      activeTk=saveTk;oSide=saveSide;oType=saveType;credType=saveCred3;
      so.t2done=true;
      addMsg("ai",`🟢 2차 익절! ${stk.nm} ${pr.toLocaleString()}원 (30% 청산)\n잔여 20% 트레일링 스탑 유지\n[Phase 9-2]`);
      renderPort();
    }
  });
  // Phase 3-8: 가격 알림 체크
  checkPriceAlerts();
  // 미체결 지정가 체결 체크
  checkPending();
}
function checkPriceAlerts(){
  if(!priceAlerts.length)return;
  STOCKS.forEach(stk=>{
    priceAlerts.forEach((al,i)=>{
      if(al.tk!==stk.tk||al.fired)return;
      const hit=(al.dir==="above"&&stk.pr>=al.price)||(al.dir==="below"&&stk.pr<=al.price);
      if(hit){
        al.fired=true;
        showAlert(`📣 가격 알림: ${stk.nm}`,`${stk.nm}이(가) ${al.price.toLocaleString()}원 ${al.dir==="above"?"이상":"이하"}에 도달했습니다.
현재가: ${stk.pr.toLocaleString()}원

알림 목적: ${al.memo||"-"}`);
        setTimeout(()=>{priceAlerts.splice(i,1);renderAlerts();},100);
      }
    });
  });
}

// ═══════════════════════════════
// AI AUTO-TRADE ENGINE
// ═══════════════════════════════
let autoLevel=3; // 기본 Lv3: 진입 자동 (Claude 검토 + 자동 매수). 0 = 완전수동, 4 = 완전자동(15:20 청산 포함)

// ═══════════════════════════════
// 장중 체크리스트 (Phase 8 실시간)
// ═══════════════════════════════
const INTRA_CHECKS = [
  {id:"ic0", txt:"STEP0: 심리 정상 (흥분/공포/복수심 없음)", phase:"8-2"},
  {id:"ic1", txt:"STEP1: 시장 선물 방향 우호적", phase:"8-3"},
  {id:"ic2", txt:"STEP2: 오늘 강한 섹터 파악 완료", phase:"8-4"},
  {id:"ic3", txt:"STEP3: 종목 스크리닝 통과 (시총/거래대금)", phase:"8-5"},
  {id:"ic4", txt:"STEP4: 차트 3단계 일치 (일봉/60분/5분)", phase:"8-6"},
  {id:"ic5", txt:"STEP5: 수급 확인 (체결강도 100+)", phase:"8-7"},
  {id:"ic6", txt:"STEP6: R/R 1.5 이상 계산 완료", phase:"8-8"},
  {id:"ic7", txt:"STEP7: 손절가 사전 확정", phase:"8-9"},
  {id:"ic8", txt:"매매금지 목록 확인 완료", phase:"3-9"},
  {id:"ic9", txt:"일일 손실 한도 80% 미만", phase:"0-3"},
];
let intraState = safeParseJSON(localStorage.getItem("htsIntra"), "{}");

function renderIntraCheck(){
  const el=document.getElementById("intraCheckList"); if(!el)return;
  el.innerHTML=INTRA_CHECKS.map((c,i)=>`
    <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;cursor:pointer;margin-bottom:2px;background:${intraState[c.id]?"rgba(5,192,114,.07)":"transparent"};"
      onclick="togIntra('${c.id}')">
      <div style="width:14px;height:14px;border-radius:50%;border:1.5px solid ${intraState[c.id]?"var(--g)":"var(--br)"};background:${intraState[c.id]?"var(--g)":"transparent"};display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;flex-shrink:0;">
        ${intraState[c.id]?"✓":""}
      </div>
      <div style="font-size:9px;color:${intraState[c.id]?"var(--tp)":"var(--ts)"};flex:1;line-height:1.3;">${c.txt}</div>
      <span style="font-size:7px;color:var(--tm);font-family:var(--mono);">${c.phase}</span>
    </div>`).join("");
  const done=INTRA_CHECKS.filter(c=>intraState[c.id]).length;
  const total=INTRA_CHECKS.length;
  const goEl=document.getElementById("intraGoNogo"); if(!goEl)return;
  const isGo=done>=8;
  goEl.style.background=isGo?"rgba(5,192,114,.12)":done>=6?"rgba(255,153,0,.12)":"rgba(240,62,62,.08)";
  goEl.style.color=isGo?"var(--g)":done>=6?"var(--a)":"var(--r)";
  goEl.textContent=isGo?`✅ GO 가능 (${done}/${total})`:done>=6?`△ 추가 확인 필요 (${done}/${total})`:`❌ NO-GO (${done}/${total})`;
}
function togIntra(id){
  intraState[id]=!intraState[id];
  saveToServer("htsIntra",JSON.stringify(intraState));
  renderIntraCheck();
}
function resetIntraCheck(){
  intraState={};saveToServer("htsIntra","{}");renderIntraCheck();
}

// ═══════════════════════════════
// AI 시장 체력 지수
// ═══════════════════════════════
async function calcMarketStrength(){
  const el=document.getElementById("mktStrDetail"); if(!el)return;
  el.textContent="계산 중...";
  const cs=getCandles(20);
  if(cs.length<5){el.textContent="데이터 부족";return;}
  const cls=cs.map(c=>c.c),vls=cs.map(c=>c.v);
  const rsi=(calcRSI(cls,14).slice(-1)[0]||50).toFixed(0);
  const ma5=calcMA(cls,5).slice(-1)[0]||0;
  const ma20=calcMA(cls,20).slice(-1)[0]||0;
  const lc=cs[cs.length-1];
  const volR=vls.length>=2?(vls[vls.length-1]/vls[vls.length-2]).toFixed(1):"1.0";
  // 로컬 계산 (0~100)
  let score=50;
  if(lc.c>ma5)score+=8; else score-=8;
  if(lc.c>ma20)score+=8; else score-=8;
  if(parseFloat(rsi)>=50&&parseFloat(rsi)<=70)score+=10;
  else if(parseFloat(rsi)>70)score-=5;
  else score-=10;
  if(parseFloat(volR)>=1.5)score+=10;
  else if(parseFloat(volR)<0.8)score-=10;
  if(lc.c>lc.o)score+=7; else score-=7;
  score=Math.min(100,Math.max(0,Math.round(score)));
  const bar=document.getElementById("mktStrBar");
  const scoreEl=document.getElementById("mktStrScore");
  if(bar)bar.style.width=score+"%";
  if(bar)bar.style.background=score>=65?"var(--g)":score>=45?"var(--b)":"var(--r)";
  if(scoreEl){
    scoreEl.textContent=score+"점";
    scoreEl.style.color=score>=65?"var(--g)":score>=45?"var(--b)":"var(--r)";
  }
  const label=score>=65?"강한 매수 우호":"강한 매수 비우호";
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  el.innerHTML=`<div style="font-family:var(--mono);font-size:10px;font-weight:700;color:${score>=65?"var(--g)":score>=45?"var(--b)":"var(--r)"};">${score>=65?"🟢 매수 우호":score>=45?"🟡 중립":"🔴 매수 비우호"}</div>
<div>RSI ${rsi} | MA${lc.c>ma5?"위":"아래"} | 거량×${volR}</div>
<div style="color:var(--tm);">${score>=65?"적극 진입 가능":score>=45?"신중 선별":"비중 축소 권장"}</div>`;
  addDecisionLog(`시장체력 ${score}점`,`RSI${rsi} | ${lc.c>ma20?"20MA 위":"20MA 아래"} | 거래량×${volR}`,"Phase 8-3");
}

// ═══════════════════════════════
// 시간대별 가이드 (장중 탭)
// ═══════════════════════════════
function updateTimeGuide(){
  const el=document.getElementById("timeGuide"); if(!el)return;
  const n=new Date(),hm=n.getHours()*100+n.getMinutes();
  let guide="",color="var(--ts)";
  if(hm<800){guide=`📋 장 전 준비\n시장 데이터 확인\n후보 종목 선정 (최대 3개)`;color="var(--tm)";}
  else if(hm<900){guide=`📊 장 전 루틴 (Phase 8-10)\n• 매크로 확인 STEP 1\n• 섹터/종목 선정 STEP 2~3\n• 진입계획 확정 STEP 4~6`;color="var(--b)";}
  else if(hm<930){guide=`⏸ 9:00~9:30 관망\n첫 봉 방향 확인\n돌발 이슈 체크\n신규 진입 금지`;color="var(--a)";}
  else if(hm<1000){guide=`👀 시장 방향 재확인\n선물 방향, VWAP 위치\n준비 종목 셋업 확인`;color="var(--b)";}
  else if(hm<1130){guide=`⭐ 적극 매매 구간\n10:00~11:30\n준비한 종목 진입 검토\nPhase 8 GO 조건 확인`;color="var(--g)";}
  else if(hm<1300){guide=`🍽 점심 (11:30~13:00)\n신규 진입 자제\n보유 포지션 관리만\n오후 계획 재검토`;color="var(--tm)";}
  else if(hm<1430){guide=`🔄 오후 매매 (13~14:30)\n프로그램 방향 확인\n오전 종목 지속 여부 판단`;color="var(--b)";}
  else if(hm<1520){guide=`⚠ 마감 준비 (14:30~15:20)\n당일매매 포지션 정리\n오버나잇 여부 결정`;color="var(--a)";}
  else{guide=`🔒 15:20 이후\n오버나잇 결정\nPhase 9-7 체크리스트\n미청산 = 오버나잇 허용 시만`;color="var(--r)";}
  el.textContent=guide;el.style.color=color;
}

// ═══════════════════════════════
// 뇌동매매 실시간 감지 강화 (Phase 11)
// ═══════════════════════════════
let bdMetrics={lossSeries:0,last30min:[],reentryCount:0,lastSellTime:null};

function checkBrainDong(side,price,qty,stk){
  // 자동매매/백테스트 중에는 사람용 경고 표시 안 함 (UI 클러터 + 알림창 차단)
  const _suppress = (autoState&&autoState.running) || (window.backtest&&backtest.running);
  if(_suppress) return;
  const now=Date.now();
  // 30분 내 매매 횟수
  bdMetrics.last30min=bdMetrics.last30min.filter(t=>now-t<1800000);
  bdMetrics.last30min.push(now);
  const freq=bdMetrics.last30min.length;
  // 손절 후 재진입 감지
  if(side==="buy"&&bdMetrics.lastSellTime&&now-bdMetrics.lastSellTime<1800000){
    bdMetrics.reentryCount++;
  }
  // 비중 계산
  const inv=(qty||0)*(price||0);
  const sizePct=mock.cash>0?(inv/cfg.capital*100).toFixed(1):0;
  // UI 업데이트
  const lossEl=document.getElementById("bd_loss"),freqEl=document.getElementById("bd_freq");
  const sizeEl=document.getElementById("bd_size"),reEl=document.getElementById("bd_reentry");
  if(lossEl){lossEl.textContent=mock.lossSeries+"회";lossEl.style.color=mock.lossSeries>=3?"var(--r)":"var(--ts)";}
  if(freqEl){freqEl.textContent=freq+"회";freqEl.style.color=freq>=3?"var(--r)":"var(--ts)";}
  if(sizeEl){sizeEl.textContent=sizePct+"%";sizeEl.style.color=parseFloat(sizePct)>30?"var(--r)":"var(--ts)";}
  if(reEl){reEl.textContent=bdMetrics.reentryCount+"회";reEl.style.color=bdMetrics.reentryCount>=2?"var(--r)":"var(--ts)";}
  // 경고 조건
  const warnings=[];
  if(mock.lossSeries>=3)warnings.push("연속 손절 "+mock.lossSeries+"회 — 즉시 중단");
  if(freq>=4)warnings.push("30분 내 "+freq+"회 매매 — 과매매");
  if(parseFloat(sizePct)>30)warnings.push("비중 "+sizePct+"% 과다");
  if(bdMetrics.reentryCount>=2)warnings.push("손절 후 재진입 "+bdMetrics.reentryCount+"회");
  // 추격매수 감지
  if(side==="buy"&&cs){
    const cs2=getCandles(3);
    const prev=cs2[cs2.length-2];
    if(prev&&price>prev.c*1.02)warnings.push("추격매수 감지 (+2% 이상에서 진입)");
  }
  const warnEl=document.getElementById("bd_warning");
  if(warnEl&&warnings.length>0){
    warnEl.style.display="block";
    warnEl.style.background="rgba(240,62,62,.08)";
    warnEl.style.border="1px solid rgba(240,62,62,.2)";
    warnEl.style.color="var(--r)";
    warnEl.innerHTML="🚨 "+warnings.join("<br>🚨 ");
    if(warnings.length>=2)showAlert("🚨 뇌동매매 경고 (Phase 11)","감지된 신호:\n"+warnings.map(w=>"• "+w).join("\n")+"\n\n지금 해야 할 것:\n1. 즉시 매매 중단\n2. HTS 5분 종료\n3. 냉각 후 복기");
  } else if(warnEl){warnEl.style.display="none";}
}
// ═══════════════════════════════
// 뉴스 → 섹터 영향 AI 분석
// ═══════════════════════════════
async function runNewsImpact(){
  const text=(document.getElementById("newsInputTa")||{}).value?.trim();
  const el=document.getElementById("newsImpactResult"); if(!el)return;
  if(!text){el.textContent="뉴스 텍스트를 입력해주세요.";return;}
  el.innerHTML='<span style="color:var(--tm);font-style:italic;">AI 분석 중...</span>';
  try{
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:500,
        messages:[{role:"user",content:`단타 트레이딩 멘토. 아래 뉴스/공시가 어떤 섹터에 어떻게 영향 미치는지 분석해줘.

뉴스: ${text}

JSON만 답해:
{
  "mainSector": "주영향 섹터명",
  "impact": "긍정/부정/중립",
  "strength": "강/보통/약",
  "duration": "당일/수일/수주",
  "relatedStocks": ["종목명1","종목명2","종목명3"],
  "strategy": "매매 전략 1~2줄",
  "caution": "주의사항 1줄",
  "grade": "S/A/B/C"
}`}]})});
    const data=await res.json();
    const raw=data.content?.[0]?.text||"{}";
    let p;try{const m=raw.match(/\{[\s\S]*\}/);p=JSON.parse(m?m[0]:"{}"); }catch(e){p={};}
    if(p.mainSector){
      const ic={"긍정":"var(--g)","부정":"var(--r)","중립":"var(--ts)"}[p.impact]||"var(--ts)";
      const gc={"S":"var(--p)","A":"var(--b)","B":"var(--a)","C":"var(--r)"}[p.grade]||"var(--ts)";
      el.innerHTML=`<div style="padding:5px 7px;background:var(--bg);border-radius:7px;border-left:3px solid ${ic};">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
          <span style="font-weight:700;font-size:10px;">${p.mainSector}</span>
          <span style="color:${ic};font-size:9px;font-weight:700;">${p.impact} ${p.strength}</span>
          <span style="font-family:var(--mono);font-size:9px;padding:0 4px;border-radius:3px;background:${gc}18;color:${gc};">${p.grade}급</span>
        </div>
        <div style="font-size:9px;color:var(--ts);margin-bottom:2px;">⏱ ${p.duration} | 관련: ${(p.relatedStocks||[]).join(", ")}</div>
        <div style="font-size:9px;color:var(--tp);">${p.strategy||""}</div>
        ${p.caution?`<div style="font-size:9px;color:var(--r);margin-top:2px;">⚠ ${p.caution}</div>`:""}
      </div>`;
      // 재료 강도도 업데이트
      document.getElementById("materialInput").value=text;
      addDecisionLog(`뉴스분석: ${p.mainSector}`,`${p.impact} ${p.strength} | ${p.duration}`,`Phase 6-1 재료강도 ${p.grade}급`);
    } else el.textContent=raw.slice(0,150);
  }catch(e){el.textContent="API 오류";}
}

// ═══════════════════════════════
// 통계 강화 — 수익/손실 패턴, 시간대별, AI 분석
// ═══════════════════════════════
async function runAIPatternAnalysis(){
  const el=document.getElementById("aiPatternResult"); if(!el)return;
  const trades=mock.trades||[];
  if(trades.length<3){el.textContent="거래 내역이 3개 이상 있어야 분석 가능합니다.";return;}
  el.innerHTML='<span style="color:var(--tm);font-style:italic;">AI 패턴 분석 중...</span>';
  const wins=trades.filter(t=>t.pnl>0);
  const losses=trades.filter(t=>t.pnl<0);
  const summary=`총 ${trades.length}회 | 수익 ${wins.length}회 | 손실 ${losses.length}회
승률 ${(wins.length/trades.length*100).toFixed(0)}%
평균 수익: ${wins.length?Math.round(wins.reduce((a,t)=>a+t.pnl,0)/wins.length).toLocaleString():"0"}원
평균 손실: ${losses.length?Math.round(losses.reduce((a,t)=>a+t.pnl,0)/losses.length).toLocaleString():"0"}원
최대 연속 손실: ${mock.lossSeries}회`;
  try{
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:600,
        messages:[{role:"user",content:`단타 트레이딩 멘토. Phase 12 복기 분석을 해줘.

매매 통계:
${summary}

최근 거래:
${trades.slice(-10).map(t=>`${t.side==="buy"?"매수":"매도"} ${t.nm} ${t.price?.toLocaleString()}원 ${t.pnl>=0?"+":""}${t.pnl?.toLocaleString()}원`).join("\n")}

분석해줘:
1. 수익 나는 패턴 Top 2 (구체적으로)
2. 손실 나는 패턴 Top 2 (구체적으로)
3. 강점 매매 스타일 (한줄)
4. 개선 우선순위 1가지
5. 개인화 원칙 제안 (진입/손절/익절 각 1줄)

각 항목에 Phase 번호 포함. 200자 이내.`}]})});
    const data=await res.json();
    const text=data.content?.[0]?.text||"분석 실패";
    el.style.whiteSpace="pre-wrap";
    el.style.color="var(--ts)";
    el.style.whiteSpace='pre-wrap';
    el.style.color='var(--ts)';
    // 텍스트 + AI 즉시반영 버튼
    el.innerHTML = `<div style="white-space:pre-wrap;margin-bottom:8px;">${text.replace(/</g,'&lt;')}</div>
      <button onclick="applyCoachingToAI()" data-coaching="${encodeURIComponent(text)}" style="background:var(--p);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">⚡ AI에 즉시 반영 (영구 저장)</button>
      <button onclick="alert('이미 누적된 코칭은 학습 메모리 노트(좌측 🎓)에서 확인 가능합니다.')" style="background:none;color:var(--tm);border:1px solid var(--br);padding:6px 10px;border-radius:6px;font-size:10px;cursor:pointer;margin-left:4px;">ℹ 누적 확인</button>`;
    window._lastCoachingText = text;
  }catch(e){el.textContent="API 오류: "+e.message;}
}

// AI 복기 분석 결과를 학습 메모리에 영구 저장 — 이후 모든 매매 결정에 반영
function applyCoachingToAI(){
  try{
    const text = window._lastCoachingText || '';
    if(!text){ showAlert('반영 실패', '복기 분석 결과가 없습니다'); return; }
    // 학습 메모리에 누적 (카테고리: 복기)
    if(!window.learningMemory) window.learningMemory = [];
    const date = sim.date || new Date().toISOString().slice(0,10);
    // 한 번에 여러 항목으로 쪼개서 저장
    const lines = text.split(/\n+/).filter(l => l.trim().length > 8);
    lines.slice(0, 8).forEach(line => {
      learningMemory.push({ date, category:'복기', text: line.trim() });
    });
    if(learningMemory.length > 80) learningMemory = learningMemory.slice(-80);
    window.learningMemory = learningMemory;
    // 영구 저장
    try{
      saveToServer('htsLearningMemory', JSON.stringify(learningMemory));
      localStorage.setItem('htsLearningMemory', JSON.stringify(learningMemory));
    }catch(_e){}
    // 별도 코칭 히스토리에도 누적
    try{
      const hist = JSON.parse(localStorage.getItem('htsCoachingHistory') || '[]');
      hist.push({ ts: Date.now(), date, text });
      if(hist.length > 50) hist.shift();
      saveToServer('htsCoachingHistory', JSON.stringify(hist));
      localStorage.setItem('htsCoachingHistory', JSON.stringify(hist));
    }catch(_e){}
    if(typeof updateLearnerStage === 'function') updateLearnerStage();
    showAlert('✅ AI에 반영 완료', '복기 분석이 학습 메모리에 누적됐어요.\n다음 모든 매매 결정 프롬프트에 자동 첨부됩니다.\n좌측 🎓 노트로 확인 가능.');
    if(typeof addDecisionLog === 'function') addDecisionLog('🎓 코칭 반영', lines.length+'개 항목 학습 메모리에 저장', '학습');
  }catch(e){ showAlert('반영 오류', e.message); }
}

// 자신만의 셋업 개발 AI (Phase 10-10)
async function runMySetupAI(){
  const el=document.getElementById('aiPatternResult'); if(!el)return;
  const trades=mock.trades||[];
  if(trades.length<10){el.textContent='10회 이상 매매 필요';return;}
  el.innerHTML='<span style="color:var(--tm);font-style:italic;">수익 패턴에서 나만의 셋업 추출 중...</span>';
  const wins=trades.filter(t=>t.pnl>0);
  const summary=`수익 매매 ${wins.length}회 / 총 ${trades.length}회\n승률 ${(wins.length/trades.length*100).toFixed(0)}%\n평균수익 ${wins.length?Math.round(wins.reduce((a,t)=>a+t.pnl,0)/wins.length).toLocaleString():'0'}원`;
  try{
    const data=await callClaude({model:"claude-sonnet-4-5",max_tokens:500,
      messages:[{role:"user",content:`단타 트레이딩 Phase 10-10. 아래 매매 데이터에서 나만의 셋업을 추출해줘.\n\n${summary}\n\n수익 거래: ${wins.slice(-10).map(t=>`${t.nm} ${(t.price||0).toLocaleString()}원 +${Math.round(t.pnl)}원 (${t.time||''})`).join(' / ')}\n\n분석:\n1. 수익 패턴의 공통 조건 (시간대/종목특성/진입방식)\n2. 나만의 셋업 이름 제안\n3. 셋업 진입 조건 3가지\n4. 셋업 청산 조건\n5. 백테스트 권장 사항\n100자 이내.`}]},
      "나만의셋업AI");
    el.style.whiteSpace='pre-wrap'; el.style.color='var(--ts)';
    el.textContent=data.content?.[0]?.text||'분석 실패';
  }catch(e){el.textContent='API 오류';}
}

function renderStatsEnhanced(){
  const trades=(mock.trades||[]).filter(isMarketHourTrade); // 장시간(09:00~15:30) 기준
  // 수익/손실 패턴
  const wins=trades.filter(t=>t.pnl>0);
  const losses=trades.filter(t=>t.pnl<0);
  const wEl=document.getElementById("winPatterns");
  const lEl=document.getElementById("lossPatterns");
  if(wEl){
    if(!wins.length){wEl.innerHTML="<span style='color:var(--tm);'>수익 거래 없음</span>";}
    else{
      const avgWin=Math.round(wins.reduce((a,t)=>a+t.pnl,0)/wins.length);
      const maxWin=Math.max(...wins.map(t=>t.pnl));
      const winNms=[...new Set(wins.map(t=>t.nm))].slice(0,3);
      wEl.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <div style="background:rgba(5,192,114,.06);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:9px;color:var(--tm);">평균 수익</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--g);">+${avgWin.toLocaleString()}원</div>
        </div>
        <div style="background:rgba(5,192,114,.06);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:9px;color:var(--tm);">최대 수익</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--g);">+${maxWin.toLocaleString()}원</div>
        </div>
      </div>
      <div style="font-size:10px;color:var(--ts);">수익 종목: ${winNms.join(", ")}</div>`;
    }
  }
  if(lEl){
    if(!losses.length){lEl.innerHTML="<span style='color:var(--tm);'>손실 거래 없음</span>";}
    else{
      const avgLoss=Math.round(losses.reduce((a,t)=>a+t.pnl,0)/losses.length);
      const maxLoss=Math.min(...losses.map(t=>t.pnl));
      lEl.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <div style="background:rgba(240,62,62,.06);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:9px;color:var(--tm);">평균 손실</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--r);">${avgLoss.toLocaleString()}원</div>
        </div>
        <div style="background:rgba(240,62,62,.06);border-radius:8px;padding:8px;text-align:center;">
          <div style="font-size:9px;color:var(--tm);">최대 손실</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--r);">${maxLoss.toLocaleString()}원</div>
        </div>
      </div>`;
    }
  }
  // 시간대별 성과
  const tEl=document.getElementById("timeStats");
  if(tEl&&trades.length){
    const slots={"09":0,"10":0,"11":0,"13":0,"14":0,"기타":0};
    const counts={"09":0,"10":0,"11":0,"13":0,"14":0,"기타":0};
    trades.forEach(t=>{
      const h=t.time?t.time.slice(0,2):"기타";
      const k=slots[h]!==undefined?h:"기타";
      slots[k]+=(t.pnl||0);counts[k]++;
    });
    tEl.innerHTML=Object.entries(slots).map(([h,pnl])=>{
      const cnt=counts[h]||0;
      const up=pnl>=0;
      return`<div style="text-align:center;background:${up?"rgba(5,192,114,.07)":"rgba(240,62,62,.07)"};border-radius:7px;padding:6px 4px;">
        <div style="font-size:9px;color:var(--tm);">${h}시</div>
        <div style="font-family:var(--mono);font-size:10px;font-weight:700;color:${up?"var(--g)":"var(--r)"};">${up?"+":""}${Math.round(pnl/1000)}K</div>
        <div style="font-size:8px;color:var(--tm);">${cnt}회</div>
      </div>`;
    }).join("");
  }
}

// ═══════════════════════════════
// 주문창 수수료 포함 실질 수익 표시
// ═══════════════════════════════


// ══════════════════════════════════════════════════════════
// 피라미딩 계산기 (Phase 10-8)
// ══════════════════════════════════════════════════════════
function calcScalpFee(){
  const amt=parseFloat(document.getElementById('scalpAmt')?.value)||0;
  const pct=parseFloat(document.getElementById('scalpPct')?.value)||0.5;
  const el=document.getElementById('scalpResult'); if(!el)return;
  if(!amt){el.textContent='금액 입력';return;}
  const gross=amt*pct/100;
  const fee=(amt*(cfg.bf||0.015)/100)+(amt*(cfg.sf||0.015)/100);
  const tax=amt*(cfg.tx||0.18)/100;
  const net=gross-fee-tax;
  const bep=(fee+tax)/amt*100;
  el.innerHTML='<span style="color:'+(net>=0?'var(--g)':'var(--r)')+'">실질 '+(net>=0?'+':'')+Math.round(net).toLocaleString()+'원</span> | 비용 '+Math.round(fee+tax).toLocaleString()+'원 | 손익분기 +'+bep.toFixed(2)+'%';
}
function calcPyramid(){
  const amt = parseFloat(document.getElementById('pyAmt')?.value)||0;
  const pr = parseFloat(document.getElementById('pyPr')?.value)||0;
  const pos = mock.positions[activeTk];
  const el = document.getElementById('pyResult'); if(!el)return;
  if(!pos||pos.qty<=0){el.innerHTML='<span style="color:var(--r);">보유 포지션 없음 — 수익 중일 때만 사용</span>';return;}
  const stk = STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  // 현재 수익 확인
  const curPnl = (stk.pr - pos.avgPrice)/pos.avgPrice*100;
  if(curPnl <= 0){el.innerHTML='<span style="color:var(--r);">⚠ 손실 중 피라미딩 금지 (물타기 아님) — Phase 10-8</span>';return;}
  if(!amt||!pr){el.innerHTML='<span style="color:var(--tm);">금액과 추가매수가 입력 필요</span>';return;}
  const addQty = Math.floor(amt/pr);
  const totalQty = pos.qty + addQty;
  const newAvg = (pos.avgPrice*pos.qty + pr*addQty)/totalQty;
  const newPnlPct = (stk.pr-newAvg)/newAvg*100;
  // 역피라미드 체크 (추가 금액이 기존보다 작아야 함)
  const curAmt = pos.avgPrice*pos.qty;
  const isReverse = amt <= curAmt*0.6; // 기존의 60% 이하
  const fee = amt*(cfg.bf+cfg.sf)/100;
  // R/R 재계산
  const so = stopOrders[activeTk];
  const stopDist = so?Math.abs(newAvg-so.stop)/newAvg*100:3;
  const t1Dist = so?Math.abs(so.t1-newAvg)/newAvg*100:6;
  const rr = stopDist>0?t1Dist/stopDist:0;
  const rrOk = rr>=1.5;
  el.innerHTML = `<div style="color:${isReverse?'var(--g)':'var(--a)'};">${isReverse?'✅ 역피라미드 적합':'⚠ 추가분이 큼 — 더 줄일 것'}</div>`+
    `<div>새 평단: <b>${Math.round(newAvg).toLocaleString()}원</b> (현재수익 ${curPnl.toFixed(1)}%→${newPnlPct.toFixed(1)}%)</div>`+
    `<div>추가 수량: ${addQty}주 | 수수료: ${Math.round(fee).toLocaleString()}원</div>`+
    `<div style="color:${rrOk?'var(--g)':'var(--r)'};">R/R: 1:${rr.toFixed(1)} ${rrOk?'✅':'❌ 1.5 미달'}</div>`;
}

// ══════════════════════════════════════════════════════════
// 매매신뢰도지수 (Phase 11-13)
// ══════════════════════════════════════════════════════════
let trustScore = 7;
function updateTrustScore(v){
  trustScore = parseInt(v);
  const el = document.getElementById('trustScoreVal');
  const desc = document.getElementById('trustScoreDesc');
  const limit = document.getElementById('trustAutoLimit');
  if(!el||!desc)return;
  let c,d,l="";
  if(trustScore>=9){c='var(--g)';d='최상 — 확신 매매 가능. 정상 비중';}
  else if(trustScore>=7){c='var(--g)';d='양호 — 정상 비중으로 매매 가능';}
  else if(trustScore>=5){c='var(--a)';d='보통 — 비중 50% 이하 유지 권장';l='⚠ 비중 50% 이하 권고';}
  else if(trustScore>=3){c='var(--a)';d='주의 — 스캘핑 금지. 신중하게';l='⚠ 스캘핑 금지 | 비중 30% 이하';}
  else{c='var(--r)';d='⚠ 매매 중단 권고 — 당일 관망';l='🚨 당일 매매 중단 권고';}
  el.textContent=trustScore+'/10'; el.style.color=c;
  desc.style.background=trustScore>=5?'rgba(5,192,114,.06)':'rgba(240,62,62,.06)';
  desc.style.color=c; desc.textContent=d;
  if(limit){limit.textContent=l;limit.style.display=l?'block':'none';}
  saveToServer('trustScore', String(trustScore));
}

// ══════════════════════════════════════════════════════════
// 슬럼프 감지 (Phase 11-12)
// ══════════════════════════════════════════════════════════
function detectSlump(){
  const el = document.getElementById('slumpPanel'); if(!el)return;
  const trades = mock.trades||[];
  if(trades.length < 10){el.innerHTML='<span style="color:var(--tm);">매매 10회 이상 필요</span>';return;}
  // 최근 2주 분석
  const recent = trades.slice(-20);
  const wins = recent.filter(t=>t.pnl>0).length;
  const total = recent.length;
  const wr = total>0?wins/total:0.5;
  const lossSeries = mock.lossSeries||0;
  let level=0, msg='', action='';
  if(lossSeries>=7||(wr<0.3&&total>=15)){level=3;msg='🔴 심각한 슬럼프';action='즉시 실전 중단 → 모의투자 전환 (Phase 11-12 3단계)';}
  else if(lossSeries>=5||(wr<0.35&&total>=10)){level=2;msg='🟠 슬럼프 경고';action='1주일 실전 중단 → 과거 100개 복기 (Phase 11-12 2단계)';}
  else if(lossSeries>=3||(wr<0.4&&total>=8)){level=1;msg='🟡 주의';action='비중 50% 이하 제한 + 매매 횟수 줄임 (Phase 11-12 1단계)';}
  else{msg='🟢 정상';action='현재 전략 유지';}
  el.innerHTML=`<div style="font-weight:700;margin-bottom:3px;">${msg}</div>`+
    `<div style="color:var(--tm);">최근 ${total}회 | 승률 ${(wr*100).toFixed(0)}% | 연속손실 ${lossSeries}회</div>`+
    `<div style="margin-top:3px;padding:3px 5px;background:var(--bg);border-radius:4px;">${action}</div>`;
}

// ══════════════════════════════════════════════════════════
// 멘탈 리셋 루틴 (Phase 11-11)
// ══════════════════════════════════════════════════════════
function showMentalReset(){
  const steps = [
    '1단계 (즉각): HTS 5분 종료 후 자리에서 일어나기',
    '2단계 (30분내): 실외 이동 또는 다른 공간. 물 한 잔. 심호흡 10회',
    '3단계 (복기): 오늘 손실 원인 3줄 작성. 내 실수? 시장? 전략?',
    '4단계: 오늘 매매 완전 중단 선언',
    '5단계 (내일): 실수 반복 방지를 위한 구체적 변경 1가지 확정'
  ];
  showAlert('🔄 멘탈 리셋 루틴 (Phase 11-11)',
    '연속손실 3회 이상 → 즉시 실행:\n\n'+steps.join('\n')+
    '\n\n⚠ 오늘 재진입 조건:\n• 손실 원인 분석 완료\n• 30분 이상 경과\n• 비중 50% 이하로 축소\n• 다른 종목 + 다른 셋업');
  const el = document.getElementById('mentalResetStatus');
  if(el){el.textContent='리셋 루틴 실행: '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});el.style.color='var(--g)';}
}

// ══════════════════════════════════════════════════════════
// 처분효과 + 과잉확신 경고 (Phase 11-4, 11-5)
// ══════════════════════════════════════════════════════════
function checkPsychWarnings(){
  const el = document.getElementById('psychWarningBanner'); if(!el)return;
  const warnings = [];
  // 처분효과: 수익 중인데 목표가 미달인데 팔려고 하면
  Object.entries(mock.positions).forEach(([tk,pos])=>{
    const stk=STOCKS.find(s=>s.tk===tk); if(!stk)return;
    const pnlPct=(stk.pr-pos.avgPrice)/pos.avgPrice*100;
    const so=stopOrders[tk];
    if(pnlPct>0&&pnlPct<1&&so&&stk.pr<so.t1){
      warnings.push(`처분효과 주의: ${stk.nm} +${pnlPct.toFixed(1)}% — 목표가(${so.t1.toLocaleString()}) 미달. 조기청산 충동 = 처분효과`);
    }
    if(pnlPct>3&&so&&!so.t1done){
      // 좋은 상태 — 홀딩 격려
    }
  });
  // 과잉확신: 3일 연속 수익 후 경고
  const recentTrades = mock.trades?.slice(-6)||[];
  const recentWins = recentTrades.filter(t=>t.pnl>0).length;
  if(recentWins>=5){
    warnings.push('과잉확신 주의: 최근 6회 중 '+recentWins+'회 수익. 비중 확대 충동 억제. 원칙 유지');
  }
  if(warnings.length>0){
    el.style.display='block';
    el.style.background='rgba(255,153,0,.08)';
    el.style.border='1px solid rgba(255,153,0,.25)';
    el.style.color='var(--a)';
    el.innerHTML='⚠ '+warnings.join('<br>⚠ ');
  } else el.style.display='none';
}

// ══════════════════════════════════════════════════════════
// 주간/월간 통계 (Phase 12-7)
// ══════════════════════════════════════════════════════════
// 종목별 누적 손익
function renderSymbolPnl(){
  const el=document.getElementById('symbolPnl'); if(!el)return;
  const trades=mock.trades||[];
  if(!trades.length){el.textContent='거래 없음';return;}
  const bySymbol={};
  trades.forEach(t=>{
    if(t.side!=='sell')return;
    if(!bySymbol[t.nm])bySymbol[t.nm]={pnl:0,cnt:0,wins:0};
    bySymbol[t.nm].pnl+=(t.pnl||0);
    bySymbol[t.nm].cnt++;
    if(t.pnl>0)bySymbol[t.nm].wins++;
  });
  const sorted=Object.entries(bySymbol).sort((a,b)=>b[1].pnl-a[1].pnl);
  el.innerHTML=sorted.map(([nm,d])=>{
    const wr=d.cnt>0?(d.wins/d.cnt*100).toFixed(0):0;
    const up=d.pnl>=0;
    return`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--br);">
      <div style="flex:1;font-size:11px;font-weight:600;">${nm}</div>
      <div style="font-size:10px;color:var(--tm);">${d.cnt}회 | 승률${wr}%</div>
      <div style="width:80px;height:4px;background:var(--bg);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${Math.min(100,Math.abs(d.pnl)/10000)}%;background:${up?'var(--g)':'var(--r)'};border-radius:2px;"></div>
      </div>
      <div style="font-family:var(--mono);font-size:11px;font-weight:700;color:${up?'var(--g)':'var(--r)'};">${up?'+':''}${Math.round(d.pnl).toLocaleString()}</div>
    </div>`;
  }).join('');
}

// 당일 매매 타임라인
function renderTimeline(){
  const el=document.getElementById('tradeTimeline'); if(!el)return;
  const today=new Date().toISOString().slice(0,10);
  const trades=(mock.trades||[]).filter(t=>t.date===today||!today);
  if(!trades.length){el.textContent='오늘 거래 없음';return;}
  el.innerHTML=`<div style="position:relative;padding-left:20px;">
    <div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:var(--br);border-radius:1px;"></div>
    ${trades.map(t=>{
      const up=t.pnl>=0||t.side==='buy';
      const col=t.side==='buy'?'var(--b)':t.pnl>=0?'var(--g)':'var(--r)';
      return`<div style="position:relative;padding:5px 0 5px 12px;margin-bottom:2px;">
        <div style="position:absolute;left:3px;top:9px;width:10px;height:10px;border-radius:50%;background:${col};border:2px solid #fff;"></div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-family:var(--mono);font-size:9px;color:var(--tm);">${t.time||'--:--'}</span>
          <span style="font-size:10px;font-weight:600;">${t.nm}</span>
          <span style="font-size:9px;color:${col};font-weight:700;">${t.side==='buy'?'▲ 매수':'▼ 매도'}</span>
          <span style="font-family:var(--mono);font-size:9px;color:var(--ts);">${(t.price||0).toLocaleString()}원 × ${t.qty}주</span>
          ${t.pnl!==0?`<span style="font-family:var(--mono);font-size:9px;font-weight:700;color:${col};margin-left:auto;">${t.pnl>=0?'+':''}${Math.round(t.pnl).toLocaleString()}</span>`:''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderWeeklyStats(){
  const el=document.getElementById('weeklyStatsPanel'); if(!el)return;
  const trades=mock.trades||[];
  // ★ 가장 최근 거래일 기준으로 이번 주 (백테스트도 정상 작동)
  const allDates = [...new Set(trades.map(t=>t.date))].sort();
  const refDate = allDates.length ? allDates[allDates.length-1] : (sim.date||new Date().toISOString().slice(0,10));
  const ref = new Date(refDate);
  const weekStart = new Date(ref); weekStart.setDate(ref.getDate()-ref.getDay());
  const weekly=trades.filter(t=>{
    const d=new Date(t.date); return d>=weekStart && d<=ref;
  });
  if(!weekly.length){el.textContent='이번 주 거래 없음';return;}
  const wins=weekly.filter(t=>t.pnl>0),losses=weekly.filter(t=>t.pnl<0);
  const total=weekly.length,wr=total>0?(wins.length/total*100).toFixed(0):0;
  const totalPnl=weekly.reduce((a,t)=>a+(t.pnl||0),0);
  const avgWin=wins.length?wins.reduce((a,t)=>a+t.pnl,0)/wins.length:0;
  const avgLoss=losses.length?losses.reduce((a,t)=>a+t.pnl,0)/losses.length:0;
  const rr=avgLoss<0?Math.abs(avgWin/avgLoss):0;
  el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;">
    <div style="background:var(--bg);border-radius:8px;padding:8px;text-align:center;">
      <div style="font-size:9px;color:var(--tm);">매매횟수</div>
      <div style="font-family:var(--mono);font-size:14px;font-weight:700;">${total}회</div>
    </div>
    <div style="background:var(--bg);border-radius:8px;padding:8px;text-align:center;">
      <div style="font-size:9px;color:var(--tm);">승률</div>
      <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:${wr>=45?'var(--g)':'var(--r)'};">${wr}%</div>
    </div>
    <div style="background:var(--bg);border-radius:8px;padding:8px;text-align:center;">
      <div style="font-size:9px;color:var(--tm);">평균 R/R</div>
      <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:${rr>=1.5?'var(--g)':'var(--r)'};">1:${rr.toFixed(1)}</div>
    </div>
    <div style="background:var(--bg);border-radius:8px;padding:8px;text-align:center;">
      <div style="font-size:9px;color:var(--tm);">주간 손익</div>
      <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:${totalPnl>=0?'var(--g)':'var(--r)'};">${totalPnl>=0?'+':''}${Math.round(totalPnl).toLocaleString()}</div>
    </div>
  </div>
  <div style="font-size:10px;color:var(--ts);">
    평균수익: +${Math.round(avgWin).toLocaleString()}원 | 평균손실: ${Math.round(avgLoss).toLocaleString()}원
  </div>`;
}

function renderMonthlyStats(){
  const el=document.getElementById('weeklyStatsPanel'); if(!el)return;
  const trades=mock.trades||[];
  // ★ 가장 최근 거래월 기준 (백테스트 호환)
  const allDates = [...new Set(trades.map(t=>t.date))].sort();
  const refDate = allDates.length ? allDates[allDates.length-1] : (sim.date||new Date().toISOString().slice(0,10));
  const ref = new Date(refDate);
  const monthly=trades.filter(t=>{
    const d=new Date(t.date); return d.getMonth()===ref.getMonth() && d.getFullYear()===ref.getFullYear();
  });
  if(!monthly.length){el.textContent='이번 달 거래 없음';return;}
  const wins=monthly.filter(t=>t.pnl>0),losses=monthly.filter(t=>t.pnl<0);
  const total=monthly.length,wr=total>0?(wins.length/total*100).toFixed(0):0;
  const totalPnl=monthly.reduce((a,t)=>a+(t.pnl||0),0);
  const avgRR=losses.length&&wins.length?Math.abs(wins.reduce((a,t)=>a+t.pnl,0)/wins.length/(losses.reduce((a,t)=>a+t.pnl,0)/losses.length)):0;
  // 반복실수 집계
  const repeats={};
  mock.trades?.forEach(t=>{if(t.repeat&&t.repeat!=='none')repeats[t.repeat]=(repeats[t.repeat]||0)+1;});
  const top3=Object.entries(repeats).sort((a,b)=>b[1]-a[1]).slice(0,3);
  el.innerHTML=`<div style="font-weight:700;margin-bottom:8px;">이번 달 — ${total}회 | 승률 ${wr}% | R/R 1:${avgRR.toFixed(1)} | ${totalPnl>=0?'+':''}${Math.round(totalPnl).toLocaleString()}원</div>`+
    `<div style="font-size:10px;color:var(--ts);">비중확대 허용 조건 (Phase 12-4):<br>`+
    `${total>=20?'✅':'❌'} 매매 20회 이상 (${total}회) &nbsp; `+
    `${parseFloat(wr)>=45?'✅':'❌'} 승률 45% 이상 (${wr}%) &nbsp; `+
    `${avgRR>=1.5?'✅':'❌'} R/R 1.5 이상 (1:${avgRR.toFixed(1)})</div>`+
    (top3.length?`<div style="margin-top:8px;font-size:10px;"><b>반복실수 Top ${top3.length}:</b> ${top3.map(([k,v])=>`${k}(${v}회)`).join(' · ')}</div>`:'');
}

// ══════════════════════════════════════════════════════════
// 반복실수 제거 루틴 (Phase 12-8)
// ══════════════════════════════════════════════════════════
async function runMistakeRemoval(){
  const el=document.getElementById('mistakeRemovalPanel'); if(!el)return;
  el.innerHTML='<span style="color:var(--tm);font-style:italic;">분석 중...</span>';
  const trades=mock.trades||[];
  if(trades.length<5){el.textContent='거래 5회 이상 필요';return;}
  const repeats={};
  trades.forEach(t=>{if(t.repeat&&t.repeat!=='none')repeats[t.repeat]=(repeats[t.repeat]||0)+1;});
  const top3=Object.entries(repeats).sort((a,b)=>b[1]-a[1]).slice(0,3);
  if(!top3.length){el.textContent='반복 실수 없음. 현재 원칙 잘 지키고 있습니다.';return;}
  const mistakeLabels={
    earlyExit:'조기 익절(처분효과)',fomo:'FOMO 추격매수',noStop:'손절 미실행',
    revenge:'복수심리 재진입',oversize:'비중 과다',noCheck:'체크리스트 스킵'
  };
  el.innerHTML=top3.map(([k,v],i)=>`<div style="padding:7px;background:var(--bg);border-radius:8px;margin-bottom:6px;">
    <div style="font-weight:700;color:var(--r);">${i+1}위. ${mistakeLabels[k]||k} (${v}회)</div>
    <div style="font-size:10px;color:var(--ts);margin-top:3px;">${getMistakeSolution(k)}</div>
  </div>`).join('')+
  `<div style="margin-top:8px;font-size:10px;color:var(--tm);">다음 달: 위 실수가 줄었는지 반드시 검증 (Phase 12-8 4단계)</div>`;
}
function getMistakeSolution(k){
  const solutions={
    earlyExit:'교정: 1차 익절 후 손절선 본전화 → 나머지는 트레일링 스탑으로 유지',
    fomo:'교정: 첫 봉(9:00~9:10) 완성 확인 의무화 + 9:10 이전 신규진입 금지',
    noStop:'교정: 진입 즉시 손절 예약주문 설정 (30초 이내)',
    revenge:'교정: 손절 후 30분 HTS 강제 종료 + 복기 작성 전 재진입 금지',
    oversize:'교정: 주문창 비중 자동계산 활용, 금액 직접입력 방식으로 변경',
    noCheck:'교정: Phase 8 장중체크탭에서 GO 확인 후에만 주문 버튼 접근',
  };
  return solutions[k]||'구체적 차단 방법 수립 필요';
}

// ══════════════════════════════════════════════════════════
// 전략변경 판단 (Phase 12-10)
// ══════════════════════════════════════════════════════════
function checkStrategyChange(){
  const el=document.getElementById('strategyChangePanel'); if(!el)return;
  const trades=mock.trades||[];
  if(trades.length<10){el.textContent='판단을 위해 거래 10회 이상 필요';return;}
  const recent=trades.slice(-30);
  const wins=recent.filter(t=>t.pnl>0);
  const wr=wins.length/recent.length;
  const avgWin=wins.length?wins.reduce((a,t)=>a+t.pnl,0)/wins.length:0;
  const losses=recent.filter(t=>t.pnl<0);
  const avgLoss=losses.length?Math.abs(losses.reduce((a,t)=>a+t.pnl,0)/losses.length):1;
  const rr=avgLoss>0?avgWin/avgLoss:0;
  const signals=[];
  if(wr<0.4)signals.push(`❌ 승률 ${(wr*100).toFixed(0)}% — 기준 45% 미달`);
  if(rr<1.2)signals.push(`❌ R/R 1:${rr.toFixed(1)} — 기준 1.5 미달`);
  if(mock.lossSeries>=5)signals.push(`❌ 연속손실 ${mock.lossSeries}회`);
  const needChange=signals.length>=2;
  el.innerHTML=`<div style="font-size:11px;font-weight:700;color:${needChange?'var(--r)':'var(--g)'};margin-bottom:8px;">${needChange?'⚠ 전략 재검토 필요':'✅ 현재 전략 유지'}</div>`+
    (signals.length?`<div style="font-size:10px;margin-bottom:8px;">${signals.join('<br>')}</div>`:`<div style="font-size:10px;color:var(--g);margin-bottom:8px;">모든 지표 정상</div>`)+
    (needChange?`<div style="font-size:10px;color:var(--ts);background:var(--bg);padding:8px;border-radius:7px;">
      Phase 12-10 전략변경 절차:<br>
      1단계: 실전 1주일 중단<br>
      2단계: 최근 복기 전체 재검토<br>
      3단계: 원인 분류 (시장/전략/심리)<br>
      4단계: 백테스트 20~50회<br>
      5단계: 소액 실전 (정상비중 10%)<br>
      6단계: 10회 안정 → 점진적 비중 복구
    </div>`:``);
}

// ══════════════════════════════════════════════════════════
// 성장단계 로드맵 (Phase 12-5)
// ══════════════════════════════════════════════════════════
function renderGrowthRoadmap(){
  const el=document.getElementById('growthRoadmap'); if(!el)return;
  const trades=mock.trades||[];
  const total=trades.length;
  const wins=trades.filter(t=>t.pnl>0).length;
  const wr=total>0?wins/total:0;
  const months=total>=100?3:total>=20?1:0;
  const stages=[
    {name:'입문',cond:'Phase 0~3 완료',maxAmt:'실전 금지',done:true},
    {name:'초보 실전',cond:'Phase 4~7 학습 중',maxAmt:'10만원 이하',done:total>=5},
    {name:'중급 실전',cond:'Phase 0~12 완료 + 20회 이상',maxAmt:'200만원 이하',done:total>=20},
    {name:'고급 실전',cond:'3개월 수익 + 승률 45%+',maxAmt:'500만원 이하',done:months>=3&&wr>=0.45},
    {name:'프로',cond:'6개월 안정 + 나만의 셋업 3개',maxAmt:'제한 없음',done:months>=6&&wr>=0.5},
  ];
  const curStage=stages.filter(s=>s.done).length-1;
  el.innerHTML=stages.map((s,i)=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;margin-bottom:5px;background:${i===curStage?'rgba(49,130,246,.08)':i<curStage?'rgba(5,192,114,.05)':'var(--bg)'};border:1.5px solid ${i===curStage?'var(--b)':i<curStage?'rgba(5,192,114,.2)':'var(--br)'};">
      <div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${i<curStage?'var(--g)':i===curStage?'var(--b)':'var(--bg)'};color:${i<=curStage?'#fff':'var(--tm)'};">${i<=curStage?'✓':(i+1)}</div>
      <div style="flex:1;">
        <div style="font-size:11px;font-weight:700;color:${i===curStage?'var(--b)':'var(--tp)'};">${s.name} ${i===curStage?'← 현재':''}</div>
        <div style="font-size:9px;color:var(--tm);">${s.cond}</div>
      </div>
      <div style="font-family:var(--mono);font-size:9px;color:var(--ts);">${s.maxAmt}</div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════
// 전체통합 체크리스트 1장 (Phase 12-11)
// ══════════════════════════════════════════════════════════
const MASTER_CL = {
  pre:[
    '야간선물 + 환율 확인',
    '시장 방향 판단 (매수 우호/중립/비우호)',
    '심리 상태 점검 (신뢰도 5 이상이어야 매매)',
    '일일 손실 한도 잔여 확인',
    '오늘 후보 종목 1~3개 최종 확정',
    '각 종목 진입가/손절가/목표가/R/R 확인'
  ],
  entry:[
    '셋업 완성 여부 (Phase 8 체크리스트)',
    'R/R 1.5 이상 확인',
    '손절가 사전 설정 완료',
    'NO-GO 조건 없음 확인',
    '즉시 손절 예약 주문 설정 (진입 후 30초 이내)'
  ],
  hold:[
    '즉각 청산 신호 없음 확인',
    '목표가 vs 현재가 확인',
    '수급 이상 신호 없음',
    '홀딩 조건 3개 충족 여부',
    '15:20 마감 시간 확인'
  ],
  post:[
    '오늘 손익 기록',
    '복기 10분 작성',
    '매매 일지 작성 완료',
    '내일 후보 종목 선정',
    '내일 주요 이벤트 확인',
    'HTS 종료'
  ]
};
let masterCLState = safeParseJSON(localStorage.getItem('masterCL'), {});
function renderMasterChecklist(){
  const sections={pre:'mcl-pre',entry:'mcl-entry',hold:'mcl-hold',post:'mcl-post'};
  Object.entries(sections).forEach(([key,id])=>{
    const el=document.getElementById(id); if(!el)return;
    const items=MASTER_CL[key]||[];
    el.innerHTML=items.map((t,i)=>{
      const k=key+i;
      return`<div style="display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:6px;cursor:pointer;margin-bottom:2px;background:${masterCLState[k]?'rgba(5,192,114,.06)':'transparent'};" onclick="togMCL('${k}')">
        <div style="width:14px;height:14px;border-radius:50%;border:1.5px solid ${masterCLState[k]?'var(--g)':'var(--br)'};background:${masterCLState[k]?'var(--g)':'transparent'};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;">${masterCLState[k]?'✓':''}</div>
        <div style="font-size:10px;color:${masterCLState[k]?'var(--tp)':'var(--ts)'};">${t}</div>
      </div>`;
    }).join('');
  });
}
function togMCL(k){masterCLState[k]=!masterCLState[k];localStorage.setItem('masterCL',JSON.stringify(masterCLState));renderMasterChecklist();}
function resetMasterChecklist(){masterCLState={};localStorage.setItem('masterCL','{}');renderMasterChecklist();}

// ══════════════════════════════════════════════════════════
// 일지 탭 전환
// ══════════════════════════════════════════════════════════
function printChecklist(){
  var secs={pre:'장 시작 전',entry:'진입 시',hold:'보유 중',post:'장 후'};
  var body='<h1>TraidAIr 통합 체크리스트 '+new Date().toLocaleDateString('ko-KR')+'</h1>';
  Object.entries(secs).forEach(function(e){
    body+='<h2>'+e[1]+'</h2>';
    (MASTER_CL[e[0]]||[]).forEach(function(t){
      body+='<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #eee;"><div style="width:14px;height:14px;border:1.5px solid #ccc;border-radius:50%;flex-shrink:0;"></div><div>'+t+'</div></div>';
    });
  });
  var w=window.open('','_blank');
  w.document.write('<html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;font-size:12px;padding:24px;}h1{font-size:16px;margin-bottom:16px;}h2{font-size:13px;margin-top:16px;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px;}</style></head><body>'+body+'</body></html>');
  w.document.close();w.print();
}
function jTab(el,id){
  document.querySelectorAll('#page-journal .stab').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
  ['jt-log','jt-form','jt-rule','jt-checklist'].forEach(tid=>{
    const d=document.getElementById(tid);
    if(d)d.style.display=tid===id?'block':'none';
  });
  if(id==='jt-checklist')renderMasterChecklist();
  if(id==='jt-rule')loadPersonalRules();
}

// ══════════════════════════════════════════════════════════
// 개인원칙 저장/로드 (Phase 11-13)
// ══════════════════════════════════════════════════════════
// 실전전환 준비도 체크 (Phase 12-5)
function checkRealReadiness(){
  const el=document.getElementById('realReadiness'); if(!el)return;
  const trades=mock.trades||[];
  const total=trades.length;
  const wins=trades.filter(t=>t.pnl>0).length;
  const wr=total>0?wins/total:0;
  const journals=safeParseJSON(localStorage.getItem('manualJournals'), []);
  const rules=safeParseJSON(localStorage.getItem('personalRules'), {});
  const items=[
    {txt:"Phase 0~12 전체 완료",done:true},
    {txt:`소액 실전 20회 이상 (현재 ${total}회)`,done:total>=20},
    {txt:`복기 일지 20개 이상 (현재 ${journals.length}개)`,done:journals.length>=20},
    {txt:`승률 45% 이상 (현재 ${(wr*100).toFixed(0)}%)`,done:wr>=0.45},
    {txt:"개인 매매 원칙 작성 완료",done:!!(rules.strength&&rules.weakness)},
    {txt:"나만의 강점 패턴 1개 파악",done:!!(rules.strength&&rules.strength.length>10)},
    {txt:"손절 원칙 준수율 90% 이상 (복기 기반)",done:total>=10&&wr>=0.4},
  ];
  const done=items.filter(i=>i.done).length;
  const ready=done>=6;
  el.innerHTML=`<div style="font-weight:700;font-size:12px;color:${ready?'var(--g)':'var(--a)'};margin-bottom:8px;">${ready?'✅ 실전 전환 준비 완료':'⏳ 준비 중 ('+done+'/'+items.length+')'}</div>`+
    items.map(i=>`<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--br);">
      <div style="width:14px;height:14px;border-radius:50%;background:${i.done?'var(--g)':'var(--bg)'};border:1.5px solid ${i.done?'var(--g)':'var(--br)'};display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;flex-shrink:0;">${i.done?'✓':''}</div>
      <div style="font-size:10px;color:${i.done?'var(--tp)':'var(--ts)'};">${i.txt}</div>
    </div>`).join('')+
    (ready?`<div style="margin-top:8px;padding:6px 8px;background:rgba(5,192,114,.08);border-radius:7px;font-size:10px;color:var(--g);">소액(정상비중 10%)으로 시작 → 10회 안정 → 비중 20% → 점진 확대</div>`:
    `<div style="margin-top:8px;padding:6px 8px;background:rgba(255,153,0,.08);border-radius:7px;font-size:10px;color:var(--a);">아직 ${items.length-done}개 조건 미충족. 모의투자 계속 진행</div>`);
}

function savePersonalRules(){
  const rules={
    strength:document.getElementById('pr-strength')?.value||'',
    weakness:document.getElementById('pr-weakness')?.value||'',
    time:document.getElementById('pr-time')?.value||'',
    avoid:document.getElementById('pr-avoid')?.value||'',
    size:document.getElementById('pr-size')?.value||'',
    maxpos:document.getElementById('pr-maxpos')?.value||'',
    stop:document.getElementById('pr-stop')?.value||'',
    weekly:document.getElementById('pr-weekly')?.value||''
  };
  localStorage.setItem('personalRules',JSON.stringify(rules));
  const el=document.getElementById('prSaved');
  if(el){el.textContent='✅ 저장됨: '+new Date().toLocaleTimeString('ko-KR');el.style.color='var(--g)';}
}
function loadPersonalRules(){
  const r=safeParseJSON(localStorage.getItem('personalRules'), {});
  ['strength','weakness','time','avoid','size','maxpos','stop','weekly'].forEach(k=>{
    const el=document.getElementById('pr-'+k);
    if(el&&r[k])el.value=r[k];
  });
}

// ══════════════════════════════════════════════════════════
// 일지 작성 폼 — 오늘 거래 자동입력 (Phase 12-6)
// ══════════════════════════════════════════════════════════
// AI 복기 프롬프트 4종 (Phase 12-9)
const REVIEW_PROMPTS = {
  1: (trades, pnl) => `아래 매매를 Phase 8~12 기준으로 분석해줘.\n\n매매: ${trades.slice(-1).map(t=>`${t.nm} ${t.side==='buy'?'매수':'매도'} ${(t.price||0).toLocaleString()}원 ${t.qty}주 손익${t.pnl>=0?'+':''}${Math.round(t.pnl||0)}원`).join(', ')}\n\n평가:\n1. 진입 타점 적절성 (Phase 8)\n2. 청산 타이밍 (Phase 9)\n3. R/R 수준\n4. 원칙 준수 여부\n5. 반복 실수 여부\n6. 같은 상황 다시 오면?`,
  2: (trades, pnl) => `이번 주 매매 패턴 분석해줘. (Phase 12-7)\n\n${trades.slice(-20).map(t=>`${t.nm} ${t.side} ${(t.pnl>=0?'+':'')}${Math.round(t.pnl||0)}원`).join(' / ')}\n\n분석:\n1. 수익 매매 공통점\n2. 손실 매매 공통점\n3. 반복 실수 Top 3\n4. 이번 주 가장 잘한 결정\n5. 다음 주 개선 1가지`,
  3: (trades, pnl) => `연속 손실 분석해줘. (Phase 11-10)\n\n최근 매매: ${trades.slice(-5).map(t=>`${t.nm} ${t.side} ${(t.pnl>=0?'+':'')}${Math.round(t.pnl||0)}원`).join(' → ')}\n\n분석:\n1. 반복되는 실수 패턴\n2. 원인: 시장/전략/심리 중 어느 것?\n3. 내일도 같은 실수 위험?\n4. 당장 적용할 개선 1가지\n5. 매매 중단 필요한 상태인가?`,
  4: (trades, pnl) => `슬럼프 감지 분석해줘. (Phase 11-12)\n\n최근 ${trades.slice(-30).length}회 매매\n승률: ${trades.slice(-30).length>0?(trades.slice(-30).filter(t=>t.pnl>0).length/trades.slice(-30).length*100).toFixed(0):'0'}%\n총손익: ${(pnl>=0?'+':'')+Math.round(pnl).toLocaleString()}원\n\n판단:\n1. 슬럼프 여부\n2. 원인 (시장/전략/심리)\n3. 현재 단계 (주의/경고/중단필요)\n4. 다음 행동 (구체적으로)\n5. 복귀 기준`
};
function useReviewPrompt(n){
  const trades=mock.trades||[];
  const pnl=mock.todayPnl||0;
  const prompt=REVIEW_PROMPTS[n]?REVIEW_PROMPTS[n](trades,pnl):'';
  const box=document.getElementById('reviewPromptBox');
  const txt=document.getElementById('reviewPromptText');
  if(box)box.style.display='block';
  if(txt)txt.value=prompt;
}
function copyPrompt(){
  const txt=document.getElementById('reviewPromptText');
  if(!txt)return;
  navigator.clipboard.writeText(txt.value).then(()=>showAlert('복사 완료','AI 채팅 창에 붙여넣기 하세요.'));
}

function autoFillJournal(){
  const today=new Date().toISOString().slice(0,10);
  const el=document.getElementById('jf-date'); if(el)el.value=today;
  // 오늘 마지막 거래 자동입력
  const todayTrades=(mock.trades||[]).filter(t=>t.date===today);
  if(todayTrades.length){
    const last=todayTrades[todayTrades.length-1];
    const nm=document.getElementById('jf-nm'); if(nm)nm.value=last.nm||'';
    const pnl=document.getElementById('jf-pnl'); if(pnl)pnl.value=Math.round(last.pnl||0);
    const psy=document.getElementById('jf-psy'); if(psy)psy.value=trustScore||7;
  }
  showAlert('자동입력','오늘 마지막 거래 데이터가 입력됐습니다.\n나머지 항목을 직접 입력해주세요.');
}
function saveJournalForm(){
  const entry={
    date:document.getElementById('jf-date')?.value||new Date().toISOString().slice(0,10),
    nm:document.getElementById('jf-nm')?.value||'',
    pnl:parseFloat(document.getElementById('jf-pnl')?.value)||0,
    psy:parseInt(document.getElementById('jf-psy')?.value)||7,
    reason:document.getElementById('jf-reason')?.value||'',
    good:document.getElementById('jf-good')?.value||'',
    bad:document.getElementById('jf-bad')?.value||'',
    repeat:document.getElementById('jf-repeat')?.value||'none',
    ts:Date.now()
  };
  const journals=safeParseJSON(localStorage.getItem('manualJournals'), []);
  journals.push(entry);
  localStorage.setItem('manualJournals',JSON.stringify(journals));
  // mock.trades에도 repeat 기록
  if(entry.repeat!=='none'&&mock.trades?.length){
    mock.trades[mock.trades.length-1].repeat=entry.repeat;
    saveMock();
  }
  showAlert('저장 완료',`${entry.nm} 일지가 저장됐습니다.`);
}

function selLevel(n,el){autoLevel=n;document.querySelectorAll(".level-card").forEach(c=>c.classList.remove("on"));el.classList.add("on");}

// Phase 9-6: 돌발 악재 즉각 전량 청산
function emergencySell(){
  const positions=Object.entries(mock.positions);
  if(!positions.length){showAlert("보유 없음","보유 중인 종목이 없습니다.");return;}
  const posStr=positions.map(([tk,p])=>{const s=STOCKS.find(x=>x.tk===tk);return`${s?.nm||tk} ${p.qty}주`;}).join(", ");
  if(!confirm(`🚨 돌발 악재 긴급 청산\n\n전체 보유 종목 시장가 전량 청산:\n${posStr}\n\n즉시 실행하시겠습니까? (Phase 9-6 원칙)`))return;
  const prev=activeTk,prevSide=oSide,prevType=oType,prevCred=credType;
  positions.forEach(([tk,p])=>{
    activeTk=tk;oSide="sell";oType="market";credType="cash";
    document.getElementById("ofQty").value=p.qty;
    submitOrder(true);
    addDecisionLog(`[${STOCKS.find(s=>s.tk===tk)?.nm||tk}] 긴급 청산 실행`,"돌발 악재 대응 — 판단 전 청산 우선","Phase 9-6: 즉각 청산 후 내용 확인");
  });
  activeTk=prev;oSide=prevSide;oType=prevType;credType=prevCred;
  addMsg("ai","🚨 긴급 청산 완료\n\n원칙: 악재 확인 전에 먼저 청산\n→ 잘못 팔았으면 다시 사면 됨\n→ 버티다 손실 확대가 더 위험\n\n지금 바로 공시/뉴스 확인하세요. (Phase 9-6)");
}

// Phase 9-3: 트레일링 스탑 패널 업데이트
function updateTrailPanel(){
  const el=document.getElementById("trailPanel");if(!el)return;
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const so=stopOrders[activeTk];
  const pos=mock.positions[activeTk];
  if(!pos||!so){el.textContent="보유 없음";return;}
  const pnlPct=((stk.pr-pos.avgPrice)/pos.avgPrice*100).toFixed(2);
  const up=parseFloat(pnlPct)>=0;
  el.innerHTML=`<div style="color:${up?"var(--g)":"var(--r)"};font-weight:700;">${up?"+":""}${pnlPct}%</div>`+
    `<div>평단 ${Math.round(pos.avgPrice).toLocaleString()}</div>`+
    `<div style="color:var(--r);">손절 ${so.stop.toLocaleString()}</div>`+
    (so.t1?`<div style="color:var(--g);">1차 ${so.t1.toLocaleString()} ${so.t1done?"✅":""}</div>`:``)+ 
    (so.t2?`<div style="color:var(--g);">2차 ${so.t2.toLocaleString()} ${so.t2done?"✅":""}</div>`:``)+
    `<div style="font-size:7px;color:var(--tm);">트레일: ${so.trail==="off"?"끔":so.trail==="pct"?"% 추적":"5MA추적"}</div>`;
}
function setTrailPct(pct){
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const so=stopOrders[activeTk];if(!so)return;
  so.trail="pct";so.trailHigh=stk.pr;so.stop=Math.round(stk.pr*(1-pct/100));
  updateTrailPanel();
  addDecisionLog(`트레일링 스탑 -${pct}% 설정`,`현재가 ${stk.pr.toLocaleString()} → 손절 ${so.stop.toLocaleString()}`,"Phase 9-3");
}
function setTrailMA5(){
  const so=stopOrders[activeTk];if(!so)return;
  so.trail="ma5";updateTrailPanel();
  addDecisionLog("트레일링 스탑 5MA 설정","5MA 이탈 시 자동 손절","Phase 9-3");
}
function startAuto(){
  autoState.running=true;autoState.level=autoLevel;
  autoState.cfg={rr:parseFloat((document.getElementById("auto-rr")||{value:"1.5"}).value)||1.5,pos:parseFloat((document.getElementById("auto-pos")||{value:"50"}).value)||50,stop:parseFloat((document.getElementById("auto-stop")||{value:"3"}).value)||3,t1:parseFloat((document.getElementById("auto-t1")||{value:"3"}).value)||3,t2:parseFloat((document.getElementById("auto-t2")||{value:"5"}).value)||5,trail:(document.getElementById("auto-trail")||{value:"none"}).value,brk:(document.getElementById("auto-brk")||{checked:false}).checked,explain:(document.getElementById("auto-explain")||{checked:true}).checked};
  document.getElementById("modeBadge").className="badge auto";
  document.getElementById("modeText").textContent=`AI Lv${autoState.level}`;
  document.getElementById("autoStopBtn").style.display="";
  var _ab=document.getElementById("autoBtn");
  if(_ab){_ab.textContent="⏹ 중지";_ab.style.background="var(--r)";_ab.style.borderColor="var(--r)";_ab.style.color="#fff";}
  var _ph=document.getElementById("pauseBtnHdr");if(_ph)_ph.style.display="";
  document.getElementById("autoBtn").classList.add("on");
  document.getElementById("aiModeBadge").textContent='Lv'+autoState.level+' 실행중';
  // 일시정지/정지 버튼 표시
  const pBtn=document.getElementById('pauseBtn'), sBtn=document.getElementById('stopBtn2');
  if(pBtn) pBtn.style.display='';
  if(sBtn) sBtn.style.display='';
  const startBtn=document.querySelector('.modal-content .ibtn.pur[onclick="startAuto()"]');
  if(startBtn) startBtn.style.display='none';
  closeModal("autotrade");
  addMsg("ai",`🤖 AI 자동매매 시작 (레벨 ${autoState.level})\n모드: ${["완전수동","종목선정","진입신호","진입자동","완전자동"][autoState.level]}\n\n설정값:\n• 최소 R/R: 1:${autoState.cfg.rr}\n• 자동 손절: -${autoState.cfg.stop}%\n• 1차 익절: +${autoState.cfg.t1}% (50%)\n• 2차 익절: +${autoState.cfg.t2}% (30%)\n\n[Phase 8: 매수 전 통합 점검 프로세스 적용]`);
  if(autoState.level>=1)scheduleScreening();
  // 자동매매 상태 영구 저장 (페이지 새로고침 후에도 복원)
  try{saveToServer('htsAutoState', JSON.stringify({running:autoState.running, level:autoState.level, cfg:autoState.cfg, autoLevel:autoLevel}));}catch(e){}
}
function pauseAuto(){
  if(!autoState.running) return;
  autoState.paused = !autoState.paused;
  if(autoState.paused){
    clearTimeout(autoTimer); autoTimer=null;
    const btn = document.getElementById('pauseBtn');
    if(btn){btn.textContent='▶ 재개';btn.style.background='var(--g)';}
    addMsg('ai','⏸ 자동매매 일시정지 — 재개하려면 버튼을 다시 누르세요.');
  } else {
    autoState.paused=false;
    const btn=document.getElementById('pauseBtn');
    if(btn){btn.textContent='⏸ 일시정지';btn.style.background='';}
    scheduleScreening();
    addMsg('ai','▶ 자동매매 재개');
  }
}
function stopAuto(){
  autoState.running=false;autoState.paused=false;if(autoTimer){clearTimeout(autoTimer);autoTimer=null;}
  try{saveToServer('htsAutoState', JSON.stringify({running:false, level:autoState.level, cfg:autoState.cfg}));}catch(e){}
  // 모든 DOM 접근 null 가드
  const _q = id => document.getElementById(id);
  const pBtn=_q('pauseBtn'), sBtn=_q('stopBtn2');
  if(pBtn){pBtn.style.display='none';pBtn.textContent='⏸ 일시정지';pBtn.style.background='';}
  if(sBtn) sBtn.style.display='none';
  const startBtn=document.querySelector('.modal-content .ibtn.pur[onclick="startAuto()"]');
  if(startBtn) startBtn.style.display='';
  const ab=_q('autoBtn');
  if(ab){ ab.classList.remove('on'); ab.textContent='▶ 자동매매'; ab.style.background=''; ab.style.borderColor=''; ab.style.color=''; }
  const aiBadge=_q('aiModeBadge'); if(aiBadge) aiBadge.textContent='대기중';
  try{ activateMockMode&&activateMockMode(); }catch(_e){}
  const stopBtnEl=_q('autoStopBtn'); if(stopBtnEl) stopBtnEl.style.display='none';
  try{ addMsg('ai','⏹ AI 자동매매 중지.'); }catch(_e){}
}
function scheduleScreening(){
  if(!autoState.running)return;
  runScreening();
  // 배속이 빠를수록 더 자주 스크리닝 (그래야 봉을 따라잡음)
  const _spd = (sim&&sim.speed)||1;
  const interval = _spd >= 1000 ? 120 : _spd >= 300 ? 300 : _spd >= 60 ? 800 : 5000;
  autoTimer=setTimeout(scheduleScreening, interval);
}
function addDecisionLog(title, body, phase){
  // 전역 로그 배열
  if(!window._decisionLog) window._decisionLog=[];
  const entry = {title, body, phase, time: new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})};
  window._decisionLog.push(entry);
  if(window._decisionLog.length > 100) window._decisionLog.shift();
  // 영구 저장 (디바운스로 묶임)
  try{saveToServer('htsDecisionLog', JSON.stringify(window._decisionLog.slice(-100)));}catch(e){}
  // UI 업데이트
  _updateAIStatusPanel(entry);
}
function _updateAIStatusPanel(entry){
  const logEl = document.getElementById('aiDecisionLog');
  const msgEl = document.getElementById('aiStatusMsg');
  const lblEl = document.getElementById('aiStatusLabel');
  const dotEl = document.getElementById('aiStatusDot');
  if(!logEl) return;
  // 상태 색상
  const isBuy = entry.title.includes('매수') || entry.title.includes('BUY');
  const isBlock = entry.title.includes('차단') || entry.title.includes('관망') || entry.title.includes('PASS');
  const isActive = entry.title.includes('분석') || entry.title.includes('검토') || entry.title.includes('스크리닝');
  if(dotEl) dotEl.style.background = isBuy?'var(--g)':isBlock?'var(--r)':isActive?'var(--a)':'var(--b)';
  if(lblEl) lblEl.textContent = entry.phase||entry.title.slice(0,20);
  if(lblEl) lblEl.style.color = isBuy?'var(--g)':isBlock?'var(--r)':isActive?'var(--a)':'var(--b)';
  if(msgEl){ msgEl.textContent = entry.body||entry.title; msgEl.style.color = isBuy?'var(--g)':isBlock?'var(--r)':'var(--ts)'; }
  // 로그 추가
  const item = document.createElement('div');
  item.style.cssText='font-size:8px;padding:3px 6px;background:var(--bg);border-radius:4px;border-left:2px solid '+(isBuy?'var(--g)':isBlock?'var(--r)':'var(--b)')+';line-height:1.4;';
  item.innerHTML='<span style="color:var(--tm);">'+entry.time+'</span> <b>'+entry.title.slice(0,20)+'</b>';
  if(entry.body) item.innerHTML += '<br><span style="color:var(--ts);">'+entry.body.slice(0,50)+'</span>';
  logEl.prepend(item);
  // 최대 8개
  while(logEl.children.length>8) logEl.removeChild(logEl.lastChild);
}
function updAdvBoxes(title, body){
  // AI 현황 패널 직접 업데이트
  const entry={title, body, phase:title, time:new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})};
  _updateAIStatusPanel(entry);
}
function addDecisionLog(action,reason,phase){
  const log=document.getElementById("aiDecisionLog");
  const now=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  const cls=action.includes("매수")?"buy":action.includes("매도")||action.includes("청산")?"sell":action.includes("선정")?"screen":"hold";
  const div=document.createElement("div");div.className="ai-log-i";
  div.innerHTML=`<div class="ai-log-tm">${now}</div><div class="ai-log-act ${cls}">${action}</div><div class="ai-log-rsn">${reason}</div>${phase?`<div class="ai-log-pha">📚 ${phase}</div>`:""}`;
  if(log.children.length===1&&log.children[0].textContent.includes("없습니다"))log.innerHTML="";
  log.insertBefore(div,log.firstChild);
  if(log.children.length>60)log.removeChild(log.lastChild);
}
// ══════════════════════════════════════════════════════
// 자동매매 3단계 AI 검토 시스템
// 1단계: 기술적 사전 필터 (빠른 로컬 계산)
// 2단계: Claude AI 심층 분석 (추세/타점/R/R/리스크)
// 3단계: 뇌동매매 체크 + 최종 실행 결정
// ══════════════════════════════════════════════════════

// 자동매매 중복 실행 방지
let _autoScreenRunning = false;
let _lastAutoScreenTime = 0;

function runScreening(){
  if(!autoState.running) return;
  const now = Date.now();
  // 중복 실행 방지 (이전 스크리닝이 진행 중이거나 3초 이내)
  if(_autoScreenRunning) return;
  // 쿨다운: 배속 비례 (x300+ 면 100ms, x60+ 500ms, 그 외 3000ms)
  const _spd2 = (sim&&sim.speed)||1;
  const _cooldown = _spd2 >= 1000 ? 50 : _spd2 >= 300 ? 100 : _spd2 >= 60 ? 500 : 3000;
  if(now - _lastAutoScreenTime < _cooldown) return;
  _lastAutoScreenTime = now;
  _autoScreenRunning = true;

  // 비동기로 실행 (UI 블로킹 방지)
  // Promise.race로 15초 강제 컷 — fetch 멈춤/네트워크 문제로 락 영구점유 방지
  Promise.race([
    _runScreeningAsync(),
    new Promise((_, rej) => setTimeout(()=>rej(new Error('screening timeout 15s')), 15000)),
  ]).catch(e => console.warn('screening:', e.message)).finally(() => { _autoScreenRunning = false; });
}

async function _runScreeningAsync(){
  // ── 분석 풀 구성: 다양성 보장을 위해 가능한 소스 모두 합침 ──
  var pool = new Set();
  (WGS[0]||[]).forEach(t=>pool.add(t));
  (WGS[1]||[]).forEach(t=>pool.add(t));
  (WGS[3]||[]).forEach(t=>pool.add(t));
  Object.keys(window._sectorInfo||{}).forEach(t=>pool.add(t));
  (CANDS||[]).forEach(c=>{ if(c&&c.tk) pool.add(c.tk); });
  // 풀이 비면 강세섹터 즉시 가져오기 (절대 activeTk 하나로 떨어지지 않게)
  if(pool.size === 0 && typeof refreshHotSectors === 'function'){
    addDecisionLog('🔄 종목 풀 비어있음','강세섹터 자동 가져오기','종목선정');
    try{ await refreshHotSectors(true); }catch(_e){}
    Object.keys(window._sectorInfo||{}).forEach(t=>pool.add(t));
    (WGS[0]||[]).forEach(t=>pool.add(t));
  }
  // 그래도 비면 STOCKS 다양한 섹터 골고루
  if(pool.size === 0){
    // 섹터별 1종목씩 + 시총 큰 것 일부
    var bySec={};
    STOCKS.forEach(s=>{ if(s.sec && !bySec[s.sec]) bySec[s.sec]=s.tk; });
    Object.values(bySec).slice(0,8).forEach(t=>pool.add(t));
    STOCKS.slice(0,5).forEach(s=>pool.add(s.tk));
    pool.add(activeTk);
  }
  var allTks=Array.from(pool).filter(Boolean);
  // 다양성 페널티 계산용: 최근 8개 매매에서 같은 종목 출현 횟수
  var _recentTks = (mock.trades||[]).slice(-8).map(function(t){return t.tk;});
  var _tkRecent = {};
  _recentTks.forEach(function(t){ _tkRecent[t]=(_tkRecent[t]||0)+1; });

  // 일일 손실/연속손절 체크
  var dayLossRate=-mock.todayPnl/cfg.capital*100;
  // 일손실 한도: 백테스트는 매일 리셋되니 OK. 한도 도달 시 그 날 매매 중단 (다음날 재개)
  if(dayLossRate>=cfg.dayloss){
    addDecisionLog('⚠ 일손실 한도 도달','오늘 손실 '+dayLossRate.toFixed(1)+'% (한도 '+cfg.dayloss+'%) — 오늘 매매 중단','NOGO');
    return;
  }
  if(mock.lossSeries>=3&&autoState.cfg.brk){
    addDecisionLog('⚠ 연속손절 '+mock.lossSeries+'회','매매 중단','Phase11');
    return;
  }

  // ── 각 종목 기술적 점수 계산 ──
  var scored=[];
  for(var _ti=0;_ti<allTks.length;_ti++){
    var tk=allTks[_ti];
    var stk=STOCKS.find(function(s){return s.tk===tk;})||{nm:tk,pr:0,base:1,sec:''};
    if(mock.positions[tk]&&mock.positions[tk].qty>0) continue; // 보유 중 skip

    var cs=[];
    // KIS 연결 시: 각 종목 개별 조회 (요청 일자 검증 후 사용)
    if(kisConfig.appKey&&kisConfig.appSecret&&tk!==activeTk){
      try{
        var _rr=await fetch('/api/kis/chart',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({appKey:kisConfig.appKey,appSecret:kisConfig.appSecret,
            mode:kisConfig.mode||'real',code:tk,date:sim.date,tf:sim.tf||'5'})});
        var _dd=await _rr.json();
        // ★ 응답 일자가 요청 일자와 다르면 사용 X (미래 데이터 차단)
        var _reqD=(sim.date||'').replace(/-/g,''), _respD=(_dd.date||'').replace(/-/g,'');
        if(_dd.ok&&_dd.candles&&_dd.candles.length>=10 && (!_reqD || !_respD || _reqD===_respD)){
          cs=_dd.candles;
        }
      }catch(_e){}
    }
    // 활성 종목 또는 시뮬: sim.candles / 시뮬 생성
    if(!cs.length){
      if(tk===activeTk){
        cs=getCandles(20);
      }else{
        // 시뮬: 종목별 캔들을 현재 sim.idx 시점까지만 (미래 봉 절대 노출 금지)
        try{ cs = _peekSimCandlesFor(tk, sim.date, sim.idx); }catch(_e){ cs=[]; }
      }
    }
    if(cs.length<10) continue;

    var cls=cs.map(function(c){return c.c;}),vls=cs.map(function(c){return c.v;});
    var lc=cs[cs.length-1],pc=cs[cs.length-2]||lc,pc2=cs[cs.length-3]||pc,pc3=cs[cs.length-4]||pc2;
    var ma5=calcMA(cls,5),ma20=calcMA(cls,20),ma60=calcMA(cls,60);
    var lma5=ma5[ma5.length-1]||0,lma20=ma20[ma20.length-1]||0,lma60=ma60[ma60.length-1]||0;
    var pma5=ma5[ma5.length-2]||lma5;
    var lrsi=parseFloat((calcRSI(cls,14).slice(-1)[0]||50).toFixed(1));
    var prevRsi=parseFloat((calcRSI(cls,14).slice(-2,-1)[0]||50).toFixed(1));
    var avg5v=vls.slice(-6,-1).reduce(function(a,b){return a+b;},0)/5||1;
    var volR=vls[vls.length-1]/avg5v;
    var pvolR=(cs[cs.length-2]?cs[cs.length-2].v:0)/avg5v;
    // 봉 형태
    var body=Math.abs(lc.c-lc.o), upperWick=lc.h-Math.max(lc.c,lc.o), lowerWick=Math.min(lc.c,lc.o)-lc.l;
    var bodyRatio=body/(lc.h-lc.l||1);
    // 20봉 신고가 (돌파)
    var prev20High=Math.max.apply(null, cs.slice(-21,-1).map(function(c){return c.h;}));
    // 시간대 (시각 추출 — "HH:MM")
    var _hm=String(lc.t||'').split(':'), _hh=parseInt(_hm[0])||0, _mm=parseInt(_hm[1])||0, _mins=_hh*60+_mm;

    // ═══ 필수 게이트 (모두 통과해야 진입 후보) ═══
    var gateFails=[];
    // G1: 시간대 — 9:30~14:00 (시초 변동성/마감 직전 제외)
    if(_mins>0 && (_mins<570 || _mins>840)) gateFails.push('시간대'+_hh+':'+String(_mm).padStart(2,'0'));
    // G2: 강한 하락 추세 차단 (5MA 아래 + 5<20)
    if(lc.c<lma5 && lma5<lma20) gateFails.push('5MA이탈+데드크로스');
    // G3: 3연속 음봉
    if(lc.c<lc.o && pc.c<pc.o && pc2.c<pc2.o) gateFails.push('3연속음봉');
    // G4: 과매수 (RSI>=72)
    if(lrsi>=72) gateFails.push('과매수RSI'+lrsi);
    // G5: 추격매수 차단 — 직전 봉 대비 +3% 이상 급등 위 진입 금지
    if(lc.c > pc.c*1.03) gateFails.push('급등진입+'+((lc.c/pc.c-1)*100).toFixed(1)+'%');
    // G6: 위꼬리 비대 (윗꼬리 본체의 2배 이상)
    if(body>0 && upperWick > body*2) gateFails.push('윗꼬리비대');
    // G7: 보유 중 (이미 위에서 필터링 — 이중체크)
    // 필수 게이트 1개라도 실패 시 즉시 제외
    if(gateFails.length){
      addDecisionLog('['+stk.nm+'] 필수조건 미달', gateFails.join(' · '), 'NOGO');
      continue;
    }

    // ═══ 확신도 점수 (모든 필수 통과 후 가산) ═══
    var score=0,tags=[];
    // 1. 추세 강도
    if(lma5>lma20 && lma20>lma60){score+=3;tags.push('정배열');}
    else if(lma5>lma20){score+=1;tags.push('단기상승');}
    if(lma5>pma5){score+=1;tags.push('5MA상승');}
    // 2. 가격 위치
    if(lc.c>lma5 && lc.c<lma5*1.015){score+=2;tags.push('5MA지지');} // 5MA 막 위에서 지지
    if(lc.c>lma20){score+=1;tags.push('20MA위');}
    // 3. 거래량 (당봉 + 직전봉도 같이 늘어야 진짜)
    if(volR>=2 && pvolR>=1.3){score+=4;tags.push('거래량폭증x'+volR.toFixed(1));}
    else if(volR>=1.5){score+=2;tags.push('거래량x'+volR.toFixed(1));}
    else if(volR>=1.2){score+=1;tags.push('거래량+'+((volR-1)*100|0)+'%');}
    // 4. RSI 안전 구간
    if(lrsi>=50 && lrsi<=65){score+=2;tags.push('RSI'+lrsi);}
    else if(lrsi>=40 && lrsi<70){score+=1;tags.push('RSI'+lrsi);}
    // 5. 봉 형태 (장대양봉)
    if(lc.c>lc.o && bodyRatio>=0.6 && lowerWick<body*0.5){score+=2;tags.push('장대양봉');}
    // 6. 20봉 돌파 (신고가)
    if(lc.c>prev20High*0.998 && volR>=1.5){score+=3;tags.push('20봉돌파');}
    // 7. 강세 섹터 가산 (모멘텀 + 대장주 + 강의기법 매칭)
    var _si = (window._sectorInfo||{})[tk];
    if(_si){
      var _bonus = _si.rank===1?3:_si.rank===2?2:_si.rank===3?1:0;
      if(_bonus){score+=_bonus;tags.push('강세'+_si.rank+'위');}
      if(_si.momentum==='강함'){ score+=1; tags.push('모멘텀강'); }
      if(_si.role==='대장주'){ score+=1; tags.push('대장주'); }
      // 공매도: 잔고비율 + 추세 반영
      if(_si.short_trend==='감소'){ score+=2; tags.push('공매도감소'); } // 쇼트 스퀴즈 기대
      else if(_si.short_trend==='증가'){ score-=2; tags.push('공매도증가-2'); } // 하락 압력
      var _sr = parseFloat((_si.short_ratio||'').replace('%',''));
      if(!isNaN(_sr)){
        if(_sr>=5){ score-=2; tags.push('공매도잔고높음'); } // 5%+ 매우 위험
        else if(_sr>=3){ score-=1; tags.push('공매도잔고주의'); }
      }
    }
    // 8. 시그널 확정 — 직전봉도 score>=4였는지 (2봉 연속 강세)
    //   → window._priorScores에서 같은 종목 직전 점수 확인
    if(!window._priorScores) window._priorScores = {};
    var _prior = window._priorScores[tk] || 0;
    if(_prior >= 4 && score >= 5){
      score += 2; tags.push('확정시그널');
    }
    window._priorScores[tk] = score;
    // 9. RSI 상승 반전 (이전 RSI<현재 RSI)
    if(lrsi > prevRsi+3 && lrsi<=60){score+=1;tags.push('RSI반전');}
    // 10. 패턴 감지 + 패턴별 가산
    var _isPullback = lc.c>=lma20 && (Math.abs(lc.c-lma5)/(lma5||1)<=0.02 || (lc.c<=lma5&&lc.c>=lma20) || (lc.c>=lma20&&(lc.c-lma20)/(lma20||1)<=0.015));
    var _isBreakout = lc.c>prev20High*0.998 && volR>=1.5;
    var _isGap = pc && lc.o>pc.c*1.01;
    var _isFirstBar = sim.idx<=6 && lc.c>lc.o && volR>=1.3;
    var _isMomentum = volR>=2 && lrsi>=50 && lc.c>lc.o;
    var _v3avg = vls.length>=4 ? (vls[vls.length-4]+vls[vls.length-3]+vls[vls.length-2])/3 : avg5v;
    if(_isPullback){
      score+=3;tags.push('눌림목');
      if(lc.c>=lma5*0.99 && lc.c<=lma5*1.01 && lma5>lma20){score+=2;tags.push('눌림목정석');}
      if(_v3avg<avg5v*0.8 && volR>=1.0){score+=1;tags.push('거래량회복');}
    }
    if(_isBreakout){score+=3;tags.push('돌파');}
    if(_isGap){score+=2;tags.push('갭상승');}
    if(_isFirstBar){score+=2;tags.push('첫봉');}
    if(_isMomentum && !_isBreakout){score+=1;tags.push('이슈테마');}
    if(!_isPullback && !_isBreakout && !_isGap && !_isFirstBar && !_isMomentum){tags.push('기타패턴');}
    // 11. 대장첫숨 — 이슈/재료 동반 필수 + 기관수급 강세섹터 대장주 장대양봉 후 첫 음봉
    var _siPat = (window._sectorInfo||{})[tk];
    var _isLeader = _siPat && _siPat.rank<=3 && (_siPat.role==='대장주'||_siPat.momentum==='강함');
    var _hasTheme = _siPat && _siPat.reason && _siPat.reason.length>2;
    var _hasNews = (typeof window._newsItems!=='undefined' && Array.isArray(_newsItems)) && _newsItems.some(function(n){return (n.tk||n.code)===tk||(n.title||'').indexOf(stk.nm)!==-1;});
    var _hasIssue = _hasTheme || _hasNews;
    var _pcBody = Math.abs(pc.c-pc.o), _pcRange = pc.h-pc.l||1;
    var _prevBigBull = pc.c>pc.o && _pcBody/_pcRange>=0.6 && (pc.c-pc.o)/pc.o*100>=1.5;
    var _curBear = lc.c<lc.o;
    if(_isLeader && _prevBigBull && _curBear && _hasIssue){
      score+=4;tags.push('대장첫숨');
    } else if(_isLeader && _prevBigBull && _curBear && !_hasIssue){
      addDecisionLog('['+stk.nm+'] 대장첫숨 조건부 미달','장대양봉+첫음봉 OK, 이슈/재료 미확인 — 진입 보류','PASS');
    }

    scored.push({tk:tk,stk:stk,score:score,tags:tags,lc:lc,lma5:lma5,lrsi:lrsi,volR:volR});
  }

  if(!scored.length){
    // 관망 사유를 구체적으로 남김 (일지에 반영)
    var _noTradeReason = '전 '+allTks.length+'종목 필수게이트 미달';
    if(dayLossRate>=cfg.dayloss*0.7) _noTradeReason += ' / 일손실 누적 '+dayLossRate.toFixed(1)+'%';
    addDecisionLog('전종목 조건미달', _noTradeReason, '관망');
    window._lastNoTradeReason = _noTradeReason;
    return;
  }

  // 점수 순 정렬
  scored.sort(function(a,b){return b.score-a.score;});
  var best=scored[0];
  var topList=scored.slice(0,3).map(function(c,i){
    return (i+1)+'. '+c.stk.nm+'('+c.tk+') '+c.score+'점 ['+c.tags.join(' ')+']';
  }).join('\n');

  // CANDS 실시간 업데이트
  var newCands=scored.slice(0,3).map(function(c){
    return {tk:c.tk,why:c.tags.join(' '),score:Math.min(99,Math.max(10,50+c.score*5))};
  });
  if(newCands.length){CANDS=newCands;renderCands();}

  addDecisionLog('[중앙AI] 스크리닝',topList,'종목선정');

  // ── 장중 갈아타기 로직 ──
  // 현재 보유 종목이 있고, 그 종목보다 훨씬 좋은 종목이 발견되면 청산 후 갈아타기
  try{
    const heldPos = Object.entries(mock.positions||{}).find(([tk,p])=>p&&p.qty>0);
    if(heldPos && best.tk !== heldPos[0]){
      const [heldTk, pos] = heldPos;
      const heldScored = scored.find(s=>s.tk===heldTk);
      const heldScore = heldScored ? heldScored.score : 0;
      // 차이 5점 이상 + 보유 종목 수익이거나 미세 손실 (-1% 이내)
      const heldStk = STOCKS.find(s=>s.tk===heldTk);
      const curPr = heldStk ? heldStk.pr : (pos.avg||0);
      const heldPnlPct = pos.avg ? ((curPr-pos.avg)/pos.avg*100) : 0;
      if(best.score - heldScore >= 5 && heldPnlPct > -1.5){
        addDecisionLog(`🔄 갈아타기 신호`, `${heldStk?.nm||heldTk}(${heldScore}점, ${heldPnlPct.toFixed(1)}%) → ${best.stk.nm}(${best.score}점)`, '백테스트');
        // 보유 전량 매도
        const sv=activeTk,svSide=oSide,svType=oType,svCred=credType;
        activeTk=heldTk;oSide="sell";oType="market";credType="cash";
        document.getElementById("ofQty").value=pos.qty;
        submitOrder(true);
        activeTk=sv;oSide=svSide;oType=svType;credType=svCred;
        await new Promise(r=>setTimeout(r,200));
      }
    }
  }catch(_swap){}

  // 최적 종목으로 전환
  if(best.tk!==activeTk){
    setActiveTk(best.tk);
    await new Promise(function(r){setTimeout(r,800);});
  }

  // 스캘핑 기법 완전 차단
  const _tech = typeof detectTechnique === "function" ? detectTechnique(scored[0]?.lc||{}) : {};
  if(_tech.technique === "스캘핑"){addDecisionLog("스캘핑 차단","스캘핑 기법 금지 설정","NOGO");return;}
  if(best.score<3){
    var _whyPass = best.tags.join(' ')||'조건미달';
    _whyPass += ' (최고 '+best.score+'점/5점 필요)';
    addDecisionLog('['+best.stk.nm+'] 관망', _whyPass, '관망');
    updAdvBoxes('관망 — '+best.stk.nm+' ('+best.score+'점)', _whyPass);
    window._lastNoTradeReason = best.stk.nm+' '+_whyPass;
    return;
  }

  addDecisionLog('['+best.stk.nm+'] 1단계 통과 ('+best.score+'점)',best.tags.join(' '),'2단계 AI 검토');
  updAdvBoxes('🔍 AI 검토 중 — '+best.stk.nm,'1단계: '+best.score+'점\nClaude 심층 분석 중...');

  // ── 빠른 배속(>=300): Claude 우회 + 다층 필터 기반 진입 ──
  if(autoState.level>=3 && (sim&&sim.speed>=300)){
    // 필수 게이트는 이미 위에서 통과 (gateFails 없는 종목만 scored에 들어옴)
    // 같은 봉 사이클에서 같은 종목 재진입만 차단 (갈아타기는 허용)
    const _lastSame = (mock.trades||[]).filter(t=>t.tk===best.tk && t.date===sim.date && t.side==='buy').pop();
    if(_lastSame && _lastSame.ts){
      const elapsedMs = Date.now() - _lastSame.ts;
      if(elapsedMs < 1000){
        addDecisionLog('['+best.stk.nm+'] 직전 매매','같은 봉 사이클 재진입 차단','신중');
        return;
      }
    }
    // 진입 등급 (백테스트는 매매 발생이 핵심 — 임계 더 낮춤):
    // - score≥5: BUY
    // - score≥3 + 확정시그널: BUY
    // - score≥2: 관찰
    const hasConfirm = best.tags.indexOf('확정시그널') !== -1;
    if(best.score >= 5 || (best.score >= 3 && hasConfirm)){
      var lcQ=best.lc;
      addDecisionLog('['+best.stk.nm+'] ✅ 진입 ('+best.score+'점)', best.tags.join(' · '), best.score>=5?'강한신호':'확정시그널');
      var _bestTech = best.tags.indexOf('대장첫숨')!==-1?'대장첫숨':'';
      try{ await execAutoBuy(lcQ.c, best.stk, best.score, _bestTech); }catch(_e){}
    } else if(best.score >= 2){
      var _whyWait = best.tags.join(' · ')+' — 점수 부족('+best.score+'/5)';
      addDecisionLog('['+best.stk.nm+'] 👀 관찰', _whyWait, '대기');
      window._lastNoTradeReason = best.stk.nm+' '+_whyWait;
    } else {
      var _whyWeak = (best.tags.join(' · ')||'조건 불충분')+' — 점수 부족('+best.score+'/5)';
      addDecisionLog('['+best.stk.nm+'] ⏸ 약함', _whyWeak, '관망');
      window._lastNoTradeReason = best.stk.nm+' '+_whyWeak;
    }
    return;
  }
  // ── Claude AI 심층 분석 (레벨3 이상, 평상시 배속) ──
  if(autoState.level>=3){
    try{
      var lc2=best.lc;
      var stopPr=Math.round(lc2.c*(1-autoState.cfg.stop/100));
      var t1Pr=Math.round(lc2.c*(1+autoState.cfg.t1/100));
      var rr=((t1Pr-lc2.c)/(lc2.c-stopPr)).toFixed(2);
      // 시황·강세섹터·공시·과거 학습·강의 원칙 맥락 자동 수집
      var _mkt = typeof collectMarketCtx==='function' ? collectMarketCtx() : '';
      var _si = (window._sectorInfo||{})[best.tk];
      var _sectorLine = _si ? `강세섹터 ${_si.rank}위 ${_si.sector} — ${_si.reason||''}` : '';
      var _shortLine = (_si && (_si.short_ratio || _si.short_trend)) ? `공매도 잔고 ${_si.short_ratio||'-'} / 추세 ${_si.short_trend||'-'}` : '';
      var _newsItems = (typeof window._newsItems!=='undefined' && Array.isArray(_newsItems)) ? _newsItems.slice(0,3).map(n=>'• '+(n.title||n)).join('\n') : '';
      var _learn = typeof getLearningContext==='function' ? getLearningContext(10) : '';
      var _lec = typeof getLectureContext==='function' ? getLectureContext(2500) : '';
      var prompt='단타 트레이딩 멘토. 자동매매 최종 진입 여부.\n\n'+
        '⚠️ 절대 원칙: 아래 강의 매매 원칙은 100% 따라야 한다. 강의에 어긋나는 진입은 \"PASS\". 의심스러우면 PASS.\n'+
        '모든 매매 기법 적극 활용: 눌림목/대장첫숨/돌파/첫봉/갭상승/이슈테마.\n'+
        '눌림목: 상승추세(20MA↑)+5MA/20MA지지+거래량감소후회복.\n'+
        '돌파: 20봉 신고가+거래량 150%↑. 갭상승: 갭업 후 양봉 확정. 첫봉: 시초 6봉 내 양봉+거래량.\n'+
        '대장첫숨: 이슈/재료 동반 필수 + 기관수급 강세섹터 대장주 장대양봉 후 첫 음봉 → 비중 1/3 신중 진입. 이슈/재료 없으면 절대 대장첫숨 아님.\n\n'+
        _lec +
        _learn +
        '【종목】 '+best.stk.nm+'('+best.tk+') '+best.stk.sec+'\n'+
        '【시간】 '+(sim.date||'')+' '+(best.lc.t||'')+'\n'+
        '【기술적】 가격 '+lc2.c.toLocaleString()+'원 | RSI '+best.lrsi+' | 거래량 평균x'+best.volR.toFixed(1)+'\n'+
        '【조건】 '+best.tags.join(' · ')+'\n'+
        (_sectorLine ? '【수급/섹터】 '+_sectorLine+'\n' : '')+
        (_shortLine ? '【공매도】 '+_shortLine+'\n' : '')+
        (_newsItems ? '【최근 공시】\n'+_newsItems+'\n' : '')+
        (_mkt && _mkt!=='데이터없음' ? '【시황】\n'+_mkt+'\n' : '')+
        '【리스크】 손절 '+stopPr.toLocaleString()+' | 목표 '+t1Pr.toLocaleString()+' | R/R 1:'+rr+'\n\n'+
        '※ 위에 학습 노트가 있다면 반드시 반영해서 같은 실수를 반복하지 말 것.\n'+
        'JSON만: {"decision":"BUY"또는"PASS","confidence":0-100,"reason":"왜 매수/관망인지 2줄(학습노트 반영시 명시)","factors":"근거한 데이터 3가지","risk":"리스크1줄","waitFor":"PASS시조건"}';
      // Claude 호출에 8초 timeout — 응답 안 오면 cancel하고 진입 PASS
      var _ctrl = new AbortController();
      var _to = setTimeout(()=>_ctrl.abort(), 8000);
      var res=await fetch('/api/claude',{method:'POST',headers:{'Content-Type':'application/json'},signal:_ctrl.signal,
        body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:300,messages:[{role:'user',content:prompt}]})});
      clearTimeout(_to);
      var data=await res.json();
      var text=(data.content&&data.content[0]&&data.content[0].text)||'{}';
      var m=text.match(/\{[\s\S]*\}/);
      var ai=m?JSON.parse(m[0]):{};
      if(ai.decision==='BUY'&&ai.confidence>=65){
        var _factorsTxt = ai.factors ? ('근거: '+ai.factors+'\n') : '';
        addDecisionLog('['+best.stk.nm+'] ✅ AI매수 (신뢰도'+ai.confidence+'%)',ai.reason+(ai.factors?(' | '+ai.factors):''),'Phase8통과');
        addMsg('ai','🤖 AI자동매수\n\n종목: '+best.stk.nm+' '+lc2.c.toLocaleString()+'원\n신뢰도: '+ai.confidence+'%\n\n✅ '+ai.reason+'\n'+_factorsTxt+'⚠ '+ai.risk+'\n\n손절: '+stopPr.toLocaleString()+' | 목표: '+t1Pr.toLocaleString()+' | R/R 1:'+rr);
        updAdvBoxes('✅ 매수결정 — '+best.stk.nm,'신뢰도 '+ai.confidence+'%\n'+ai.reason+(ai.factors?('\n근거: '+ai.factors):''));
        var _bestTech2 = best.tags.indexOf('대장첫숨')!==-1?'대장첫숨':'';
        await execAutoBuy(lc2.c, best.stk, best.score, _bestTech2);
      }else{
        var _factorsTxt2 = ai.factors ? (' | '+ai.factors) : '';
        addDecisionLog('['+best.stk.nm+'] ⏸ AI관망',(ai.reason||'조건미충족')+_factorsTxt2,'2단계차단');
        updAdvBoxes('⏸ AI관망 — '+best.stk.nm,(ai.reason||'조건미충족')+(ai.factors?('\n근거: '+ai.factors):'')+'\n기다릴것: '+(ai.waitFor||'추세확인'));
      }
    }catch(_e2){
      addDecisionLog('['+best.stk.nm+'] AI분석실패',_e2.message,'관망');
      updAdvBoxes('⚠ AI오류 — 관망',_e2.message);
    }
  }else if(autoState.level===2){
    var lc3=best.lc;
    var stopPr2=Math.round(lc3.c*(1-autoState.cfg.stop/100));
    var t1Pr2=Math.round(lc3.c*(1+autoState.cfg.t1/100));
    var rr2=((t1Pr2-lc3.c)/(lc3.c-stopPr2)).toFixed(2);
    updAdvBoxes('📊 진입신호 — '+best.stk.nm,best.tags.join(' · ')+'\n진입: '+lc3.c.toLocaleString()+' 손절: '+stopPr2.toLocaleString()+' 목표: '+t1Pr2.toLocaleString()+' R/R:1:'+rr2+'\n⚡ 직접 주문창에서 실행');
    addDecisionLog('['+best.stk.nm+'] 진입신호(Lv2)',best.score+'/12점 | R/R 1:'+rr2,'Phase8');
  }
}

function runAutoStep(cs){
  if(!autoState.running)return;
  // 백테스트 중 봉 단위 강세섹터 갱신 (시뮬 시간 기준 60봉마다 = 약 1시간)
  // 백테스트: 봉 단위로 강세섹터 갱신 (1분봉 기준 120봉=2시간 마다 → 비용 ↓)
  if(window.backtest&&backtest.running && (sim.idx % 120 === 0) && sim.idx > 0){
    if(typeof refreshHotSectors==='function' && !window._sectorRefreshing){
      window._sectorRefreshing = true;
      refreshHotSectors(false).finally(()=>{ window._sectorRefreshing = false; });
    }
  }
  // Level 4: 15:20 auto-close
  if(autoState.level>=4){
    const cur=cs[cs.length-1];
    // 마지막 봉 도달 또는 15:20 이후 → 전량 청산 (당일매매 원칙)
    const isEndBar = sim.idx >= sim.candles.length - 2;
    if((cur && cur.t >= "15:20") || isEndBar){
      Object.keys(mock.positions).forEach(tk=>{
        const pos=mock.positions[tk];if(!pos||pos.qty<=0)return;
        const stk=STOCKS.find(s=>s.tk===tk);if(!stk)return;
        const sv=activeTk,svSide=oSide,svType=oType,svCred=credType;activeTk=tk;oSide="sell";oType="market";credType="cash";document.getElementById("ofQty").value=pos.qty;
        submitOrder(true);activeTk=sv;oSide=svSide;oType=svType;credType=svCred;
        addDecisionLog(`[${stk.nm}] 마감 자동 전량 청산`, '당일매매 원칙', 'Phase 12-2');
      });
    }
  }
  // ── 모멘텀 약화 자동 매도 (보유 종목 — 5MA 이탈 + 거래량 감소) ──
  if(autoState.level>=3 && (sim&&sim.speed>=300)){
    try{
      const cur2=cs[cs.length-1], prev=cs[cs.length-2];
      const cls=cs.map(c=>c.c), vls=cs.map(c=>c.v);
      const ma5arr=calcMA(cls,5);
      const ma5cur=ma5arr[ma5arr.length-1]||0, ma5prev=ma5arr[ma5arr.length-2]||ma5cur;
      const avgV=vls.slice(-6,-1).reduce((a,b)=>a+b,0)/5||1;
      const volR=cur2.v/avgV;
      const pos=mock.positions[activeTk];
      if(pos && pos.qty>0 && ma5cur && cur2 && prev){
        // 조건: 5MA 이탈 (현재 종가 < 5MA) AND 직전 봉 5MA 위였음 AND 거래량 살아있음 → 모멘텀 약화
        const broke5MA = prev.c >= ma5prev && cur2.c < ma5cur*0.997;
        const profitable = cur2.c > (pos.avg||0); // 수익 중일 때만 자동 청산 (손실은 stopOrders가 처리)
        if(broke5MA && profitable && volR>=0.7){
          const sv=activeTk,svSide=oSide,svType=oType,svCred=credType;
          oSide="sell";oType="market";credType="cash";
          document.getElementById("ofQty").value=Math.floor(pos.qty*0.5)||pos.qty; // 절반 익절
          const ok=submitOrder(true);
          if(ok){
            const stk=STOCKS.find(s=>s.tk===activeTk);
            addDecisionLog('['+(stk?stk.nm:activeTk)+'] 🎯 모멘텀 약화 절반 익절','5MA 이탈 — 수익 보호','자동매도');
          }
          oSide=svSide;oType=svType;credType=svCred;
        }
      }
    }catch(_e){}
  }
}
async function execAutoBuy(pr, stk, score, techTag){
  if(!autoState.running||autoState.level<3)return;
  if(mock.lossSeries>=3&&autoState.cfg.brk){addMsg("ai","⏸ 연속 손절 3회 — 자동매매 일시정지\n[Phase 11: 뇌동매매 방지]");stopAuto();return;}
  // 확신도(score)에 따라 비중 차등 — 타점 명확하면 화끈하게
  // score>=12 강한신호 50% / >=10 강함 40% / >=8 보통 30% / 그 외 기본
  let posPct;
  if(typeof score==='number'){
    if(score>=12) posPct=50;
    else if(score>=10) posPct=40;
    else if(score>=8) posPct=30;
    else posPct=20;
  }else{
    posPct = Math.max(5, Math.min(80, autoState.cfg.pos||30));
  }
  // 대장첫숨: 신중 진입 — 비중 1/3로 제한
  if(techTag==='대장첫숨'){ posPct=Math.min(posPct, 33); }
  // 사용자 cfg 상한 존중 (cfg.pos를 사용자가 60%로 올려놓았다면 그 이상은 안 감)
  posPct = Math.min(posPct, Math.max(20, autoState.cfg.pos||50));
  // 신용 한도 포함 가용 자금 (잔고 + 신용한도 - 사용중)
  const creditAvail = Math.max(0, Math.round(mock.cash*((cfg.clim||140)/100)) - (mock.creditUsed||0));
  const totalAvail = mock.cash + creditAvail;
  const budget = Math.floor(totalAvail * (posPct/100));
  let qty = Math.floor(budget / pr);
  // 신용 한도 내 최대 매수 가능량
  const maxByTotal = Math.floor(totalAvail / pr);
  if(qty<=0 && maxByTotal>0){
    qty = Math.min(maxByTotal, 10);
    addDecisionLog('['+stk.nm+'] 비중 보정', '신용 포함 한도 내 '+qty+'주 매수', '백테스트');
  }
  if(qty<=0){ addDecisionLog('['+stk.nm+'] 잔고/신용 부족', '가용 '+totalAvail.toLocaleString()+'원 < 1주('+pr.toLocaleString()+')', '관망'); return; }
  // 신용 사용 여부 결정 (잔고 부족하면 자동 신용)
  const totalCost = qty * pr;
  const useCredit = totalCost > mock.cash && creditAvail > 0;
  document.getElementById("ofPr").value=pr;document.getElementById("ofQty").value=qty;
  document.getElementById("ofStop").value=Math.round(pr*(1-autoState.cfg.stop/100));
  document.getElementById("ofT1").value=Math.round(pr*(1+autoState.cfg.t1/100));
  document.getElementById("ofT2").value=Math.round(pr*(1+autoState.cfg.t2/100));
  // ★ 자동매매는 신용만 사용. 미수(margin)는 절대 사용 안 함
  oSide="buy";oType="market";credType=useCredit?"credit":"cash";trailMode=autoState.cfg.trail;
  // credSel UI도 동기화 (submitOrder가 select에서 읽음)
  const credSel=document.getElementById("credSel"); if(credSel) credSel.value = credType;
  const ok=submitOrder(true);
  if(ok){
    const _inv = (qty*pr).toLocaleString();
    const _credTag = useCredit ? ' 🟠신용' : '';
    addDecisionLog(`[${stk.nm}] 자동 매수 (${posPct}% 비중)${_credTag}`,`${pr.toLocaleString()}원 × ${qty}주 = ${_inv}원 | 손절 ${Math.round(pr*(1-autoState.cfg.stop/100)).toLocaleString()} | 목표 ${Math.round(pr*(1+autoState.cfg.t1/100)).toLocaleString()}`,"Phase 9-4");
    if(autoState.cfg.explain && typeof explainAutoDecision === 'function') setTimeout(()=>explainAutoDecision(stk,pr,qty),600);
  }
}

// ═══════════════════════════════
// DART 공시 조회 (Phase 6-5, 웹 검색 활용)
// ═══════════════════════════════
const DART_REACTIONS = {
  "신규 수주": {reaction:"+5~15%", timing:"공시 직후 거래량 확인 후", grade:"A"},
  "유상증자": {reaction:"-5~20%", timing:"낙폭 안정 후 판단", grade:"B"},
  "무상증자": {reaction:"권리락 후 반등", timing:"권리락일 시가 안정 후", grade:"B"},
  "실적 호조": {reaction:"+3~10%", timing:"시가 이후 안정 확인", grade:"A"},
  "실적 부진": {reaction:"-5~15%", timing:"낙폭 안정 후 반등 노림", grade:"B"},
  "대주주 매수": {reaction:"+5~20%", timing:"연속 매수 여부 확인", grade:"A"},
  "자사주 매입": {reaction:"+3~10%", timing:"공시 직후", grade:"A"},
  "FDA 임상 성공": {reaction:"+15~30%", timing:"공시 직후", grade:"S"},
  "FDA 임상 실패": {reaction:"-20~50%", timing:"진입 금지", grade:"C"},
  "CB/BW 발행": {reaction:"-3~10%", timing:"진입 자제", grade:"C"},
};
// SAMPLE_DARTS 제거됨 (가짜 하드코딩 데이터)

// DART API 상태
let dartApiAvailable = false;
async function checkDartApiStatus(){
  try{
    const r=await fetch("/api/dart/status");
    const d=await r.json();
    dartApiAvailable=d.has_key;
    return d;
  }catch(e){return {has_key:false};}
}

async function fetchDartNews(corpName){
  const el=document.getElementById("dartList");
  el.innerHTML='<div style="font-size:9px;color:var(--tm);padding:4px 0;display:flex;align-items:center;gap:5px;"><span style="animation:pu 1s infinite;display:inline-block;">●</span> 공시 로딩 중...</div>';
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const nm=corpName||stk.nm;
  // 고유번호 조회
  let corpCode="";
  try{
    const cr=await fetch(`/api/dart/corpcode?nm=${encodeURIComponent(nm)}`);
    const cd=await cr.json();
    corpCode=cd.corp_code||"";
  }catch(e){}
  // DART API 호출
  try{
    const params=new URLSearchParams({days:3});
    if(corpCode)params.set("corp_code",corpCode);
    const r=await fetch(`/api/dart/list?${params}`);
    const d=await r.json();
    if(d.status==="no_key"){
      // API 키 없음 — 샘플 데이터 + 안내
      renderDartSample(el, stk.nm);
      return;
    }
    if(d.status==="ok"&&d.list&&d.list.length>0){
      dartApiAvailable=true;
      renderDartReal(el, d.list);
      return;
    }
    // 데이터 없으면 샘플
    renderDartSample(el, stk.nm);
  }catch(e){
    renderDartSample(el, stk.nm);
  }
}

function renderDartReal(el, list){
  el.innerHTML=`<div style="font-size:8px;color:var(--g);font-family:var(--mono);padding:2px 0;margin-bottom:3px;">✅ DART 실시간 (딜레이 없음)</div>`+
  list.slice(0,8).map(d=>{
    const rcptNo=d.rcept_no||"";
    const dartUrl=`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcptNo}`;
    // 공시 유형 자동 판단
    const title=d.report_nm||"";
    const grade=classifyDartGrade(title);
    const gc={"S":"var(--p)","A":"var(--b)","B":"var(--a)","C":"var(--r)"}[grade]||"var(--ts)";
    const reaction=getDartReaction(title);
    const timeStr=(d.rcept_dt||"").slice(4,8).replace(/(\d{2})(\d{2})/,"$1:$2");
    return`<div style="padding:4px 0;border-bottom:1px solid var(--br);cursor:pointer;" onclick="window.open('${dartUrl}','_blank');analyzeDart('${title.replace(/'/g,"\'")}','','${d.corp_name||""}')">
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:1px;">
        <span style="font-family:var(--mono);font-size:8px;color:var(--tm);">${timeStr}</span>
        <span style="font-size:8px;padding:0 4px;border-radius:3px;font-weight:700;color:${gc};background:${gc}18;">${grade}급</span>
        <span style="font-size:9px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.corp_name||""}</span>
      </div>
      <div style="font-size:9px;color:var(--ts);line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${title}</div>
      ${reaction?`<div style="font-size:8px;color:var(--tm);margin-top:1px;">${reaction}</div>`:""}
    </div>`;
  }).join("")||`<div style='font-size:9px;color:var(--tm);'>최근 공시 없음</div>`;
}

function renderDartSample(el, corpName){
  // DART API 키 없음 — 실제 데이터 없음을 명확히 표시
  el.innerHTML=`<div style="padding:8px;background:rgba(255,153,0,.06);border:1px solid rgba(255,153,0,.2);border-radius:7px;font-size:10px;line-height:1.7;">
    <div style="font-weight:700;color:var(--a);margin-bottom:4px;">⚠ DART API 키 미설정</div>
    <div style="color:var(--ts);">공시 데이터를 표시하려면 DART API 키가 필요합니다.</div>
    <div style="margin-top:6px;color:var(--tm);font-size:9px;">
      1. <a href="https://opendart.fss.or.kr" target="_blank" style="color:var(--b);">opendart.fss.or.kr</a> → 인증키 신청 (무료)<br>
      2. ⚙ 설정 → API 키 탭 → DART API 키 입력 → 저장
    </div>
  </div>`;
}

function classifyDartGrade(title){
  if(title.includes("합병")||title.includes("인수")||title.includes("사업전환")||title.includes("대규모"))return "S";
  if(title.includes("수주")||title.includes("공급계약")||title.includes("실적")||title.includes("FDA")||title.includes("임상")||title.includes("자사주")||title.includes("대주주"))return "A";
  if(title.includes("CB")||title.includes("BW")||title.includes("유상증자")||title.includes("전환사채")||title.includes("신주"))return "C";
  return "B";
}

function getDartReaction(title){
  for(const [key,val] of Object.entries(DART_REACTIONS)){
    if(title.includes(key.split(" ")[0]))return `예상반응 ${val.reaction}`;
  }
  return "";
}
async function analyzeDart(title, type, corp){
  try{
  // 공시 클릭 시 재료 강도 자동 분석
  document.getElementById("materialInput").value=`[${corp}] ${title} (${type})`;
  // AI 추천 탭으로 이동해서 분석
  const aiTab=document.querySelector(".lp-tabs .lpt:last-child");
  if(aiTab)lTab(aiTab,"lpb-ai");
  await runMaterialAnalysis();
  addMsg("ai",`📢 공시 분석: ${corp}
${title}

공시 유형: ${type}
→ 재료 분석 패널에서 결과를 확인하세요. (Phase 6-5)`);
  }catch(e){console.error("analyzeDart:",e);}
}

// ═══════════════════════════════
// 매매 타점 AI 추천 (Phase 10)
// ═══════════════════════════════
const TECHNIQUES = {
  "눌림목": {phase:"10-4", cond:"20MA 지지 + 거래량 감소 후 회복", stop:"눌림 저점 이탈", target:"직전 고점"},
  "돌파": {phase:"10-5", cond:"전고점 저항선 돌파 + 거래량 300%+", stop:"돌파선 아래", target:"다음 저항선"},
  "첫봉": {phase:"10-3", cond:"시가 후 첫봉 양봉 + 거래량 150%+", stop:"첫봉 저가", target:"전일 고점"},
  "갭상승": {phase:"10-2", cond:"갭업 후 첫봉 양봉 확정", stop:"갭 아래 (시가)", target:"이전 저항 or +5%"},
  "이슈테마": {phase:"10-6", cond:"재료 A급 이상 + 선도주 + 거래량 1위", stop:"시가 이탈", target:"R/R 1:2"},
  "대장첫숨": {phase:"10-7", cond:"이슈/재료 동반 필수 + 기관수급 강세섹터 대장주 장대양봉 후 첫 음봉 — 비중 1/3 신중 진입", stop:"장대양봉 시가 이탈", target:"장대양봉 고가"},
};

async function detectTechnique(cs, stk){
  if(!cs||cs.length<10) return null;
  // 사용자가 매매기법 직접 선택한 경우 그대로 사용
  if(userTechnique && userTechnique !== 'auto'){
    const t = TECHNIQUES[userTechnique]||TECHNIQUES["눌림목"];
    const cls=cs.map(c=>c.c);
    const lc=cs[cs.length-1];
    const ma20=(calcMA(cls,20).slice(-1)[0]||lc.c);
    const entryPr=lc.c;
    const stopPr=Math.round(entryPr*(1-0.03));
    const targetPr=Math.round(entryPr+(entryPr-stopPr)*2);
    return {technique:userTechnique,score:3,phase:t.phase,cond:t.cond,entry:entryPr,stop:stopPr,target:targetPr,rr:2,ma5:Math.round(calcMA(cls,5).slice(-1)[0]||lc.c),ma20:Math.round(ma20),rsi:(calcRSI(cls,14).slice(-1)[0]||50).toFixed(0),volRatio:'1.0'};
  }
  const cls=cs.map(c=>c.c), vls=cs.map(c=>c.v);
  const lc=cs[cs.length-1], pc=cs[cs.length-2]||lc;
  const ma5=calcMA(cls,5), ma20=calcMA(cls,20);
  const lma5=ma5[ma5.length-1]||0, lma20=ma20[ma20.length-1]||0;
  const rsi=(calcRSI(cls,14).slice(-1)[0]||50);
  const volRatio=vls.length>=2?vls[vls.length-1]/vls[vls.length-2]:1;
  const chgPct=(lc.c-lc.o)/lc.o*100;
  const prevHighs=cs.slice(-20).map(c=>c.h), maxHigh=Math.max(...prevHighs);
  const isBreakout=lc.h>=maxHigh*0.99&&volRatio>=2;
  const isPullback=lc.c>lma20&&lc.c<lma5&&volRatio<1;
  const isGap=lc.o>pc.c*1.01;
  const isFirstBar=sim.idx<=6; // 처음 6봉 이내
  const isMomentum=rsi>=50&&volRatio>=1.5&&chgPct>0;
  // 대장첫숨: 이슈/재료 동반 필수 + 강세섹터 대장주 장대양봉 후 첫 음봉
  const _siDet = stk ? (window._sectorInfo||{})[stk.tk||''] : null;
  const _isLeaderDet = _siDet && _siDet.rank<=3 && (_siDet.role==='대장주'||_siDet.momentum==='강함');
  const _hasThemeDet = _siDet && _siDet.reason && _siDet.reason.length>2;
  const _hasNewsDet = (typeof window._newsItems!=='undefined' && Array.isArray(window._newsItems)) && window._newsItems.some(function(n){return (n.tk||n.code)===(stk.tk||'')||(n.title||'').indexOf(stk.nm||'')!==-1;});
  const _hasIssueDet = _hasThemeDet || _hasNewsDet;
  const _pcBd = Math.abs(pc.c-pc.o), _pcRng = pc.h-pc.l||1;
  const _prevBigBullDet = pc.c>pc.o && _pcBd/_pcRng>=0.6 && (pc.c-pc.o)/pc.o*100>=1.5;
  const _curBearDet = lc.c<lc.o;
  const isLeaderDip = _isLeaderDet && _prevBigBullDet && _curBearDet && _hasIssueDet;
  let technique="눌림목", score=0;
  if(isLeaderDip){technique="대장첫숨";score=4;}
  else if(isBreakout){technique="돌파";score=4;}
  else if(isGap&&isFirstBar){technique="갭상승";score=4;}
  else if(isFirstBar&&lc.c>lc.o&&volRatio>=1.5){technique="첫봉";score=3;}
  else if(isPullback){technique="눌림목";score=3;}
  else if(isMomentum&&volRatio>=2){technique="이슈테마";score=3;}
  else if(rsi<=30&&lc.c>lc.o&&(lc.c-lc.l)>(lc.h-lc.c)*1.5){
    // RSI 30이하 + 망치형(아래꼬리가 윗꼬리의 1.5배 이상) → 역추세
    technique="역추세";score=2;
  }
  else{technique="눌림목";score=2;}
  const t=TECHNIQUES[technique]||TECHNIQUES["눌림목"];
  const entryPr=lc.c;
  const stopPr=Math.round(lma20*0.995||entryPr*0.97);
  const rr=2;
  const targetPr=Math.round(entryPr+(entryPr-stopPr)*rr);
  return {technique,score,phase:t.phase,cond:t.cond,entry:entryPr,stop:stopPr,target:targetPr,rr,ma5:Math.round(lma5),ma20:Math.round(lma20),rsi:rsi.toFixed(0),volRatio:volRatio.toFixed(1)};
}

// ═══════════════════════════════
// AI 종합분석 + Phase 8 체크리스트
// ═══════════════════════════════
let analysisRunning=false;
let analysisCache={};
async function runFullAnalysis(){
  try{
  const _cacheKey='analysis_'+activeTk+'_'+sim.idx;
  const _cached=_getCachedAnalysis(_cacheKey);
  if(_cached){const box=document.getElementById('aiAdvBox');if(box)box.innerHTML=_cached;finishProgress('캐시된 분석');return;}
  if(analysisRunning)return;
  const cacheKey=activeTk+'_'+sim.idx;
  if(analysisCache[cacheKey]&&Date.now()-analysisCache[cacheKey].ts<300000){
    const p=analysisCache[cacheKey].result;
    if(p){applyAnalysisResult(p);document.getElementById('analysisTk').textContent='캐시됨(5분)';}
    return;
  }
  analysisRunning=true;
  showProgress('AI 종합 분석 중...', 5);
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const cs=getCandles(20);
  if(cs.length<5){analysisRunning=false;return;}
  document.getElementById("analysisTk").textContent=`${stk.nm} (${sim.tf}분)`;
  document.getElementById("techniqueTag").textContent="분석 중...";
  document.getElementById("entryPoint").textContent="계산 중...";
  // Phase 8 실시간 수치 즉시 표시
  updatePhase8Live();
  document.getElementById("goNogoTag").textContent="-";
  document.getElementById("goNogoTag").style.cssText="font-size:9px;padding:1px 6px;border-radius:3px;font-weight:700;font-family:var(--mono);";

  // Claude API 키 없으면 로컬 분석만
  const hasClaudeKey = !!(kisConfig.claudeKey && kisConfig.claudeKey.startsWith('sk-ant-'));
  if(!hasClaudeKey){
    // 로컬 분석으로 대체
    const tech=await detectTechnique(cs, stk);
    const lc2=getCurrentCandle()||cs[cs.length-1];
    const ep2=document.getElementById("entryPoint");
    if(tech){
      document.getElementById("techniqueTag").textContent=tech.technique;
      document.getElementById("techniqueTag").style.color="var(--b)";
      const rea=document.getElementById("techniqueReason");
      if(rea)rea.textContent=tech.cond||'';
      if(ep2) ep2.innerHTML=
        `<span style="color:var(--r);font-weight:700;">📍 진입 ${(tech.entry||lc2.c).toLocaleString()}원</span><br>`+
        `<span style="color:var(--b);">✂ 손절 ${(tech.stop||Math.round(lc2.c*0.97)).toLocaleString()}원</span><br>`+
        `<span style="color:var(--g);">🎯 목표 ${(tech.target||Math.round(lc2.c*1.06)).toLocaleString()}원</span><br>`+
        `<span style="font-size:8px;color:var(--ts);">R/R 1:${tech.rr||2}</span><br>`+
        `<span style="font-size:7px;color:var(--tm);">* Claude 키 설정 시 AI 심층분석</span>`;
      const goEl=document.getElementById("goNogoTag");
      if(goEl){goEl.textContent=tech.score>=3?'✅ 진입검토':'⚪ 관망';goEl.style.color=tech.score>=3?'var(--g)':'var(--ts)';}
    } else {
      if(ep2) ep2.innerHTML=
        `<span style="color:var(--r);font-weight:700;">📍 진입 ${lc2.c.toLocaleString()}원</span><br>`+
        `<span style="color:var(--b);">✂ 손절 ${Math.round(lc2.c*0.97).toLocaleString()}원</span><br>`+
        `<span style="color:var(--g);">🎯 목표 ${Math.round(lc2.c*1.06).toLocaleString()}원</span><br>`+
        `<span style="font-size:8px;color:var(--ts);">R/R 1:2 (기본값)</span><br>`+
        `<span style="font-size:7px;color:var(--tm);">* 봉 데이터 축적 중</span>`;
    }
    analysisRunning=false;
    return;
  }

  // 1. 로컬 기법 감지
  const tech=await detectTechnique(cs, stk);
  if(tech){
    document.getElementById("techniqueTag").textContent=tech.technique;
    document.getElementById("techniqueTag").style.color="var(--b)";
  }

  // 2. Claude API로 종합 분석
  const cls=cs.map(c=>c.c), vls=cs.map(c=>c.v);
  const ma5=calcMA(cls,5), ma20=calcMA(cls,20), ma60=calcMA(cls,60);
  const rsi=(calcRSI(cls,14).slice(-1)[0]||50).toFixed(1);
  const lma5=(ma5.slice(-1)[0]||0).toFixed(0);
  const lma20=(ma20.slice(-1)[0]||0).toFixed(0);
  const lma60=(ma60.slice(-1)[0]||0).toFixed(0);
  const lc=cs[cs.length-1];
  const volR=vls.length>=2?(vls[vls.length-1]/vls[vls.length-2]).toFixed(1):"1.0";
  const pos=mock.positions[activeTk];
  const so=stopOrders[activeTk];

  const prompt=`단타 트레이딩 멘토. Phase 8 통합 점검 기준으로 분석해줘.

종목: ${stk.nm}(${activeTk}) ${stk.sec||""} ${stk.cap||""}
현재가: ${lc.c.toLocaleString()}원
5MA: ${lma5} / 20MA: ${lma20} / 60MA: ${lma60}
RSI: ${rsi} / 거래량비율: ${volR}배
감지된 기법: ${tech?.technique||"불명확"}
${pos?`보유: ${pos.qty}주 평단 ${Math.round(pos.avgPrice).toLocaleString()}원${so?` 손절${so.stop.toLocaleString()} 목표${so.t1.toLocaleString()}`:""}`:""} 

Phase 8 STEP 0~7 간략 점검 결과를 JSON으로 답해:
{
  "technique": "매매기법명",
  "techniqueReason": "이 기법을 선택한 이유 1문장",
  "entry": 진입가숫자,
  "stop": 손절가숫자,
  "target1": 1차목표가숫자,
  "target2": 2차목표가숫자,
  "rr": RR비율숫자,
  "entryTiming": "진입 타이밍 설명",
  "phase8": {
    "step0_psych": "심리상태: 정상/주의",
    "step1_market": "시장환경: 우호/중립/비우호",
    "step2_sector": "섹터: 강/보통/약",
    "step3_screen": "스크리닝: 통과/주의/실패",
    "step4_chart": "차트: 진입가능/주의/불가",
    "step5_supply": "수급: 강/보통/약",
    "step6_rr": "R/R: 충족/미달",
    "step7_final": "최종: GO/NO-GO"
  },
  "goNogo": "GO" or "NO-GO",
  "goScore": 0~8,
  "caution": "주의사항"
}`;

  try{
    const data=await callClaude({model:"claude-sonnet-4-5",max_tokens:700,messages:[{role:"user",content:prompt}]},"Phase8 종합분석");
    const raw=data.content?.[0]?.text||"{}";
    let p;try{const m=raw.match(/\{[\s\S]*\}/);p=JSON.parse(m?m[0]:"{}"); }catch(e){p={};}

    // 매매기법
    if(p.technique){
      document.getElementById("techniqueTag").textContent=p.technique;
      document.getElementById("techniqueTag").style.color="var(--b)";
      document.getElementById("techniqueReason").textContent=(p.techniqueReason||"")+(p.phase8?.step4_chart?` · ${p.phase8.step4_chart}`:"");
    }

    // 타점
    if(p.entry){
      const rrStr=p.rr?` (R/R 1:${p.rr})`:"";
      document.getElementById("entryPoint").innerHTML=
        `<span style="color:var(--b);font-weight:700;">진입 ${(p.entry||0).toLocaleString()}원</span><br>`+
        `<span style="color:var(--r);">✂ 손절 ${(p.stop||0).toLocaleString()}원</span><br>`+
        `<span style="color:var(--g);">🎯 1차 ${(p.target1||0).toLocaleString()}원</span><br>`+
        `<span style="color:var(--g);">🎯 2차 ${(p.target2||0).toLocaleString()}원</span>`+
        `<br><span style="font-size:8px;color:var(--ts);">${p.entryTiming||""}${rrStr}</span>`;
      // 주문창에 자동 입력
      document.getElementById("ofPr").value=p.entry;
      document.getElementById("ofStop").value=p.stop;
      document.getElementById("ofT1").value=p.target1;
      document.getElementById("ofT2").value=p.target2;
      updOSum();
    }

    // Phase 8 체크리스트
    if(p.phase8){
      const ph=p.phase8;
      const checkIcon=v=>v&&(v.includes("우호")||v.includes("강")||v.includes("통과")||v.includes("GO")||v.includes("충족")||v.includes("정상"))?"✅":v&&(v.includes("비우호")||v.includes("약")||v.includes("실패")||v.includes("NO")||v.includes("미달"))?"❌":"🟡";
      document.getElementById("phase8Check").innerHTML=
        `${checkIcon(ph.step0_psych)} STEP0 ${ph.step0_psych||"-"}<br>`+
        `${checkIcon(ph.step1_market)} STEP1 ${ph.step1_market||"-"}<br>`+
        `${checkIcon(ph.step2_sector)} STEP2 ${ph.step2_sector||"-"}<br>`+
        `${checkIcon(ph.step3_screen)} STEP3 ${ph.step3_screen||"-"}<br>`+
        `${checkIcon(ph.step4_chart)} STEP4 ${ph.step4_chart||"-"}<br>`+
        `${checkIcon(ph.step5_supply)} STEP5 ${ph.step5_supply||"-"}<br>`+
        `${checkIcon(ph.step6_rr)} STEP6 ${ph.step6_rr||"-"}<br>`+
        `${checkIcon(ph.step7_final)} STEP7 ${ph.step7_final||"-"}`;
    }

    // GO/NO-GO 태그
    const isGo=p.goNogo==="GO";
    const tag=document.getElementById("goNogoTag");
    tag.textContent=isGo?`✅ GO (${p.goScore||0}/8)`:p.goNogo?`❌ NO-GO (${p.goScore||0}/8)`:`🟡 (${p.goScore||0}/8)`;
    tag.style.background=isGo?"rgba(5,192,114,.15)":"rgba(240,62,62,.15)";
    tag.style.color=isGo?"var(--g)":"var(--r)";

    // AI 결정 로그
    addDecisionLog(
      `[${stk.nm}] ${p.technique||"분석"} → ${p.goNogo||"분석중"}`,
      `진입 ${(p.entry||0).toLocaleString()} / 손절 ${(p.stop||0).toLocaleString()} / 목표 ${(p.target1||0).toLocaleString()} · ${p.phase8?.step7_final||""}`,
      `Phase ${TECHNIQUES[p.technique]?.phase||"10"} · Phase 8`
    );

    // 캐시 저장
    if(p)analysisCache[activeTk+'_'+sim.idx]={ts:Date.now(),result:p};
    // 채팅에도 알림
    if(p.goNogo){
      addMsg("ai",
        `📊 AI 종합분석 완료: ${stk.nm}

`+
        `매매기법: ${p.technique||"-"} (${TECHNIQUES[p.technique]?.phase||""})
`+
        `${p.techniqueReason||""}

`+
        `진입가: ${(p.entry||0).toLocaleString()}원
`+
        `손절가: ${(p.stop||0).toLocaleString()}원
`+
        `1차목표: ${(p.target1||0).toLocaleString()}원
`+
        `2차목표: ${(p.target2||0).toLocaleString()}원
`+
        `R/R: 1:${p.rr||"-"}

`+
        `Phase 8 점수: ${p.goScore||0}/8 → ${p.goNogo}
`+
        `${p.caution?"⚠ "+p.caution:""}`
      );
    }
  }catch(e){
    document.getElementById("techniqueTag").textContent=tech?.technique||"분석실패";
    document.getElementById("entryPoint").textContent="API 오류";
    document.getElementById("phase8Check").textContent="API 오류";
    failProgress('분석 실패: '+e.message);
  }
  analysisRunning=false;
  finishProgress('AI 분석 완료');
  }catch(e){failProgress("AI 분석 실패");console.error("runFullAnalysis:",e);}
}
function applyAnalysisResult(p){
  if(!p)return;
  if(p.technique){
    const el=document.getElementById('techniqueTag');
    if(el){el.textContent=p.technique;el.style.color='var(--b)';}
    const re=document.getElementById('techniqueReason');
    if(re)re.textContent=p.techniqueReason||'';
  }
  if(p.entry){
    const ep=document.getElementById('entryPoint');
    if(ep)ep.innerHTML='<span style="color:var(--b);font-weight:700;">진입 '+(p.entry||0).toLocaleString()+'원</span><br><span style="color:var(--r);">✂ 손절 '+(p.stop||0).toLocaleString()+'원</span><br><span style="color:var(--g);">🎯 1차 '+(p.target1||0).toLocaleString()+' | 2차 '+(p.target2||0).toLocaleString()+'원</span><br><span style="font-size:8px;color:var(--ts);">R/R 1:'+(p.rr||'-')+'</span>';
  }
  const tag=document.getElementById('goNogoTag');
  if(tag&&p.goNogo){const isGo=p.goNogo==='GO';tag.textContent=isGo?'✅ GO ('+(p.goScore||0)+'/8)':'❌ NO-GO ('+(p.goScore||0)+'/8)';tag.style.background=isGo?'rgba(5,192,114,.15)':'rgba(240,62,62,.15)';tag.style.color=isGo?'var(--g)':'var(--r)';}
  const p8=document.getElementById('phase8Check');
  if(p8&&p.checkList)p8.innerHTML=p.checkList;
}

// ═══════════════════════════════
// AI 자동매매 — 결정 이유 실시간 표시 강화
// ═══════════════════════════════
async function runFullAutoStep(cs, stk){
  try{
  if(!autoState.running) return;
  const tech=await detectTechnique(cs, stk);
  if(!tech) return;
  const reason=`${tech.technique} 기법 감지 · RSI${tech.rsi} · 거래량×${tech.volRatio} · R/R 1:${tech.rr}`;
  addDecisionLog(`[${stk.nm}] 기법감지: ${tech.technique}`, reason, `Phase ${tech.phase}`);
  // Level 2 이상: 진입 신호 표시
  if(autoState.level>=2 && tech.score>=2){
    updAdvBoxes(
      `${tech.technique} 셋업 감지 — ${stk.nm}`,
      `진입 ${tech.entry.toLocaleString()} / 손절 ${tech.stop.toLocaleString()} / 목표 ${tech.target.toLocaleString()}
${TECHNIQUES[tech.technique]?.cond||""}`
    );
    if(autoState.level>=3 && tech.score>=2){
      // 진입가/손절/목표 주문창에 자동 세팅 후 매수
      document.getElementById("ofPr").value=tech.entry;
      document.getElementById("ofStop").value=tech.stop;
      document.getElementById("ofT1").value=tech.target;
      document.getElementById("ofT2").value=Math.round(tech.entry+(tech.target-tech.entry)*1.5);
      await execAutoBuy(tech.entry, stk);
    }
  }
  }catch(e){console.error("runFullAutoStep:",e);}
}

async function autoAdvUpdate(){
  try{
  // 자동매매 레벨 무관하게 항상 차트 분석 업데이트
  await updateAIAdvisor();
  // 자동매매 실행 중이면 기법 감지도 실행
  if(autoState.running && autoState.level>=1){
    const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
    const cs=getCandles(20);
    if(cs.length>=10) await runFullAutoStep(cs, stk);
  }
  }catch(e){console.error("autoAdvUpdate:",e);}
}
// ═══════════════════════════════
// AI SECTOR & STOCK RECOMMENDATION (Phase 6, 7)
// ═══════════════════════════════
const MATERIAL_GRADES = {
  S:"구조적 변화 (M&A/정책/사업전환) — 수주~수개월 지속. 최대비중 가능",
  A:"정책/실적/계약 — 1~5일 지속. 정상비중",
  B:"테마/이슈 — 수시간~수일. 보통비중",
  C:"소문/SNS — 수분~수시간. 진입금지"
};

async function runAISectorAnalysis(){
  const el=document.getElementById("aiSectorResult");
  el.innerHTML='<span style="color:var(--tm);font-style:italic;">AI 분석 중...</span>';
  // ★ 미래 참조 금지: getDashData(당일 최종점수) 대신 현재 봉까지의 데이터 사용
  const cs = getCandles(2);
  const cls = cs.map(c=>c.c);
  const curRSI = (calcRSI(cls,14).slice(-1)[0]||50).toFixed(0);
  const curVol = cs.length>=2?(cs[cs.length-1].v/cs[cs.length-2].v).toFixed(1):'1.0';
  const lc = cs[cs.length-1]||{};
  const marketCtx = `현재시각 ${lc.t||'--'} | RSI ${curRSI} | 거래량비율 ${curVol}배 | 종가 ${(lc.c||0).toLocaleString()}원`;
  const prompt=`단타 트레이딩 멘토. 오늘 섹터 분석을 해줘. (Phase 6-1,6-4 기준)

시장: ${marketCtx}
현재 종목: ${STOCKS.find(s=>s.tk===activeTk)?.nm||activeTk}

아래 섹터들 중 오늘 집중해야 할 섹터를 분석해줘:
- 반도체/AI (삼성전자, SK하이닉스)
- 2차전지 (LG에너지솔루션)
- 바이오 (삼성바이오, 셀트리온)
- 인터넷 (NAVER, 카카오)
- 자동차 (현대차)

각 섹터에 대해:
1. 오늘 투자 강도: 🟢강함/🟡보통/🔴약함
2. 재료강도: S/A/B/C
3. 한줄 이유

JSON 형식으로만 답해 (다른 텍스트 없이):
{"sectors":[{"name":"섹터명","grade":"🟢","material":"A","reason":"이유"},...], "topSector":"최우선섹터명", "caution":"오늘 주의사항"}`;
  try{
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:500,messages:[{role:"user",content:prompt}]})});
    const data=await res.json();
    const raw=data.content?.[0]?.text||"{}";
    let p;try{const m=raw.match(/\{[\s\S]*\}/);p=JSON.parse(m?m[0]:"{}");}catch(e){p={};}
    if(p.sectors){
      const html=p.sectors.map(s=>`<div style="padding:3px 0;border-bottom:1px solid var(--br);display:flex;align-items:center;gap:5px;">
        <span>${s.grade}</span>
        <span style="font-weight:600;font-size:10px;flex:1;">${s.name}</span>
        <span style="font-family:var(--mono);font-size:9px;padding:1px 4px;border-radius:3px;background:${s.material==="S"||s.material==="A"?"rgba(49,130,246,.1)":"rgba(0,0,0,.05)"};">${s.material}급</span>
      </div>`).join("")+
      (p.topSector?`<div style="margin-top:5px;padding:4px 6px;background:rgba(124,58,237,.08);border-radius:6px;font-size:9px;color:var(--p);font-weight:700;">⭐ 오늘 핵심: ${p.topSector}</div>`:"")+
      (p.caution?`<div style="margin-top:3px;font-size:9px;color:var(--r);">⚠ ${p.caution}</div>`:"");
      el.innerHTML=html;
    } else el.innerHTML=raw.slice(0,200);
  }catch(e){el.innerHTML='<span style="color:var(--r);">API 오류</span>';}
}

async function runAIStockScreening(){
  const el=document.getElementById("aiScreenResult");
  el.innerHTML='<span style="color:var(--tm);font-style:italic;">스크리닝 중...</span>';
  // Phase 7-7: 4가지 필터 로컬 계산
  const results=[];
  STOCKS.forEach(stk=>{
    let score=0,tags=[];
    const chgPct=(stk.pr-stk.base)/stk.base*100;
    // 실제 기술적 분석 기반 스크리닝 (가짜 random 없음)
    const cs2=getCandles(20);
    if(cs2.length>=5){
      const cls2=cs2.map(c=>c.c),vls2=cs2.map(c=>c.v);
      const lc2=cs2[cs2.length-1],pc2=cs2[cs2.length-2]||lc2;
      const ma5_2=(calcMA(cls2,5).slice(-1)[0]||0);
      const ma20_2=(calcMA(cls2,20).slice(-1)[0]||0);
      const rsi2=parseFloat((calcRSI(cls2,14).slice(-1)[0]||50).toFixed(0));
      const volR2=vls2.length>=2?vls2[vls2.length-1]/vls2[vls2.length-2]:1;
      // 실제 지표 기반 점수
      if(volR2>=1.5){score+=3;tags.push(`거래량×${volR2.toFixed(1)}`);}
      if(ma5_2>ma20_2){score+=2;tags.push("MA정배열");}
      if(rsi2>=45&&rsi2<=70){score+=2;tags.push(`RSI${rsi2}`);}
      if(lc2.c>lc2.o&&pc2.c<pc2.o){score+=2;tags.push("음→양전환");}
      if(chgPct>=1){score+=2;tags.push(`+${chgPct.toFixed(1)}%`);}
    }
    if(score>=4)results.push({stk,score,tags});
  });
  results.sort((a,b)=>b.score-a.score);
  const top3=results.slice(0,3);
  if(!top3.length){el.innerHTML="현재 조건 충족 종목 없음";return;}
  // AI 심화 분석
  const prompt=`단타 트레이딩 멘토. Phase 7-7 스크리닝 기준으로 아래 후보 종목을 분석해줘.

후보 종목:
${top3.map(r=>`- ${r.stk.nm}(${r.stk.tk}): 점수${r.score}/10, 신호:${r.tags.join(",")}, 등락${((r.stk.pr-r.stk.base)/r.stk.base*100).toFixed(2)}%`).join("\n")}

각 종목에 대해:
1. 단타 적합도: ○(적합)/△(보통)/✗(부적합)
2. 재료강도: S/A/B/C
3. 손절 기준 (진입가 기준 %)
4. 한줄 이유

JSON만 답해:
{"stocks":[{"name":"종목명","fit":"○","material":"A","stop":"3%","reason":"이유"},...], "bestPick":"최우선종목명"}`;
  try{
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:400,messages:[{role:"user",content:prompt}]})});
    const data=await res.json();
    const raw=data.content?.[0]?.text||"{}";
    let p;try{const m=raw.match(/\{[\s\S]*\}/);p=JSON.parse(m?m[0]:"{}");}catch(e){p={};}
    if(p.stocks){
      const html=p.stocks.map((s,i)=>`<div style="padding:4px 0;border-bottom:1px solid var(--br);" onclick="selectStk('${top3[i]?.stk?.tk||"005930"}')">
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="font-size:13px;">${s.fit==="○"?"🟢":s.fit==="△"?"🟡":"🔴"}</span>
          <span style="font-weight:700;font-size:10px;flex:1;cursor:pointer;color:var(--b);">${s.name}</span>
          <span style="font-family:var(--mono);font-size:9px;">${s.material}급</span>
        </div>
        <div style="font-size:9px;color:var(--ts);margin-top:1px;">손절 -${s.stop} · ${s.reason}</div>
      </div>`).join("")+
      (p.bestPick?`<div style="margin-top:5px;padding:4px 6px;background:rgba(49,130,246,.08);border-radius:6px;font-size:9px;font-weight:700;color:var(--b);">⭐ 최우선: ${p.bestPick}</div>`:"");
      el.innerHTML=html;
    // AI 스크리닝 결과를 '오늘 후보' 목록에 자동 반영
    if(p.bestPick&&top3.length){
      const bestStk=top3.find(r=>r.stk.nm===p.bestPick)||top3[0];
      if(bestStk&&!CANDS.find(c=>c.tk===bestStk.stk.tk)){
        CANDS.unshift({tk:bestStk.stk.tk,why:`AI스크리닝 최우선 (${bestStk.score}/10)`});
        if(CANDS.length>3)CANDS.pop();
        renderCands();
      }
    }
    } else el.innerHTML=raw.slice(0,200);
  }catch(e){el.innerHTML='<span style="color:var(--r);">API 오류</span>';}
}

async function runMaterialAnalysis(){
  const text=document.getElementById("materialInput").value.trim();
  const el=document.getElementById("materialResult");
  if(!text){showAlert("입력 필요","뉴스나 공시 내용을 입력해주세요.");return;}
  el.innerHTML='<span style="color:var(--tm);font-style:italic;">분석 중...</span>';
  const prompt=`단타 트레이딩 멘토. 아래 뉴스/공시의 재료 강도를 Phase 6-1 기준으로 판별해줘.

내용: ${text}

재료 강도 기준:
S급: 구조적 변화 (M&A, 사업전환, 대형정책) — 수주~수개월
A급: 실적/계약/정책 — 1~5일
B급: 테마/이슈 — 수시간~수일
C급: 소문/SNS — 진입금지

JSON만 답해:
{"grade":"A","duration":"1~3일","action":"눌림목 진입 검토","reason":"이유 1문장","warning":"주의사항"}`;
  try{
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:250,messages:[{role:"user",content:prompt}]})});
    const data=await res.json();
    const raw=data.content?.[0]?.text||"{}";
    let p;try{const m=raw.match(/\{[\s\S]*\}/);p=JSON.parse(m?m[0]:"{}");}catch(e){p={};}
    const gc={"S":"var(--p)","A":"var(--b)","B":"var(--a)","C":"var(--r)"}[p.grade]||"var(--ts)";
    el.innerHTML=`<div style="padding:5px 7px;background:rgba(0,0,0,.04);border-radius:7px;border-left:3px solid ${gc};">
      <div style="font-size:14px;font-weight:800;color:${gc};">${p.grade||"?"}급 재료</div>
      <div style="font-size:9px;color:var(--ts);margin-top:2px;">${MATERIAL_GRADES[p.grade]||""}</div>
      <div style="font-size:10px;margin-top:4px;"><b>지속:</b> ${p.duration||"-"}</div>
      <div style="font-size:10px;"><b>전략:</b> ${p.action||"-"}</div>
      <div style="font-size:9px;color:var(--ts);margin-top:2px;">${p.reason||""}</div>
      ${p.warning?`<div style="font-size:9px;color:var(--r);margin-top:2px;">⚠ ${p.warning}</div>`:""}
    </div>`;
  }catch(e){el.innerHTML='<span style="color:var(--r);">API 오류</span>';}
}

async function updateAIAdvisor(){
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const cs=getCandles(20);
  if(cs.length<5)return;
  const cls=cs.map(c=>c.c),vls=cs.map(c=>c.v);
  const lc=cs[cs.length-1];
  const ma5=calcMA(cls,5),ma20=calcMA(cls,20),ma60=calcMA(cls,60),rsi=calcRSI(cls,14);
  const lma5=ma5[ma5.length-1]||0,lma20=ma20[ma20.length-1]||0,lma60=ma60[ma60.length-1]||0;
  const lrsi=parseFloat((rsi[rsi.length-1]||50).toFixed(0));
  const volR=vls.length>=2?(vls[vls.length-1]/vls[vls.length-2]):'1';
  const maArr=lma5>lma20&&lma20>lma60?"정배열":lma5<lma20&&lma20<lma60?"역배열":"혼합";
  let score=0,signals=[];
  if(lc.c>lma5){score++;signals.push("5MA위");}
  if(lc.c>lma20){score++;signals.push("20MA위");}
  if(lrsi>=45&&lrsi<=70){score++;signals.push(`RSI${lrsi}`);}
  if(parseFloat(volR)>=1.3){score++;signals.push(`거래량${parseFloat(volR).toFixed(1)}배`);}
  if(lc.c>lc.o){score++;signals.push("양봉");}
  const so=stopOrders[activeTk];
  const pos=mock.positions[activeTk];

  // ── 토스체 상황 설명 ──
  const priceKr = stk.pr.toLocaleString();
  const maEmoji = maArr==='정배열'?'📈':maArr==='역배열'?'📉':'🔀';
  const rsiComment = lrsi>=70?'과열 구간이에요':lrsi<=30?'과매도 구간이에요':lrsi>=50?'모멘텀 살아있어요':'중립이에요';
  const volComment = parseFloat(volR)>=2?'거래량 폭발 🔥':parseFloat(volR)>=1.3?'거래량 증가 중':'거래량 보통';

  // ── 현재 종목명 표시 ──
  const tkEl = document.getElementById('analysisTk');
  if(tkEl) tkEl.textContent = `${stk.nm} (${sim.tf}분)`;

  // ── 토스체 상황 텍스트 ──
  const situationText = `${stk.nm} ${priceKr}원\n${maEmoji} ${maArr} · RSI ${lrsi} (${rsiComment})\n${volComment} · 강도 ${score}/5점`;

  // ── 토스체 행동 가이드 ──
  let actionText='';
  if(pos){
    const pnlPct=((stk.pr-pos.avgPrice)/pos.avgPrice*100).toFixed(2);
    const up=stk.pr>=pos.avgPrice;
    if(so&&stk.pr<=so.stop*1.01){
      actionText=`⚠️ 손절선 근처예요\n지금 ${so.stop.toLocaleString()}원이 손절 기준\n감정 빼고 원칙대로 해요`;
    } else if(so&&!so.t1done&&stk.pr>=so.t1*0.99){
      actionText=`🎯 1차 목표가 왔어요!\n${so.t1.toLocaleString()}원 근처\n절반은 팔고 나머지는 홀딩해요`;
    } else {
      actionText=`${up?'✅':'⚠️'} 보유 중 ${up?'+':''}${pnlPct}%\n${up?'흐름 좋아요. 목표가까지 홀딩':'손절선 다시 확인해요'}`;
    }
  } else {
    if(score>=4){
      actionText=`🟢 지금 괜찮아 보여요 (${score}/5)\n${signals.slice(0,3).join(' · ')}\n진입 전 반드시 손절가 설정하고요`;
    } else if(score>=2){
      actionText=`🟡 아직 기다리는 게 나아요 (${score}/5)\n신호가 좀 더 모여야 해요\n서두르지 마세요`;
    } else {
      actionText=`⚪ 지금은 관망이에요 (${score}/5)\n좋은 종목 다시 찾아봐요`;
    }
  }

  const nowEl=document.getElementById("advNow");
  const actEl=document.getElementById("advAction");
  if(nowEl){
    nowEl.innerHTML=situationText.replace(/\n/g,"<br>");
    nowEl.className="adv-txt";
  }
  if(actEl){
    actEl.innerHTML=actionText.replace(/\n/g,"<br>");
    actEl.className="adv-txt";
  }
  document.getElementById("aiModeBadge").textContent=score>=4?"🟢 진입검토":score>=2?"🟡 관망":"⚪ 대기";

  // 차트 신호 업데이트
  analyzeChartSignals();

  if(autoState.running&&autoState.level>=2)runScreening();
}
function updAdvBoxes(now,action){
  document.getElementById("advNow").textContent=now||"-";
  document.getElementById("advNow").className="adv-txt";
  document.getElementById("advAction").textContent=action||"-";
  document.getElementById("advAction").className="adv-txt";
}

// ═══════════════════════════════
// AI CHAT
// ═══════════════════════════════

// ═══════════════════════════════
// API 사용량 추적
// ═══════════════════════════════
const CLAUDE_IN_PRICE = 3.0 / 1_000_000;   // $3 per 1M input tokens
const CLAUDE_OUT_PRICE = 15.0 / 1_000_000;  // $15 per 1M output tokens

let apiUsage = (()=>{try{return JSON.parse(localStorage.getItem('apiUsage') || JSON.stringify({
  today: {date:'', calls:0, inTokens:0, outTokens:0, cost:0, breakdown:{}},
  total: {calls:0, inTokens:0, outTokens:0, cost:0}
}))}catch(e){return {today:{date:"",calls:0,inTokens:0,outTokens:0,cost:0},total:{calls:0,inTokens:0,outTokens:0,cost:0}};}})();

function ensureToday(){
  const today = new Date().toISOString().slice(0,10);
  if(apiUsage.today.date !== today){
    apiUsage.today = {date:today, calls:0, inTokens:0, outTokens:0, cost:0, breakdown:{}};
    saveUsage();
  }
}
function saveUsage(){localStorage.setItem('apiUsage', JSON.stringify(apiUsage));}

function trackApiCall(feature, inTokens, outTokens){
  ensureToday();
  const cost = inTokens * CLAUDE_IN_PRICE + outTokens * CLAUDE_OUT_PRICE;
  // 오늘
  apiUsage.today.calls++;
  apiUsage.today.inTokens += inTokens;
  apiUsage.today.outTokens += outTokens;
  apiUsage.today.cost += cost;
  if(!apiUsage.today.breakdown[feature]) apiUsage.today.breakdown[feature] = 0;
  apiUsage.today.breakdown[feature]++;
  // 누적
  apiUsage.total.calls++;
  apiUsage.total.inTokens += inTokens;
  apiUsage.total.outTokens += outTokens;
  apiUsage.total.cost += cost;
  saveUsage();
  updateUsageUI();
}

function updateUsageUI(){
  ensureToday();
  const t = apiUsage.today;
  const total = apiUsage.total;
  // 설정창 API 탭
  const f = id => document.getElementById(id);
  if(f('apiCallCount')) f('apiCallCount').textContent = t.calls + '회';
  if(f('apiInTokens')) f('apiInTokens').textContent = t.inTokens.toLocaleString();
  if(f('apiOutTokens')) f('apiOutTokens').textContent = t.outTokens.toLocaleString();
  if(f('apiCost')) f('apiCost').textContent = '$' + t.cost.toFixed(4);
  // 사용량 탭
  if(f('u_calls')) f('u_calls').textContent = t.calls;
  if(f('u_tokens')) f('u_tokens').textContent = (t.inTokens + t.outTokens).toLocaleString();
  if(f('u_cost')) f('u_cost').textContent = '$' + t.cost.toFixed(4);
  if(f('u_total_calls')) f('u_total_calls').textContent = total.calls + '회';
  if(f('u_total_in')) f('u_total_in').textContent = total.inTokens.toLocaleString();
  if(f('u_total_out')) f('u_total_out').textContent = total.outTokens.toLocaleString();
  if(f('u_total_cost')) f('u_total_cost').textContent = '$' + total.cost.toFixed(4);
  // 기능별
  const bd = f('u_breakdown');
  if(bd && t.breakdown){
    bd.innerHTML = Object.entries(t.breakdown).sort((a,b)=>b[1]-a[1]).map(([k,v])=>
      `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--br);">
        <span style="color:var(--ts);">${k}</span>
        <span style="font-family:var(--mono);font-weight:700;">${v}회</span>
      </div>`
    ).join('') || '<span style="color:var(--tm);">호출 없음</span>';
  }
}
function resetUsage(){
  if(!confirm('사용량 통계를 초기화하시겠습니까?')) return;
  apiUsage = {
    today:{date:'',calls:0,inTokens:0,outTokens:0,cost:0,breakdown:{}},
    total:{calls:0,inTokens:0,outTokens:0,cost:0}
  };
  saveUsage(); updateUsageUI();
}

// Claude API 래퍼 — 모든 fetch("/api/claude") 호출을 이것으로 교체
async function callClaude(payload, feature){
  feature = feature || 'AI 기타';
  const res = await fetch("/api/claude", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  // API 키 만료/오류 감지
  if(data.error){ checkApiKeyExpiry(JSON.stringify(data.error)); }
  if(res.status === 401 || res.status === 403){ checkApiKeyExpiry('401 Unauthorized'); }
  const usage = data.usage || {};
  const inTok = usage.input_tokens || estimateTokens(JSON.stringify(payload));
  const outTok = usage.output_tokens || estimateTokens(data.content?.[0]?.text || '');
  trackApiCall(feature, inTok, outTok);
  return data;
}
function estimateTokens(text){
  // 토큰 수 추정 (응답에 usage 없을 때): 영문 4자/토큰, 한글 2자/토큰
  const korean = (text.match(/[가-힣]/g)||[]).length;
  const other = text.length - korean;
  return Math.round(korean / 2 + other / 4);
}

// ═══════════════════════════════
// KIS API 설정 저장/로드
// ═══════════════════════════════
// ── API 설정 (localStorage 영구 저장) ──
const KIS_CFG_KEY = 'traidair_api_config_v2';

// ★ 하드코딩 기본값 — 만료 시 설정창에서 업데이트
// 기본값은 서버 /api/get-config에서 로드 (window.onload에서 수행)
const _DEFAULT_CFG = { appKey:'', appSecret:'', account:'47400138-01', mode:'real', dartKey:'', claudeKey:'' };

function loadKisCfgFromStorage(){
  try {
    const raw = localStorage.getItem(KIS_CFG_KEY) || localStorage.getItem('kisConfig');
    if(raw) {
      const parsed = JSON.parse(raw);
      // 저장된 값이 있으면 우선, 없는 필드는 기본값으로
      return { ..._DEFAULT_CFG, ...parsed };
    }
  } catch(e) {}
  return { ..._DEFAULT_CFG };
}
let kisConfig = loadKisCfgFromStorage();

async function saveKisConfig(){
  const ak = document.getElementById('kis-appkey')?.value?.trim() || '';
  const as = document.getElementById('kis-appsecret')?.value?.trim() || '';
  const ac = document.getElementById('kis-account')?.value?.trim() || '';
  const dk = document.getElementById('dart-key')?.value?.trim() || '';
  const ck = document.getElementById('claude-apikey')?.value?.trim() || '';
  const nt = document.getElementById('notion-token')?.value?.trim() || '';
  const np = document.getElementById('notion-page-id')?.value?.trim() || '';
  const mode = document.getElementById('kis-real')?.checked ? 'real' : 'mock';
  if(mode === 'real' && kisConfig.mode !== 'real'){
    if(!confirm('⚠ 실거래 모드로 전환합니다.\n실제 자금이 사용됩니다.\n계속하시겠습니까?')){
      document.getElementById('kis-mock').checked = true; return;
    }
  }
  kisConfig = { appKey:ak, appSecret:as, account:ac, mode, dartKey:dk, claudeKey:ck };
  // localStorage 저장 (로컬 빠른 복원용)
  const serialized = JSON.stringify(kisConfig);
  localStorage.setItem(KIS_CFG_KEY, serialized);
  localStorage.setItem('kisConfig', serialized);
  // ★ 서버에 영구 저장 (Railway 재배포 후에도 유지)
  try {
    const r = await fetch('/api/save-config', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        claudeKey: ck,
        kisAppKey: ak,
        kisAppSecret: as,
        kisAccount: ac,
        kisMode: mode,
        dartKey: dk,
        notionToken: nt,
        notionPageId: np,
      })
    });
    const d = await r.json();
    if(d.ok){
      updateKisStatus();
      _applyModeToHTS(mode);
      // 노션 토큰 저장됐으면 즉시 강의 동기화 시도
      if(nt){ try{ refreshLecture&&refreshLecture(true); }catch(_e){} }
      showAlert('✅ 저장 완료', '서버에 영구 저장되었습니다.\n재배포 후에도 유지됩니다.');
    } else {
      throw new Error(d.error || '저장 실패');
    }
  } catch(e) {
    // 서버 저장 실패해도 localStorage는 저장됨
    updateKisStatus();
    _applyModeToHTS(mode);
    showAlert('⚠ 부분 저장', `서버 저장 실패: ${e.message}\n브라우저 로컬에는 저장되었습니다.`);
  }
}

// HTS 모드 전환 (실거래 ↔ 모의투자)
function _applyModeToHTS(mode){
  const badge = document.getElementById('modeBadge');
  const text = document.getElementById('modeText');
  const mockBar = document.querySelector('.mock-bar');
  const playBtn = document.getElementById('playBtn');
  const endBtn = document.querySelector('.ibtn.red[onclick*="endMock"]');

  if(mode === 'real'){
    // ── 실거래 모드 ──
    if(badge){ badge.className = 'badge live'; }
    if(text){ text.textContent = '실거래'; }
    // 모의투자 컨트롤 숨김 (날짜/배속/재생 바)
    if(mockBar){ mockBar.style.display = 'none'; }
    // 종료 버튼 텍스트 변경
    if(endBtn){ endBtn.textContent = '모의투자'; endBtn.onclick = ()=>{ _applyModeToHTS('mock'); kisConfig.mode='mock'; localStorage.setItem(KIS_CFG_KEY, JSON.stringify(kisConfig)); }; }
    // 실시간 시세 즉시 갱신 시작
    kisRefreshPrice(activeTk);
    syncKisBalance();
    // 실거래 안내 메시지
    addMsg('ai', `🔴 실거래 모드 전환됨\n계좌: ${kisConfig.account}\n\n• 주문 즉시 실제 체결됩니다\n• 손절가 반드시 설정하세요\n• 잔고/보유종목 자동 동기화됩니다`);
    // 잔고 동기화 후 차트 갱신
    setTimeout(()=>{ kisRefreshPrice(activeTk); drawChart(); }, 1000);
  } else {
    // ── 모의투자 모드 ──
    if(badge){ badge.className = 'badge mock'; }
    if(text){ text.textContent = '모의투자'; }
    if(mockBar){ mockBar.style.display = ''; }
    if(endBtn){ endBtn.textContent = '■ 종료'; endBtn.onclick = endMock; }
  }
  closeModal('settings');
}

async function loadKisConfig(){
  // 1) 서버에서 저장된 설정 먼저 로드
  try {
    const r = await fetch('/api/get-config');
    const d = await r.json();
    if(d.ok && (d.kisAppKey || d.claudeKeyFull)) {
      kisConfig = {
        appKey: d.kisAppKey || kisConfig.appKey || '',
        appSecret: d.kisAppSecret || kisConfig.appSecret || '',
        account: d.kisAccount || kisConfig.account || '',
        mode: d.kisMode || kisConfig.mode || 'mock',
        dartKey: d.dartKey || kisConfig.dartKey || '',
        claudeKey: d.claudeKeyFull || kisConfig.claudeKey || '',
      };
      // localStorage도 동기화
      localStorage.setItem(KIS_CFG_KEY, JSON.stringify(kisConfig));
    }
  } catch(e) {}
  // 2) UI에 반영
  const ki=document.getElementById('kis-appkey');
  const ks=document.getElementById('kis-appsecret');
  const ka=document.getElementById('kis-account');
  const kd=document.getElementById('dart-key');
  const kc=document.getElementById('claude-apikey');
  if(ki && kisConfig.appKey) ki.value=kisConfig.appKey;
  if(ks && kisConfig.appSecret) ks.value=kisConfig.appSecret;
  if(ka && kisConfig.account) ka.value=kisConfig.account;
  if(kd && kisConfig.dartKey) kd.value=kisConfig.dartKey;
  if(kc && kisConfig.claudeKey) kc.value=kisConfig.claudeKey;
  // 노션 토큰/페이지 ID 입력란 채우기 + 상태 표시
  try{
    const r2 = await fetch('/api/get-config');
    const d2 = await r2.json();
    const nti=document.getElementById('notion-token');
    const npi=document.getElementById('notion-page-id');
    const ns=document.getElementById('notion-status');
    if(nti && d2.notionTokenSet) nti.placeholder = '✓ 설정됨 ('+(d2.notionToken||'****')+')';
    if(npi && d2.notionPageId) npi.value = d2.notionPageId;
    if(ns) ns.textContent = d2.notionTokenSet ? '✅ Notion — 토큰 설정됨' : '⬜ Notion — 미설정';
  }catch(_e){}
  if(kisConfig.mode==='real'){const kr=document.getElementById('kis-real');if(kr)kr.checked=true;}
  updateKisStatus();
}
function updateKisStatus(){
  const ks = document.getElementById('kis-status');
  const ds = document.getElementById('dart-status');
  if(ks){
    if(kisConfig.appKey && kisConfig.account){
      ks.textContent = `✅ KIS — ${kisConfig.mode === 'real' ? '실거래' : '모의투자'} (${kisConfig.account})`;
      ks.style.color = kisConfig.mode === 'real' ? 'var(--r)' : 'var(--g)';
    } else {
      ks.textContent = '⬜ KIS — 미설정';
      ks.style.color = 'var(--tm)';
    }
  }
  if(ds){
    if(kisConfig.dartKey){
      ds.textContent = '✅ DART — 연결됨';
      ds.style.color = 'var(--g)';
    } else {
      ds.textContent = '⬜ DART — 미설정';
      ds.style.color = 'var(--tm)';
    }
  }
}

// ═══════════════════════════════
// KIS API 실제 연동
// ═══════════════════════════════

// KIS API 호출 공통 헬퍼 (server.js 프록시 경유)
async function kisCall(endpoint, payload) {
  // KIS API 직접 호출 (브라우저→KIS) — Railway 서버 프록시 우회
  const mode = kisConfig.mode || 'mock';
  const host = mode === 'real'
    ? 'https://openapi.koreainvestment.com:9443'
    : 'https://openapivts.koreainvestment.com:29443';

  if (endpoint === 'token') {
    // 토큰 발급
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(`${host}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: kisConfig.appKey, appsecret: kisConfig.appSecret }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const d = await res.json();
      if (d.access_token) {
        kisConfig._token = d.access_token;
        kisConfig._tokenExp = Date.now() + 29 * 60 * 1000;
        return { ok: true, token: d.access_token.slice(0, 10) + '...' };
      }
      return { ok: false, error: d.message || '토큰 발급 실패' };
    } catch(e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        // 직접 호출 실패 → 서버 프록시 폴백
        return _kisCallProxy(endpoint, payload);
      }
      return _kisCallProxy(endpoint, payload);
    }
  }
  // token 외 나머지는 서버 프록시 사용
  return _kisCallProxy(endpoint, payload);
}

async function _kisCallProxy(endpoint, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('/api/kis/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, appKey: kisConfig.appKey, appSecret: kisConfig.appSecret, mode: kisConfig.mode, account: kisConfig.account }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.json();
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('연결 시간 초과 (10초)');
    throw e;
  }
}

// KIS 연결 테스트 (토큰 발급 확인)
async function kisConnect() {
  const ks = document.getElementById('kis-status');
  if (!kisConfig.appKey || !kisConfig.appSecret) {
    showAlert('KIS 연결 실패', 'App Key와 App Secret을 먼저 저장하세요.');
    return;
  }
  if (ks) { ks.textContent = '⏳ KIS — 연결 중...'; ks.style.color = 'var(--a)'; }
  try {
    const result = await kisCall('token', {});
    if (result.ok) {
      if (ks) { ks.textContent = `✅ KIS — ${kisConfig.mode === 'real' ? '실거래' : '모의투자'} 연결됨`; ks.style.color = 'var(--g)'; }
      showAlert('KIS 연결 성공', `${kisConfig.mode === 'real' ? '실거래' : '모의투자'} 서버에 연결되었습니다.\n\n이제 실제 시세와 주문이 동작합니다.`);
      // 연결 후 잔고 동기화
      if (kisConfig.account) syncKisBalance();
    } else {
      throw new Error(result.error || '연결 실패');
    }
  } catch(e) {
    if (ks) { ks.textContent = '❌ KIS — 연결 실패'; ks.style.color = 'var(--r)'; }
    showAlert('KIS 연결 실패', e.message + '\n\nApp Key/Secret과 모의투자 신청 여부를 확인하세요.');
  }
}

// KIS 현재가 조회 및 HTS 가격 업데이트
async function kisRefreshPrice(code) {
  if (!kisConfig.appKey) return null;
  try {
    const result = await kisCall('price', { code });
    if (result.ok && result.price > 0) {
      // STOCKS 배열 업데이트
      const stk = STOCKS.find(s => s.tk === code);
      if (stk) {
        stk.pr = result.price;
        stk.nm = result.name || stk.nm;
      }
      if (code === activeTk) updPrice({ c: result.price });
      return result;
    }
  } catch(e) { /* 조용히 실패 */ }
  return null;
}

// KIS 잔고 조회 및 mock 동기화
async function syncKisBalance() {
  if (!kisConfig.appKey || !kisConfig.account) return;
  try {
    const result = await kisCall('balance', {});
    if (!result.ok) return;
    // 예수금 동기화
    if (result.cash > 0) {
      mock.cash = result.cash;
    }
    // 보유 종목 동기화 (실제 계좌 기준으로 덮어씌움)
    if (result.positions && result.positions.length > 0) {
      mock.positions = {};
      result.positions.forEach(p => {
        if (p.qty > 0) {
          mock.positions[p.code] = {
            qty: p.qty,
            avgPrice: p.avgPrice,
            creditType: 'cash',
            creditAmt: 0,
          };
          // STOCKS에 없으면 추가
          if (!STOCKS.find(s => s.tk === p.code)) {
            STOCKS.push({ tk: p.code, nm: p.name, pr: p.currentPrice, base: p.avgPrice });
          } else {
            const s = STOCKS.find(s => s.tk === p.code);
            if (s) s.pr = p.currentPrice;
          }
        }
      });
    }
    saveMock(); renderPort(); updCash(); updPnl();
    addMsg('ai', `📊 KIS 잔고 동기화 완료\n예수금: ${result.cash.toLocaleString()}원 | 총평가: ${result.totalEval.toLocaleString()}원`);
  } catch(e) { /* 조용히 실패 */ }
}

// KIS 실제 주문 전송
async function sendKisOrder(side, code, qty, price, orderType) {
  if (!kisConfig.appKey || !kisConfig.account) return { ok: false, error: 'KIS 미설정' };
  return kisCall('order', { side, code, qty, price, orderType });
}

// 설정창에 KIS 연결 버튼 동작
function kisConnectBtn() {
  // input 필드에 값이 있으면 자동으로 kisConfig에 반영 (저장 버튼 없이도 동작)
  const ak = document.getElementById('kis-appkey')?.value?.trim() || '';
  const as = document.getElementById('kis-appsecret')?.value?.trim() || '';
  const ac = document.getElementById('kis-account')?.value?.trim() || '';
  if(ak) kisConfig.appKey = ak;
  if(as) kisConfig.appSecret = as;
  if(ac) kisConfig.account = ac;
  kisConnect();
}

// 설정 탭 전환
function sTab(el, id){
  document.querySelectorAll('.stab').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
  document.querySelectorAll('.stb').forEach(b=>b.classList.remove('on'));
  document.getElementById(id).classList.add('on');
  if(id==='st-api') loadKisConfig();
  if(id==='st-usage') updateUsageUI();
}

function buildSys(){
  const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const cs=getCandles(30);
  const cls=cs.map(c=>c.c), vls=cs.map(c=>c.v);
  const lc=cs[cs.length-1]||{o:0,h:0,l:0,c:stk.pr,v:0};
  const pc=cs[cs.length-2]||lc;

  // ── 기술적 지표 계산 ──
  const rsi=(calcRSI(cls,14).slice(-1)[0]||50).toFixed(1);
  const ma5=(calcMA(cls,5).slice(-1)[0]||0).toFixed(0);
  const ma20=(calcMA(cls,20).slice(-1)[0]||0).toFixed(0);
  const ma60=(calcMA(cls,60).slice(-1)[0]||0).toFixed(0);
  const volR=vls.length>=2?(vls[vls.length-1]/vls[vls.length-2]).toFixed(1):"1.0";
  const maArr=parseFloat(ma5)>parseFloat(ma20)&&parseFloat(ma20)>parseFloat(ma60)?"정배열(상승)":
              parseFloat(ma5)<parseFloat(ma20)&&parseFloat(ma20)<parseFloat(ma60)?"역배열(하락)":"혼합";
  const chgPct=((lc.c-lc.o)/lc.o*100).toFixed(2);
  const body=Math.abs(lc.c-lc.o), total=(lc.h-lc.l)||1;
  const lowerWick=(Math.min(lc.o,lc.c)-lc.l), upperWick=(lc.h-Math.max(lc.o,lc.c));
  const candleShape=lc.c>lc.o?
    (body/total>0.6?"강한 양봉":lowerWick>body*2?"망치형":upperWick>body*2?"유성형":"양봉"):
    (body/total>0.6?"강한 음봉":lowerWick>body*2?"역망치형":"음봉");
  const isHH=lc.h>pc.h, isHL=lc.l>pc.l;
  const trendStr=isHH&&isHL?"HH-HL(상승추세)":!isHH&&!isHL?"LH-LL(하락추세)":"혼조";

  // ── 수급 데이터 ──
  const pos=mock.positions[activeTk];
  const so=stopOrders[activeTk];
  const pnlPct=pos?((stk.pr-pos.avgPrice)/pos.avgPrice*100).toFixed(2):null;
  const lossSeries=mock.lossSeries||0;
  const todayPnlPct=(mock.todayPnl/(cfg.capital||10000000)*100).toFixed(2);
  const lossLimit=cfg.dayloss||2;
  const lossUsed=(-parseFloat(todayPnlPct)).toFixed(2);
  const vwapCs=getCandles(50);
  const vwap=vwapCs.length>0?(vwapCs.reduce((a,c)=>a+(c.h+c.l+c.c)/3*c.v,0)/vwapCs.reduce((a,c)=>a+c.v,1)||lc.c).toFixed(0):lc.c;
  const aboveVwap=lc.c>parseFloat(vwap);

  // ── STEP 0: 심리 상태 (Phase 8-2) ──
  const trustScore=typeof window!=='undefined'&&window.trustScore!=null?window.trustScore:7;
  const psyOk=trustScore>=5&&lossSeries<3;
  const psyWarn=trustScore<5?"심리점수 낮음":lossSeries>=3?"연속손절 "+lossSeries+"회 → 뇌동매매 위험":"양호";

  // ── STEP 1: 시장 환경 (Phase 8-3) ──
  const idxKospi=document.getElementById('idx-kospi')?.textContent||'--';
  const idxKosdq=document.getElementById('idx-kosdq')?.textContent||'--';
  const idxPred=document.getElementById('idx-pred')?.textContent||'--';

  // ── STEP 4: 차트 (Phase 8-6) ──
  const chartSTEP4=`MA배열:${maArr} | 추세:${trendStr} | RSI:${rsi}(${parseFloat(rsi)>=70?"⚠과매수":parseFloat(rsi)<=30?"⚠과매도":"정상"}) | VWAP${aboveVwap?"위(긍정)":"아래(부정)"}`;

  // ── STEP 5: 수급 (Phase 8-7) ──
  const supplySTEP5=`거래량×${volR}(${parseFloat(volR)>=1.5?"수급강":"미약"}) | 캔들:${candleShape} | 등락:${chgPct}%`;

  // ── STEP 6: R/R (Phase 8-8) ──
  const entrySug=lc.c;
  const stopSug=Math.round(lc.c*0.97);
  const tgt1Sug=Math.round(lc.c*1.06);
  const rr=((tgt1Sug-entrySug)/(entrySug-stopSug)).toFixed(1);
  const commission=0.00015,tax=0.0018;
  const netProfit=Math.round((tgt1Sug-entrySug)*100-(tgt1Sug*100*(commission+tax))-(entrySug*100*commission));
  const netLoss=Math.round((entrySug-stopSug)*100+(entrySug*100*commission)+(stopSug*100*(commission+tax)));
  const realRR=(netProfit/netLoss).toFixed(2);

  // ── 보유 포지션 청산 전략 (Phase 9) ──
  let exitCtx="";
  if(pos&&pos.qty>0){
    const p=parseFloat(pnlPct);
    const t1ok=so&&lc.c>=so.t1;
    exitCtx=`\n[Phase 9 청산전략] 보유${pos.qty}주 평단${Math.round(pos.avgPrice).toLocaleString()}원 (${p>=0?"+":""}${pnlPct}%)
손절선:${so?so.stop.toLocaleString()+"원":"미설정⚠"} | 1차목표:${so?so.t1.toLocaleString()+"원":"미설정"}
${p>=3?"1차 익절(50%) 검토 → 즉시 손절선 본전화":p<=-3?"손절선 근접 → 즉각 대응 준비":p>=1?"홀딩 유지 → 트레일링 스탑 점검":"보유 중 관찰"}
${t1ok?"⚡ 1차 목표 도달 → 50% 익절 실행 권고":""}`;
  }

  return `당신은 20년 경력 단타 트레이딩 멘토이자 AI 파트너입니다.
모든 판단은 아래 Phase 0~12 강의 체크 절차를 반드시 순서대로 확인한 뒤 내립니다.

═══ Phase 8 매수 전 통합 점검 (현재 데이터 기반 자동 체크) ═══

[STEP 0 | Phase 8-2 | 심리상태] ${psyOk?"✅":"🚨"} ${psyWarn} | 신뢰도점수:${trustScore}/10 | 연속손절:${lossSeries}회
→ ${psyOk?"매매 가능":"진입 금지 상태 — 먼저 심리 리셋 필요"}

[STEP 1 | Phase 8-3 | 시장환경] KOSPI:${idxKospi} | KOSDAQ:${idxKosdq} | 단기전망:${idxPred}
→ 비우호적 시(선물-1.5%이하/VIX30이상): 비중 50%↓ 제한

[STEP 2 | Phase 8-4 | 섹터] ${stk.sec||"미분류"} 섹터 | 오늘 강세 섹터 확인 필요
→ 섹터 역방향 진입은 위험 증가

[STEP 3 | Phase 8-5 | 종목스크리닝] ${stk.nm}(${activeTk}) ${stk.sec||""} ${stk.cap||""}
→ 시총/거래대금/투자경고/재료 유무 체크 완료 기준 판단

[STEP 4 | Phase 8-6 | 차트] ${chartSTEP4}
→ 일봉-60분봉-5분봉 3단계 타임프레임 일치 여부 판단

[STEP 5 | Phase 8-7 | 수급] ${supplySTEP5}
→ 기관/외국인 수급 + VWAP 위치 + 체결강도 종합

[STEP 6 | Phase 8-8 | R/R] 기준타점: 진입${entrySug.toLocaleString()} / 손절${stopSug.toLocaleString()}(-3%) / 목표${tgt1Sug.toLocaleString()}(+6%)
→ 수수료/세금 포함 실질R/R: ${realRR} (기준 1.5 이상 권장)

[STEP 7 | Phase 8-9 | GO/NOGO 기준]
GO: 8항목 중 6개 이상 충족 시 / NOGO: 연속3회손절·일손실한도80%초과·R/R<1.0·손절미확정·FOMO 중 1개라도 해당 시 즉시 금지
현재 일손실: ${lossUsed}% / 한도: ${lossLimit}% (${parseFloat(lossUsed)>=lossLimit*0.8?"⚠한도 80% 초과":parseFloat(lossUsed)>=lossLimit*0.5?"주의":"정상"})
${exitCtx}

═══ Phase 9 청산 원칙 ═══
- 손절: 시장가 즉시 실행, 진입 즉시 예약주문 필수
- 익절: 1차(+3%·50%) → 즉시 손절선 본전화 → 2차(+5%·30%) → 3차(잔여)
- 트레일링: 고점-3% or 5MA 이탈 시 자동청산
- 오버나잇: 수급3일지속+재료유효+비중50%이하 모두 충족 시만 허용

═══ 응답 원칙 ═══
1. 위 Phase 체크 데이터를 먼저 검토한 뒤 판단
2. 결론 → 근거(Phase번호 포함) → 구체적 수치
3. 뇌동매매 신호(빨리들어가야/느낌으로/본전만오면) 감지 시 즉시 경고 먼저
4. 추측은 "(추정)"으로 표시, 확인불가는 "확인불가"
5. 한국어, 간결하게`;
}
// 뇌동매매 키워드 패턴 (지침 기반)
const BRAIN_DONG_PATTERNS = [
  /빨리\s*들어가야/, /다들\s*사고\s*있/, /오를?\s*것?\s*같/,
  /본전만/, /조금만\s*더\s*기다리/, /물타/, /추가\s*매수/,
  /손절\s*못하/, /손절\s*기준\s*낮추/, /손절\s*안\s*하/,
  /느낌/, /감/i
];
function _detectBrainDongInChat(text){
  if(!text) return null;
  for(const p of BRAIN_DONG_PATTERNS){
    if(p.test(text)) return text.match(p)[0];
  }
  return null;
}

async function sendChat(txt){
  if(chatBusy)return;
  const inp=document.getElementById("aiIn");
  const msg=txt||inp.value.trim();if(!msg)return;
  inp.value="";autoResize(inp);
  addMsg("me",msg);chatHist.push({role:"user",content:msg});
  // 뇌동매매 키워드 감지 시 경고 메시지 먼저
  const _bdHit = _detectBrainDongInChat(msg);
  if(_bdHit){
    const warn = `🚨 뇌동매매 경고\n━━━━━━━━━━━━━━━━━━━━\n감지된 신호: "${_bdHit}"\n지금 상태: 감정적 판단 가능성\n\n멘토 판단:\n이 문장이 분석 요청이 아니라 본인 결정 후 동의 구하기로 보인다. 그건 매매 사고의 첫 신호다.\n\n지금 해야 할 것:\n1. 즉시 매매 중단\n2. 차트 끄고 5분 휴식\n3. 다시 본다면 "왜 이 가격에 사야 하는가"를 수치로 작성\n━━━━━━━━━━━━━━━━━━━━\n계속 진행하려면 "본인 판단으로 진행합니다"라고 입력하세요.`;
    addMsg('ai', warn);
    chatHist.push({role:'assistant', content: warn});
    chatBusy=false;
    return;
  }
  appendTyping();chatBusy=true;document.getElementById("sendBtn").disabled=true;
  try{
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:500,system:buildSys(),messages:chatHist.slice(-10)})});
    const data=await res.json();removeTyping();
    const rep=data.content?.[0]?.text||"응답 오류";
    chatHist.push({role:"assistant",content:rep});addMsg("ai",rep);
  }catch(e){removeTyping();addMsg("ai","⚠ API 오류. /api/claude 서버 확인 필요");}
  chatBusy=false;document.getElementById("sendBtn").disabled=false;
}
function qa(t){
  // BUG13 FIX: brp 패널의 마지막 탭 직접 지정
  const aiTab=document.querySelector(".brp-tabs .brpt:last-child");
  if(aiTab)brTab(aiTab,"brpb-ai");
  sendChat(t);
}
function addMsg(role,content){
  const m=document.getElementById("aiMsgs");
  const tm=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
  const h=content.replace(/\n/g,"<br>")
    .replace(/(\+[\d.]+%)/g,"<span class='adv-tag bull'>$1</span>")
    .replace(/(-[\d.]+%)/g,"<span class='adv-tag bear'>$1</span>")
    .replace(/(손절|경고|⚠|🚨)/g,"<span class='adv-tag warn'>$1</span>")
    .replace(/(Phase \d+[-\d]*)/g,"<span class='adv-tag pha'>$1</span>");
  const d=document.createElement("div");d.className="ai-msg"+(role==="me"?" me":"");
  d.innerHTML=`<div class="ai-av ${role==="ai"?"ai":"me"}">${role==="ai"?"AI":"나"}</div><div><div class="ai-bub">${h}</div><div class="ai-meta">${role==="ai"?"Claude · ":"나 · "}${tm}</div></div>`;
  m&&m.appendChild(d);if(m)m.scrollTop=m.scrollHeight;
  // 영구 저장 (최근 100개)
  if(!window._chatMsgs) window._chatMsgs=[];
  window._chatMsgs.push({role,content,tm});
  if(window._chatMsgs.length>100) window._chatMsgs.shift();
  try{saveToServer('htsChatMsgs', JSON.stringify(window._chatMsgs));}catch(e){}
}
function appendTyping(){const m=document.getElementById("aiMsgs");const d=document.createElement("div");d.className="ai-msg";d.id="typi";d.innerHTML=`<div class="ai-av ai">AI</div><div class="ai-bub"><div class="tyd-wrap"><div class="tyd"></div><div class="tyd"></div><div class="tyd"></div></div></div>`;m.appendChild(d);m.scrollTop=m.scrollHeight;}
function removeTyping(){const t=document.getElementById("typi");if(t)t.remove();}
function handleKey(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat();}}
// Phase 3-4: 단축키 F1~F8
document.addEventListener("keydown",function(e){
  if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT")return;
  const pos=mock.positions[activeTk];
  switch(e.key){
    case"F1":e.preventDefault();setOSide("buy");setOType(document.getElementById("ott-limit"),"limit");brTab(document.querySelector(".brp-tabs .brpt"),"brpb-order");break; // 지정가 매수
    case"F2":e.preventDefault();setOSide("buy");setOType(document.getElementById("ott-market"),"market");brTab(document.querySelector(".brp-tabs .brpt"),"brpb-order");submitOrder(false);break; // 시장가 매수
    case"F3":e.preventDefault();setOSide("sell");setOType(document.getElementById("ott-limit"),"limit");brTab(document.querySelector(".brp-tabs .brpt"),"brpb-order");break; // 지정가 매도
    case"F4":e.preventDefault(); // 시장가 매도(손절)
      if(pos&&pos.qty>0)quickSell(100);break;
    case"F6":e.preventDefault(); // 전량 지정가 매도
      if(pos&&pos.qty>0){setOSide("sell");setOType(document.getElementById("ott-limit"),"limit");setPct(100);brTab(document.querySelector(".brp-tabs .brpt"),"brpb-order");}break;
    case"F7":e.preventDefault(); // 전량 시장가 매도
      if(pos&&pos.qty>0)quickSell(100);break;
    case"F8":e.preventDefault(); // 반량 시장가 매도
      if(pos&&pos.qty>0)quickSell(50);break;
  }
});
function autoResize(el){el.style.height="auto";el.style.height=Math.min(el.scrollHeight,80)+"px";}

// ═══════════════════════════════
// PORTFOLIO
// ═══════════════════════════════
function updCash(){
  // 오늘 손익 표시
  const tpEl = document.getElementById('todayPnlDisp');
  if(tpEl){
    const tp = mock.todayPnl||0;
    tpEl.textContent = (tp>=0?'+':'')+Math.round(tp).toLocaleString()+'원';
    tpEl.style.color = tp>0?'var(--g)':tp<0?'var(--r)':'var(--tm)';
  }
  // cashVal도 갱신
  const cv = document.getElementById('cashVal');
  if(cv && mock.cash !== undefined) cv.textContent = Math.round(mock.cash).toLocaleString()+'원';
document.getElementById("cashVal").textContent=mock.cash.toLocaleString()+"원";}
function switchToSell(){
  // 보유 종목 클릭 시 주문탭 + 매도 자동 선택
  const orderTab=document.querySelector(".brp-tabs .brpt:first-child");
  if(orderTab)brTab(orderTab,"brpb-order");
  setOSide("sell");
}
function addAlert(){
  const pr=parseFloat(document.getElementById("alPr").value);
  const dir=document.getElementById("alDir").value;
  const memo=document.getElementById("alMemo").value;
  if(!pr){showAlert("알림 오류","가격을 입력하세요.");return;}
  priceAlerts.push({tk:activeTk,price:pr,dir,memo,fired:false});
  document.getElementById("alPr").value="";document.getElementById("alMemo").value="";
  renderAlerts();
  showAlert("알림 설정","가격 알림이 설정되었습니다.\n"+
    `${STOCKS.find(s=>s.tk===activeTk)?.nm||activeTk} ${pr.toLocaleString()}원 ${dir==="above"?"이상":"이하"} 도달 시 알림`);
}
function renderAlerts(){
  const el=document.getElementById("alertList");if(!el)return;
  if(!priceAlerts.length){el.textContent="알림 없음";return;}
  el.innerHTML=priceAlerts.filter(a=>!a.fired).map((a,i)=>{
    const stk=STOCKS.find(s=>s.tk===a.tk)||{nm:a.tk};
    return`<div style="display:flex;align-items:center;gap:4px;padding:2px 0;border-bottom:1px solid var(--br);">
      <span style="flex:1;">${stk.nm} ${a.price.toLocaleString()} ${a.dir==="above"?"↑":"↓"} ${a.memo||""}</span>
      <button onclick="priceAlerts.splice(${i},1);renderAlerts()" style="background:none;border:none;color:var(--r);cursor:pointer;font-size:11px;">×</button>
    </div>`;
  }).join("");
}
function renderPort(){
  const c=document.getElementById("portItems"),keys=Object.keys(mock.positions);
  if(!keys.length){c.innerHTML="<div style='font-size:9px;color:var(--tm);text-align:center;padding:12px 0;'>보유 종목 없음</div>";return;}
  c.innerHTML=keys.map(tk=>{
    const pos=mock.positions[tk],stk=STOCKS.find(s=>s.tk===tk)||{nm:tk,pr:0};
    const pnl=(stk.pr-pos.avgPrice)*pos.qty,pct=((stk.pr-pos.avgPrice)/pos.avgPrice*100).toFixed(2),up=pnl>=0;
    const so=stopOrders[tk];
    const bgs=(pos.creditType&&pos.creditType!=="cash"?`<span class="pi-b cred">${pos.creditType==="credit"?"신용":"미수"}</span>`:"")+(so?`<span class="pi-b stop">손절${so.stop.toLocaleString()}</span>`:"")+(so&&!so.t1done?`<span class="pi-b tgt">목표${so.t1.toLocaleString()}</span>`:"")+(so?.trail!=="off"?`<span class="pi-b trail">트레일</span>`:"")+(pos.auto?`<span class="pi-b ai">AI</span>`:"");
    return `<div class="pi" onclick="selectStk('${tk}');switchToSell()"><div class="pi-h"><span class="pi-tk">${stk.nm}</span><span class="pi-pnl ${up?"cu":"cd"}">${up?"+":""}${Math.round(pnl).toLocaleString()}원</span></div><div class="pi-s"><span>${pos.qty.toLocaleString()}주 평단${Math.round(pos.avgPrice).toLocaleString()}</span><span class="${up?"cu":"cd"}">${up?"+":""}${pct}%</span></div>${bgs?`<div style="margin-top:2px;display:flex;gap:2px;flex-wrap:wrap;">${bgs}</div>`:""}</div>`;
  }).join("");
}
function renderTradeLog(){
  const c=document.getElementById("tradeLog"),rec=[...mock.trades].reverse().slice(0,40);
  if(!rec.length){c.innerHTML="<div style='font-size:9px;color:var(--tm);text-align:center;padding:12px;'>거래 없음</div>";return;}
  c.innerHTML=rec.map(t=>`<div class="tl-i"><div class="tl-side ${t.side}">${t.side==="buy"?"매수":"매도"}</div><div class="tl-info">${t.nm}${t.auto?"<span style='color:var(--p);font-size:8px;'>[AI]</span>":""}<br>${t.price.toLocaleString()}×${t.qty}</div>${t.side==="sell"?`<div class="tl-pnl ${t.pnl>=0?"cu":"cd"}">${t.pnl>=0?"+":""}${t.pnl.toLocaleString()}원</div>`:""}</div>`).join("");
}

// ═══════════════════════════════
// WATCHLIST / LEFT
// ═══════════════════════════════

// 다중 선택된 필터 인덱스
let selectedFilters=new Set();

function renderFilters(){
  const cats=['수급','차트','재료'];
  const el=document.getElementById("filterList");
  if(!el)return;
  el.innerHTML=cats.map(cat=>{
    const items=FILTERS.map((f,i)=>({...f,i})).filter(f=>f.cat===cat);
    return`<div style="margin-bottom:6px;">
      <div style="font-size:8px;font-weight:700;color:var(--tm);margin-bottom:3px;padding:0 2px;">${cat}</div>
      ${items.map(f=>`<div class="fi ${selectedFilters.has(f.i)?'on':''}" onclick="toggleFil(${f.i},this)" style="margin-bottom:2px;">
        <div class="fi-d" style="background:${f.col}"></div>
        <span class="fi-t">${f.nm}</span>
      </div>`).join('')}
    </div>`;
  }).join('');
}

function toggleFil(i, el){
  if(selectedFilters.has(i)) selectedFilters.delete(i);
  else selectedFilters.add(i);
  el.classList.toggle('on');
  applySelectedFilters();
}

function applySelectedFilters(){
  const resultEl=document.getElementById("filterResult");
  if(!resultEl)return;
  if(selectedFilters.size===0){
    resultEl.innerHTML="<div style='font-size:9px;color:var(--tm);'>조건을 선택하세요 (여러 개 선택 시 교집합)</div>";
    return;
  }
  // 교집합: 선택된 모든 필터에 포함된 종목만
  const sets=Array.from(selectedFilters).map(i=>new Set(FILTERS[i].stocks));
  let intersection=[...sets[0]];
  for(let j=1;j<sets.length;j++) intersection=intersection.filter(tk=>sets[j].has(tk));

  if(intersection.length===0){
    resultEl.innerHTML="<div style='font-size:9px;color:var(--r);padding:4px;'>교집합 없음 — 조건 조합을 바꿔보세요</div>";
    return;
  }
  resultEl.innerHTML=intersection.map(tk=>{
    const s=STOCKS.find(s=>s.tk===tk)||{tk,nm:tk,pr:0,base:1};
    const c=((s.pr-s.base)/s.base*100).toFixed(2),up=parseFloat(c)>=0;
    const filNames=Array.from(selectedFilters).map(i=>FILTERS[i].nm).join(' ∩ ');
    return`<div class="wli" onclick="selectStk('${tk}');addCandFromFilter('${tk}','${filNames.slice(0,20)}')" style="cursor:pointer;">
      <div class="wl-tk">${tk.slice(-4)}</div>
      <div style="flex:2"><div class="wl-nm">${s.nm}</div><div style="font-size:7px;color:var(--tm);">+후보추가</div></div>
      <div class="wl-ch ${up?"cu":"cd"}">${up?"+":""}${c}%</div>
    </div>`;
  }).join("");
}

// 기존 applyFil 호환
function applyFil(i,el){ toggleFil(i,el); }
function renderNews(){
  const grades=["A","B","A","A","S"]; // 뉴스별 재료 강도 (실제로는 AI 분석)
  document.getElementById("newsList").innerHTML=NEWS.map((n,i)=>{
    const g=grades[i]||"B";
    const gc={"S":"var(--p)","A":"var(--b)","B":"var(--a)","C":"var(--r)"}[g]||"var(--ts)";
    return`<div style="padding:5px 9px;border-bottom:1px solid var(--br);cursor:pointer;" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
      <div style="font-size:10px;line-height:1.4;margin-bottom:2px;">${n.ttl}</div>
      <div style="display:flex;gap:5px;align-items:center;">
        <span style="font-size:8px;color:var(--tm);font-family:var(--mono);">${n.tm}</span>
        <span style="font-size:8px;padding:1px 4px;border-radius:2px;background:rgba(0,0,0,.04);color:${n.col};">${n.cat}</span>
        <span style="font-size:8px;padding:1px 4px;border-radius:2px;font-family:var(--mono);font-weight:700;background:rgba(0,0,0,.04);color:${gc};">${g}급</span>
      </div>
    </div>`;
  }).join("");
}
function selectStk(tk){activeTk=tk;const s=STOCKS.find(s=>s.tk===tk)||STOCKS[0];document.getElementById("siNm").textContent=s.nm;
  try{saveToServer('htsSimState', JSON.stringify({date:sim.date, tf:sim.tf, activeTk}));}catch(e){}
  const tkEl=document.getElementById("obTkName");if(tkEl)tkEl.textContent=s.nm;document.getElementById("srchIn").value="";hideSrch();renderWL();genCandles(tk,sim.date);initChart();renderOB();renderTH();
  const atk=document.getElementById("analysisTk");if(atk)atk.textContent=s.nm;
  // 차트 상단 큰 종목명 갱신
  updChartHeader();
  setTimeout(()=>{updateAIAdvisor();runFullAnalysis();fetchDartNews();},400);
  _syncIdxWithSim();}
// AI 자동매매가 호출하는 종목 전환 — selectStk 위임 (실시간 차트/호가/AI 패널 모두 전환)
function setActiveTk(tk){
  if(!tk||tk===activeTk) return;
  selectStk(tk);
  try{addDecisionLog&&addDecisionLog('🔄 종목 자동 전환',(STOCKS.find(s=>s.tk===tk)||{nm:tk}).nm+' ('+tk+')','자동매매');}catch(e){}
}
// 차트 헤더 종목 정보 갱신 (큰 종목명 / 가격 / 등락 / 실시간 잔고)
function updChartHeader(){
  const s=STOCKS.find(s=>s.tk===activeTk);
  if(s){
    const chgPct=((s.pr-s.base)/s.base*100);
    const up=chgPct>=0;
    const ne=document.getElementById('chartHdrNm');if(ne) ne.textContent=s.nm;
    const te=document.getElementById('chartHdrTk');if(te) te.textContent=s.tk;
    const pe=document.getElementById('chartHdrPr');if(pe) pe.textContent=(s.pr||0).toLocaleString();
    const ce=document.getElementById('chartHdrCh');
    if(ce){ ce.textContent=(up?'+':'')+chgPct.toFixed(2)+'%'; ce.style.color=up?'var(--r)':'var(--b)'; }
  }
  // 실시간 잔고 / 평가 / 손익
  try{
    let eval = 0;
    Object.entries(mock.positions||{}).forEach(([tk,p])=>{
      if(!p||p.qty<=0) return;
      const stk = STOCKS.find(x=>x.tk===tk);
      const pr = (stk&&stk.pr) || p.avg || 0;
      eval += pr * p.qty;
    });
    const totalPnl = (mock.todayPnl||0);
    const he = document.getElementById('hdrCash'); if(he) he.textContent = Math.round(mock.cash||0).toLocaleString()+'원';
    const ev = document.getElementById('hdrEval'); if(ev) ev.textContent = Math.round(eval).toLocaleString()+'원';
    const pn = document.getElementById('hdrPnl');
    if(pn){
      pn.textContent = (totalPnl>=0?'+':'')+Math.round(totalPnl).toLocaleString()+'원';
      pn.style.color = totalPnl>=0 ? 'var(--g)' : 'var(--r)';
    }
  }catch(e){}
}

// ═══════════════════════════════
// SEARCH
// ═══════════════════════════════
function onSearch(q){
  if(!q){hideSrch();return;}
  const res=STOCKS.filter(s=>s.nm.includes(q)||s.tk.includes(q)||(s.sec&&s.sec.includes(q))).slice(0,8);
  if(!res.length){hideSrch();return;}
  const el=document.getElementById("srchDrop");el.style.display="block";
  el.innerHTML=res.map(s=>{
    const c=((s.pr-s.base)/s.base*100).toFixed(2),up=c>=0;
    const capCol=s.cap==="대형"?"var(--b)":s.cap==="중형"?"var(--a)":"var(--ts)";
    return`<div class="sri" onclick="selectStk('${s.tk}')">
      <div style="display:flex;flex-direction:column;width:48px;flex-shrink:0;">
        <div class="sri-tk">${s.tk}</div>
        <div style="font-size:8px;color:${capCol};">${s.cap||""}</div>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.nm}</div>
        <div style="font-size:9px;color:var(--ts);">${s.sec||""}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div class="sri-pr ${up?"cu":"cd"}">${s.pr.toLocaleString()}</div>
        <div style="font-size:9px;" class="${up?"cu":"cd"}">${up?"+":""}${c}%</div>
      </div>
    </div>`;
  }).join("");
}
function hideSrch(){document.getElementById("srchDrop").style.display="none";}
function togInd(nm,el){inds[nm]=!inds[nm];el.classList.toggle("on",inds[nm]);if(!inds[nm]){if(nm==="rsi"){const rs=document.getElementById("rsiSub");if(rs)rs.classList.add("hide");}if(nm==="macd"){const ms=document.getElementById("macdSub");if(ms)ms.classList.add("hide");}}drawChart();}

// ═══════════════════════════════
// LIVE UPDATE
// ═══════════════════════════════
// 관심종목 가격 KIS 갱신 (30초마다 순차 조회)
let _wlRefreshIdx = 0;
async function refreshWatchlistPrices(){
  if(!kisConfig.appKey || !kisConfig.account) return;
  // 관심종목 + activeTk 모든 종목 수집
  const allTks = [...new Set([activeTk, ...(WGS[0]||[]), ...(WGS[1]||[])])];
  if(!allTks.length) return;
  // 한 번에 한 종목씩 순차 조회 (API 부하 방지)
  const tk = allTks[_wlRefreshIdx % allTks.length];
  _wlRefreshIdx++;
  await kisRefreshPrice(tk);
  renderWLGroup(); // 관심목록 가격 재렌더
}

function liveUpdate(){
  if(document.hidden)return; // 탭 비활성 시 스킵
  if(sim.playing)return;
  if(kisConfig.appKey && kisConfig.account){
    kisRefreshPrice(activeTk); // 현재 선택 종목 즉시 갱신
    // 관심종목 가격은 별도 인터벌에서 갱신 (setInterval 아래에서 처리)
  } else {
    // KIS 미연결: 가격 변동 없음 — 마지막 값 유지
    const stk=STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
    updPrice({c:stk.pr});
  }
  renderWL();renderOB();updPnl();
}

// ═══════════════════════════════
// STATS
// ═══════════════════════════════
function renderStats(){
  const allTrades = mock.trades || [];
  // mock.trades 0건이면 명확한 안내
  if(allTrades.length === 0){
    const grid = document.getElementById('statsGrid');
    if(grid) grid.innerHTML = '<div style="grid-column:1/-1;background:rgba(255,153,0,0.08);border:1px dashed var(--a);border-radius:8px;padding:14px;text-align:center;font-size:11px;color:var(--ts);line-height:1.6;">📊 매매 내역이 0건입니다.<br><b>백테스트나 매수</b>를 해야 통계가 채워집니다.<br><span style="font-size:9px;">🔍 디버그 버튼으로 자동매매 상태 확인하세요.</span></div>';
    const ml = document.getElementById('mistakeList');
    if(ml) ml.innerHTML = '<div style="font-size:10px;color:var(--tm);text-align:center;padding:10px;">매매 발생 후 표시됩니다</div>';
    if(typeof pnlChart!=='undefined' && pnlChart && pnlChart.destroy) pnlChart.destroy();
    return;
  }
  console.log('[renderStats] trades:', allTrades.length, 'sells:', allTrades.filter(t=>t.side==='sell').length);
  const sells=allTrades.filter(t=>t.side==="sell");
  const wins=sells.filter(t=>t.pnl>0),losses=sells.filter(t=>t.pnl<=0);
  const wr=sells.length?Math.round(wins.length/sells.length*100):0;
  const aw=wins.length?Math.round(wins.reduce((a,t)=>a+t.pnl,0)/wins.length):0;
  const al=losses.length?Math.round(losses.reduce((a,t)=>a+Math.abs(t.pnl),0)/losses.length):0;
  const rr=al>0?(aw/al).toFixed(2):"--";
  const tp=sells.reduce((a,t)=>a+t.pnl,0);
  const ai=mock.trades.filter(t=>t.auto).length;
  document.getElementById("statsGrid").innerHTML=[["승률",wr+"%",`${wins.length}승 ${losses.length}패`],["평균 R/R","1:"+rr,`익절 ${aw.toLocaleString()} 손절 ${al.toLocaleString()}`],["총 손익",(tp>=0?"+":"")+tp.toLocaleString()+"원",`${sells.length}회 거래`],["AI 매매",ai+"건",`전체의 ${mock.trades.length?Math.round(ai/mock.trades.length*100):0}%`]].map(([l,v,s])=>`<div class="stat-card"><div class="stat-lbl">${l}</div><div class="stat-val">${v}</div><div style="font-size:9px;color:var(--tm);font-family:var(--mono);margin-top:2px;">${s}</div></div>`).join("");
  if(pnlChart)pnlChart.destroy();
  const dm={};sells.forEach(t=>{dm[t.date]=(dm[t.date]||0)+t.pnl;});
  const dates=Object.keys(dm).sort();let cum=0;const cd=dates.map(d=>{cum+=dm[d];return cum;});
  // 차트는 Chart.js 의존 — 라이브러리 미로드면 자체 canvas 그림으로 대체
  if(dates.length){
    const pcv=document.getElementById("pnlChart");
    if(pcv && typeof Chart !== 'undefined'){
      try{ const ctx=pcv.getContext("2d"); pnlChart=new Chart(ctx,{type:"line",data:{labels:dates,datasets:[{data:cd,borderColor:"#4d9fff",borderWidth:2,pointRadius:3,fill:true,backgroundColor:"rgba(77,159,255,.08)",tension:.3}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"#454b58",font:{size:8}}},y:{ticks:{color:"#8c9db5",font:{size:8},callback:v=>v.toLocaleString()}}}}}); }catch(_e){ console.warn('Chart 실패:', _e.message); }
    } else if(pcv){
      // Chart.js 없을 때 자체 canvas로 누적 손익 그리기 (jPnlChart와 동일 로직 단순화)
      try{
        const r=pcv.getBoundingClientRect(); const W=Math.round(r.width)||600, H=160; pcv.width=W; pcv.height=H;
        const ctx=pcv.getContext('2d'); ctx.clearRect(0,0,W,H);
        const PL=42, PR=10, PT=10, PB=22; const cw=W-PL-PR, ch=H-PT-PB;
        let yMin=Math.min(0,...cd), yMax=Math.max(0,...cd); if(yMin===yMax){yMin-=1;yMax+=1;}
        const yPad=(yMax-yMin)*0.08; yMin-=yPad; yMax+=yPad; const yR=yMax-yMin;
        const toY=v=>PT+ch*(1-(v-yMin)/yR); const toX=i=>PL+cw*(i/Math.max(cd.length-1,1));
        ctx.strokeStyle='rgba(0,0,0,.15)'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(PL,toY(0)); ctx.lineTo(W-PR,toY(0)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle='#8c9db5'; ctx.font='9px monospace'; ctx.textAlign='right';
        [yMax,(yMax+yMin)/2,yMin].forEach(v=>ctx.fillText((v>=0?'+':'')+Math.round(v/1000)+'k', PL-4, toY(v)+3));
        const last=cd[cd.length-1]||0; const col=last>=0?'#05c072':'#dc3545';
        const grad=ctx.createLinearGradient(0,PT,0,PT+ch); grad.addColorStop(0,col==='#05c072'?'rgba(5,192,114,.25)':'rgba(220,53,69,.25)'); grad.addColorStop(1,'rgba(255,255,255,0)');
        ctx.fillStyle=grad; ctx.beginPath(); ctx.moveTo(toX(0),toY(0)); cd.forEach((c,i)=>ctx.lineTo(toX(i),toY(c))); ctx.lineTo(toX(cd.length-1),toY(0)); ctx.closePath(); ctx.fill();
        ctx.strokeStyle=col; ctx.lineWidth=2; ctx.beginPath(); cd.forEach((c,i)=>{const x=toX(i),y=toY(c); if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);}); ctx.stroke();
        ctx.fillStyle='#8c9db5'; ctx.textAlign='center'; [0,Math.floor(dates.length/2),dates.length-1].forEach(i=>{ if(dates[i]) ctx.fillText(dates[i].slice(5), toX(i), H-6); });
      }catch(_e){ console.warn('pnl 자체 차트:', _e.message); }
    }
  }
  const mis=mock.trades.filter(t=>t.side==="sell"&&t.pnl<0);
  const mt={"FOMO 추격 진입":0,"손절 지연":0,"목표가 조기 익절":0,"재진입 손실":0};
  mis.forEach((_,i)=>{const k=Object.keys(mt)[i%4];mt[k]++;});
  document.getElementById("mistakeList").innerHTML=Object.entries(mt).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v],i)=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--br);"><span style="font-size:11px;font-weight:700;color:var(--tm);">${i+1}</span><span style="flex:1;font-size:11px;">${k}</span><span style="font-family:var(--mono);font-size:11px;color:var(--r);">${v}회</span></div>`).join("")||"<div style='font-size:11px;color:var(--tm);'>데이터 없음</div>";
  renderStatsEnhanced();
  renderSymbolPnl();
  renderTimeline();
  // 주간/월간 통계 자동 호출
  try{ renderWeeklyStats && renderWeeklyStats(); }catch(e){ console.warn('weekly:', e.message); }
  try{ renderMonthlyStats && renderMonthlyStats(); }catch(e){ console.warn('monthly:', e.message); }
  // 📅 날짜별 손익 텍스트 리스트
  try{
    const dpEl = document.getElementById('dailyPnlList');
    if(dpEl){
      const dm={};
      sells.forEach(t=>{ dm[t.date] = (dm[t.date]||0) + (t.pnl||0); });
      const _dates = Object.keys(dm).sort();
      let cum = 0;
      const rows = _dates.map(d=>{
        const v = dm[d]; cum += v;
        const col = v>=0?'var(--g)':'var(--r)';
        const cumCol = cum>=0?'var(--g)':'var(--r)';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:6px;background:var(--bg);">
          <span style="font-family:var(--mono);font-size:11px;">${d}</span>
          <span style="display:flex;gap:12px;align-items:baseline;">
            <span style="font-family:var(--mono);font-size:12px;font-weight:700;color:${col};">${v>=0?'+':''}${v.toLocaleString()}원</span>
            <span style="font-size:9px;color:var(--tm);">누적</span>
            <span style="font-family:var(--mono);font-size:10px;color:${cumCol};">${cum>=0?'+':''}${cum.toLocaleString()}원</span>
          </span>
        </div>`;
      }).join('');
      dpEl.innerHTML = rows || '<div style="font-size:10px;color:var(--tm);text-align:center;padding:10px;">매도 기록이 없습니다</div>';
    }
  }catch(_e){ console.warn('dailyPnl:', _e.message); }
}

// ═══════════════════════════════
// JOURNAL
// ═══════════════════════════════
async function genJModal(){
  const body=document.getElementById("jModalBody");
  const tt=mock.trades.filter(t=>t.date===sim.date);
  if(!tt.length){body.innerHTML="<div style='font-size:11px;color:var(--tm);'>오늘 거래 내역이 없습니다.</div>";return;}
  const pnl=tt.filter(t=>t.side==="sell").reduce((a,t)=>a+t.pnl,0);
  const wins=tt.filter(t=>t.side==="sell"&&t.pnl>0).length,total=tt.filter(t=>t.side==="sell").length;
  const str=tt.map(t=>`${t.side==="buy"?"매수":"매도"} ${t.nm} ${t.qty}주 @${t.price.toLocaleString()}${t.pnl?` 손익${t.pnl>=0?"+":""}${t.pnl.toLocaleString()}원`:""} ${t.auto?"[AI매매]":""}`).join("\n");

  // ── 1. AI 없이도 즉시 기본 저장 ──
  const baseEntry = {
    summary: `${sim.date} 매매 (${total}건, ${pnl>=0?'+':''}${pnl.toLocaleString()}원)`,
    why_bought: '기록 없음',
    why_sold: '기록 없음',
    mistakes: '-',
    psychology: '-',
    phase_check: '-',
    improvement: '-',
    score_total: null,
    aiGenerated: false,
    trades: str,
  };
  saveJEntry(sim.date, baseEntry, pnl, wins, total, str);

  body.innerHTML="<div style='font-size:11px;color:var(--tm);font-style:italic;'>AI 분석 중... (이미 저장됨)</div>";

  try{
    const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:600,messages:[{role:"user",content:`당신은 20년 경력 단타 트레이딩 멘토입니다. Phase 0~12 강의 기준으로 아래 매매를 완전 분석하세요.

[매매 데이터]
${str}
총손익: ${pnl>=0?"+":""}${pnl}원 | 승률: ${total?Math.round(wins/total*100):0}% | 매매횟수: ${total}회

JSON만 출력 (다른 텍스트 없이):
{"summary":"오늘 매매 한줄 총평","market_context":"오늘 시장 환경 평가(코스피/나스닥 방향 등)","why_bought":"진입 이유 분석 - Phase 8 STEP 기준 충족 여부","why_sold":"청산 이유 분석 - 손절/익절 원칙 준수 여부","mistakes":"가장 심각한 실수 2~3가지(구체적 수치와 함께)","psychology":"심리 상태 평가(FOMO/복수매매/조기익절 등 오류)","phase_check":"Phase 8 체크리스트 중 건너뛴 항목","improvement":"다음에 같은 상황에서 다르게 할 행동(구체적으로)","score_principle":8,"score_timing":7,"score_psychology":7,"score_total":7,"score_reason":"점수 이유"}`}]})});
    const data=await res.json();
    let p;try{const m=(data.content?.[0]?.text||"{}").match(/\{[\s\S]*\}/);p=JSON.parse(m?m[0]:"{}"); }catch(e){p={};}
    p.aiGenerated=true; p.trades=str;
    // ── 2. AI 성공 시 덮어쓰기 저장 ──
    saveJEntry(sim.date,p,pnl,wins,total,str);
    body.innerHTML=_renderJEntry({...p,date:sim.date,pnl,wins,total,tradeCount:tt.length});
  }catch(e){
    // ── 3. AI 실패해도 기본 저장은 이미 됨 ──
    body.innerHTML=`<div class='jday'><div class='jd-hdr'><span class='jd-dt'>${sim.date}</span><span class='jd-pnl ${pnl>=0?"cu":"cd"}'>${pnl>=0?"+":""}${pnl.toLocaleString()}원</span></div>
      <div class='jd-sub'>${tt.length}건 · 승률${total?Math.round(wins/total*100):0}%</div>
      <div class='jd-note' style='color:var(--a);'>⚠ AI 분석 실패 — 기본 일지로 저장됨. Claude API 키 확인.</div>
      <div style='font-size:10px;color:var(--ts);margin-top:6px;white-space:pre-wrap;'>${str}</div></div>`;
  }
}

function _renderJEntry(e){
  return `<div class="jday" style="margin-bottom:0;">
    <div class="jd-hdr"><span class="jd-dt">${e.date||''}</span><span class="jd-pnl ${(e.pnl||0)>=0?"cu":"cd"}">${(e.pnl||0)>=0?"+":""}${(e.pnl||0).toLocaleString()}원</span></div>
    <div class="jd-sub">${e.tradeCount||e.total||0}건 · 승률${e.total?Math.round(e.wins/e.total*100):0}%${e.aiGenerated?' · <span style="color:var(--p);">🤖AI분석완료</span>':' · <span style="color:var(--tm);">수동저장</span>'}</div>
    ${e.summary?`<b style="font-size:12px;">${e.summary}</b>`:''}
    <div class="jd-ai" style="margin-top:8px;line-height:1.7;">
      ${e.market_context?`<div class="jd-note" style="border-left:3px solid var(--b);padding-left:6px;margin-bottom:4px;">📊 시장: ${e.market_context}</div>`:""}
      ${e.why_bought&&e.why_bought!=='기록 없음'?`<div style="margin-bottom:4px;"><span style="color:var(--r);font-weight:700;">진입이유:</span> ${e.why_bought}</div>`:""}
      ${e.why_sold&&e.why_sold!=='기록 없음'?`<div style="margin-bottom:4px;"><span style="color:var(--b);font-weight:700;">청산이유:</span> ${e.why_sold}</div>`:""}
      ${e.psychology&&e.psychology!=='-'?`<div class="jd-note" style="border-left:3px solid var(--a);padding-left:6px;margin-bottom:4px;">🧠 심리: ${e.psychology}</div>`:""}
    </div>
    ${e.mistakes&&e.mistakes!=='-'?`<div class="jd-note err" style="margin-top:4px;">🔴 실수: ${e.mistakes}</div>`:""}
    ${e.phase_check&&e.phase_check!=='-'?`<div class="jd-note err">⚠ 건너뛴 Phase: ${e.phase_check}</div>`:""}
    ${e.improvement&&e.improvement!=='-'?`<div class="jd-note tip">💡 개선: ${e.improvement}</div>`:""}
    ${e.score_total?`<div style="text-align:right;margin-top:4px;font-size:9px;color:var(--tm);">원칙:${e.score_principle||"-"} 타점:${e.score_timing||"-"} 심리:${e.score_psychology||"-"} <b>종합:${e.score_total}</b>/10</div>`:""}
    ${e.trades&&!e.aiGenerated?`<details style="margin-top:6px;"><summary style="font-size:9px;color:var(--tm);cursor:pointer;">매매내역 보기</summary><pre style="font-size:9px;color:var(--ts);white-space:pre-wrap;margin-top:4px;">${e.trades}</pre></details>`:''}
  </div>`;
}

function renderJPage(){
  const js=safeParseJSON(localStorage.getItem("htsJournals"), "{}");
  // ★ 키 자체가 date — entry에 date 필드 없어도 키로 보강
  const entries=Object.entries(js)
    .map(([key, v]) => ({...(v||{}), date: (v && v.date) || key}))
    .filter(e=>e.date)
    .sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const jlEl = document.getElementById('journalList');
  console.log('[renderJPage] entries:', entries.length, 'journalList exists:', !!jlEl);
  // 통계/차트는 항상 갱신 (거래 없어도 빈 카드 표시)
  try{ renderJournalStats(); }catch(e){ console.warn('stats:', e.message); }
  // 가장 최근 AI 코칭 박스 — 열자마자 보임
  try{
    const lc = document.getElementById('jLatestCoaching');
    if(lc){
      const latest = entries.find(e=>e.aiGenerated);
      if(latest){
        lc.style.display='';
        const stage = (typeof getLearnerStage==='function') ? getLearnerStage() : {lv:1,label:'초보',color:'var(--a)'};
        lc.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:13px;font-weight:800;color:var(--p);">🎓 AI 코칭 — ${latest.date}</div>
            <span style="background:${stage.color};color:#fff;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;">Lv${stage.lv} ${stage.label}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            ${latest.good && latest.good!=='-' ? `<div style="background:rgba(5,192,114,0.08);border-left:3px solid var(--g);padding:6px 10px;border-radius:6px;"><div style="font-size:10px;color:var(--g);font-weight:700;margin-bottom:2px;">✅ 잘한 점</div><div style="font-size:11px;line-height:1.5;">${latest.good}</div></div>` : ''}
            ${latest.bad && latest.bad!=='-' ? `<div style="background:rgba(240,62,62,0.08);border-left:3px solid var(--r);padding:6px 10px;border-radius:6px;"><div style="font-size:10px;color:var(--r);font-weight:700;margin-bottom:2px;">🔴 반성</div><div style="font-size:11px;line-height:1.5;">${latest.bad}</div></div>` : ''}
            ${latest.improvement && latest.improvement!=='-' ? `<div style="background:rgba(49,130,246,0.08);border-left:3px solid var(--b);padding:6px 10px;border-radius:6px;"><div style="font-size:10px;color:var(--b);font-weight:700;margin-bottom:2px;">💡 개선</div><div style="font-size:11px;line-height:1.5;">${latest.improvement}</div></div>` : ''}
            ${latest.psychology && latest.psychology!=='-' ? `<div style="background:rgba(245,158,11,0.08);border-left:3px solid var(--a);padding:6px 10px;border-radius:6px;"><div style="font-size:10px;color:var(--a);font-weight:700;margin-bottom:2px;">🧠 심리</div><div style="font-size:11px;line-height:1.5;">${latest.psychology}</div></div>` : ''}
          </div>
          ${latest.mentor_comment && latest.mentor_comment!=='-' ? `<div style="background:var(--pan);padding:8px 12px;border-radius:8px;border:1px dashed var(--p);font-size:11px;line-height:1.6;"><b style="color:var(--p);">🎯 멘토 한마디:</b> ${latest.mentor_comment}</div>` : ''}
        `;
      }else if(entries.length===0){
        lc.style.display='';
        lc.innerHTML = `<div style="font-size:12px;color:var(--tm);text-align:center;padding:20px;">백테스트나 매매를 마치면 여기에 AI 코칭이 자동으로 나타납니다.</div>`;
      }else{
        lc.style.display='none';
      }
    }
  }catch(e){ console.warn('latest coaching:', e.message); }
  if(!entries.length){document.getElementById("journalList").innerHTML="<div style='font-size:12px;color:var(--tm);text-align:center;padding:40px;'>거래 내역이 없습니다.</div>";return;}
  const _jl = document.getElementById("journalList");
  if(!_jl){ console.warn('[renderJPage] journalList DOM 없음'); return; }
  _jl.innerHTML=entries.map(e=>{
    try{
    const aiTag = e.aiTradeCount ? `<span style="font-size:9px;background:rgba(139,92,246,.15);color:var(--p);padding:1px 5px;border-radius:3px;font-weight:700;margin-left:4px;">🤖 AI ${e.aiTradeCount}건</span>` : '';
    const manTag = e.manualTradeCount ? `<span style="font-size:9px;background:rgba(49,130,246,.12);color:var(--b);padding:1px 5px;border-radius:3px;margin-left:2px;">${e.manualTradeCount}건</span>` : '';
    const savedTag = e.aiGenerated ? '<span style="font-size:8px;color:var(--p);">🤖</span>' : '<span style="font-size:8px;color:var(--tm);">📝</span>';
    const _rg = e.result_grade || ((e.pnl||0)>0 ? '수익' : (e.pnl||0)<0 ? '손실' : '무변동');
    const _rgCol = (e.pnl||0)>0 ? 'var(--g)' : (e.pnl||0)<0 ? 'var(--r)' : 'var(--tm)';
    const _pg = e.process_grade ? `<span style="font-size:8px;background:var(--bg);color:var(--ts);padding:1px 5px;border-radius:3px;margin-left:3px;">과정 ${e.process_grade}</span>` : '';
    return `<div class="jday">
      <div class="jd-hdr">
        <span class="jd-dt">${e.date} ${savedTag} <span style="background:${_rgCol};color:#fff;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;margin-left:4px;">결과 ${_rg}</span>${_pg}</span>
        <span style="display:flex;align-items:center;gap:6px;">
          <span class="jd-pnl ${(e.pnl||0)>=0?"cu":"cd"}" style="font-size:14px;font-weight:800;">${(e.pnl||0)>=0?"+":""}${(e.pnl||0).toLocaleString()}원</span>
          <button data-copy="${e.date}" onclick="copyJEntry('${e.date}')" title="마크다운 복사" style="background:none;border:1px solid var(--br);border-radius:4px;color:var(--ts);font-size:10px;cursor:pointer;padding:1px 6px;">📋</button>
          <button onclick="delJEntry('${e.date}')" title="삭제" style="background:none;border:none;color:var(--tm);font-size:14px;cursor:pointer;padding:0 4px;line-height:1;">&times;</button>
        </span>
      </div>
      <div class="jd-sub">${e.total||0}건 ${aiTag}${manTag} · 승률${e.total?Math.round(e.wins/e.total*100):0}% ${(e.pnl||0)>0 && e.total && Math.round(e.wins/e.total*100)<50 ? '<span style="color:var(--g);font-size:9px;font-weight:700;">📈 손익비 우수</span>' : ''}${(e.pnl||0)<0 && e.total && Math.round(e.wins/e.total*100)>=60 ? '<span style="color:var(--r);font-size:9px;font-weight:700;">⚠ 손익비 불량</span>' : ''}</div>
      ${e.summary?`<b style="font-size:12px;">${e.summary}</b>`:e.trades?`<div style="font-size:10px;color:var(--tm);">매매 ${e.total||0}건 기록됨</div>`:''}
      <div class="jd-ai" style="margin-top:5px;line-height:1.7;">
        ${e.market_context?`<div class="jd-note" style="border-left:3px solid var(--b);padding-left:6px;margin-bottom:3px;font-size:10px;">📊 ${e.market_context}</div>`:""}
        ${e.why_bought&&e.why_bought!=='기록 없음'?`<div style="font-size:10px;margin-bottom:3px;"><span style="color:var(--r);font-weight:700;">진입:</span> ${e.why_bought}</div>`:""}
        ${e.why_sold&&e.why_sold!=='기록 없음'?`<div style="font-size:10px;margin-bottom:3px;"><span style="color:var(--b);font-weight:700;">청산:</span> ${e.why_sold}</div>`:""}
        ${e.psychology&&e.psychology!=='-'?`<div class="jd-note" style="border-left:3px solid var(--a);padding-left:6px;margin-bottom:3px;font-size:10px;">🧠 ${e.psychology}</div>`:""}
        ${!e.aiGenerated&&!e.summary?`<div style="font-size:9px;color:var(--tm);font-style:italic;">AI 일지 미생성 — 상단 🤖 버튼으로 생성하세요</div>`:""}
      </div>
      ${e.mistakes&&e.mistakes!=='-'?`<div class="jd-note err" style="font-size:10px;">🔴 ${e.mistakes}</div>`:""}
      ${e.improvement&&e.improvement!=='-'?`<div class="jd-note tip" style="font-size:10px;">💡 ${e.improvement}</div>`:""}
      ${e.score_total?`<div style="text-align:right;font-size:8px;color:var(--tm);">원칙:${e.score_principle||"-"} 타점:${e.score_timing||"-"} 심리:${e.score_psychology||"-"} <b>종합:${e.score_total}</b>/10</div>`:""}
    </div>`;
    }catch(_e){
      console.warn('[renderJPage] entry 렌더 실패', e.date, _e.message);
      return `<div class="jday" style="border-left:3px solid var(--r);"><div class="jd-hdr"><span class="jd-dt">${e.date||'?'}</span><span class="jd-pnl">렌더 오류</span></div><div style="font-size:10px;color:var(--r);padding:6px;">${(_e.message||'').slice(0,100)}</div></div>`;
    }
  }).join("");
}
// ═══════════════════════════════════════════════
// 매매일지 통계 / 누적손익 차트 / AI 기능 제안
// ═══════════════════════════════════════════════
function _journalStatsData(){
  const js = safeParseJSON(localStorage.getItem("htsJournals"), "{}");
  // ★ 키로 date 보강 (autoSave 도중 부분 저장된 항목도 통계 반영)
  const entries = Object.entries(js)
    .map(([key, v])=>({...(v||{}), date: (v && v.date) || key}))
    .filter(e=>e.date)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const trades = (mock.trades || []).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const sells = trades.filter(t=>t.side==='sell');
  const wins = sells.filter(t=>(t.pnl||0)>0);
  const losses = sells.filter(t=>(t.pnl||0)<0);
  const totalPnl = sells.reduce((s,t)=>s+(t.pnl||0),0);
  const winRate = sells.length ? (wins.length/sells.length*100) : 0;
  const avgWin = wins.length ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s,t)=>s+t.pnl,0)/losses.length) : 0;
  const rr = avgLoss>0 ? avgWin/avgLoss : 0;
  // 일별 누적
  const daily = entries.map(e => ({date:e.date, pnl:e.pnl||0, wins:e.wins||0, total:e.total||0}));
  let cum = 0;
  const curve = daily.map(d => ({date:d.date, pnl:d.pnl, cum: (cum += d.pnl)}));
  // 연승/연패
  let curWin=0, curLoss=0, maxWin=0, maxLoss=0;
  sells.forEach(t=>{
    if((t.pnl||0)>0){ curWin++; curLoss=0; if(curWin>maxWin) maxWin=curWin; }
    else if((t.pnl||0)<0){ curLoss++; curWin=0; if(curLoss>maxLoss) maxLoss=curLoss; }
  });
  // AI vs 수동
  const aiSells = sells.filter(t=>t.auto);
  const manSells = sells.filter(t=>!t.auto);
  const aiPnl = aiSells.reduce((s,t)=>s+(t.pnl||0),0);
  const manPnl = manSells.reduce((s,t)=>s+(t.pnl||0),0);
  const aiWinRate = aiSells.length ? (aiSells.filter(t=>(t.pnl||0)>0).length/aiSells.length*100) : 0;
  const manWinRate = manSells.length ? (manSells.filter(t=>(t.pnl||0)>0).length/manSells.length*100) : 0;
  // 종목별 TOP3
  const byTk = {};
  sells.forEach(t=>{
    if(!byTk[t.tk]) byTk[t.tk] = {tk:t.tk, nm:t.nm, pnl:0, count:0, wins:0};
    byTk[t.tk].pnl += (t.pnl||0);
    byTk[t.tk].count++;
    if((t.pnl||0)>0) byTk[t.tk].wins++;
  });
  const topStocks = Object.values(byTk).sort((a,b)=>b.pnl-a.pnl);
  const best = curve.reduce((a,b)=>(!a||b.pnl>a.pnl)?b:a, null);
  const worst = curve.reduce((a,b)=>(!a||b.pnl<a.pnl)?b:a, null);
  // 최대 낙폭(MDD)
  let peak = 0, mdd = 0;
  curve.forEach(c=>{ if(c.cum>peak) peak=c.cum; const dd=peak-c.cum; if(dd>mdd) mdd=dd; });
  return {
    entries, sells, trades, wins, losses,
    totalPnl, winRate, avgWin, avgLoss, rr,
    daily, curve, maxWin, maxLoss,
    aiSells, manSells, aiPnl, manPnl, aiWinRate, manWinRate,
    topStocks, best, worst, mdd
  };
}

function renderJournalStats(){
  const d = _journalStatsData();
  const tradesLen = (mock.trades||[]).length;
  // 빈 상태 안내
  if(tradesLen === 0){
    const kpiEl = document.getElementById('jKpiRow');
    if(kpiEl){
      kpiEl.innerHTML = `<div style="grid-column:1/-1;background:rgba(255,153,0,0.08);border:1px dashed var(--a);border-radius:8px;padding:14px;text-align:center;font-size:11px;line-height:1.6;color:var(--ts);">
        📊 매매 내역이 0건입니다.<br>
        <b>백테스트를 돌리거나 수동 매매</b>해서 거래가 발생해야 통계/일지가 채워져요.<br>
        <span style="font-size:9px;color:var(--tm);">자동매매가 켜져있어도 진입 조건을 충족하는 종목이 없으면 매매가 안 됩니다.</span>
      </div>`;
    }
    const cv = document.getElementById('jPnlChart');
    if(cv){ const ctx=cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height); ctx.fillStyle='#8c9db5'; ctx.font='11px sans-serif'; ctx.textAlign='center'; ctx.fillText('매매가 발생하면 누적 손익이 표시됩니다', cv.width/2, cv.height/2); }
    const bd = document.getElementById('jBreakdown'); if(bd) bd.innerHTML='';
    return;
  }
  const kpiEl = document.getElementById('jKpiRow');
  if(kpiEl){
    const pnlCol = d.totalPnl>=0 ? 'var(--g)' : 'var(--r)';
    const kpi = (label, val, col) => `<div style="background:var(--bg);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:9px;color:var(--tm);margin-bottom:3px;">${label}</div><div style="font-size:14px;font-weight:800;color:${col||'var(--t)'};">${val}</div></div>`;
    kpiEl.innerHTML =
      kpi('총 손익', (d.totalPnl>=0?'+':'')+d.totalPnl.toLocaleString()+'원', pnlCol) +
      kpi('승률', d.sells.length ? d.winRate.toFixed(1)+'%' : '-') +
      kpi('손익비', d.rr>0 ? '1:'+d.rr.toFixed(2) : '-') +
      kpi('매매일', d.curve.length+'일') +
      kpi('전체 매매', tradesLen+'건', 'var(--b)') +
      kpi('매도 완료', d.sells.length+'건');
  }
  // 누적손익 차트
  const cv = document.getElementById('jPnlChart');
  if(cv && d.curve.length){
    const r = cv.getBoundingClientRect();
    const W = Math.round(r.width)||600, H = 140;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0,0,W,H);
    const PL=42, PR=10, PT=10, PB=22;
    const cw = W-PL-PR, ch = H-PT-PB;
    const cums = d.curve.map(c=>c.cum);
    let yMin = Math.min(0, ...cums), yMax = Math.max(0, ...cums);
    if(yMin===yMax){ yMin -= 1; yMax += 1; }
    const yPad = (yMax-yMin)*0.08;
    yMin -= yPad; yMax += yPad;
    const yR = yMax-yMin;
    const toY = v => PT + ch*(1-(v-yMin)/yR);
    const toX = i => PL + cw*(i/Math.max(d.curve.length-1,1));
    // 0선
    ctx.strokeStyle = 'rgba(0,0,0,.15)';
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(PL, toY(0)); ctx.lineTo(W-PR, toY(0)); ctx.stroke();
    ctx.setLineDash([]);
    // Y라벨
    ctx.fillStyle='#8c9db5'; ctx.font='9px monospace'; ctx.textAlign='right';
    [yMax, (yMax+yMin)/2, yMin].forEach(v=>{
      const y = toY(v);
      ctx.fillText((v>=0?'+':'')+Math.round(v/1000)+'k', PL-4, y+3);
    });
    // 면적
    const grad = ctx.createLinearGradient(0, PT, 0, PT+ch);
    grad.addColorStop(0, 'rgba(5,192,114,.25)');
    grad.addColorStop(1, 'rgba(5,192,114,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(0));
    d.curve.forEach((c,i)=>ctx.lineTo(toX(i), toY(c.cum)));
    ctx.lineTo(toX(d.curve.length-1), toY(0));
    ctx.closePath(); ctx.fill();
    // 라인
    ctx.strokeStyle = d.totalPnl>=0 ? '#05c072' : '#dc3545';
    ctx.lineWidth = 2;
    ctx.beginPath();
    d.curve.forEach((c,i)=>{
      const x=toX(i), y=toY(c.cum);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    // X 라벨 (시작/중간/끝)
    ctx.fillStyle='#8c9db5'; ctx.textAlign='center';
    [0, Math.floor(d.curve.length/2), d.curve.length-1].forEach(i=>{
      if(d.curve[i]) ctx.fillText(d.curve[i].date.slice(5), toX(i), H-6);
    });
  } else if(cv){
    const ctx=cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height);
    ctx.fillStyle='#8c9db5'; ctx.font='11px sans-serif'; ctx.textAlign='center';
    ctx.fillText('매매일지가 쌓이면 누적 손익이 표시됩니다', cv.width/2, cv.height/2);
  }
  // 분해 분석
  const bd = document.getElementById('jBreakdown');
  if(bd){
    const bar = (label, valPct, col) => `<div style="margin-bottom:6px;"><div style="display:flex;justify-content:space-between;font-size:9px;color:var(--tm);margin-bottom:2px;"><span>${label}</span><span>${valPct.toFixed(1)}%</span></div><div style="background:var(--bg);height:6px;border-radius:3px;overflow:hidden;"><div style="width:${Math.min(100,valPct)}%;height:100%;background:${col};"></div></div></div>`;
    const aiVsMan = `
      <div style="background:var(--bg);border-radius:8px;padding:10px;">
        <div style="font-size:10px;font-weight:700;margin-bottom:6px;">🤖 AI vs 🙋 수동</div>
        ${bar('AI 승률 ('+d.aiSells.length+'건)', d.aiWinRate, 'var(--p)')}
        ${bar('수동 승률 ('+d.manSells.length+'건)', d.manWinRate, 'var(--b)')}
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-top:4px;">
          <span>AI 손익: <b style="color:${d.aiPnl>=0?'var(--g)':'var(--r)'};">${d.aiPnl>=0?'+':''}${d.aiPnl.toLocaleString()}</b></span>
          <span>수동 손익: <b style="color:${d.manPnl>=0?'var(--g)':'var(--r)'};">${d.manPnl>=0?'+':''}${d.manPnl.toLocaleString()}</b></span>
        </div>
      </div>`;
    const extras = `
      <div style="background:var(--bg);border-radius:8px;padding:10px;font-size:10px;line-height:1.7;">
        <div style="font-weight:700;margin-bottom:6px;">📊 상세 지표</div>
        <div>평균 수익: <b style="color:var(--g);">+${Math.round(d.avgWin).toLocaleString()}원</b></div>
        <div>평균 손실: <b style="color:var(--r);">-${Math.round(d.avgLoss).toLocaleString()}원</b></div>
        <div>최대 연승: <b>${d.maxWin}회</b> · 최대 연패: <b>${d.maxLoss}회</b></div>
        <div>최대 낙폭(MDD): <b style="color:var(--r);">-${Math.round(d.mdd).toLocaleString()}원</b></div>
        ${d.best?`<div>최고일: ${d.best.date} <b style="color:var(--g);">+${d.best.pnl.toLocaleString()}</b></div>`:''}
        ${d.worst?`<div>최악일: ${d.worst.date} <b style="color:var(--r);">${d.worst.pnl.toLocaleString()}</b></div>`:''}
      </div>`;
    const topStk = `
      <div style="background:var(--bg);border-radius:8px;padding:10px;grid-column:1/-1;">
        <div style="font-size:10px;font-weight:700;margin-bottom:6px;">🏆 종목별 손익 TOP/BOTTOM</div>
        ${d.topStocks.slice(0,3).map(s=>`<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0;"><span>${s.nm} (${s.tk}) · ${s.count}건 · 승${s.wins}</span><b style="color:${s.pnl>=0?'var(--g)':'var(--r)'};">${s.pnl>=0?'+':''}${s.pnl.toLocaleString()}원</b></div>`).join('')}
        ${d.topStocks.length>3 ? '<div style="font-size:9px;color:var(--tm);margin:4px 0;text-align:center;">···</div>' : ''}
        ${d.topStocks.slice(-2).reverse().filter(s=>!d.topStocks.slice(0,3).includes(s)).map(s=>`<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0;"><span>${s.nm} (${s.tk}) · ${s.count}건 · 승${s.wins}</span><b style="color:${s.pnl>=0?'var(--g)':'var(--r)'};">${s.pnl>=0?'+':''}${s.pnl.toLocaleString()}원</b></div>`).join('')}
      </div>`;
    bd.innerHTML = aiVsMan + extras + topStk;
  }
}

// AI 기능 제안 — 매매일지·학습노트·통계 보고 새 기능/개선점 제안
async function askAIForFeatureSuggestion(ev){
  const btn = (ev && ev.target) || document.querySelector('button[onclick*="askAIForFeatureSuggestion"]');
  const _restore = _btnBusy(btn, '🤖 분석 중...');
  const body = document.getElementById('jSuggestBody');
  if(body) body.innerHTML = '<div style="color:var(--tm);">🤖 분석 중...</div>';
  try{
  try{
    const s = _journalStatsData();
    const stage = (typeof getLearnerStage==='function') ? getLearnerStage() : null;
    const learnSummary = (window.learningMemory||[]).slice(-10).map(l=>`[${l.category}] ${l.text}`).join('\n');
    const lastJournals = s.entries.slice(-5).map(e=>`${e.date} pnl${e.pnl>=0?'+':''}${e.pnl} good:${(e.good||'').slice(0,40)} bad:${(e.bad||'').slice(0,60)} improve:${(e.improvement||'').slice(0,60)}`).join('\n');
    const prompt = `너는 트레이딩 앱 PM 겸 트레이더 멘토.
이 사용자의 매매 통계와 학습 노트를 보고, **이 앱에 추가하면 매매 성능이 가장 좋아질 기능 3가지**를 제안해줘.
기존 기능: 자동매매(레벨1~4), 백테스트, 학습 메모리, 강세 섹터 자동감지, 매매일지 자동작성, AI 판단 로그.

【통계】
총손익 ${s.totalPnl.toLocaleString()}원 / 매매 ${s.sells.length}건 / 승률 ${s.winRate.toFixed(1)}%
손익비 1:${s.rr.toFixed(2)} / MDD -${Math.round(s.mdd).toLocaleString()}원 / 최대연패 ${s.maxLoss}회
AI손익 ${s.aiPnl.toLocaleString()} (승률 ${s.aiWinRate.toFixed(1)}%) vs 수동 ${s.manPnl.toLocaleString()} (${s.manWinRate.toFixed(1)}%)
학습단계 ${stage?('Lv'+stage.lv+' '+stage.label):'미시작'}

【최근 일지 요약】
${lastJournals || '없음'}

【최근 학습 노트】
${learnSummary || '없음'}

JSON만:
{"suggestions":[
 {"title":"기능명 (5자내외)","why":"왜 필요한지 통계 근거 1줄","what":"무엇을 만들지 2~3줄","impact":"예상 성능 영향","priority":"높음/중간/낮음"},
 ...총 3개
]}`;
    const res = await fetch('/api/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:600,messages:[{role:'user',content:prompt}]})});
    const data = await res.json();
    const txt = (data.content&&data.content[0]&&data.content[0].text)||'{}';
    const m = txt.match(/\{[\s\S]*\}/);
    if(!m) throw new Error('JSON 파싱 실패');
    const ai = JSON.parse(m[0]);
    const sugs = ai.suggestions || [];
    if(!sugs.length){ body.innerHTML = '<div style="color:var(--tm);">제안 없음</div>'; return; }
    body.innerHTML = sugs.map((s,i)=>{
      const pCol = s.priority==='높음'?'var(--r)':s.priority==='중간'?'var(--a)':'var(--tm)';
      return `
        <div style="background:var(--pan);border-radius:8px;padding:10px;margin-bottom:6px;border-left:4px solid ${pCol};">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <div style="font-size:12px;font-weight:800;">${i+1}. ${s.title}</div>
            <span style="font-size:9px;background:${pCol};color:#fff;padding:1px 6px;border-radius:3px;font-weight:700;">${s.priority}</span>
          </div>
          <div style="font-size:10px;color:var(--ts);margin-bottom:4px;">📊 ${s.why}</div>
          <div style="font-size:10px;line-height:1.6;margin-bottom:4px;">🔧 ${s.what}</div>
          <div style="font-size:10px;color:var(--g);font-weight:600;">📈 ${s.impact}</div>
        </div>`;
    }).join('');
    // 메모리에 저장 (다음 빌드에 참고)
    try{
      const list = JSON.parse(localStorage.getItem('htsFeatureSuggestions')||'[]');
      list.push({ts:Date.now(), suggestions:sugs});
      if(list.length>30) list.shift();
      saveToServer('htsFeatureSuggestions', JSON.stringify(list));
    }catch(e){}
  }catch(e){
    if(body) body.innerHTML = '<div style="color:var(--r);">실패: '+e.message+'</div>';
  }
  }finally{ _restore(); }
}

async function genAllJournals(ev){
  const btn = (ev && ev.target) || document.querySelector('button[onclick="genAllJournals()"]');
  const _restore = _btnBusy(btn, '🤖 생성 중...');
  try{
    // 매매가 있고 아직 aiGenerated 안 된 날짜만 작성
    const bd={};
    (mock.trades||[]).forEach(t=>{ if(!bd[t.date]) bd[t.date]=[]; bd[t.date].push(t); });
    // 일지에 있는 날짜도 포함 (관망일지)
    const existing = safeParseJSON(localStorage.getItem('htsJournals'), '{}');
    Object.keys(existing).forEach(d=>{ if(!bd[d]) bd[d]=[]; });
    const dates = Object.keys(bd).sort();
    if(!dates.length){ showAlert('일지 생성','매매 내역이 없습니다'); return; }
    const todo = dates.filter(d => !(existing[d] && existing[d].aiGenerated) && (bd[d]||[]).length>0);
    if(!todo.length){ showAlert('일지 생성','모든 거래일의 AI 일지가 이미 작성돼 있습니다.'); return; }
    let toast = document.getElementById('genJToast');
    if(!toast){
      toast = document.createElement('div');
      toast.id = 'genJToast';
      toast.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--pan);border:1px solid var(--br);border-radius:10px;padding:8px 14px;box-shadow:0 4px 20px rgba(0,0,0,.15);font-size:11px;display:flex;align-items:center;gap:10px;';
      document.body.appendChild(toast);
    }
    let done = 0, fail = 0;
    toast.innerHTML = `🤖 일지 작성 중 0 / ${todo.length}`;
    let _consecFail = 0;
    for(const date of todo){
      const _t0 = Date.now();
      let _timerId;
      const _updateToast = ()=>{ toast.innerHTML = `🤖 ${date} 작성중 (${done+1}/${todo.length}) · ${Math.round((Date.now()-_t0)/1000)}초`; };
      _updateToast();
      _timerId = setInterval(_updateToast, 1000);
      try{
        await Promise.race([
          autoSaveJournalOnTrade(date),
          new Promise((_, rej) => setTimeout(()=>rej(new Error('timeout 10s — Claude 한도/네트워크')), 10000)),
        ]);
        done++;
        _consecFail = 0;
      }catch(e){
        fail++;
        _consecFail++;
        console.warn('일지 실패 '+date+':', e.message);
        toast.innerHTML = `⚠ ${date} 실패 (${e.message}) — 다음으로...`;
        await new Promise(r=>setTimeout(r,500));
        // 연속 3회 실패 → API 한도/네트워크 문제 → 중단
        if(_consecFail >= 3){
          clearInterval(_timerId);
          toast.innerHTML = `❌ Claude API 응답 실패 3연속 — Anthropic 한도/네트워크 확인 필요. ${done}/${todo.length} 완료, 중단합니다.`;
          setTimeout(()=>{ try{toast.remove();}catch(_e){} }, 5000);
          renderJPage();
          return;
        }
      }finally{
        clearInterval(_timerId);
      }
      renderJPage();
      await new Promise(r=>setTimeout(r,200));
    }
    toast.innerHTML = `✅ 일지 ${done}건 작성 완료 ${fail?'(실패 '+fail+'건)':''}`;
    setTimeout(()=>{ try{toast.remove();}catch(e){} }, 3500);
    renderJPage();
  }finally{ _restore(); }
}

// ═══════════════════════════════
// SETTINGS
// ═══════════════════════════════
function saveSettings(){
  cfg={capital:parseFloat(document.getElementById("cfg-capital").value)||10000000,dayloss:parseFloat(document.getElementById("cfg-dayloss").value)||2,maxpos:parseFloat(document.getElementById("cfg-maxpos").value)||20,clim:parseFloat(document.getElementById("cfg-clim").value)||140,mlim:parseFloat(document.getElementById("cfg-mlim").value)||40,crate:parseFloat(document.getElementById("cfg-crate").value)||8.5,mrate:parseFloat(document.getElementById("cfg-mrate").value)||12,bf:parseFloat(document.getElementById("cfg-bf").value)||0.015,sf:parseFloat(document.getElementById("cfg-sf").value)||0.015,tx:parseFloat(document.getElementById("cfg-tx").value)||0.18,bd:document.getElementById("cfg-bd").checked,al:document.getElementById("cfg-al").checked};
  const cfgV=JSON.stringify(cfg);localStorage.setItem("htsCfg",cfgV);saveToServer("htsCfg",cfgV);closeModal("settings");showAlert("저장 완료","설정이 서버에 영구 저장되었습니다.");
}
function resetMock(){if(!confirm("모의투자를 초기화하시겠습니까?\n모든 거래 내역이 삭제됩니다."))return;mock={cash:cfg.capital,positions:{},trades:[],todayPnl:0,todayTrades:0,lossSeries:0,creditUsed:0,marginUsed:0};stopOrders={};saveMock();renderAll();closeModal("settings");}

// ═══════════════════════════════
// UI HELPERS
// ═══════════════════════════════
let overnightAlerted=false;
// 초기 페이지 상태
window._curPage = "hts";
function tick(){
  if(document.hidden)return; // 탭 비활성 시 스킵
  const n=new Date();
  document.getElementById("clk").textContent=[n.getHours(),n.getMinutes(),n.getSeconds()].map(v=>v.toString().padStart(2,"0")).join(":");
  // 오버나잇 체크리스트 15:20 자동 팝업 (Phase 9-7)
  const hm=n.getHours()*100+n.getMinutes();
  if(hm===1520&&!overnightAlerted&&Object.keys(mock.positions).length>0){
    overnightAlerted=true;
    const posList=Object.entries(mock.positions).map(([tk,p])=>{const s=STOCKS.find(s=>s.tk===tk)||{nm:tk,pr:0};const pnl=(s.pr-p.avgPrice)*p.qty;return `${s.nm}: ${pnl>=0?"+":""}${Math.round(pnl).toLocaleString()}원 (${((s.pr-p.avgPrice)/p.avgPrice*100).toFixed(1)}%)`;}).join("\n");
    showAlert("⏰ 오버나잇 체크리스트 (Phase 9-7)",
      `15:20 마감 정리 시간입니다.

보유 종목:
${posList}

✅ 오버나잇 허용 조건:
1. 수급 지속 확인됐나요?
2. 이슈 내일도 지속되나요?
3. 뉴스 리스크 없나요?

❌ 하나라도 NO → 오늘 청산`);
  }
  if(hm!==1520)overnightAlerted=false;
  // Phase 8-10 + Phase 12: 시간대별 루틴 힌트
  const phHint=document.getElementById("phaseHint");
  if(phHint){
    if(hm<900)phHint.textContent="장 전 — 후보 3종목 확정 (Phase 8-10)";
    else if(hm<930)phHint.textContent="9:00~9:30 — 관망 권장 (초보자 진입 금지)";
    else if(hm<1000)phHint.textContent="9:30~10:00 — 시장 방향 확인 후 진입 검토";
    else if(hm<1130)phHint.textContent="10:00~11:30 — 적극 매매 구간 ★";
    else if(hm<1300)phHint.textContent="11:30~13:00 — 점심 | 신규 진입 자제";
    else if(hm<1430)phHint.textContent="13:00~14:30 — 오후 매매 구간";
    else if(hm<1520)phHint.textContent="14:30~15:20 — 마감 준비 | 포지션 정리";
    else phHint.textContent="15:20 이후 — 오버나잇 결정 후 청산";
  }
  // Phase 12-2: 시간대별 힌트
  const h=n.getHours()*60+n.getMinutes();
  const hint=document.getElementById("phaseHint");
  if(hint){
    if(h<540)hint.textContent="장 전 — 후보종목 선정 시간";
    else if(h<570)hint.textContent="⚠ 9:00~9:30 관망 구간 (추격 금지)";
    else if(h<690)hint.textContent="✅ 핵심 매매 구간 (10:30~11:30)";
    else if(h<780)hint.textContent="점심 — 신규 진입 자제";
    else if(h<870)hint.textContent="오후 매매 구간";
    else if(h<920)hint.textContent="⚠ 마감 준비 — 당일 포지션 청산";
    else hint.textContent="장 마감";
  }
}
function goPage(p,el){
  document.querySelectorAll(".page").forEach(d=>d.classList.remove("on"));
  const pg=document.getElementById("page-"+p);
  if(pg) pg.classList.add("on");
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("on"));
  if(el) el.classList.add("on");
  // ★ 페이지별 렌더 트리거 — 통계/일지가 비어있던 원인 해결
  try{
    if(p==='stats'){
      if(typeof renderStats==='function') renderStats();
      if(typeof renderStatsEnhanced==='function') renderStatsEnhanced();
    } else if(p==='journal'){
      if(typeof renderJPage==='function') renderJPage();
    }
  }catch(_e){ console.warn('goPage 렌더:', _e.message); }
  // ── 날짜 동기화 ──
  if(p==="hts"){
    // 대시보드 → HTS: 대시보드 날짜를 HTS에 반영
    const dashFrame=document.getElementById("dashFrame");
    if(dashFrame&&dashFrame.contentWindow){
      try{
        const dashDate=dashFrame.contentWindow.curDate;
        if(dashDate&&dashDate!==sim.date){
          sim.date=dashDate;
          const mockDateEl=document.getElementById("mockDate");
          if(mockDateEl) mockDateEl.value=dashDate;
          genCandles(activeTk,sim.date);
          initChart();
        }
      }catch(e){}
    }
  } else if(p==="dash"){
    // HTS → 대시보드: HTS 날짜를 대시보드에 항상 동기화 (단방향 push)
    const dashFrame=document.getElementById("dashFrame");
    if(dashFrame&&dashFrame.contentWindow){
      try{
        dashFrame.contentWindow._skipHtsSync=true;
        dashFrame.contentWindow.curDate=sim.date;
        const dashDateEl=dashFrame.contentWindow.document.getElementById("dashDate");
        if(dashDateEl){ dashDateEl.value=sim.date; }
        dashFrame.contentWindow.loadDashData&&dashFrame.contentWindow.loadDashData();
        dashFrame.contentWindow.autoLoadMarketData&&dashFrame.contentWindow.autoLoadMarketData();
        setTimeout(()=>{try{dashFrame.contentWindow._skipHtsSync=false;}catch(e){}},100);
      }catch(e){}
    }
    // 강세섹터 자동 관심종목 동기화 (하루 1회만)
    try{
      const _today=sim.date||new Date().toISOString().slice(0,10);
      const _lastSync=localStorage.getItem('htsAutoSyncDate')||'';
      if(_lastSync!==_today){
        saveToServer('htsAutoSyncDate',_today);
        syncCandidatesToWatchlist&&syncCandidatesToWatchlist();
      }
    }catch(e){}
  }
}


// ── 모바일 패널 제어 ──
function isMobile(){return window.innerWidth<=767;}
function isTablet(){return window.innerWidth>=768&&window.innerWidth<=1023;}
// 화면 크기 변경 시 자동 레이아웃 업데이트
let _lastW=window.innerWidth;
window.addEventListener('resize',()=>{
  const w=window.innerWidth;
  if(Math.abs(w-_lastW)>20){
    _lastW=w;
    if(w>1023) closeMobPanels(); // PC로 전환 시 패널 닫기
    drawChart(); // 차트 크기 재조정
  }
});
function openMobPanel(panel){
  // panel: 'lp' | 'rp' | 'brp'
  closeMobPanels();
  const el=document.querySelector('.'+panel);
  if(el){el.classList.add('mob-open');}
  const ov=document.getElementById('mobOverlay');
  if(ov)ov.style.display='block';
}
function closeMobPanels(){
  document.querySelectorAll('.lp,.rp,.brp').forEach(el=>el.classList.remove('mob-open'));
  const ov=document.getElementById('mobOverlay');
  if(ov)ov.style.display='none';
}
function mobTab(name,btn){
  if(!isMobile()&&!isTablet())return;
  // 먼저 HTS 페이지로 전환
  const htsTab=document.getElementById('tab-hts');
  goPage('hts',htsTab);
  // 모든 탭 비활성화
  document.querySelectorAll('.mob-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  closeMobPanels();
  if(name==='chart'){
    // 차트만 보임 (기본)
  } else if(name==='order'){
    openMobPanel('brp');
    // brp 주문 탭 활성화
    const orderTab=document.querySelector('.brpt[onclick*="order"]');
    if(orderTab){brTab(orderTab,'brpb-order');}
  } else if(name==='watchlist'){
    openMobPanel('lp');
    // lp 관심 탭 활성화
    const wlTab=document.querySelector('.lpt[onclick*="lpb-w"]');
    if(wlTab){lTab(wlTab,'lpb-w');}
  } else if(name==='hoga'){
    openMobPanel('rp');
  } else if(name==='ai'){
    openMobPanel('brp');
    const aiTab=document.querySelector('.brpt[onclick*="ai"]');
    if(aiTab){brTab(aiTab,'brpb-ai');}
  }
}

// ── 스와이프 제스처 ──
(function(){
  let sx=0,sy=0,startTime=0;
  const MIN_DIST=60,MAX_TIME=400,MAX_VERT=80;
  document.addEventListener('touchstart',e=>{
    if(!isMobile())return;
    sx=e.touches[0].clientX;sy=e.touches[0].clientY;startTime=Date.now();
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(!isMobile())return;
    const dx=e.changedTouches[0].clientX-sx;
    const dy=e.changedTouches[0].clientY-sy;
    const dt=Date.now()-startTime;
    if(dt>MAX_TIME||Math.abs(dy)>MAX_VERT||Math.abs(dx)<MIN_DIST)return;
    // 우→좌 스와이프: 관심목록 열기
    if(dx>MIN_DIST&&sx<60){
      const htsPage=document.getElementById('page-hts');
      if(htsPage&&htsPage.classList.contains('on')){
        openMobPanel('lp');
        document.querySelectorAll('.mob-tab').forEach(b=>b.classList.remove('active'));
        const wlBtn=document.getElementById('mbt-watchlist');
        if(wlBtn)wlBtn.classList.add('active');
      }
    }
    // 좌→우 스와이프 (오른쪽 끝에서): 호가창 열기
    if(dx<-MIN_DIST&&sx>window.innerWidth-60){
      const htsPage=document.getElementById('page-hts');
      if(htsPage&&htsPage.classList.contains('on')){
        openMobPanel('rp');
        document.querySelectorAll('.mob-tab').forEach(b=>b.classList.remove('active'));
        const hgBtn=document.getElementById('mbt-hoga');
        if(hgBtn)hgBtn.classList.add('active');
      }
    }
  },{passive:true});
})();

// ── 화면 크기 변경 시 처리 ──
window.addEventListener('resize',()=>{
  if(!isMobile())closeMobPanels();
  requestAnimationFrame(()=>drawChart());
},false);

function lTab(el,id){document.querySelectorAll(".lpt").forEach(t=>t.classList.remove("on"));el.classList.add("on");document.querySelectorAll(".lpb").forEach(b=>{b.classList.remove("on");b.style.display="none";});const t=document.getElementById(id);if(t){t.style.display="block";t.classList.add("on");}}
function rTab(el,id){document.querySelectorAll(".rpt").forEach(t=>t.classList.remove("on"));el.classList.add("on");document.querySelectorAll(".rpb").forEach(b=>{b.classList.remove("on");b.style.display="none";});const t=document.getElementById(id);if(t){t.style.display="block";t.classList.add("on");}}
function brTab(el,id){document.querySelectorAll(".brpt").forEach(t=>t.classList.remove("on"));el.classList.add("on");document.querySelectorAll(".brpb").forEach(b=>{b.classList.remove("on");b.style.display="none";});const t=document.getElementById(id);if(t){t.style.display=id==="brpb-ai"?"flex":"block";t.classList.add("on");}}
function openModal(id){
  document.getElementById("modal-"+id).classList.add("show");
  if(id==="settings"){
    const keys=["capital","dayloss","maxpos","clim","mlim","crate","mrate","bf","sf","tx"];
    keys.forEach(k=>{const el=document.getElementById("cfg-"+k);if(el)el.value=cfg[k];});
    document.getElementById("cfg-bd").checked=cfg.bd;
    document.getElementById("cfg-al").checked=cfg.al;
    // ★ 설정창 열릴 때 서버에서 API 키 자동 로드
    loadKisConfig();
  }
  if(id==="journal"){const tt=mock.trades.filter(t=>t.date===sim.date);const pnl=tt.filter(t=>t.side==="sell").reduce((a,t)=>a+t.pnl,0);document.getElementById("jModalBody").innerHTML=tt.length?`<div style="font-size:11px;color:var(--ts);">${sim.date} 거래 ${tt.length}건 · 손익 ${pnl>=0?"+":""}${pnl.toLocaleString()}원</div><div style="font-size:10px;color:var(--tm);margin-top:5px;">AI 일지 생성 버튼을 눌러주세요.</div>`:"<div style='font-size:11px;color:var(--tm);'>오늘 거래가 없습니다.</div>";}
}
function closeModal(id){document.getElementById("modal-"+id).classList.remove("show");}
function showAlert(t,m){document.getElementById("alertTtl").textContent=t;document.getElementById("alertMsg").textContent=m;openModal("alert");}
document.querySelectorAll(".modal-bg").forEach(el=>{el.addEventListener("click",e=>{if(e.target===el){const id=el.id.replace("modal-","");closeModal(id);}});});

// ═══════════════════════════════
// 매매기법 선택
// ═══════════════════════════════
let userTechnique = 'auto'; // 'auto' = AI 자동, 나머지는 고정
function setUserTechnique(val){
  userTechnique = val;
  const tag = document.getElementById('techniqueTag');
  const sel = document.getElementById('techniqueSelect');
  if(val === 'auto'){
    if(tag) tag.style.display = 'none';
  } else {
    if(tag){ tag.textContent = val; tag.style.display = 'block'; }
  }
}

// ═══════════════════════════════
// 강세 섹터 순위
// ═══════════════════════════════
const SECTOR_STOCKS = {
  '반도체': ['005930','000660','042700','058470','357780'],
  '2차전지': ['051910','006400','373220','247540','003670'],
  '바이오': ['068270','207940','128940','009540','326030'],
  '자동차': ['005380','000270','012330','241560','304000'],
  '인터넷·플랫폼': ['035420','035720','259960','293490','252010'],
  '방산·우주': ['012450','047810','006280','064350','272210'],
  '조선': ['010140','009540','042660','00970','267250'],
  '철강·소재': ['005490','004020','002810','006360','011790'],
};



// ═══════════════════════════════
// 차트 우클릭 AI 분석
// ═══════════════════════════════
let _ctxCandle = null;
function initChartRightClick(){
  const wrap = document.querySelector('.chart-main');
  if(!wrap||wrap._rcOk) return;
  wrap._rcOk = true;
  wrap.addEventListener('contextmenu', e=>{
    e.preventDefault();
    const canvas = document.getElementById('mainChart');
    if(!canvas) return;
    const r = wrap.getBoundingClientRect();
    const x = e.clientX - r.left;
    const cs = _cvCs();
    if(!cs.length) return;
    const PL=4, PR=54, cw=(canvas.width||700)-PL-PR;
    const idx = Math.floor((x-PL)/(cw/cs.length));
    const c = cs[Math.max(0,Math.min(idx,cs.length-1))];
    _ctxCandle = c;
    const menu = document.getElementById('chartCtxMenu');
    const info = document.getElementById('ctxCandleInfo');
    if(info && c) info.textContent = `${c.t} | O${c.o.toLocaleString()} H${c.h.toLocaleString()} L${c.l.toLocaleString()} C${c.c.toLocaleString()}`;
    if(menu){
      menu.style.display='block';
      menu.style.left = Math.min(e.clientX, window.innerWidth-180)+'px';
      menu.style.top = Math.min(e.clientY, window.innerHeight-160)+'px';
    }
  });
  document.addEventListener('click', ()=>closeChartCtx());
  document.addEventListener('touchstart', ()=>closeChartCtx(), {passive:true});
}
function closeChartCtx(){
  const m = document.getElementById('chartCtxMenu');
  if(m) m.style.display='none';
}
async function ctxAskAI(type){
  closeChartCtx();
  const c = _ctxCandle;
  const stk = STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];
  const cs = _cvCs();
  const cls = cs.map(x=>x.c);
  const rsi = (calcRSI(cls,14).slice(-1)[0]||50).toFixed(0);
  const ma5 = (calcMA(cls,5).slice(-1)[0]||0).toFixed(0);
  const ma20 = (calcMA(cls,20).slice(-1)[0]||0).toFixed(0);
  const popup = document.getElementById('chartAiPopup');
  const body = document.getElementById('aiPopupBody');
  const title = document.getElementById('aiPopupTitle');
  if(popup){
    popup.style.display='block';
    popup.style.left='50%'; popup.style.top='50%';
    popup.style.transform='translate(-50%,-50%)';
  }
  if(title) title.textContent = type==='buy'?'🟢 매수 판단':type==='sell'?'🔴 매도 판단':'🔍 구간 분석';
  if(body) body.textContent='분석 중...';

  const prompts = {
    buy: `단타 트레이더야. 솔직하게 쉽게 말해줘 (토스 알림처럼).
종목: ${stk.nm} | 현재가: ${c?.c?.toLocaleString()||'-'}원
RSI: ${rsi} | 5MA: ${ma5} | 20MA: ${ma20}
이 가격에서 지금 매수하면 어때? 3줄로.`,
    sell: `단타 트레이더야. 솔직하게 쉽게 말해줘 (토스 알림처럼).
종목: ${stk.nm} | 현재가: ${c?.c?.toLocaleString()||'-'}원
RSI: ${rsi} | 5MA: ${ma5} | 20MA: ${ma20}
이 가격에서 지금 매도하면 어때? 3줄로.`,
    analysis: `단타 트레이더야. 쉽고 직관적으로 말해줘.
종목: ${stk.nm} | TF: ${sim.tf}분
이 시간대 캔들 (${c?.t||'-'}): O${c?.o||'-'} H${c?.h||'-'} L${c?.l||'-'} C${c?.c||'-'}
RSI: ${rsi} | 5MA: ${ma5} | 20MA: ${ma20}
이 구간 차트 상황 한마디로 요약하고 대응 알려줘. 4줄 이내.`,
  };
  try{
    const data = await callClaude({model:'claude-sonnet-4-5',max_tokens:200,messages:[{role:'user',content:prompts[type]}]},'차트클릭AI');
    const text = data.content?.[0]?.text||'분석 실패';
    if(body) body.innerHTML = text.replace(/\n/g,'<br>');
  }catch(e){
    if(body) body.textContent = '분석 실패: '+e.message;
  }
}

// ═══════════════════════════════
// 차트 AI 타점 오버레이
// ═══════════════════════════════
let _aiSignals = []; // [{idx, type:'buy'|'sell', price, reason}]
async function analyzeChartSignals(){
  const cs = _cvCs();
  if(cs.length < 10) return;
  const cls = cs.map(c=>c.c);
  const rsi = calcRSI(cls,14);
  const ma5 = calcMA(cls,5);
  const ma20 = calcMA(cls,20);
  const signals = [];
  // 간단한 로컬 신호 생성 (API 호출 없이)
  cs.forEach((c,i)=>{
    if(i<20) return;
    const r = rsi[i]||50;
    const m5 = ma5[i]||0;
    const m20 = ma20[i]||0;
    const prev = cs[i-1];
    // 매수 신호: RSI 30~50, 5MA > 20MA, 양봉 전환
    if(r>=30&&r<=55&&m5>m20&&c.c>c.o&&prev.c<prev.o){
      signals.push({idx:i,type:'buy',price:c.c,reason:'RSI반등+5MA상향'});
    }
    // 매도 신호: RSI 70이상 또는 음봉 + MA하향
    if((r>=70||( m5<m20&&c.c<c.o&&prev.c>prev.o))){
      signals.push({idx:i,type:'sell',price:c.c,reason:r>=70?'RSI과매수':'MA데드크로스'});
    }
  });
  // 너무 많으면 최근 것만
  _aiSignals = signals.slice(-10);
  drawSignalOverlay();
}

// ── 시뮬 슬라이더 이동 ──
function seekToSlider(val){
  const total = sim.candles.length;
  if(!total) return;
  const idx = Math.max(0, Math.min(Math.round((val/100)*(total-1)), total-1));
  sim.idx = idx;
  // 재생 중이면 멈추기
  if(sim.playing){ sim.playing=false; _syncPlayBtn(); if(sim.timer){clearTimeout(sim.timer);sim.timer=null;} }
  updChartToIdx();
}
function seekToPos(e, el){
  const r = el.getBoundingClientRect();
  const pct = Math.max(0, Math.min((e.clientX - r.left) / r.width, 1));
  const sl = document.getElementById('simSlider');
  if(sl) sl.value = pct*100;
  seekToSlider(pct*100);
}

// ── updChartToIdx에서 슬라이더 동기화 (seekToPos에서 직접 호출) ──

// ── Phase 8 실시간 수치 표시 ──
function updatePhase8Live(){
  const el = document.getElementById('phase8Check');
  if(!el) return;
  const cs = getCandles(20);
  if(cs.length < 5){ el.innerHTML='-'; return; }
  const cls = cs.map(c=>c.c), vls = cs.map(c=>c.v);
  const lc = cs[cs.length-1];
  const ma5 = calcMA(cls,5), ma20 = calcMA(cls,20), ma60 = calcMA(cls,60);
  const lma5 = ma5[ma5.length-1]||0, lma20 = ma20[ma20.length-1]||0, lma60 = ma60[ma60.length-1]||0;
  const rsi = parseFloat((calcRSI(cls,14).slice(-1)[0]||50).toFixed(1));
  const volR = vls.length>=2 ? (vls[vls.length-1]/vls[vls.length-2]) : 1;
  const stk = STOCKS.find(s=>s.tk===activeTk)||STOCKS[0];

  const row = (label, val, ok) =>
    `<div style="display:flex;justify-content:space-between;padding:1px 0;border-bottom:1px solid rgba(0,0,0,.04);">
      <span style="color:var(--tm);font-size:8px;">${label}</span>
      <span style="font-weight:700;font-size:9px;font-family:var(--mono);color:${ok===true?'#16a34a':ok===false?'#dc2626':'var(--ts)'};">${val}</span>
    </div>`;

  // STEP1: 시장 방향 — 당일 최종점수 참조 금지, 현재 봉 기준으로 계산
  // getDashData(sim.date) 사용 금지 (미래 데이터). 현재까지 봉으로 추정
  const maScore = lma5 > lma20 ? 1 : 0;
  const rsiScore = rsi>=45 && rsi<=70 ? 1 : 0;
  const volScore = parseFloat(volR)>=1.3 ? 1 : 0;
  const mktEstScore = 5 + maScore + rsiScore + volScore; // 5~8 추정
  const mktOk = mktEstScore >= 6;
  // STEP2: 강세 섹터 (현재 섹터)
  const secOk = stk.sec ? true : null;
  // STEP3: 종목 수급 (거래량)
  const volOk = volR >= 1.3;
  // STEP4: 차트 (5MA > 20MA)
  const chartOk = lma5 > lma20;
  // STEP5: 체결 강도 (종가 > 시가)
  const momOk = lc.c > lc.o;
  // STEP6: R/R
  const so = stopOrders[activeTk];
  const rrOk = so ? ((so.t1 - lc.c) / (lc.c - so.stop) >= 1.5) : null;
  // STEP7: 손절가
  const stopOk = !!so;

  el.innerHTML =
    row('STEP1 시장', `${mktEstScore>=7?'우호적':mktEstScore>=6?'보통':'비우호'} (현재봉 기준 ~${mktEstScore}/10)`, mktOk) +
    row('STEP2 섹터', stk.sec||'미지정', secOk) +
    row('STEP3 수급', `거래량 ×${volR.toFixed(1)}`, volOk) +
    row('STEP4 차트', `5MA ${Math.round(lma5).toLocaleString()} / 20MA ${Math.round(lma20).toLocaleString()}`, chartOk) +
    row('STEP5 모멘텀', `RSI ${rsi} / ${lc.c>lc.o?'양봉':'음봉'}`, momOk && rsi>=45 && rsi<=75) +
    row('STEP6 R/R', so ? `1:${((so.t1-lc.c)/(lc.c-so.stop)).toFixed(1)}` : '손절 미설정', rrOk) +
    row('STEP7 손절가', so ? `${so.stop.toLocaleString()}원` : '미설정', stopOk);
}

// ── B/S 타점 — 봉 좌표와 일치하도록 수정 ──
function drawSignalOverlay(){
  const canvas = document.getElementById('signalChart');
  const mainCv = document.getElementById('mainChart');
  if(!canvas || !mainCv) return;
  const W = mainCv.width||700, H = mainCv.height||400;
  if(canvas.width!==W || canvas.height!==H){ canvas.width=W; canvas.height=H; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  if(!_aiSignals.length) return;

  const cs = _cvCs();
  if(!cs.length) return;

  // drawChart와 동일한 좌표계
  const PL=4, PR=54, PT=8, PB=22, SB=12;
  const volH = inds.vol ? Math.floor(H*0.20) : 0;
  const mainH = H - PT - PB - volH - SB;
  const cw = W - PL - PR;

  const prices = cs.flatMap(c=>[c.h,c.l]).filter(v=>v>0);
  if(!prices.length) return;
  let yMin = Math.min(...prices), yMax = Math.max(...prices);
  const yPad = (yMax-yMin)*0.06 || yMin*0.005 || 1;
  yMin -= yPad; yMax += yPad;
  const yR = yMax - yMin || 1;

  const toX = i => PL + (i+0.5) * (cw/cs.length);
  const toY = v => PT + mainH * (1 - (v-yMin)/yR);

  _aiSignals.forEach(sig => {
    if(sig.idx < 0 || sig.idx >= cs.length) return;
    const c = cs[sig.idx];
    const x = toX(sig.idx);
    const isBuy = sig.type === 'buy';
    // B=빨간, S=파란 (요청대로)
    const col = isBuy ? '#dc2626' : '#2563eb';
    const yBase = isBuy ? toY(c.l) : toY(c.h);

    ctx.save();
    ctx.fillStyle = col;
    // 삼각형
    ctx.beginPath();
    if(isBuy){
      ctx.moveTo(x, yBase+14);
      ctx.lineTo(x-7, yBase+24);
      ctx.lineTo(x+7, yBase+24);
    } else {
      ctx.moveTo(x, yBase-14);
      ctx.lineTo(x-7, yBase-24);
      ctx.lineTo(x+7, yBase-24);
    }
    ctx.fill();

    // 라벨 + 수치
    ctx.fillStyle = col;
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isBuy?'B':'S', x, isBuy?yBase+34:yBase-28);
    // 가격 수치
    ctx.font = '7px JetBrains Mono,monospace';
    ctx.fillStyle = col;
    const priceStr = (c.c/1000).toFixed(0)+'k';
    ctx.fillText(priceStr, x, isBuy?yBase+43:yBase-37);
    ctx.restore();
  });
}

// ── API 키 만료/한도 감지 + 어떤 API인지 추정 ──
function checkApiKeyExpiry(errorMsg, hint){
  if(!errorMsg) return;
  const msg = String(errorMsg);
  // 사용량 한도(Usage Limits)와 키 만료를 구분
  const isUsageLimit = /usage limit|reached your specified|regain access on|rate_limit|429/i.test(msg);
  const expired = isUsageLimit || msg.includes('expired') || msg.includes('invalid') ||
                  msg.includes('401') || msg.includes('authentication') ||
                  msg.includes('Unauthorized') || msg.includes('invalid_api_key') ||
                  msg.includes('EGW') /* KIS 에러코드 */ ||
                  msg.includes('rt_cd') /* KIS */ ;
  if(!expired) return;
  // 어떤 API인지 추정
  let api = hint || '';
  if(!api){
    if(/anthropic|claude|sk-ant|invalid_api_key|invalid_request_error|usage limit/i.test(msg)) api = 'Claude (Anthropic)';
    else if(/kis|koreainvestment|appkey|appsecret|EGW|rt_cd/i.test(msg)) api = 'KIS 한국투자증권';
    else if(/notion/i.test(msg)) api = 'Notion';
    else if(/dart/i.test(msg)) api = 'DART';
    else api = 'API (상세 불명)';
  }
  // 중복 배너 방지
  const exist = document.querySelector('[data-api-expiry-banner]');
  if(exist) exist.remove();
  const box = document.createElement('div');
  box.setAttribute('data-api-expiry-banner','1');
  box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:10px 16px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
  // Usage limit인 경우: 잔액 충전과 별개. 콘솔에서 한도 늘려야 함
  if(isUsageLimit && api.includes('Claude')){
    // reset 날짜 추출
    const dateMatch = msg.match(/regain access on (\d{4}-\d{2}-\d{2})/i);
    const resetDate = dateMatch ? dateMatch[1] : '한도 reset일';
    box.innerHTML = `⚠️ <b>Claude 사용량 한도 초과</b>
      <span style="font-size:11px;">잔액 충전 ≠ 한도 해제. 콘솔에서 직접 한도(Spend limit) 상향 필요</span>
      <a href="https://console.anthropic.com/settings/limits" target="_blank" style="border:2px solid #fff;background:#fff;color:#dc2626;padding:3px 10px;border-radius:5px;text-decoration:none;font-weight:700;">콘솔 한도 설정 ↗</a>
      <span style="font-size:10px;opacity:.9;">재접근 가능: ${resetDate}</span>
      <button onclick="this.parentNode.remove()" style="border:none;background:none;color:#fff;cursor:pointer;font-size:16px;margin-left:auto;">✕</button>`;
  }else{
    const lifetime = api.includes('Claude') ? '영구 (한도 초과/직접 폐기 시 발생)'
      : api.includes('KIS') ? '실거래 키 1년 / 모의투자 키 1개월 (모의는 자주 만료)'
      : api.includes('Notion') ? '영구 (Integration 삭제 시)'
      : api.includes('DART') ? '영구' : '확인 필요';
    box.innerHTML = `⚠️ <b>${api}</b> 키 만료/오류 — 일반적인 만료 주기: <i>${lifetime}</i>
      <span style="font-size:10px;opacity:.9;">에러: ${msg.slice(0,120)}</span>
      <button onclick="openModal('settings');this.parentNode.remove()" style="border:2px solid #fff;background:none;color:#fff;padding:3px 12px;border-radius:5px;cursor:pointer;font-weight:700;margin-left:auto;">설정 열기</button>
      <button onclick="this.parentNode.remove()" style="border:none;background:none;color:#fff;cursor:pointer;font-size:16px;">✕</button>`;
  }
  document.body.appendChild(box);
  try{ addDecisionLog('⚠ '+api, (isUsageLimit?'사용량 한도':'키 오류')+' — '+msg.slice(0,80), 'NOGO'); }catch(_e){}
}

// ── 대시보드 데이터 브릿지 ──
let _dashCache = {};
function setDashData(d){ if(d && d.date) _dashCache[d.date]=d; }
function getDashData(date){
  if(_dashCache[date]) return _dashCache[date];
  // 기본 시장 점수 계산
  const score = 5;
  return { score, date };
}

// ── 진행률 표시 시스템 ──
let _progressTimer = null;
function showProgress(label, steps){
  // 상단에 진행바 표시
  let bar = document.getElementById('_globalProgress');
  if(!bar){
    bar = document.createElement('div');
    bar.id = '_globalProgress';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:var(--pan);border-bottom:2px solid var(--br);padding:5px 14px;display:flex;align-items:center;gap:10px;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,.1);';
    document.body.appendChild(bar);
  }
  bar.style.display = 'flex';
  let pct = 0;
  bar.innerHTML = `
    <div style="flex:1;">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
        <span id="_pgLabel" style="font-weight:600;color:var(--tp);">${label}</span>
        <span id="_pgPct" style="font-family:var(--mono);color:var(--b);font-weight:700;">0%</span>
      </div>
      <div style="height:3px;background:var(--bg);border-radius:2px;overflow:hidden;">
        <div id="_pgBar" style="height:100%;width:0%;background:linear-gradient(90deg,var(--b),var(--g));border-radius:2px;transition:width .3s;"></div>
      </div>
    </div>
    <button onclick="document.getElementById('_globalProgress').style.display='none'" style="border:none;background:none;color:var(--tm);cursor:pointer;font-size:14px;padding:0 4px;">✕</button>`;

  // 단계별로 자동 진행
  if(_progressTimer) clearInterval(_progressTimer);
  const stepPct = steps ? 95/steps : 5;
  _progressTimer = setInterval(()=>{
    pct = Math.min(pct + stepPct + (Math.random()*2-1), 95);
    const pgBar = document.getElementById('_pgBar');
    const pgPct = document.getElementById('_pgPct');
    if(pgBar) pgBar.style.width = pct+'%';
    if(pgPct) pgPct.textContent = Math.round(pct)+'%';
  }, 400);
  return bar;
}

function finishProgress(label){
  if(_progressTimer){ clearInterval(_progressTimer); _progressTimer=null; }
  const pgBar = document.getElementById('_pgBar');
  const pgPct = document.getElementById('_pgPct');
  const pgLabel = document.getElementById('_pgLabel');
  if(pgBar) pgBar.style.width = '100%';
  if(pgPct) pgPct.textContent = '100%';
  if(pgLabel && label) pgLabel.textContent = '✅ '+label;
  setTimeout(()=>{
    const bar = document.getElementById('_globalProgress');
    if(bar) bar.style.display = 'none';
  }, 1500);
}

function failProgress(label){
  if(_progressTimer){ clearInterval(_progressTimer); _progressTimer=null; }
  const pgBar = document.getElementById('_pgBar');
  const pgLabel = document.getElementById('_pgLabel');
  if(pgBar){ pgBar.style.width = '100%'; pgBar.style.background = 'var(--r)'; }
  if(pgLabel) pgLabel.textContent = '❌ '+label;
  setTimeout(()=>{
    const bar = document.getElementById('_globalProgress');
    if(bar) bar.style.display = 'none';
  }, 3000);
}

// ═══════════════════════════════
// 실시간 지수 표시 (Yahoo Finance 실제 데이터)
// ═══════════════════════════════
let _idxCache = null;
let _idxFetching = false;

// ── 시장 데이터 통합 시스템 (실시간 + 모의투자 연동) ──
let _mktData = null;      // 현재 로드된 시장 데이터
let _mktFetching = false;
let _mktLastFetch = 0;

async function fetchMarketData(forceRefresh){
  if(_mktFetching) return;
  const now = Date.now();
  // 실시간 모드: 3분 캐시 / 모의투자: 날짜+시간 바뀔 때만
  if(!forceRefresh && _mktData && (now - _mktLastFetch < 3 * 60 * 1000)) return;
  _mktFetching = true;
  try{
    let url;
    if(sim.playing || sim.idx > 0){
      // 모의투자 모드: 현재 봉 시각 기준으로 데이터 요청
      const curCandle = getCurrentCandle();
      const simTimeStr = curCandle ? curCandle.t : '09:00';
      url = `/api/market-data?mode=sim&date=${sim.date}&time=${encodeURIComponent(simTimeStr)}&tf=${sim.tf}`;
    } else {
      url = '/api/market-data?mode=realtime';
    }
    const r = await fetch(url);
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    _mktData = d;
    _mktLastFetch = now;
    _updateIdxUI(d);
    _updateDashboardMarket(d);
  }catch(e){
    console.warn('시장데이터 fetch 실패:', e.message);
    if(!_mktData){
      // 기본값
      document.getElementById('idx-kospi') && (_setIdxUI('idx-kospi', 2650, 0));
      document.getElementById('idx-kosdq') && (_setIdxUI('idx-kosdq', 850, 0));
    }
  }
  _mktFetching = false;
}

function _updateIdxUI(d){
  if(!d || !d.indices) return;
  const idx = d.indices;
  if(idx.kospi?.price)  _setIdxUI('idx-kospi',  idx.kospi.price,  idx.kospi.chgPct||0);
  if(idx.kosdq?.price)  _setIdxUI('idx-kosdq',  idx.kosdq.price,  idx.kosdq.chgPct||0);
  // 업데이트 시각 표시
  const kEl = document.getElementById('idx-kospi-time');
  if(kEl && idx.kospi?.lastUpdatedKST) kEl.textContent = idx.kospi.lastUpdatedKST.slice(11,19);
}

function _updateDashboardMarket(d){
  if(!d || !d.indices) return;
  const idx = d.indices;
  // 대시보드 시장카드 자동 업데이트
  const cards = {
    'dc-kospi': idx.kospi,
    'dc-kosdq': idx.kosdq,
    'dc-nasdaq': idx.nasdaq,
    'dc-sp500': idx.sp500,
    'dc-dow': idx.dow,
    'dc-usdkrw': idx.usdkrw,
    'dc-vix': idx.vix,
    'dc-nikkei': idx.nikkei,
  };
  for(const [id, data] of Object.entries(cards)){
    const el = document.getElementById(id);
    if(!el || !data?.price) continue;
    const up = (data.chgPct||0) >= 0;
    el.innerHTML = `<span class="${up?'cu':'cd'}" style="font-family:var(--mono);font-weight:700;">${data.price.toLocaleString()}</span>
      <span class="${up?'cu':'cd'}" style="font-size:8px;">${up?'+':''}${(data.chgPct||0).toFixed(2)}%</span>
      ${data.lastUpdatedKST?`<span style="font-size:7px;color:var(--tm);display:block;">${data.lastUpdatedKST.slice(11,19)} 기준</span>`:''}`;
  }
  // 야간선물: 실제 데이터 없음 (표시 안 함)
  const nfEl2 = document.getElementById('dc-nightfutures');
  if(nfEl2){ nfEl2.innerHTML = '<span style="color:var(--tm);font-size:9px;">실시간 연결 필요</span>'; }
}

// 하위호환
function _syncIdxWithSim(){ fetchMarketData(); }
async function fetchRealIndex(){ await fetchMarketData(); }

// 모의투자 봉 진행 시 시장 데이터 갱신 (5봉마다)
let _mktSyncCnt = 0;
function _onSimBarAdvance(){
  _mktSyncCnt++;
  if(_mktSyncCnt % 5 === 0) fetchMarketData(true);
}
function _setIdxUI(id, val, chg){
  const ve=document.getElementById(id), ce=document.getElementById(id+'-chg');
  if(!ve)return;
  ve.textContent=val.toLocaleString();
  const up=chg>=0;
  ve.style.color=up?'var(--r)':'var(--b)';
  if(ce){ce.textContent=(up?'+':'')+chg.toFixed(2)+'%';ce.style.color=ve.style.color;}
}

async function runIdxAIPrediction(){
  const now=Date.now();
  if(now-_idxSim.lastPred < 3*60*1000) return; // 3분 쿨다운
  _idxSim.lastPred = now;
  const cs=getRecentCandles(10);
  if(cs.length<3) return;
  const cls=cs.map(c=>c.c);
  const rsi=(calcRSI(cls,9).slice(-1)[0]||50).toFixed(0);
  const vol=cs.length>=2?(cs[cs.length-1].v/cs[cs.length-2].v).toFixed(1):'1.0';
  const lc=cs[cs.length-1];
  try{
    const data=await callClaude({
      model:'claude-sonnet-4-5',max_tokens:80,
      messages:[{role:'user',content:`지금 시장 초단기(5~15분) 방향 예측. RSI:${rsi} 거래량:${vol}배 현재가:${lc.c.toLocaleString()}. JSON만: {"dir":"상승예상"또는"하락예상"또는"횡보","confidence":75}`}]
    },'지수예측');
    const text=data.content?.[0]?.text||'';
    const m=text.match(/\{[\s\S]*\}/);
    if(!m)return;
    const p=JSON.parse(m[0]);
    const el=document.getElementById('idx-pred');
    if(!el)return;
    const isUp=p.dir?.includes('상승');
    const isDown=p.dir?.includes('하락');
    el.style.display='block';
    el.textContent=`${isUp?'▲':isDown?'▼':'→'} ${p.dir||'횡보'} (${p.confidence||50}%)`;
    el.style.background=isUp?'rgba(5,192,114,.15)':isDown?'rgba(240,64,64,.15)':'rgba(156,163,175,.15)';
    el.style.color=isUp?'var(--g)':isDown?'var(--r)':'var(--tm)';
  }catch(e){}
}

// ── updChartToIdx: 봉 이동 시 일괄 처리 (무한재귀 없음) ──
function updChartToIdx(){
  // 1. 차트 렌더
  const cs = getCandles(1);
  const lc = cs[cs.length-1];
  if(lc) updPrice(lc);
  try{ updChartHeader&&updChartHeader(); }catch(e){}
  // Auto-follow: 사용자가 끝쪽에 두면 새 봉을 따라 자동 스크롤
  if(window._followLatest !== false && !window._chartUserDragging){
    try{
      const _allLen = sim.candles.length;
      if(_allLen > chartViewCount){
        const _newStart = Math.max(0, sim.idx - chartViewCount + 5);
        if(_newStart !== chartViewStart) chartViewStart = _newStart;
      }
    }catch(_e){}
  }
  // 슬라이더 동기화
  const total = sim.candles.length;
  const pct = total > 1 ? (sim.idx / (total-1)) * 100 : 0;
  const sl = document.getElementById('simSlider');
  if(sl) sl.value = pct;
  const pf = document.getElementById('progF');
  if(pf) pf.style.width = pct + '%';
  const msBar = document.getElementById('msBar');
  if(msBar) msBar.textContent = sim.idx;
  const msTime = document.getElementById('msTime');
  if(msTime && lc) msTime.textContent = lc.t || '--:--';
  // 자동 우측 스크롤 (드래그 중 아닐 때만)
  if(!window._chartUserDragging){
    const viewEnd = chartViewStart + chartViewCount;
    if(sim.idx >= viewEnd - 2 || sim.idx >= sim.candles.length - 4){
      chartViewStart = Math.max(0, sim.idx - Math.floor(chartViewCount * 0.75));
    }
  }
  drawChart();
  // 2. 자동매매 step 체크 (Level 4 마감청산)
  if(autoState.running){
    const _cs = getCandles(1);
    runAutoStep(_cs);  // Level 4 마감청산 전용
  }
  // 3. 지수/시장 데이터 동기화 (5봉마다)
  _onSimBarAdvance();
  // 4. AI 예측 (3분마다, 비동기)
  runIdxAIPrediction().catch(()=>{});
}

// ═══════════════════════════════
// 조건검색 → 관심종목 추가 + 분석 팝업
// ═══════════════════════════════
function addToWatchlistWithAnalysis(tk, why){
  const stk=STOCKS.find(s=>s.tk===tk)||{tk,nm:tk,pr:0,base:1,sec:''};
  // 이미 관심종목에 있으면 그냥 이동
  if(WGS[0]&&WGS[0].includes(tk)){
    selectStk(tk);
    showAlert('이미 추가됨', `${stk.nm}은 이미 관심종목에 있어요`);
    return;
  }
  // 팝업 띄우기
  const popup = document.getElementById('watchAddPopup') || (() => {
    const d=document.createElement('div');
    d.id='watchAddPopup';
    d.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--pan);border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.2);padding:20px;width:320px;max-width:90vw;';
    document.body.appendChild(d);
    return d;
  })();

  popup.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="font-size:14px;font-weight:700;">${stk.nm} <span style="font-size:10px;color:var(--tm);font-family:var(--mono);">${tk}</span></span>
      <button onclick="document.getElementById('watchAddPopup').style.display='none'" style="border:none;background:none;font-size:16px;cursor:pointer;color:var(--tm);">✕</button>
    </div>
    <div style="font-size:11px;color:var(--ts);margin-bottom:12px;">${why||'조건 검색 결과'}</div>
    <div id="watchAnalysisBody" style="font-size:11px;line-height:1.7;color:var(--ts);background:var(--bg);border-radius:8px;padding:10px;margin-bottom:12px;min-height:80px;">
      <span style="color:var(--tm);">분석 중...</span>
    </div>
    <div style="display:flex;gap:8px;">
      <button onclick="addToWG(0,'${tk}');document.getElementById('watchAddPopup').style.display='none';renderWLGroup();showAlert('추가됨','${stk.nm} 관심종목 추가됨');" style="flex:1;padding:8px;border-radius:8px;border:none;background:var(--b);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">+ 관심종목 추가</button>
      <button onclick="selectStk('${tk}');document.getElementById('watchAddPopup').style.display='none';" style="padding:8px 12px;border-radius:8px;border:1.5px solid var(--br);background:none;font-size:12px;cursor:pointer;">차트 보기</button>
    </div>`;
  popup.style.display='block';

  // AI 분석 실행
  const ab=document.getElementById('watchAnalysisBody');
  callClaude({
    model:'claude-sonnet-4-5',max_tokens:200,
    messages:[{role:'user',content:`단타 관점에서 ${stk.nm}(${tk}) 종목 체크포인트를 알려줘. 수급/모멘텀/재료/공매도/리스크 각 1줄씩. 쉽게.`}]
  },'종목분석팝업').then(d=>{
    const t=d.content?.[0]?.text||'분석 실패';
    if(ab)ab.innerHTML=t.replace(/\n/g,'<br>');
  }).catch(e=>{ if(ab)ab.textContent='Claude API 키 필요'; });
}

// addCandFromFilter 업그레이드 — 팝업 포함
function addCandFromFilter(tk, why){
  addToWatchlistWithAnalysis(tk, why);
}

function addToWG(g, tk){
  if(!WGS[g])WGS[g]=[];
  if(!WGS[g].includes(tk))WGS[g].push(tk);
  if(g===0)WL=WGS[0];
  saveWGS();
}

// ═══════════════════════════════
// 매매일지 AI 매매 구분 표시
// ═══════════════════════════════
// 일지 단건 복사 (Claude Code/Notion 등에 붙여넣기 용)
function copyJEntry(date){
  try{
    const js = safeParseJSON(localStorage.getItem('htsJournals'), '{}');
    const e = js[date];
    if(!e){ showAlert('복사', '일지를 찾을 수 없습니다'); return; }
    const md = `# 매매일지 — ${date}\n\n` +
      `**손익**: ${(e.pnl||0)>=0?'+':''}${(e.pnl||0).toLocaleString()}원\n` +
      `**매매**: ${e.total||0}건 / 승률 ${e.total?Math.round((e.wins||0)/e.total*100):0}%\n\n` +
      (e.summary?`**요약**: ${e.summary}\n\n`:'') +
      (e.market_context?`## 시장 환경\n${e.market_context}\n\n`:'') +
      `## 매매 분석\n` +
      `- **진입 이유**: ${e.why_bought||'-'}\n` +
      `- **청산 이유**: ${e.why_sold||'-'}\n\n` +
      `## 평가\n` +
      `- ✅ 잘한점: ${e.good||'-'}\n` +
      `- 🔴 반성: ${e.bad||e.mistakes||'-'}\n` +
      `- 🧠 심리: ${e.psychology||'-'}\n` +
      `- 💡 개선: ${e.improvement||'-'}\n` +
      `- 📋 Phase 체크: ${e.phase_check||'-'}\n` +
      (e.mentor_comment?`\n## 멘토 한마디\n> ${e.mentor_comment}\n`:'') +
      (e.score_total?`\n## 점수\n원칙:${e.score_principle||'-'} 타점:${e.score_timing||'-'} 심리:${e.score_psychology||'-'} | **종합 ${e.score_total}/10**\n`:'') +
      (e.trades?`\n## 매매 내역\n\`\`\`\n${e.trades}\n\`\`\`\n`:'');
    navigator.clipboard.writeText(md).then(()=>{
      const btn = document.querySelector(`button[data-copy="${date}"]`);
      if(btn){ const _o=btn.textContent; btn.textContent='✓'; btn.style.color='var(--g)'; setTimeout(()=>{btn.textContent=_o;btn.style.color='';},1500); }
    }).catch(e=>{
      showAlert('복사 실패', e.message);
    });
  }catch(e){ showAlert('복사 오류', e.message); }
}
// 전체 일지 복사
function copyAllJournals(){
  try{
    const js = safeParseJSON(localStorage.getItem('htsJournals'), '{}');
    const entries = Object.values(js).sort((a,b)=>a.date.localeCompare(b.date));
    if(!entries.length){ showAlert('복사', '일지가 없습니다'); return; }
    const totalPnl = entries.reduce((s,e)=>s+(e.pnl||0),0);
    const wins = entries.reduce((s,e)=>s+(e.wins||0),0);
    const total = entries.reduce((s,e)=>s+(e.total||0),0);
    let md = `# 매매일지 전체 (${entries.length}일)\n\n` +
      `**기간**: ${entries[0].date} ~ ${entries[entries.length-1].date}\n` +
      `**총 손익**: ${totalPnl>=0?'+':''}${totalPnl.toLocaleString()}원\n` +
      `**매매**: ${total}건 / 승률 ${total?Math.round(wins/total*100):0}%\n\n---\n\n`;
    entries.forEach(e=>{
      md += `## ${e.date} (${(e.pnl||0)>=0?'+':''}${(e.pnl||0).toLocaleString()}원, ${e.total||0}건)\n\n`;
      if(e.summary) md += `${e.summary}\n\n`;
      if(e.why_bought && e.why_bought !== '-') md += `**진입**: ${e.why_bought}\n`;
      if(e.why_sold && e.why_sold !== '-') md += `**청산**: ${e.why_sold}\n`;
      if(e.good && e.good !== '-') md += `**잘한점**: ${e.good}\n`;
      if(e.bad && e.bad !== '-') md += `**반성**: ${e.bad}\n`;
      if(e.improvement && e.improvement !== '-') md += `**개선**: ${e.improvement}\n`;
      if(e.mentor_comment && e.mentor_comment !== '-') md += `> 멘토: ${e.mentor_comment}\n`;
      md += '\n';
    });
    navigator.clipboard.writeText(md).then(()=>{
      showAlert('복사 완료', entries.length+'일치 일지가 클립보드에 복사됐습니다.\nClaude Code에 그대로 붙여넣으세요.');
    }).catch(err=>showAlert('복사 실패', err.message));
  }catch(e){ showAlert('복사 오류', e.message); }
}
// 일지 단건 삭제
function delJEntry(date){
  if(!confirm(date+' 일지를 삭제할까요?')) return;
  try{
    const js = safeParseJSON(localStorage.getItem('htsJournals'), '{}');
    delete js[date];
    const v = JSON.stringify(js);
    localStorage.setItem('htsJournals', v);
    saveToServer('htsJournals', v);
    renderJPage();
  }catch(e){ console.warn('일지삭제:', e.message); }
}
// 모든 일지 삭제
function clearAllJournals(){
  if(!confirm('⚠ 매매일지를 모두 삭제할까요?\n복구할 수 없습니다.')) return;
  if(!confirm('정말로 모두 삭제? 한 번 더 확인.')) return;
  localStorage.setItem('htsJournals', '{}');
  saveToServer('htsJournals', '{}');
  renderJPage();
  showAlert('삭제 완료', '모든 매매일지를 삭제했습니다');
}

function saveJEntry(date,p,pnl,wins,total,str){
  const js2=safeParseJSON(localStorage.getItem("htsJournals"), "{}");
  // AI 매매 통계 추가
  const todayTrades=mock.trades.filter(t=>t.date===date);
  const aiTrades=todayTrades.filter(t=>t.auto);
  const manualTrades=todayTrades.filter(t=>!t.auto);
  // 기존 항목 있으면 aiGenerated 여부 보존 (AI 분석 완료된 거 덮어쓰지 않음)
  const existing=js2[date];
  if(existing&&existing.aiGenerated&&!p.aiGenerated){
    // 기존에 AI 분석 완료된 항목이 있고 새 것이 기본 저장이면 → 거래내역/통계만 업데이트
    js2[date]={...existing,pnl,wins,total,str,
      aiTradeCount:aiTrades.length,
      manualTradeCount:manualTrades.length,
      aiPnl:aiTrades.filter(t=>t.side==='sell').reduce((a,t)=>a+t.pnl,0),
      manualPnl:manualTrades.filter(t=>t.side==='sell').reduce((a,t)=>a+t.pnl,0),
    };
  } else {
    js2[date]={date,pnl,wins,total,str,...p,
      aiTradeCount:aiTrades.length,
      manualTradeCount:manualTrades.length,
      aiPnl:aiTrades.filter(t=>t.side==='sell').reduce((a,t)=>a+t.pnl,0),
      manualPnl:manualTrades.filter(t=>t.side==='sell').reduce((a,t)=>a+t.pnl,0),
    };
  }
  const jv=JSON.stringify(js2);
  localStorage.setItem("htsJournals",jv);
  saveToServer("htsJournals",jv);
  renderJPage();
}

// 거래 발생 시 즉시 기본 일지 저장 (AI 없이도 항상 기록)
// autoSaveJournalOnTrade는 아래 async 버전에서 정의됨 (Claude AI 평가 + 학습 누적 포함)

// ═══════════════════════════════════════════════════
// 🤖 AI 파트너 — 장중 자동 체크 + 섹터수급 + 진입후보
// ═══════════════════════════════════════════════════

// ── 장중 자동 체크 (체크탭) ──
const INTRA_ITEMS = [
  { label:'지수 방향', icon:'📈', fn:()=>{
    const cs=getCandles(3); if(cs.length<2) return {score:50,val:'데이터 부족',ok:null};
    const chg=(cs[cs.length-1].c-cs[0].c)/cs[0].c*100;
    const ok=chg>0.2; return {score:ok?85:chg>-0.2?55:25, val:`${chg>=0?'▲':'▼'}${Math.abs(chg).toFixed(2)}%`, ok};
  }},
  { label:'거래량 수급', icon:'💧', fn:()=>{
    const cs=getRecentCandles(5); if(cs.length<2) return {score:50,val:'-',ok:null};
    const avg=cs.slice(0,-1).reduce((a,c)=>a+c.v,0)/(cs.length-1)||1;
    const r=cs[cs.length-1].v/avg; const ok=r>=1.3;
    return {score:ok?85:r>=0.8?55:30, val:`×${r.toFixed(1)}배`, ok};
  }},
  { label:'MA 배열', icon:'📊', fn:()=>{
    const cs=getCandles(25); const cls=cs.map(c=>c.c);
    const m5=(calcMA(cls,5).slice(-1)[0]||0), m20=(calcMA(cls,20).slice(-1)[0]||0);
    const ok=m5>m20; return {score:ok?80:35, val:ok?'정배열 ✅':'역배열', ok};
  }},
  { label:'RSI 모멘텀', icon:'⚡', fn:()=>{
    const cs=getCandles(20); const cls=cs.map(c=>c.c);
    const rsi=parseFloat((calcRSI(cls,14).slice(-1)[0]||50).toFixed(0));
    const ok=rsi>=45&&rsi<=70; return {score:ok?82:rsi>=40?60:25, val:`RSI ${rsi}`, ok};
  }},
  { label:'캔들 형태', icon:'🕯️', fn:()=>{
    const c=getCurrentCandle(); if(!c) return {score:50,val:'-',ok:null};
    const up=c.c>c.o; const body=Math.abs(c.c-c.o)/(c.h-c.l||1)*100;
    const ok=up&&body>50; return {score:ok?78:up?58:30, val:`${up?'양봉':'음봉'} ${body.toFixed(0)}%`, ok};
  }},
  { label:'매매 시간대', icon:'🕐', fn:()=>{
    const lc=getCurrentCandle(); if(!lc) return {score:50,val:'-',ok:null};
    const [h,m]=(lc.t||'09:00').split(':').map(Number); const hm=h*60+m;
    const best=(hm>=9*60&&hm<=9*60+30)||(hm>=14*60&&hm<=14*60+30);
    const ok=hm>=9*60+30&&hm<=14*60;
    return {score:best?90:ok?70:40, val:lc.t+(best?' ⭐':ok?'':' ⚠️점심'), ok:best||ok};
  }},
  { label:'포지션 비중', icon:'💼', fn:()=>{
    const total=Object.values(mock.positions||{}).reduce((a,p)=>a+(p.qty*(p.avgPrice||0)),0);
    const r=total/((mock.cash||10000000)+total||1)*100;
    const ok=r<60; return {score:ok?80:r<80?55:30, val:`${r.toFixed(0)}%`, ok};
  }},
  { label:'오늘 손익', icon:'💰', fn:()=>{
    const pnl=mock.todayPnl||0; const cap=cfg.capital||10000000;
    const pct=pnl/cap*100; const ok=pct>0;
    return {score:ok?85:pct>-1?60:pct>-2?35:15, val:`${pnl>=0?'+':''}${pnl.toLocaleString()}원`, ok};
  }},
];

function runIntraCheck(){
  const el=document.getElementById('intraLiveList');
  if(!el) return;
  const results=INTRA_ITEMS.map(item=>{
    let r={score:50,val:'-',ok:null};
    try{r=item.fn();}catch(e){}
    return {...item,...r};
  });
  const total=Math.round(results.reduce((a,r)=>a+r.score,0)/results.length);
  const goColor=total>=75?'var(--g)':total>=50?'var(--a)':'var(--r)';
  const goText=total>=75?'✅ 매매 우호':'⚠️ 신중 필요';
  el.innerHTML=`
    <div style="text-align:center;padding:6px 4px;margin-bottom:6px;border-radius:8px;background:var(--bg);">
      <span style="font-size:18px;font-weight:900;color:${goColor};">${total}점</span>
      <span style="font-size:10px;color:var(--tm);"> / 100 &nbsp; ${goText}</span>
    </div>
    ${results.map(r=>{
      const col=r.score>=75?'var(--g)':r.score>=50?'var(--a)':'var(--r)';
      const dot=r.ok===true?'🟢':r.ok===false?'🔴':'🟡';
      return `<div style="padding:4px 2px;border-bottom:1px solid rgba(0,0,0,.04);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:9px;color:var(--ts);">${r.icon} ${r.label}</span>
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="font-size:9px;color:var(--tm);">${r.val}</span>
            <span style="font-size:10px;font-weight:800;color:${col};">${r.score}</span>
          </div>
        </div>
        <div style="height:2px;background:var(--bg);border-radius:1px;margin-top:2px;overflow:hidden;">
          <div style="height:100%;width:${r.score}%;background:${col};border-radius:1px;transition:width .4s;"></div>
        </div>
      </div>`;
    }).join('')}`;
}
setInterval(()=>{ if(document.querySelector('.lpt.on[onclick*="lpb-ck"]')) runIntraCheck(); }, 30000);

// ── 섹터 수급 순위 (AI) ──
let _prevSectorRank=[];
async function loadSectorRanking(){
  const el=document.getElementById('sectorRankList');
  const btn=document.getElementById('sectorRankBtn');
  if(!el) return;
  el.innerHTML='<span style="color:var(--tm);font-style:italic;font-size:9px;">AI 분석 중...</span>';
  if(btn) btn.disabled=true;
  try{
    const cs=getRecentCandles(20);
    const cls=cs.map(c=>c.c);
    const rsi=(calcRSI(cls,14).slice(-1)[0]||50).toFixed(0);
    const volR=cs.length>=2?(cs[cs.length-1].v/cs[cs.length-2].v).toFixed(1):'1.0';
    const prompt=`지금 이 순간 단타 트레이더 관점에서 섹터별 수급 점수를 알려줘.
RSI:${rsi} 거래량:${volR}배 종목:${STOCKS.find(s=>s.tk===activeTk)?.nm||activeTk}

섹터: 반도체, 2차전지, 바이오, 자동차, 인터넷, 방산, 조선, 철강
0~100점 평가. JSON만: {"sectors":[{"name":"반도체","score":82,"reason":"외국인 순매수 지속","stocks":["삼성전자","SK하이닉스"]},...]}`; 
    const data=await callClaude({model:'claude-sonnet-4-5',max_tokens:500,messages:[{role:'user',content:prompt}]},'섹터수급');
    const text=data.content?.[0]?.text||'';
    const m=text.match(/\{[\s\S]*\}/);
    if(!m) throw new Error('파싱실패');
    const sectors=(JSON.parse(m[0]).sectors||[]).sort((a,b)=>b.score-a.score);
    const prevNames=_prevSectorRank.map(s=>s.name);
    const newOnes=sectors.filter((s,i)=>i<3&&!prevNames.slice(0,3).includes(s.name));
    _prevSectorRank=sectors;
    el.innerHTML=sectors.slice(0,6).map((s,i)=>{
      const sc=s.score||50;
      const col=sc>=75?'var(--g)':sc>=55?'var(--a)':'var(--r)';
      const isNew=newOnes.some(n=>n.name===s.name);
      return `<div onclick="loadSectorStocks('${s.name}','${(s.stocks||[]).join(',')}','${s.reason||''}')" style="padding:5px 3px;border-radius:6px;cursor:pointer;margin-bottom:2px;" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='none'">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">
          <span style="font-size:10px;font-weight:800;color:${i<3?'var(--b)':'var(--tm)'};min-width:14px;">${i+1}</span>
          <span style="font-size:10px;font-weight:700;flex:1;">${s.name}</span>
          ${isNew?'<span style="font-size:8px;background:var(--r);color:#fff;padding:1px 4px;border-radius:3px;font-weight:700;">NEW</span>':''}
          <span style="font-family:var(--mono);font-size:10px;font-weight:800;color:${col};">${sc}점</span>
        </div>
        <div style="height:3px;background:var(--bg);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${sc}%;background:${col};border-radius:2px;"></div>
        </div>
        <div style="font-size:8px;color:var(--tm);margin-top:1px;">${s.reason||''}</div>
      </div>`;
    }).join('');
  }catch(e){
    el.innerHTML=`<span style="color:var(--r);font-size:9px;">Claude API 키 필요</span>`;
  }
  if(btn){btn.disabled=false;btn.textContent='↺ 갱신';}
}

function loadSectorStocks(name, stocksStr, reason){
  // 섹터 종목 중 STOCKS에 있는 것 필터
  const stkNames=(stocksStr||'').split(',').filter(Boolean);
  const matched=STOCKS.filter(s=>stkNames.some(n=>s.nm.includes(n)||n.includes(s.nm)));
  if(!matched.length){ showAlert(name+' 섹터', reason||'수급 집중 섹터'); return; }
  let popup=document.getElementById('_sectorPopup');
  if(!popup){ popup=document.createElement('div'); popup.id='_sectorPopup';
    popup.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--pan);border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.2);padding:18px;width:280px;max-width:92vw;';
    document.body.appendChild(popup); }
  popup.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <span style="font-size:14px;font-weight:800;">🔥 ${name} 주도주</span>
    <button onclick="document.getElementById('_sectorPopup').style.display='none'" style="border:none;background:none;font-size:16px;cursor:pointer;">✕</button>
  </div>
  <div style="font-size:10px;color:var(--tm);margin-bottom:10px;">${reason}</div>
  ${matched.map(s=>{const chg=((s.pr-s.base)/s.base*100).toFixed(2);const up=parseFloat(chg)>=0;
    return `<div onclick="selectStk('${s.tk}');document.getElementById('_sectorPopup').style.display='none';" style="display:flex;align-items:center;gap:8px;padding:7px;border-radius:8px;cursor:pointer;margin-bottom:3px;" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='none'">
      <div style="font-size:11px;font-weight:700;flex:1;">${s.nm}</div>
      <div class="${up?'cu':'cd'}" style="font-size:11px;">${up?'+':''}${chg}%</div>
    </div>`;}).join('')}`;
  popup.style.display='block';
}

// ── 진입후보 점수 + 클릭 상세 ──
function renderCands(){
  const cc=document.getElementById('candCount');
  const sorted=[...CANDS].sort((a,b)=>(b.score||0)-(a.score||0));
  if(cc){cc.textContent=sorted.length+'/3';cc.style.color=sorted.length>=3?'var(--r)':'var(--ts)';}
  const el=document.getElementById('candList');
  if(!el) return;
  el.innerHTML=sorted.map((c,i)=>{
    const s=STOCKS.find(s=>s.tk===c.tk)||{nm:c.tk,pr:0,base:1};
    const sc=c.score||70;
    const col=sc>=80?'var(--g)':sc>=65?'var(--a)':'var(--r)';
    const chg=((s.pr-s.base)/s.base*100).toFixed(2);
    const up=parseFloat(chg)>=0;
    return `<div onclick="showCandDetail('${c.tk}')" style="padding:7px 6px;border-radius:8px;cursor:pointer;border-bottom:1px solid var(--br);" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='none'">
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="font-size:11px;font-weight:800;color:var(--b);min-width:16px;">${i+1}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:700;">${s.nm}</div>
          <div style="font-size:8px;color:var(--ts);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.why||''}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;font-weight:900;color:${col};">${sc}점</div>
          <div style="font-size:9px;" class="${up?'cu':'cd'}">${up?'+':''}${chg}%</div>
        </div>
      </div>
      <div style="height:2px;background:var(--bg);border-radius:1px;margin-top:4px;overflow:hidden;">
        <div style="height:100%;width:${sc}%;background:${col};border-radius:1px;"></div>
      </div>
    </div>`;
  }).join('');
}

function showCandDetail(tk){
  const c=CANDS.find(c=>c.tk===tk)||{tk,why:'',score:70};
  const s=STOCKS.find(s=>s.tk===tk)||{nm:tk,pr:0,base:1};
  const sc=c.score||70;
  const col=sc>=80?'var(--g)':sc>=65?'var(--a)':'var(--r)';
  let popup=document.getElementById('_candPopup');
  if(!popup){ popup=document.createElement('div'); popup.id='_candPopup';
    popup.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--pan);border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.2);padding:18px;width:300px;max-width:92vw;';
    document.body.appendChild(popup); }
  popup.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div><div style="font-size:14px;font-weight:800;">${s.nm}</div><div style="font-size:10px;color:var(--tm);">${tk}</div></div>
      <div style="text-align:right;"><div style="font-size:22px;font-weight:900;color:${col};">${sc}점</div>
      <button onclick="document.getElementById('_candPopup').style.display='none'" style="border:none;background:none;font-size:14px;cursor:pointer;color:var(--tm);">✕</button></div>
    </div>
    <div style="background:var(--bg);border-radius:8px;padding:10px;margin-bottom:12px;font-size:11px;line-height:1.8;color:var(--ts);" id="_candReason">
      <span style="color:var(--tm);">🤖 AI가 분석 중이에요...</span>
    </div>
    <div style="display:flex;gap:8px;">
      <button onclick="selectStk('${tk}');document.getElementById('_candPopup').style.display='none';" style="flex:1;padding:9px;border-radius:8px;border:none;background:var(--b);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">📊 차트 보기</button>
      <button onclick="document.getElementById('_candPopup').style.display='none'" style="padding:9px 14px;border-radius:8px;border:1.5px solid var(--br);background:none;font-size:12px;cursor:pointer;">닫기</button>
    </div>`;
  popup.style.display='block';
  const cs=getRecentCandles(5); const cls=cs.map(x=>x.c);
  const rsi=(calcRSI(cls,9).slice(-1)[0]||50).toFixed(0);
  const lc=getCurrentCandle()||{c:s.pr};
  callClaude({model:'claude-sonnet-4-5',max_tokens:200,
    messages:[{role:'user',content:`단타 트레이더야. ${s.nm}(${tk})이 오늘 진입 후보인 이유를 토스처럼 쉽게 알려줘.
추천이유: ${c.why||'조건검색 통과'} | 현재가: ${lc.c.toLocaleString()}원 | RSI: ${rsi}
수급/차트/재료/리스크 각 한줄씩, 이모지 사용해서 쉽게.`}]},'후보상세').then(d=>{
    const t=d.content?.[0]?.text||'분석 실패';
    const el=document.getElementById('_candReason');
    if(el) el.innerHTML=t.replace(/\n/g,'<br>');
  }).catch(()=>{
    const el=document.getElementById('_candReason');
    if(el) el.textContent=c.why||'Claude API 키를 설정창에서 입력해 주세요.';
  });
}

// ── 전체 새로고침 버튼 ──
function refreshAllData(){
  showProgress('전체 새로고침 중...',3);
  renderAll();
  runIntraCheck();
  setTimeout(()=>finishProgress('새로고침 완료'),800);
}

function safeParseJSON(str, fallback){
  if(str===null||str===undefined) return fallback;
  try{
    const r=JSON.parse(str);
    // 타입 검증: fallback이 배열이면 배열, 객체면 객체여야 함
    if(Array.isArray(fallback)&&!Array.isArray(r)) return fallback;
    return r;
  }catch(e){return fallback;}
}
const _analysisCache={};
function _getCachedAnalysis(key){
  const c=_analysisCache[key];
  if(c&&Date.now()-c.ts<5*60*1000) return c.data;
  return null;
}
function _setCachedAnalysis(key,data){_analysisCache[key]={ts:Date.now(),data};}

// 매매 시 시장 컨텍스트 자동 수집 (매매일지용)
function collectMarketCtx(){
  if(!_mktData || !_mktData.indices) return '데이터없음';
  const idx = _mktData.indices;
  const curCandle = getCurrentCandle();
  const cs = getCandles(5);
  const cls = cs.map(c=>c.c);
  const rsi = (calcRSI(cls,9).slice(-1)[0]||50).toFixed(1);
  const lines = [];
  if(idx.kospi?.price) lines.push(`KOSPI: ${idx.kospi.price.toLocaleString()} (${idx.kospi.chgPct>=0?'+':''}${idx.kospi.chgPct}%) [${idx.kospi.lastUpdatedKST?.slice(11,19)||'--'}]`);
  if(idx.kosdq?.price) lines.push(`KOSDQ: ${idx.kosdq.price.toLocaleString()} (${idx.kosdq.chgPct>=0?'+':''}${idx.kosdq.chgPct}%) [${idx.kosdq.lastUpdatedKST?.slice(11,19)||'--'}]`);
  if(idx.nasdaq?.price) lines.push(`나스닥: ${idx.nasdaq.price.toLocaleString()} (${idx.nasdaq.chgPct>=0?'+':''}${idx.nasdaq.chgPct}%) [${idx.nasdaq.lastUpdatedKST?.slice(11,19)||'--'}]`);
  if(idx.usdkrw?.price) lines.push(`USD/KRW: ${idx.usdkrw.price} [${idx.usdkrw.lastUpdatedKST?.slice(11,19)||'--'}]`);
  if(idx.vix?.price) lines.push(`VIX: ${idx.vix.price} [${idx.vix.lastUpdatedKST?.slice(11,19)||'--'}]`);
  if(curCandle) lines.push(`차트: RSI ${rsi} | 현재봉 O${curCandle.o?.toLocaleString()} H${curCandle.h?.toLocaleString()} L${curCandle.l?.toLocaleString()} C${curCandle.c?.toLocaleString()}`);
  if(_mktData.simDate) lines.push(`모의날짜: ${_mktData.simDate} ${_mktData.simTime||''}`);
  return lines.join('\n');
}

// ─ 새 버전 자동 감지 (캐시 우회) ───────────────────
(function(){
  const meta = document.querySelector('meta[name="build-ts"]');
  const myBuildTs = meta ? meta.getAttribute('content') : '';
  if(!myBuildTs || myBuildTs === '__BUILD_TS__') return; // 로컬 빌드 안 한 경우
  let reloaded = false;
  async function check(){
    if(reloaded) return;
    try{
      const r = await fetch('/api/version', {cache:'no-store'});
      const d = await r.json();
      if(d && d.buildTs && String(d.buildTs) !== String(myBuildTs)){
        reloaded = true;
        console.log('🔄 새 버전 감지, 새로고침합니다.', d.buildTs, '!=', myBuildTs);
        // ?_v= 쿼리 추가해서 강제 새 응답
        const u = location.pathname + '?_v=' + d.buildTs;
        location.replace(u);
      }
    }catch(e){}
  }
  // 초기 + 60초마다 + 탭 다시 활성화될 때
  setTimeout(check, 5000);
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) check(); });
})();

window.onload=()=>{
  loadState();
  // 캐시된 강세섹터 정보 복원 (관심종목 순위 배지용)
  try{
    const _si=localStorage.getItem('htsSectorInfo');
    if(_si) window._sectorInfo=JSON.parse(_si);
  }catch(e){}
  goPage('hts',document.getElementById('tab-hts'));
  document.getElementById("mockDate").value=sim.date;
  initChartEvents();
  _initResizeObserver();
  initChartRightClick();
  // 장중 체크 자동 실행
  setTimeout(runIntraCheck, 1500);
  // ★ 서버에서 저장된 API 설정 로드 (재배포 후에도 유지)
  fetch('/api/get-config').then(r=>r.json()).then(d=>{
    if(d.ok && (d.kisAppKey || d.claudeKeyFull)){
      kisConfig={
        appKey: d.kisAppKey||kisConfig.appKey||'',
        appSecret: d.kisAppSecret||kisConfig.appSecret||'',
        account: d.kisAccount||kisConfig.account||'',
        mode: d.kisMode||kisConfig.mode||'mock',
        dartKey: d.dartKey||kisConfig.dartKey||'',
        claudeKey: d.claudeKeyFull||kisConfig.claudeKey||'',
      };
      localStorage.setItem(KIS_CFG_KEY, JSON.stringify(kisConfig));
      if(kisConfig.claudeKey) fetch('/api/set-claude-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:kisConfig.claudeKey})}).catch(()=>{});
      updateKisStatus();
      console.log('✅ 서버에서 설정 로드됨');
    }
  }).catch(()=>{});
  updateKisStatus();
  renderAll();
  genCandles(); // ★ 전일+당일 분봉 생성, sim.idx는 전일 마지막 봉
  // 전일+당일 보이도록 뷰 끝쪽 정렬 (당일 첫봉 근처)
  chartViewCount=Math.min(120,sim.candles.length||60);
  chartViewStart=Math.max(0,(sim.candles.length||60)-chartViewCount);
  setTimeout(async function(){if(!kisConfig.appKey||!kisConfig.appSecret)return;try{var _ic=await _fetchKisCandles(activeTk,sim.date,sim.tf||"5");if(_ic&&_ic.length>0){sim.candles=_ic;var _pc=_kisChartMeta.prevCount||0;sim.idx=_pc>0?_pc-1:_ic.length-1;chartViewCount=Math.min(60,_ic.length);chartViewStart=Math.max(0,_ic.length-chartViewCount);updPrice(_ic[sim.idx]);drawChart();var _ci=document.getElementById("cinfo");if(_ci)_ci.textContent="✅ "+_ic.length+"봉 (전일"+(_kisChartMeta.prevCount||0)+"봉+오늘"+(_kisChartMeta.todayCount||0)+"봉)";addMsg("ai","📊 분봉 로드 완료: "+_ic.length+"봉\n전일: "+(_kisChartMeta.prevCount||0)+"봉 | 오늘: "+(_kisChartMeta.todayCount||0)+"봉");}}catch(_e){console.warn("KIS초기:",_e.message);}},2500);
  // 레이아웃 완성 후 차트 렌더 (requestAnimationFrame 중첩으로 보장)
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    drawChart();
    // 추가 보험: 100ms, 300ms 후 재렌더
    setTimeout(drawChart, 100);
    setTimeout(drawChart, 300);
  }));
  renderOB(); renderTH();
  tick(); setInterval(tick,1000);
  setInterval(liveUpdate,2200);
  setInterval(checkStopOrders,800);
  setInterval(refreshWatchlistPrices, 5000);
  setInterval(autoAdvUpdate,5000);
  // ★ 자체 진단 — 30초마다 매매 시스템 헬스 체크
  setInterval(_selfDiagnose, 30000);
  setTimeout(async()=>{
    await checkDartApiStatus();
    updateAIAdvisor();
    fetchDartNews();
    runFullAnalysis();
    renderIntraCheck();
    updateTimeGuide();
    calcMarketStrength();
  },800);
  setInterval(()=>{updateTimeGuide();},30000);
  setInterval(()=>fetchDartNews(),30000);
  ensureToday(); updateUsageUI();
  const savedTrust=localStorage.getItem('trustScore');
  if(savedTrust){trustScore=parseInt(savedTrust);const sl=document.getElementById('trustSlider');if(sl)sl.value=trustScore;updateTrustScore(trustScore);}
  setTimeout(()=>{renderGrowthRoadmap();detectSlump();},500);
  // 차트 큰 헤더 초기화 + 강세 섹터 패널 초기 렌더 / 주기적 갱신
  setTimeout(()=>{updChartHeader&&updChartHeader();renderHotSectors&&renderHotSectors();refreshHotSectors&&refreshHotSectors(false);updateLearnerStage&&updateLearnerStage();renderLiveTrades&&renderLiveTrades();refreshLecture&&refreshLecture(false);}, 400);
  // 5분마다 강세 섹터 자동 갱신 (모의투자라도 변동이 보이게)
  setInterval(()=>{refreshHotSectors&&refreshHotSectors(false);}, 30*60*1000); // 30분
};

// ═══════════════════════════════════════════════
// 자체 진단 시스템 — 매매 멈춤/일지 누락 등 자동 감지 및 복구
// ═══════════════════════════════════════════════
window._diagState = { lastTradeCount:0, lastScreenTime:0, stuckAlerted:false, noTradeBarCount:0 };
function _selfDiagnose(){
  if(!window.backtest || !backtest.running) return;
  var ds = window._diagState;
  var now = Date.now();
  var issues = [];
  // 1. autoState 꺼짐 감지 → 자동 복구
  if(!autoState.running){
    autoState.running=true; autoState.level=autoLevel||4;
    if(!autoTimer) scheduleScreening();
    issues.push('자동매매 꺼짐 → 재시작');
  }
  // 2. 스크리닝 멈춤 감지 (autoTimer 없음)
  if(autoState.running && !autoTimer){
    scheduleScreening();
    issues.push('스크리닝 타이머 없음 → 재시작');
  }
  // 3. 포지션 보유 중인데 stopOrders 없음 → 손절/익절 미설정
  var heldPositions = Object.entries(mock.positions||{}).filter(function(e){return e[1]&&e[1].qty>0;});
  heldPositions.forEach(function(e){
    var tk=e[0];
    if(!stopOrders[tk]){
      var pos=e[1], stk=STOCKS.find(function(s){return s.tk===tk;});
      if(stk && pos.avg){
        var stopPr = Math.round(pos.avg*(1-(autoState.cfg.stop||3)/100));
        var t1Pr = Math.round(pos.avg*(1+(autoState.cfg.t1||3)/100));
        var t2Pr = Math.round(pos.avg*(1+(autoState.cfg.t2||5)/100));
        stopOrders[tk]={stop:stopPr,t1:t1Pr,t2:t2Pr,t1done:false,t2done:false,trail:autoState.cfg.trail||'off',trailHigh:pos.avg,origQty:pos.qty,origStop:stopPr};
        issues.push(stk.nm+' 손절/익절 미설정 → 자동 설정 (손절 '+stopPr.toLocaleString()+')');
      }
    }
  });
  // 4. 장기 미매매 감지 (60봉 이상 보유만 하고 매매 없음)
  var curTradeCount = (mock.trades||[]).filter(function(t){return t.date===sim.date;}).length;
  if(curTradeCount === ds.lastTradeCount){
    ds.noTradeBarCount += 6;
  } else {
    ds.noTradeBarCount = 0;
    ds.lastTradeCount = curTradeCount;
  }
  if(ds.noTradeBarCount >= 120 && heldPositions.length > 0 && !ds.stuckAlerted){
    ds.stuckAlerted = true;
    issues.push('120봉('+Math.round(ds.noTradeBarCount/60)+'시간) 매매 없음 + 포지션 보유 중 — 손절선/시장 확인');
    addMsg('ai','⚠ 자체 진단: 장기 보유 감지\n보유 '+heldPositions.length+'종목, '+Math.round(ds.noTradeBarCount/60)+'시간 매매 없음\n손절선이 작동하는지 확인하세요.');
  }
  // 5. sim.playing이 false인데 백테스트 진행 중
  if(!sim.playing && backtest.running){
    sim.playing=true;
    _syncPlayBtn();
    runStep();
    issues.push('시뮬레이션 멈춤 → 재시작');
  }
  // 로그 출력
  if(issues.length){
    addDecisionLog('🔧 자체 진단', issues.join(' | '), '시스템');
    console.log('[자체진단]', issues);
  }
  // 날짜 변경 시 리셋
  if(ds._prevDate && ds._prevDate !== sim.date){
    ds.noTradeBarCount = 0;
    ds.stuckAlerted = false;
    ds.lastTradeCount = 0;
  }
  ds._prevDate = sim.date;
}

// 강세 섹터 캐시 렌더링 (localStorage에서 가져옴)
function renderHotSectors(){
  const el=document.getElementById('hotSectorList');
  const te=document.getElementById('hotSecTime');
  if(!el) return;
  let info={};
  try{info=JSON.parse(localStorage.getItem('htsSectorInfo')||'{}');}catch(e){}
  const grouped={};
  Object.entries(info).forEach(([tk,v])=>{
    if(!grouped[v.rank]) grouped[v.rank]={sector:v.sector,reason:v.reason,technique:v.technique,momentum:v.momentum,risk:v.risk,stocks:[]};
    grouped[v.rank].stocks.push({tk,nm:v.nm||tk,role:v.role,entry:v.entry,reason:v.reason});
  });
  const ranks=Object.keys(grouped).sort((a,b)=>parseInt(a)-parseInt(b));
  if(!ranks.length){el.innerHTML='<div style="color:var(--tm);font-size:9px;padding:2px 0;">아직 데이터 없음 ↻ 클릭</div>';return;}
  el.innerHTML=ranks.map(r=>{
    const g=grouped[r];
    const _momCol = g.momentum==='강함'?'var(--r)':g.momentum==='보통'?'var(--a)':'var(--tm)';
    const _techTag = g.technique ? `<span style="font-size:8px;color:var(--b);background:rgba(49,130,246,.1);padding:0 4px;border-radius:3px;margin-left:3px;">${g.technique}</span>` : '';
    const _momTag = g.momentum ? `<span style="font-size:8px;color:${_momCol};background:${_momCol==='var(--r)'?'rgba(220,38,38,.08)':'var(--bg)'};padding:0 4px;border-radius:3px;margin-left:3px;">${g.momentum}</span>` : '';
    const stkLine = g.stocks.map(s => {
      const _roleTag = s.role==='대장주' ? '👑' : '';
      const _short = (info[s.tk]&&info[s.tk].short_trend) || '';
      const _shortIcon = _short==='감소' ? '🔥' : _short==='증가' ? '⚠️' : '';
      const _tip = (s.entry||s.reason) ? ` title="${(s.entry||s.reason||'').replace(/"/g,'&quot;')}"` : '';
      return `<span class="hot-sec-stk" data-tk="${s.tk}" onclick="selectStk(this.dataset.tk)"${_tip} style="cursor:pointer;color:var(--b);font-weight:600;">${_roleTag}${_shortIcon}${s.nm}</span>`;
    }).join(' · ');
    const _riskLine = g.risk ? `<div style="color:var(--r);font-size:8px;margin-top:2px;">⚠ ${g.risk}</div>` : '';
    return `<div style="line-height:1.4;">
      <span style="background:var(--r);color:#fff;border-radius:3px;padding:0 4px;font-weight:700;font-size:8px;margin-right:4px;">${r}위</span>
      <span style="font-weight:700;">${g.sector||'-'}</span>${_techTag}${_momTag}
      <div style="color:var(--ts);font-size:8px;margin-top:2px;">${g.reason||''}</div>
      ${stkLine}
      ${_riskLine}
    </div>`;
  }).join('<div style="height:1px;background:var(--br);margin:5px 0;"></div>');
  const t=localStorage.getItem('htsSectorTime');
  if(te) te.textContent=t?('갱신 '+t):'-';
}
// 강세 섹터 새로 가져오기 (5분 쿨다운, force=true면 무시)
let _hotSecLast=0;
async function refreshHotSectors(force){
  const now=Date.now();
  if(!force && now-_hotSecLast < 30*60*1000) return; // 30분 쿨다운 (이전 5분 → 비용 6배 절감)
  _hotSecLast=now;
  const btn=document.getElementById('hotSecRefreshBtn');
  if(btn){btn.textContent='…';btn.disabled=true;}
  try{
    await syncCandidatesToWatchlist();
    const now2=new Date();
    const hh=String(now2.getHours()).padStart(2,'0'), mm=String(now2.getMinutes()).padStart(2,'0');
    saveToServer('htsSectorTime', hh+':'+mm);
    renderHotSectors();
  }catch(e){console.warn('hotSec:',e.message);}
  if(btn){btn.textContent='↻';btn.disabled=false;}
}
// ══════════════════════════════════════════════
// AI 종목 선택 시스템 (강의 기준 기반)
// ══════════════════════════════════════════════
// 대시보드 진입후보 → 관심종목 자동 추가
async function syncCandidatesToWatchlist(){
  try{
    addMsg('ai','🔄 강세섹터 정교 분석 중 (거래대금·수급·재료·모멘텀)...');

    const date = sim.date || new Date().toISOString().slice(0,10);
    // 분석 시점 결정 (장 전 / 장 시작 / 장중 / 장 마감)
    const _now = new Date();
    const _hm = _now.getHours()*60 + _now.getMinutes();
    const _phase = _hm < 540 ? '장 전 (09:00 이전 — 갭/시초 시나리오)'
      : _hm < 600 ? '장 시작 직후 (09:00~10:00 — 첫봉/갭상승 매매)'
      : _hm < 840 ? '장중 (10:00~14:00 — 눌림목/돌파 매매)'
      : _hm < 930 ? '장 후반 (14:00~15:30 — 마감 청산 시간대)'
      : '장 마감 후 (복기·내일 준비)';

    // 시장 컨텍스트 수집
    const _mkt = (typeof collectMarketCtx==='function') ? collectMarketCtx() : '데이터없음';
    const _lec = (typeof getLectureContext==='function') ? getLectureContext(3000) : '';
    const _learn = (typeof getLearningContext==='function') ? getLearningContext(8) : '';

    // 강의 + 학습 컨텍스트가 프롬프트 최상단에 자동 첨부됨
    const prompt =
      _lec + _learn +
      `# 강세섹터 정교 분석 요청 — ${date} ${_phase}\n\n` +
      `⚠️ 중요: 분석 대상 날짜는 정확히 ${date}이다. ${date} 기준 (그 시점의 시장 상황 + 그 직전 영업일까지 누적된 흐름)으로만 판단. 그 이후 정보는 사용 금지(미래 정보 leak 금지).\n\n` +
      `당신은 단타 매매 멘토. 위 강의 원칙을 100% 따라 ${date} 기준 한국 주식시장 강세섹터를 선정.\n\n` +
      `## 시장 현황\n${_mkt}\n\n` +
      `## 분석 기준 (반드시 모두 종합)\n` +
      `1. **거래대금/거래량**: 코스피·코스닥 거래대금 상위 섹터, 거래량 전일 대비 200%+ 종목\n` +
      `2. **수급**: 외국인 + 기관 동반 순매수, 연속 순매수 일수, 프로그램 매수\n` +
      `3. **공매도 잔고**: 종목별 공매도 잔고 비율(%), 최근 5일 추이 (감소=스퀴즈 기대 / 급증=하락 압력)\n` +
      `4. **재료/모멘텀**: 정책 이슈, 실적 발표, 신규 수주, 신제품, 글로벌 테마 (AI/2차전지/바이오/방산/원전 등)\n` +
      `5. **차트 기술적**: 정배열, 신고가 돌파, 거래량 동반 상승, RSI 50~65 안전구간\n` +
      `6. **선도주 ↔ 후속주**: 섹터 대장주 + 동반 상승 2부 종목\n` +
      `7. **시장 환경 정합**: 코스피 방향성·환율·미국 시장 흐름과 맞는 섹터\n` +
      `8. **시간대 적합성**: ${_phase}에 진입하기 좋은 종목 (강의의 매매 기법 — 눌림목/대장첫숨/돌파/첫봉/갭상승/이슈테마 중 어떤 게 적합?)\n\n` +
      `## 출력 — JSON만 (다른 텍스트 X)\n` +
      `{\n` +
      `  "market_view":"오늘 시장 한줄 요약 (방향/리스크)",\n` +
      `  "sectors":[\n` +
      `    {\n` +
      `      "rank":1,\n` +
      `      "name":"섹터명",\n` +
      `      "reason":"강세 근거 (거래대금·수급·재료를 수치로)",\n` +
      `      "momentum":"강함/보통/약함",\n` +
      `      "technique":"강의 매매기법명 (눌림목/대장첫숨/돌파/첫봉/갭상승/이슈테마 중)",\n` +
      `      "risk":"이 섹터 리스크 1줄",\n` +
      `      "stocks":[\n` +
      `        {"tk":"종목코드6자리","nm":"종목명","role":"대장주/후속주","reason":"선정이유","entry":"진입 시나리오 1줄","stop":"손절 기준","short_ratio":"공매도 잔고비율 (예: 1.2%, 모르면 -)","short_trend":"공매도 추세 (감소/유지/증가/모름)"}\n` +
      `      ]\n` +
      `    },\n` +
      `    ... 총 3개 섹터\n` +
      `  ]\n` +
      `}\n\n` +
      `각 섹터별 종목 1~3개. 종목코드는 정확한 6자리. 모르면 그 종목 빼고 다른 거 선정.`;

    const res = await fetch('/api/claude',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-5',
        max_tokens:900,
        messages:[{role:'user',content:prompt}]
      })
    });
    const data = await res.json();
    let text = (data.content&&data.content[0]&&data.content[0].text)||'{}';
    // 코드 블록/주석 제거 (Claude가 ```json ... ``` 으로 감싸는 경우 대응)
    text = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').replace(/\/\/.*$/gm,'');
    // 마지막 } 까지 매칭 (greedy)
    const m = text.match(/\{[\s\S]*\}/);
    if(!m) throw new Error('JSON 파싱 실패');
    const result = JSON.parse(m[0]);
    if(!result.sectors||!result.sectors.length) throw new Error('섹터 데이터 없음');
    if(result.market_view) addMsg('ai', '📊 오늘 시장: ' + result.market_view);

    // 기존 후보 종목 제거 (WGS[0]에서 이전 자동추가 종목 제거)
    const prevAuto = JSON.parse(localStorage.getItem('htsAutoTks')||'[]');
    if(prevAuto.length){
      WGS[0] = WGS[0].filter(function(tk){ return !prevAuto.includes(tk); });
    }

    // 새 종목 추가
    const newTks = [];
    const sectorInfo = {}; // tk → {rank, sectorName, reason}
    let _rejected = 0;
    result.sectors.forEach(function(sec){
      (sec.stocks||[]).forEach(function(stk){
        // 종목코드 정규화: 5자리도 허용, 앞에 0 추가
        let _tk = String(stk.tk||'').trim().replace(/[^\d]/g,'');
        if(_tk.length===5) _tk = '0'+_tk;
        stk.tk = _tk;
        if(/^\d{6}$/.test(_tk) && !newTks.includes(_tk)){
          newTks.push(stk.tk);
          sectorInfo[stk.tk] = {
            rank: sec.rank,
            sector: sec.name,
            reason: stk.reason || sec.reason,
            nm: stk.nm,
            role: stk.role || '대장주',
            technique: sec.technique || '',
            momentum: sec.momentum || '',
            risk: sec.risk || '',
            entry: stk.entry || '',
            stop: stk.stop || '',
            short_ratio: stk.short_ratio || '',
            short_trend: stk.short_trend || '',
          };
          // STOCKS에 없으면 추가
          // STOCKS에 없으면 추가 (가격 추정치 base 사용)
          if(!STOCKS.find(function(s){return s.tk===_tk;})){
            // base 가격 추정: stk.entry에 숫자 있으면 그걸로
            let _base = 50000;
            const _em = String(stk.entry||'').match(/(\d{1,3}(?:,\d{3})*|\d+)\s*원/);
            if(_em) _base = parseInt(_em[1].replace(/,/g,'')) || 50000;
            STOCKS.push({tk:_tk, nm:stk.nm, pr:_base, base:_base, sec:sec.name, cap:'중형'});
          }
        }else if(_tk){
          _rejected++;
          console.warn('종목코드 인식 실패:', stk.tk, '→', _tk);
        }
      });
    });
    if(_rejected>0) addMsg('ai', '⚠ 종목코드 형식 오류 '+_rejected+'건 무시 (6자리 숫자 아님)');
    if(!newTks.length){
      addMsg('ai', '⚠ Claude가 유효한 종목코드를 반환 안 함. 강의 페이지 확인 또는 다시 시도.');
      return;
    }

    // WGS[0]에 추가 (앞에 삽입). 한도(WG_MAX[0]) 내에서
    newTks.forEach(function(tk){
      if(!WGS[0].includes(tk)) WGS[0].unshift(tk);
    });
    // 한도 초과분 제거
    const _maxW = WG_MAX[0]||10;
    if(WGS[0].length > _maxW) WGS[0] = WGS[0].slice(0, _maxW);
    addDecisionLog('📌 관심종목 추가됨', newTks.length+'개 종목 → '+newTks.map(t=>{const s=STOCKS.find(x=>x.tk===t);return s?s.nm:t;}).join(', '), '종목선정');
    
    // 자동추가 목록 저장
    saveToServer('htsAutoTks', JSON.stringify(newTks));

    // 순위 표시 태그 저장
    saveToServer('htsSectorInfo', JSON.stringify(sectorInfo));
    window._sectorInfo = sectorInfo;

    saveWGS();
    renderWLGroup();
    // HTS 좌측 강세 섹터 패널도 즉시 갱신
    try{renderHotSectors&&renderHotSectors();}catch(_e){}

    // 메시지 출력
    let msg = '📊 강세섹터 자동 선정 완료\n\n';
    result.sectors.forEach(function(sec){
      msg += sec.rank+'위 '+sec.name+': '+sec.reason+'\n';
      (sec.stocks||[]).forEach(function(stk){
        msg += '  → '+stk.nm+'('+stk.tk+')\n';
      });
    });
    addMsg('ai', msg);

    // CANDS 업데이트
    CANDS = newTks.slice(0,3).map(function(tk,i){
      const info = sectorInfo[tk]||{};
      return {tk:tk, why:info.sector+'('+info.rank+'위) '+info.reason, score:95-i*5};
    });
    renderCands();

  }catch(e){
    console.warn('강세섹터 분석 실패:', e.message);
    addMsg('ai','⚠ 강세섹터 분석 실패: '+e.message);
  }
}

async function autoSelectBestStock(){
  const allTks=[...(WGS[0]||[]),...(WGS[1]||[]),...(WGS[2]||[])].filter(function(v,i,a){return a.indexOf(v)===i&&v;});
  if(!allTks.length){addMsg('ai','관심종목이 없습니다.');return null;}
  const candidates=[];
  for(const tk of allTks){
    const stk=STOCKS.find(function(s){return s.tk===tk;});
    if(!stk)continue;
    if(mock.positions[tk]&&mock.positions[tk].qty>0)continue;
    const cs=sim.candles,cls=cs.map(function(c){return c.c;}),vls=cs.map(function(c){return c.v;});
    if(cls.length<10)continue;
    const lc=cs[cs.length-1],pc=cs[cs.length-2]||lc,pc2=cs[cs.length-3]||pc;
    const ma5=calcMA(cls,5),ma20=calcMA(cls,20);
    const lma5=ma5[ma5.length-1]||0,lma20=ma20[ma20.length-1]||0;
    const lrsi=parseFloat((calcRSI(cls,14).slice(-1)[0]||50).toFixed(1));
    const volR=vls.length>=2?vls[vls.length-1]/vls[vls.length-2]:1;
    let score=0;const tags=[];
    if(lma5>lma20){score+=3;tags.push('MA정배열');}
    if(lc.c>lma5){score+=2;tags.push('5MA위');}
    if(lc.c>lc.o){score+=1;tags.push('양봉');}
    if(volR>=1.5){score+=3;tags.push('거래량x'+volR.toFixed(1));}
    else if(volR>=1.2){score+=1;tags.push('거래량+'+(((volR-1)*100).toFixed(0))+'%');}
    if(lrsi>=50&&lrsi<=65){score+=2;tags.push('RSI'+lrsi);}
    else if(lrsi>=40&&lrsi<50){score+=1;tags.push('RSI'+lrsi+'(회복)');}
    if(lc.c<lma5&&lma5<lma20){score-=5;tags.push('하락추세');}
    if(lc.c<lc.o&&pc.c<pc.o&&pc2.c<pc2.o){score-=3;tags.push('3연속음봉');}
    candidates.push({tk:tk,stk:stk,score:score,tags:tags});
  }
  if(!candidates.length){addMsg('ai','분석 가능한 관심종목이 없습니다.');return null;}
  candidates.sort(function(a,b){return b.score-a.score;});
  const best=candidates[0];
  const topList=candidates.slice(0,3).map(function(c,i){return (i+1)+'. '+c.stk.nm+'('+c.tk+') '+c.score+'점 '+c.tags.join(' ');}).join('\n');
  if(best.score<4){addMsg('ai','스크리닝 결과\n'+topList+'\n\n전 종목 진입조건 미달('+best.score+'/11). 관망');return null;}
  addMsg('ai','AI 종목 선택\n'+topList+'\n\n-> '+best.stk.nm+' 선택 ('+best.score+'/11점)');
  if(best.tk!==activeTk){setActiveTk(best.tk);await new Promise(function(r){setTimeout(r,500);});}
  return best;
}

// ══════════════════════════════════════════════
// 매매일지 AI 자동 작성 + Notion 저장
// ══════════════════════════════════════════════
// 장 시간 필터 (09:00~15:30)
function isMarketHourTrade(trade){
  var t = trade.time || trade.barTime || '';
  if(!t) return true;
  try{
    // "HH:MM" 포맷만 처리 (한국어 "오후 2시" 등은 통과)
    if(t.indexOf(':') === -1) return true;
    const [h,m] = t.split(':').map(Number);
    if(isNaN(h)) return true;
    const mins = h*60+(m||0);
    return mins >= 9*60 && mins <= 15*60+30;
  }catch(e){ return true; }
}
function getMarketTrades(date){
  const all = mock.trades.filter(t=>t.date===(date||sim.date));
  return all.filter(isMarketHourTrade);
}

async function autoSaveJournalOnTrade(forceDate){
  const date=forceDate||sim.date;
  var tt=(mock.trades||[]).filter(function(t){return t.date===date&&isMarketHourTrade(t);});
  // 장시간 필터 후 0건이지만 해당 날짜 거래 자체는 있으면 → 필터 무시 (time 형식 문제 방지)
  if(!tt.length){
    tt=(mock.trades||[]).filter(function(t){return t.date===date;});
    if(!tt.length) return;
  }
  const sells=tt.filter(function(t){return t.side==='sell';});
  const pnl=sells.reduce(function(a,t){return a+t.pnl;},0);
  const wins=sells.filter(function(t){return t.pnl>0;}).length;
  const losses=sells.filter(function(t){return t.pnl<0;}).length;
  const total=sells.length;
  const _winRate = total>0 ? Math.round(wins/total*100) : 0;
  const _resultGrade = pnl>0 ? '수익' : pnl<0 ? '손실' : '무변동';
  const str=tt.map(function(t){return (t.side==='buy'?'매수':'매도')+' '+t.nm+' '+t.qty+'주 @'+t.price.toLocaleString()+(t.pnl!==undefined?' ('+(t.pnl>=0?'+':'')+Math.round(t.pnl).toLocaleString()+'원)':'');}).join('\n');
  // 기본 일지 — AI 없이도 유의미한 내용 (AI 실패 시 이것만 남음)
  const _buyTrades = tt.filter(function(t){return t.side==='buy';});
  const _buyNames = [...new Set(_buyTrades.map(function(t){return t.nm;}))].join(', ');
  const _sellSummary = sells.map(function(t){return t.nm+' '+(t.pnl>=0?'+':'')+Math.round(t.pnl).toLocaleString()+'원';}).join(' / ');
  const baseEntry={
    summary: date+' '+_resultGrade+' | '+tt.length+'건 '+(pnl>=0?'+':'')+pnl.toLocaleString()+'원 (승률 '+_winRate+'%)',
    result_grade: _resultGrade,
    why_bought: _buyNames ? '매수: '+_buyNames : '매수 내역 없음',
    why_sold: _sellSummary || '청산 내역 없음',
    good: pnl>0 ? '수익 실현 성공' : wins>0 ? '일부 종목 수익 확보' : '매매 시도',
    bad: pnl<0 ? '손실 '+Math.round(pnl).toLocaleString()+'원 발생' : '-',
    psychology: losses>=3 ? '연속 손절 주의' : total>0 ? '정상 매매' : '-',
    improvement: pnl<0 ? '손절 기준 재점검 필요' : '현 전략 유지',
    phase_check: '-',
    mistakes: '-',
    aiGenerated: false,
    trades: str
  };
  saveJEntry(date,baseEntry,pnl,wins,total,str);
  try{
    const logs=(window._decisionLog||[]).slice(-20).map(function(d){return '['+(d.phase||'')+'] '+d.title+': '+(d.body||'');}).join('\n');
    const _lecJ = typeof getLectureContext==='function' ? getLectureContext(2500) : '';
    const _winRate = total>0 ? Math.round(wins/total*100) : 0;
    const _resultGrade = pnl>0 ? '수익(GAIN)' : pnl<0 ? '손실(LOSS)' : '무변동(FLAT)';
    const prompt='단타 트레이딩 멘토. 오늘 매매를 강의 원칙 기준으로 평가해서 매매일지 작성.\n\n'+_lecJ+
      '\n날짜: '+date+
      '\n결과: '+_resultGrade+' / 손익 '+(pnl>=0?'+':'')+pnl.toLocaleString()+'원 / 승률 '+_winRate+'% ('+wins+'/'+total+')'+
      '\n\n매매내역:\n'+str+
      '\n\nAI결정로그:\n'+(logs||'없음')+
      '\n\n[평가 원칙 — 반드시 지킬 것]\n'+
      '1. 결과(손익)와 과정(원칙 준수)을 분리해서 평가\n'+
      '2. 손익이 +면 절대 "실패"라고 하지 말 것. 과정에 문제 있어도 "결과는 성공, 다만 X 위험"으로 표현\n'+
      '3. 손익이 -면 "실패" 명확히 — 단 과정이 좋았다면 "과정 OK였으나 시장 운"으로 구분\n'+
      '4. 승률 낮아도 손익 +면 "큰 익절 + 작은 손절" 손익비 잘 잡았다는 신호 — 칭찬할 것\n'+
      '5. 승률 높아도 손익 -면 "작은 익절 + 큰 손절" 손익비 잘못 — 강하게 지적\n\n'+
      'JSON만:\n'+
      '{"result_grade":"성공/실패/혼합","process_grade":"성공/실패/혼합",'+
      '"summary":"한줄 총평(결과와 과정 모두 언급)",'+
      '"why_bought":"매수이유","why_sold":"청산이유",'+
      '"good":"잘한점","bad":"반성할점(손익+면 부드럽게)",'+
      '"psychology":"심리평가","improvement":"개선행동",'+
      '"phase_check":"적용Phase","mentor_comment":"멘토한마디(결과/과정 통합)"}';
    // fetch + timeout (30초) — 멈춤 방지
    const ctrl = new AbortController();
    const _timer = setTimeout(()=>ctrl.abort(), 15000); // 15초 — 일지는 중요하므로 넉넉히
    const res = await fetch('/api/claude',{method:'POST',headers:{'Content-Type':'application/json'},signal:ctrl.signal,body:JSON.stringify({model:'claude-haiku-4-5',max_tokens:500,messages:[{role:'user',content:prompt}]})});
    clearTimeout(_timer);
    const data=await res.json();
    const text=(data.content&&data.content[0]&&data.content[0].text)||'{}';
    const m=text.match(/\{[\s\S]*\}/);
    if(!m)throw new Error('JSON파싱실패');
    const ai=JSON.parse(m[0]);
    const aiEntry={summary:ai.summary||(date+' 매매 '+tt.length+'건 / '+(pnl>=0?'+':'')+pnl.toLocaleString()+'원'),result_grade:ai.result_grade||(pnl>0?'성공':pnl<0?'실패':'혼합'),process_grade:ai.process_grade||'-',why_bought:ai.why_bought||'-',why_sold:ai.why_sold||'-',good:ai.good||'-',bad:ai.bad||'-',psychology:ai.psychology||'-',improvement:ai.improvement||'-',phase_check:ai.phase_check||'-',mentor_comment:ai.mentor_comment||'-',aiGenerated:true,trades:str};
    saveJEntry(date,aiEntry,pnl,wins,total,str);
    // 학습 메모리 누적 (다음 매매 결정에 자동 반영)
    try{ appendLesson(date, ai); }catch(_e){}
    const stage = (typeof getLearnerStage==='function') ? getLearnerStage() : {lv:1,label:'초보'};
    addMsg('ai','📓 매매일지 자동 작성 완료\n\n'+date+' '+(pnl>=0?'+':'')+pnl.toLocaleString()+'원\n\n✅ 잘한점: '+ai.good+'\n\n🔴 반성: '+ai.bad+'\n\n💡 개선: '+ai.improvement+'\n\n🎯 멘토: '+ai.mentor_comment+'\n\n🎓 학습 단계: Lv'+stage.lv+' '+stage.label+' (노트 '+learningMemory.length+'건)');
    const nPageId=localStorage.getItem('notionJournalPageId');
    if(nPageId)await _saveJournalToNotion(date,aiEntry,pnl,str);
  }catch(e){
    console.warn('AI일지실패:',e.message);
    addMsg('ai','📓 기본 일지 저장 완료 (AI실패: '+e.message+')');
  }
}

async function _saveJournalToNotion(date,entry,pnl,trades){
  try{
    const nPageId=localStorage.getItem('notionJournalPageId');
    if(!nPageId)return;
    const body='## '+date+' 매매일지\n\n**손익**: '+(pnl>=0?'+':'')+pnl.toLocaleString()+'원\n\n**매매내역**:\n'+trades+'\n\n**매수이유**: '+entry.why_bought+'\n**청산이유**: '+entry.why_sold+'\n**잘한점**: '+(entry.good||'-')+'\n**반성**: '+(entry.bad||'-')+'\n**심리**: '+(entry.psychology||'-')+'\n**개선**: '+(entry.improvement||'-')+'\n**멘토**: '+(entry.mentor_comment||'-');
    await fetch('/api/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:200,mcp_servers:[{type:'url',url:'https://mcp.notion.com/mcp',name:'notion'}],messages:[{role:'user',content:'Notion 페이지('+nPageId+')에 아래 내용을 추가해줘.\n\n'+body}]})});
    addMsg('ai','📝 Notion 일지 저장 완료');
  }catch(e){console.warn('Notion저장실패:',e.message);}
}

// scheduleScreening에 종목 선택 통합
async function scheduleScreening(){
  if(!autoState.running)return;
  runScreening();
  autoTimer=setTimeout(scheduleScreening,5000);
}


// ─── AI 실시간 사고 패널 ───
function updAIThought(s){
  var dot=document.getElementById('aiThoughtDot');
  var ttl=document.getElementById('aiThoughtTitle');
  var tel=document.getElementById('aiThoughtTime');
  var con=document.getElementById('aiThoughtConclusion');
  if(!dot||!ttl)return;
  var cols={analyzing:'#3b82f6',blocking:'#ef4444',waiting:'#f97316',buy:'#22c55e',pass:'#94a3b8',running:'#a855f7'};
  var col=cols[s.type]||'#94a3b8';
  dot.style.background=col; dot.style.boxShadow='0 0 5px '+col;
  ttl.textContent=s.title||'대기중'; ttl.style.color=col;
  if(tel)tel.textContent=new Date().toLocaleTimeString('ko',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  ['trend','entry','risk','decision'].forEach(function(k){
    var el=document.getElementById('ts-'+k);
    if(!el)return;
    var v=s[k];
    if(v){el.style.display='block';el.className='thought-step '+(v.type||'info');el.innerHTML='<b>'+v.label+'</b> '+v.text;}
    else{el.style.display='none';}
  });
  if(con){
    if(s.conclusion){
      con.style.display='block';
      var bg=s.type==='buy'?'rgba(34,197,94,.12)':s.type==='blocking'?'rgba(239,68,68,.12)':'rgba(59,130,246,.08)';
      var fc=s.type==='buy'?'#22c55e':s.type==='blocking'?'#ef4444':'#3b82f6';
      con.style.background=bg;con.style.color=fc;con.style.borderLeft='3px solid '+fc;
      con.textContent=s.conclusion;
    }else{con.style.display='none';}
  }
}
function _showThought_blocking(r,d){updAIThought({type:'blocking',title:'매수 차단',trend:{type:'bad',label:'⛔ 추세:',text:r},conclusion:'매수 불가 - '+d});}
function _showThought_analyzing(n,sc,rs){updAIThought({type:'analyzing',title:'AI 분석 중 - '+n,trend:{type:'info',label:'1단계:',text:'기술 '+sc+'/6점 ('+rs.slice(0,2).join(', ')+')'},entry:{type:'info',label:'2단계:',text:'Claude AI 심층 검토중...'},conclusion:null});}
function _showThought_pass(n,r,w){updAIThought({type:'pass',title:'관망 - '+n,trend:{type:'warn',label:'AI 판단:',text:r},entry:{type:'info',label:'기다릴것:',text:w||'추세 전환 확인'},conclusion:'지금은 아님 - '+r});}
function _showThought_buy(n,p,sp,t1,rr,cf,r){updAIThought({type:'buy',title:'매수 결정 - '+n,trend:{type:'ok',label:'진입근거:',text:r},entry:{type:'ok',label:'타점:',text:p.toLocaleString()+'원 신뢰도 '+cf+'%'},risk:{type:'info',label:'리스크:',text:'손절 '+sp.toLocaleString()+' 목표 '+t1.toLocaleString()+' R/R 1:'+rr},decision:{type:'ok',label:'결정:',text:'자동 매수 실행'},conclusion:'매수 - '+n+' '+p.toLocaleString()+'원 ('+cf+'%)'});}
function _showThought_idle(n){updAIThought({type:'waiting',title:'모니터링 - '+(n||''),trend:{type:'info',label:'상태:',text:'자동매매 실행중 5초마다 스크리닝'},conclusion:null});}



function resetBalance(){
  const cur=(cfg.capital||10000000).toString().replace(/,/g,"");
  const newCap=prompt("초기 자본금 입력 (원)",cur);
  if(newCap===null)return;
  const amt=parseInt(String(newCap).replace(/,/g,""));
  if(isNaN(amt)||amt<100000){showAlert("입력 오류","100,000원 이상 입력하세요.");return;}
  if(!confirm(amt.toLocaleString()+"원으로 리셋하시겠습니까?"))return;
  cfg.capital=amt;mock.cash=amt;mock.positions={};mock.trades=[];
  mock.todayPnl=0;mock.totalPnl=0;mock.lossSeries=0;mock.wins=0;mock.losses=0;
  mock.creditUsed=0;mock.marginUsed=0;
  saveMock();
  // saveCfg가 정의돼 있으면 호출 (없을 수도)
  if(typeof saveCfg === 'function') saveCfg();
  updCash();updPnl();renderPort();renderTradeLog();
  addMsg("ai","잔고 "+amt.toLocaleString()+"원으로 리셋 완료");
  showAlert("리셋 완료",amt.toLocaleString()+"원으로 리셋되었습니다.");
}

/* DEPLOY-v437431 */
function toggleAutoTrade(){if(autoState.running){stopAuto();}else{startAuto();}}
