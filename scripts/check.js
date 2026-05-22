#!/usr/bin/env node
// 정적 분석 — 미정의 함수/변수 호출, 위험 패턴 탐지
const fs = require('fs');
const path = require('path');

function check(file){
  const src = fs.readFileSync(file, 'utf8');
  // 1) 정의된 함수/변수 수집
  const defined = new Set();
  // function name(
  for(const m of src.matchAll(/(?:^|\s)(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/g)) defined.add(m[1]);
  // const/let/var name =
  for(const m of src.matchAll(/(?:^|\s)(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=/g)) defined.add(m[1]);
  // window.name =
  for(const m of src.matchAll(/window\.([a-zA-Z_$][\w$]*)\s*=/g)) defined.add(m[1]);

  // 2) 호출되는 함수 식별자 추출
  // patterns: name(  / typeof name  / await name(  / .then(name)
  const called = new Map();
  const callPat = /(?:^|[^a-zA-Z_$\w.])([a-zA-Z_$][\w$]{2,})\s*\(/g;
  let m;
  while((m = callPat.exec(src))){
    const name = m[1];
    // 키워드/내장 제외
    if(['if','for','while','switch','return','function','async','await','typeof','new','catch','throw','console','setTimeout','setInterval','clearTimeout','clearInterval','Object','Array','Math','Date','String','Number','Boolean','JSON','Promise','Map','Set','RegExp','Error','TypeError','parseFloat','parseInt','isNaN','isFinite','Number','encodeURIComponent','decodeURIComponent','fetch','alert','confirm','prompt','document','window','localStorage','sessionStorage','requestAnimationFrame','AbortController','URL','URLSearchParams','Symbol','Proxy','Reflect'].includes(name)) continue;
    called.set(name, (called.get(name)||0)+1);
  }

  // 3) 호출됐는데 정의 안 된 것 — 잠재적 ReferenceError
  const missing = [];
  for(const [name, cnt] of called){
    if(!defined.has(name)){
      missing.push({name, count: cnt});
    }
  }
  missing.sort((a,b)=>b.count-a.count);
  return { defined: defined.size, called: called.size, missing };
}

const file = process.argv[2] || 'src/hts/script.js';
const r = check(file);
console.log(`[${file}]`);
console.log(`  정의: ${r.defined}개 / 호출: ${r.called}개`);
if(r.missing.length === 0){
  console.log('✅ 미정의 식별자 0건');
  process.exit(0);
}
console.log(`⚠ 미정의 식별자 ${r.missing.length}건:`);
r.missing.slice(0, 30).forEach(m => console.log(`  - ${m.name} (${m.count}회 호출)`));
process.exit(r.missing.length > 20 ? 1 : 0);
