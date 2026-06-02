// Railway/로컬 빌드 스크립트
// 1) 환경변수 → cfg.json
// 2) src/<page>/{template.html, style.css, body.html, script.js} → trading-<page>.html
// 외부 의존성 없음. node 표준 모듈만 사용.
const fs = require('fs');
const path = require('path');

// ── 1. cfg.json 생성/병합 ─────────────────────────────
const cfg = {
  ck: process.env.ANTHROPIC_API_KEY || '',
  ak: process.env.KIS_APP_KEY || '',
  as: process.env.KIS_APP_SECRET || '',
  ac: process.env.KIS_ACCOUNT || '',
  md: process.env.KIS_MODE || 'real',
};
let existing = {};
try { existing = JSON.parse(fs.readFileSync('./cfg.json', 'utf8')); } catch (e) {}
const merged = {};
for (const k of ['ck', 'ak', 'as', 'ac', 'md', 'dk']) {
  merged[k] = cfg[k] || existing[k] || '';
}
fs.writeFileSync('./cfg.json', JSON.stringify(merged, null, 2));
console.log('✅ cfg.json 생성/업데이트');

// ── 2. src/ 페이지 빌드 ──────────────────────────────
const BUILD_TS = String(Date.now());
fs.writeFileSync('./buildinfo.json', JSON.stringify({ buildTs: BUILD_TS, builtAt: new Date().toISOString() }, null, 2));
console.log('✅ buildinfo.json: ' + BUILD_TS);

const PAGES = [
  // ⚠️ trading-hts.html 은 src/hts 에서 빌드하지 않는다(SKIP) — 정본(SSOT) 보호.
  //    trading-hts.html 은 직접 편집되는 정본이며 server.js 가 그대로 서빙한다(로컬·Railway 동일).
  //    src/hts 는 현재 trading-hts.html 보다 ~1521줄(스트리밍 상담·3버튼 백테스트·회의적용·
  //    노션적용·매매설정 패널 등) 뒤처진 죽은 코드 → 나중에 src/hts 재동기화는 기술부채로 남긴다.
  //    여기서 src/hts 를 다시 빌드하면 Railway 배포 시 그 기능들이 전부 사라진다.
  // { src: 'src/hts', out: 'trading-hts.html' },   // ← 의도적으로 비활성화 (정본 덮어쓰기 방지)
  { src: 'src/dashboard', out: 'trading-dashboard.html' },
];

function buildPage({ src, out }) {
  if (!fs.existsSync(src)) {
    console.log(`⏭  ${src} 없음 — ${out} 기존 파일 유지`);
    return;
  }
  const tplPath = path.join(src, 'template.html');
  const cssPath = path.join(src, 'style.css');
  const bodyPath = path.join(src, 'body.html');
  const jsPath = path.join(src, 'script.js');
  for (const p of [tplPath, cssPath, bodyPath, jsPath]) {
    if (!fs.existsSync(p)) {
      console.log(`⏭  ${p} 없음 — ${out} 빌드 건너뜀`);
      return;
    }
  }
  const tpl = fs.readFileSync(tplPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  const body = fs.readFileSync(bodyPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  // 함수 형태로 넘겨 replace 특수 문자($$, $&, $') 해석 회피
  const html = tpl
    // CRLF/LF 모두 허용 (\r?\n) — Windows 작업트리(CRLF)에서도 정상 치환.
    .replace(/\r?\n\/\*##STYLES##\*\/\r?\n/, () => css)
    .replace(/\r?\n<!--##BODY##-->\r?\n/, () => body)
    .replace(/\r?\n\/\*##SCRIPT##\*\/\r?\n/, () => js)
    .replace(/__BUILD_TS__/g, () => BUILD_TS);
  fs.writeFileSync(out, html);
  console.log(`✅ 빌드: ${src} → ${out} (${(html.length / 1024).toFixed(1)} KB)`);
}

PAGES.forEach(buildPage);
console.log('🎉 빌드 완료');
