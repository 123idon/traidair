// ─ 새 버전 자동 감지 (캐시 우회) ───────────────────
(function(){
  const meta = document.querySelector('meta[name="build-ts"]');
  const myBuildTs = meta ? meta.getAttribute('content') : '';
  if(!myBuildTs || myBuildTs === '__BUILD_TS__') return;
  let reloaded = false;
  async function check(){
    if(reloaded) return;
    try{
      const r = await fetch('/api/version', {cache:'no-store'});
      const d = await r.json();
      if(d && d.buildTs && String(d.buildTs) !== String(myBuildTs)){
        reloaded = true;
        location.replace(location.pathname + '?_v=' + d.buildTs);
      }
    }catch(e){}
  }
  setTimeout(check, 5000);
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) check(); });
})();

// ── 대시보드 진행률 표시 ──
let _dpTimer=null;
function showDashProgress(label, steps){
  let bar=document.getElementById('_dp');
  if(!bar){
    bar=document.createElement('div');
    bar.id='_dp';
    bar.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:9999;background:var(--pan);border-top:1px solid var(--br);padding:6px 16px;display:flex;align-items:center;gap:10px;font-size:11px;';
    document.body.appendChild(bar);
  }
  bar.style.display='flex';
  let pct=0;
  bar.innerHTML=`<span id="_dpLabel" style="font-weight:600;min-width:160px;">${label}</span>
    <div style="flex:1;height:4px;background:#e5e7eb;border-radius:2px;overflow:hidden;">
      <div id="_dpBar" style="height:100%;width:0%;background:linear-gradient(90deg,#3182f6,#05c072);border-radius:2px;transition:width .3s;"></div>
    </div>
    <span id="_dpPct" style="font-family:monospace;font-weight:700;color:#3182f6;min-width:35px;">0%</span>
    <button onclick="document.getElementById('_dp').style.display='none'" style="border:none;background:none;cursor:pointer;color:#9ca3af;">✕</button>`;
  if(_dpTimer)clearInterval(_dpTimer);
  const step=steps?90/steps:5;
  _dpTimer=setInterval(()=>{
    pct=Math.min(pct+step+(Math.random()*2-1),95);
    const b=document.getElementById('_dpBar');const p=document.getElementById('_dpPct');
    if(b)b.style.width=pct+'%';if(p)p.textContent=Math.round(pct)+'%';
  },400);
}
function finishDashProgress(label){
  if(_dpTimer){clearInterval(_dpTimer);_dpTimer=null;}
  const b=document.getElementById('_dpBar');const p=document.getElementById('_dpPct');const l=document.getElementById('_dpLabel');
  if(b)b.style.width='100%';if(p)p.textContent='100%';if(l&&label)l.textContent='✅ '+label;
  setTimeout(()=>{const d=document.getElementById('_dp');if(d)d.style.display='none';},1500);
}
function failDashProgress(label){
  if(_dpTimer){clearInterval(_dpTimer);_dpTimer=null;}
  const b=document.getElementById('_dpBar');const l=document.getElementById('_dpLabel');
  if(b){b.style.width='100%';b.style.background='#ef4444';}if(l)l.textContent='❌ '+label;
  setTimeout(()=>{const d=document.getElementById('_dp');if(d)d.style.display='none';},3000);
}

// ── 날짜 설정 ──
const today = new Date();
// HTS sim.date 우선, 없으면 오늘
let curDate = (function(){
  try{ if(window.parent&&window.parent.sim&&window.parent.sim.date) return window.parent.sim.date; }catch(e){}
  return today.toISOString().slice(0,10);
})();
document.getElementById('dashDate').value = curDate;

function onDateChange(){
  curDate = document.getElementById('dashDate').value;
  // ── HTS 날짜 동기화 (루프 방지: _skipHtsSync 체크) ──
  if(!window._skipHtsSync){
    try{
      if(window.parent && window.parent.sim){
        window.parent.sim.date = curDate;
        const mockEl = window.parent.document.getElementById('mockDate');
        if(mockEl){ mockEl.value = curDate; }
        window.parent.genCandles && window.parent.genCandles(window.parent.activeTk, curDate);
        window.parent.initChart && window.parent.initChart();
      }
    }catch(e){}
  }
  loadDashData();
  autoLoadMarketData(); // 날짜 바꾸면 해당 날짜 데이터 자동 로드
}

// ── HTS kisConfig 공유 (iframe 부모에서 받기) ──
function getKisConfig(){
  try{ return window.parent.kisConfig || {}; } catch(e){ return {}; }
}

// ── 시장 데이터 (실제 값 입력 또는 AI 추정) ──
let mktData = {};
const MKT_IDS = ['kospi','kosdq','usd','nasdaq','sp500','vix','bond','night'];

function setMkt(id, val, chg, dir){
  const ve = document.getElementById('m-'+id);
  const ce = document.getElementById('mc-'+id);
  if(!ve||!ce) return;
  ve.textContent = val;
  ce.textContent = chg;
  const cls = dir>0?'up':dir<0?'dn':'neu';
  ve.className = 'mkt-val '+cls;
  ce.className = 'mkt-chg '+cls;
}

function calcScore(){
  // 점수 계산 (로컬 데이터 기반)
  const ks = mktData;
  let score = 5;
  if(ks.nasdaq_dir > 0) score++;
  if(ks.nasdaq_dir < 0) score--;
  if(ks.kospi_dir > 0) score++;
  if(ks.kospi_dir < 0) score--;
  if(ks.vix_val && ks.vix_val < 20) score++;
  if(ks.vix_val && ks.vix_val > 25) score--;
  if(ks.usd_val && ks.usd_val > 1350) score--;
  score = Math.max(1, Math.min(10, score));
  const badge = document.getElementById('marketScore');
  if(badge){
    badge.textContent = `시장 ${score}/10`;
    badge.style.background = score>=7?'rgba(5,192,114,.15)':score>=5?'rgba(255,147,0,.15)':'rgba(240,64,64,.15)';
    badge.style.color = score>=7?'#059669':score>=5?'#d97706':'#dc2626';
  }
  return score;
}

// ── 모의투자 통계 ──
function loadMockStats(){
  try{
    const mock = window.parent.mock || {};
    const trades = mock.trades || [];
    const todayTrades = trades.filter(t=>t.date===curDate);
    const wins = todayTrades.filter(t=>t.side==='sell'&&t.pnl>0).length;
    const total = todayTrades.filter(t=>t.side==='sell').length;
    const pnl = todayTrades.filter(t=>t.side==='sell').reduce((a,t)=>a+t.pnl,0);
    // 부모 창의 mock 데이터 표시 (추후 확장)
    return { wins, total, pnl };
  }catch(e){ return {wins:0,total:0,pnl:0}; }
}

// ── Claude API 호출 ──
async function callClaude(prompt, maxTokens=800){
  try{
    const res = await fetch('/api/claude',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        model:'claude-sonnet-4-5',
        max_tokens: maxTokens,
        messages:[{role:'user',content:prompt}]
      })
    });
    const d = await res.json();
    if(d.error) throw new Error(JSON.stringify(d.error));
    return d.content?.[0]?.text || '';
  }catch(e){
    console.error('Claude API 오류:', e);
    throw e;
  }
}

// ── AI 전체 분석 ──
async function runFullAIAnalysis(){
  const btn = document.querySelector('.hdr-btn:not(.sec)');
  if(btn){ btn.disabled=true; btn.textContent='분석 중...'; }
  
  // 진행률 표시
  showDashProgress('AI 시장 전체 분석 중...', 8);
  addMsg('ai', '📊 오늘 시장 전체 분석을 시작할게요. 잠깐만요...');

  const dateStr = curDate;
  const prompt = `⚠️ 분석 대상 날짜: ${dateStr} (절대 다른 날짜로 추정 금지)
${dateStr} 시점에서만 알 수 있던 정보(${dateStr} 직전 영업일까지의 시장 흐름·뉴스)만 사용.
${dateStr} 이후 정보는 절대 사용 금지(미래 정보 leak 금지). 모르면 "(추정)" 표시.

단타 트레이더를 위한 장 전 종합 분석. 쉽고 직관적으로 (토스 알림처럼).

다음 항목을 JSON으로 답해줘 (다른 텍스트 없이 JSON만):
{
  "direction": "매수우호적/중립/매수비우호적",
  "directionReason": "2줄 이내 이유 (쉽게)",
  "score": 7,
  "sectors": [
    {"rank":1,"name":"섹터명","reason":"한줄 이유","signal":"🔥강세"},
    {"rank":2,"name":"섹터명","reason":"한줄 이유","signal":"🟡보통"},
    {"rank":3,"name":"섹터명","reason":"한줄 이유","signal":"🟡보통"}
  ],
  "risks": "오늘 주의할 리스크 2가지 (쉽게)",
  "strategy": "오늘 매매 전략 한마디",
  "flow": "외국인/기관 수급 예상",
  "candidates": [
    {"rank":1,"name":"종목명","code":"코드","reason":"추천 이유 (쉽게)","strategy":"진입전략","stop":"손절 기준","target":"목표가 기준","signals":["신호1","신호2"]},
    {"rank":2,"name":"종목명","code":"코드","reason":"추천 이유","strategy":"진입전략","stop":"손절 기준","target":"목표가 기준","signals":["신호1"]},
    {"rank":3,"name":"종목명","code":"코드","reason":"추천 이유","strategy":"진입전략","stop":"손절 기준","target":"목표가 기준","signals":["신호1"]}
  ]
}`;

  try{
    const text = await callClaude(prompt, 1200);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if(!jsonMatch) throw new Error('JSON 파싱 실패');
    const d = JSON.parse(jsonMatch[0]);

    // 시장 방향
    const dirEl = document.getElementById('ai-direction');
    const isUp = d.direction?.includes('매수우호');
    const isDown = d.direction?.includes('비우호');
    if(dirEl) dirEl.innerHTML = `<span class="ai-tag ${isUp?'tag-g':isDown?'tag-r':'tag-a'}">${d.direction||'중립'}</span> ${d.directionReason||''}`;

    // 시장 점수
    const badge = document.getElementById('marketScore');
    const score = d.score||5;
    if(badge){
      badge.textContent = `시장 ${score}/10`;
      badge.style.background = score>=7?'rgba(5,192,114,.15)':score>=5?'rgba(255,147,0,.15)':'rgba(240,64,64,.15)';
      badge.style.color = score>=7?'#059669':score>=5?'#d97706':'#dc2626';
    }

    // verdict
    const vd = document.getElementById('marketVerdict');
    if(vd){
      vd.className = 'verdict '+(isUp?'buy':isDown?'sell':'neutral');
      vd.textContent = isUp?`📈 매수 우호적 (${score}/10점)`:isDown?`📉 매수 비우호적 (${score}/10점)`:`📊 중립 (${score}/10점)`;
    }

    // 강세 섹터
    const secEl = document.getElementById('ai-sectors');
    if(secEl && d.sectors){
      secEl.innerHTML = d.sectors.map(s=>
        `<div style="margin-bottom:3px;">${s.signal} <strong>${s.name}</strong> — ${s.reason}</div>`
      ).join('');
    }

    // 리스크
    const rkEl = document.getElementById('ai-risks');
    if(rkEl) rkEl.innerHTML = (d.risks||'--').replace(/\n/g,'<br>');

    // 전략
    const stEl = document.getElementById('ai-strategy');
    if(stEl) stEl.innerHTML = d.strategy||'--';

    // 수급
    const flEl = document.getElementById('ai-flow');
    if(flEl) flEl.innerHTML = d.flow||'--';

    document.getElementById('aiAnalyzed').textContent = `${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 업데이트`;

    // 진입 후보
    if(d.candidates) renderCandidates(d.candidates);

    // 채팅 메시지
    const dirText = isUp?'매수 우호적 🟢':isDown?'매수 비우호적 🔴':'중립 🟡';
    addMsg('ai', `분석 완료!\n\n📊 시장: ${dirText} (${score}/10점)\n${d.directionReason||''}\n\n🔥 강세 섹터: ${(d.sectors||[]).slice(0,2).map(s=>s.name).join(', ')}\n\n🎯 오늘 후보: ${(d.candidates||[]).map(c=>c.name).join(', ')}`);

    // HTS에 데이터 전달
    try{
      if(window.parent.setDashData){
        window.parent.setDashData({score, direction:d.direction, sectors:d.sectors, candidates:d.candidates, date:curDate});
      }
    }catch(e){}

  }catch(e){
    addMsg('ai', `분석 실패: ${e.message}\n\nClaude API 키를 설정창에서 확인해주세요.`);
  }

  if(btn){ btn.disabled=false; btn.textContent='🤖 AI 전체 분석'; }
  finishDashProgress('분석 완료');
}

// ── 진입 후보 렌더 ──
function renderCandidates(candidates){
  // HTS 진입후보 연동
  try{
    if(window.parent && window.parent.updateCandsFromDash){
      window.parent.updateCandsFromDash(candidates);
    }
  }catch(e){}
  const el = document.getElementById('candList');
  if(!el) return;
  document.getElementById('candUpdated').textContent = `${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 기준`;
  
  el.innerHTML = candidates.map((c,i)=>`
    <div class="cand-item" onclick="toggleCand(this)">
      <div class="cand-header">
        <span class="cand-rank">${c.rank||i+1}</span>
        <span class="cand-name">${c.name}</span>
        <span class="cand-code">${c.code||''}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--tm);">탭하여 상세 ›</span>
      </div>
      <div class="cand-reason">${c.reason||''}</div>
      <div class="cand-signal">
        ${(c.signals||[]).map(s=>`<span class="ai-tag tag-b">${s}</span>`).join('')}
      </div>
      <div class="cand-detail">
        <div style="margin-bottom:6px;font-weight:700;color:var(--tp);">📋 상세 분석</div>
        <div><strong>진입 전략:</strong> ${c.strategy||'--'}</div>
        <div style="margin-top:4px;"><strong>✂ 손절 기준:</strong> <span style="color:var(--r);">${c.stop||'--'}</span></div>
        <div style="margin-top:4px;"><strong>🎯 목표가 기준:</strong> <span style="color:var(--g);">${c.target||'--'}</span></div>
        <div style="margin-top:8px;">
          <button onclick="event.stopPropagation();selectInHTS('${c.code||''}')" style="padding:5px 12px;border-radius:6px;border:none;background:var(--b);color:#fff;font-size:11px;font-weight:600;cursor:pointer;">HTS에서 보기 →</button>
        </div>
      </div>
    </div>
  `).join('');
}

function toggleCand(el){
  el.classList.toggle('open');
}

function selectInHTS(code){
  try{
    if(code && window.parent.selectStk) window.parent.selectStk(code);
    if(window.parent.goPage) window.parent.goPage('hts', window.parent.document.getElementById('tab-hts'));
  }catch(e){}
}

// ── 채팅 ──
let hist=[], busy=false;
function addMsg(role, text){
  const el = document.getElementById('chatMsgs');
  if(!el) return;
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = text.replace(/\n/g,'<br>');
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

async function sendChat(){
  if(busy) return;
  const inp = document.getElementById('chatInput');
  const text = inp.value.trim();
  if(!text) return;
  inp.value='';
  addMsg('user', text);
  busy=true;

  const loadDiv = document.createElement('div');
  loadDiv.className='msg ai loading';
  loadDiv.innerHTML='<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  document.getElementById('chatMsgs').appendChild(loadDiv);

  hist.push({role:'user',content:text});
  const sysPrompt = `단타 트레이딩 멘토. 오늘 날짜: ${curDate}. 쉽고 직관적으로 3~5줄로 답해줘. 수치 기반으로.`;

  try{
    const res = await fetch('/api/claude',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:300,system:sysPrompt,messages:hist})
    });
    const d = await res.json();
    const reply = d.content?.[0]?.text||'응답 없음';
    hist.push({role:'assistant',content:reply});
    loadDiv.remove();
    addMsg('ai', reply);
  }catch(e){
    loadDiv.remove();
    addMsg('ai', '오류: '+e.message);
  }
  busy=false;
}

function quickQ(q){
  document.getElementById('chatInput').value=q;
  sendChat();
}

// ── 초기화 ──
function loadDashData(){
  // HTS에서 날짜 데이터 동기화
  try{
    const parent = window.parent;
    if(parent.getDashData){
      const dd = parent.getDashData(curDate);
      if(dd && dd.score){
        const badge = document.getElementById('marketScore');
        if(badge){
          badge.textContent = `시장 ${dd.score}/10`;
          badge.style.background = dd.score>=7?'rgba(5,192,114,.15)':dd.score>=5?'rgba(255,147,0,.15)':'rgba(240,64,64,.15)';
          badge.style.color = dd.score>=7?'#059669':dd.score>=5?'#d97706':'#dc2626';
        }
      }
      if(dd && dd.candidates) renderCandidates(dd.candidates);
    }
  }catch(e){}
}

// ── 시장 데이터 자동 로드 (페이지 열릴 때 자동 실행) ──
async function autoLoadMarketData(){
  showDashProgress('실제 시장 데이터 로드 중...', 5);
  const today = new Date().toISOString().slice(0,10);
  const isToday = curDate === today;

  try {
    // ── 실제 데이터: /api/market-data 호출 ──
    // 오늘이면 realtime, 과거 날짜면 해당일 장 마감 기준(15:00) 데이터
    let url;
    if (isToday) {
      url = '/api/market-data?mode=realtime';
    } else {
      // 과거 날짜: 장 마감 시점(15:30) 기준 데이터
      url = `/api/market-data?mode=sim&date=${curDate}&time=15%3A30&tf=5`;
    }

    showDashProgress('Yahoo Finance 데이터 수신 중...', 4);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const idx = data.indices || {};

    // ── 각 지수 채우기 (실제 수치 + 갱신 시각) ──
    function fillMkt(domId, item, label) {
      if (!item || item.price == null) return;
      const up = (item.chgPct || 0) >= 0;
      const chgStr = `${up ? '+' : ''}${(item.chgPct || 0).toFixed(2)}%`;
      const timeStr = item.lastUpdatedKST ? item.lastUpdatedKST.slice(11, 19) : '';
      setMkt(domId, item.price.toLocaleString(), chgStr, up ? 1 : -1);
      // 갱신 시각 툴팁
      const valEl = document.getElementById(`m-${domId}`);
      if (valEl) valEl.title = `${label}: ${timeStr} KST 기준 실제 데이터`;
    }

    fillMkt('kospi',  idx.kospi,  '코스피');
    fillMkt('kosdq',  idx.kosdq,  '코스닥');
    fillMkt('usd',    idx.usdkrw, 'USD/KRW');
    fillMkt('nasdaq', idx.nasdaq, '나스닥');
    fillMkt('sp500',  idx.sp500,  'S&P500');
    fillMkt('vix',    idx.vix,    'VIX');

    // 미국 10년채 (Yahoo Finance: ^TNX)
    if (idx.tnx) {
      fillMkt('bond', idx.tnx, '미국10년채');
    }

    // 야간선물: 나스닥 전날 데이터 = 한국 당일 장 시작 전 미국 마감 기준
    // idx.nasdaq에 이미 올바른 전날 마감값이 들어있음 (서버에서 시간 기준 조정됨)
    const nightEl = document.getElementById('m-night');
    if (nightEl) {
      if (idx.nasdaq?.price && idx.nasdaq?.chgPct != null) {
        const nq = idx.nasdaq;
        const up = (nq.chgPct || 0) >= 0;
        const timeLabel = nq.lastUpdatedKST ? nq.lastUpdatedKST.slice(0,16) : '전날';
        setMkt('night',
          `${up ? '+' : ''}${(nq.chgPct || 0).toFixed(2)}%`,
          `나스닥 ${timeLabel} KST 마감기준`,
          up ? 1 : -1
        );
        nightEl.title = `나스닥 전날 마감: ${nq.price?.toLocaleString()} (실제 데이터)`;
      } else {
        setMkt('night', '-', '데이터 없음', 0);
      }
    }

    // ── 갱신 시각 표시 (가장 최근 갱신된 지수 기준) ──
    const latestTime = [idx.kospi, idx.kosdq, idx.nasdaq, idx.usdkrw]
      .filter(x => x?.lastUpdatedKST)
      .map(x => x.lastUpdatedKST)
      .sort().pop();

    const updEl = document.getElementById('mktUpdated');
    if (updEl && latestTime) {
      const timeOnly = latestTime.slice(11, 19);
      const isRealtime = isToday;
      updEl.innerHTML = `<span style="color:var(--g);font-size:9px;">✅ 실제데이터 ${isRealtime ? '실시간' : curDate} ${timeOnly} KST</span>`;
    }

    // ── 시장 방향 자동 판단 ──
    const kospiChg = idx.kospi?.chgPct || 0;
    const nasdaqChg = idx.nasdaq?.chgPct || 0;
    const vixVal = idx.vix?.price || 20;
    const score = Math.min(10, Math.max(1,
      5 +
      (kospiChg > 0.5 ? 2 : kospiChg > 0 ? 1 : kospiChg > -0.5 ? -1 : -2) +
      (nasdaqChg > 1 ? 1 : nasdaqChg > 0 ? 0.5 : -0.5) +
      (vixVal < 15 ? 1 : vixVal > 25 ? -1 : 0)
    ));

    const badge = document.getElementById('marketScore');
    if (badge) {
      badge.textContent = `시장 ${score.toFixed(0)}/10`;
      badge.style.background = score>=7?'rgba(5,192,114,.15)':score>=5?'rgba(255,147,0,.15)':'rgba(240,64,64,.15)';
      badge.style.color = score>=7?'#059669':score>=5?'#d97706':'#dc2626';
    }

    const summary = score >= 7
      ? `▲ 매수 우호 — 코스피 ${kospiChg >= 0 ? '+' : ''}${kospiChg.toFixed(2)}% / 나스닥 ${nasdaqChg >= 0 ? '+' : ''}${nasdaqChg.toFixed(2)}% / VIX ${vixVal}`
      : score >= 5
      ? `→ 중립 — 코스피 ${kospiChg >= 0 ? '+' : ''}${kospiChg.toFixed(2)}% / 나스닥 ${nasdaqChg >= 0 ? '+' : ''}${nasdaqChg.toFixed(2)}% / VIX ${vixVal}`
      : `▼ 매수 비우호 — 코스피 ${kospiChg >= 0 ? '+' : ''}${kospiChg.toFixed(2)}% / 나스닥 ${nasdaqChg >= 0 ? '+' : ''}${nasdaqChg.toFixed(2)}% / VIX ${vixVal}`;

    const vd = document.getElementById('marketVerdict');
    if (vd) {
      vd.className = 'verdict '+(score>=7?'buy':score<=4?'sell':'neutral');
      vd.textContent = summary;
    }

    // HTS에 실제 점수 전달
    try { if(window.parent.setDashData) window.parent.setDashData({score: Math.round(score), date: curDate, realData: true}); } catch(e){}

    // 시장 데이터 로컬 캐시 저장
    try {
      const dashCache = {
        date: curDate,
        kospi: idx.kospi?.price, kosdq: idx.kosdq?.price,
        usd: idx.usdkrw?.price, nasdaq: idx.nasdaq?.price,
        sp500: idx.sp500?.price, vix: idx.vix?.price,
        score: Math.round(score), summary, realData: true,
        fetchedAt: data.fetchedAt,
      };
      localStorage.setItem('dashCache_' + curDate, JSON.stringify(dashCache));
    } catch(e) {}

  } catch(e) {
    console.error('시장 데이터 로드 실패:', e.message);
    document.getElementById('marketVerdict').textContent = `⚠ 실시간 데이터 로드 실패: ${e.message} — AI 전체 분석으로 대체하거나 잠시 후 다시 시도하세요`;
    failDashProgress('데이터 로드 실패');
    return;
  }
  finishDashProgress('✅ 실제 시장 데이터 업데이트 완료');
}

// ── 대시보드 미니 차트 ──
function refreshChartFromHTS(){
  try {
    const parent = window.parent;
    if(!parent.sim || !parent.sim.candles || !parent.sim.candles.length) return;
    const cs = parent.sim.candles.slice(0, parent.sim.idx+1);
    const stk = parent.STOCKS?.find(s=>s.tk===parent.activeTk);
    renderDashChart(cs, stk?.nm||'차트');
  } catch(e) { console.log('차트 로드 실패:', e.message); }
}

function renderDashChart(cs, name){
  const canvas = document.getElementById('dashChart');
  const empty = document.getElementById('dashChartEmpty');
  const nameEl = document.getElementById('chartTkName');
  if(!canvas || !cs || cs.length < 2) return;
  if(nameEl) nameEl.textContent = name || '';
  if(empty) empty.style.display = 'none';
  canvas.style.display = 'block';

  const W = canvas.offsetWidth || 600, H = 160;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);

  const prices = cs.flatMap(c=>[c.h,c.l]).filter(v=>v>0);
  if(!prices.length) return;
  const yMin = Math.min(...prices)*0.999, yMax = Math.max(...prices)*1.001;
  const yR = yMax-yMin||1;
  const PL=2,PR=50,PT=8,PB=18;
  const cw=W-PL-PR, ch=H-PT-PB;
  const toX=i=>PL+(i+0.5)*(cw/cs.length);
  const toY=v=>PT+ch*(1-(v-yMin)/yR);
  const bw=Math.max(1,Math.min(10,cw/cs.length*0.7));

  // 배경
  ctx.fillStyle='#f8f9fa'; ctx.fillRect(0,0,W,H);

  // 봉
  cs.forEach((c,i)=>{
    const x=toX(i), up=c.c>=c.o;
    const col=up?'#f04040':'#3182f6';
    ctx.strokeStyle=col; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x,toY(c.h)); ctx.lineTo(x,toY(c.l)); ctx.stroke();
    ctx.fillStyle=col;
    const oy=toY(Math.max(c.o,c.c)), cy=toY(Math.min(c.o,c.c));
    ctx.fillRect(x-bw/2, oy, bw, Math.max(1,cy-oy));
  });

  // Y축 레이블
  ctx.fillStyle='#9ca3af'; ctx.font='9px monospace'; ctx.textAlign='left';
  [yMax,yMin].forEach(v=>ctx.fillText(v.toLocaleString(), W-PR+4, toY(v)+3));

  // 현재가 라인
  const last=cs[cs.length-1];
  ctx.strokeStyle='rgba(49,130,246,.5)'; ctx.lineWidth=1; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(PL,toY(last.c)); ctx.lineTo(W-PR,toY(last.c)); ctx.stroke();
  ctx.setLineDash([]);
}

// 3초마다 자동 갱신
setInterval(refreshChartFromHTS, 3000);

// HTS sim.date 우선 동기화 (없으면 오늘)
(function(){
  try{
    if(window.parent && window.parent.sim && window.parent.sim.date){
      curDate = window.parent.sim.date;
    }
  }catch(e){}
  document.getElementById('dashDate').value = curDate;
})();
loadDashData();
// ★ 페이지 열리면 시장 데이터 자동 로드
autoLoadMarketData();
