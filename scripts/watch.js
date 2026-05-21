#!/usr/bin/env node
// src/ 변경 감지 → 자동 빌드. 외부 의존성 없음(fs.watch 사용).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WATCH_DIRS = ['src/hts', 'src/dashboard'];
let timer = null;
let lastBuild = 0;

function rebuild(reason) {
  const now = Date.now();
  if (now - lastBuild < 200) return; // 디바운스
  lastBuild = now;
  process.stdout.write(`\n[${new Date().toLocaleTimeString('ko-KR')}] 빌드 (${reason})...\n`);
  const r = spawnSync('node', ['build.js'], { stdio: 'inherit' });
  if (r.status !== 0) process.stdout.write('❌ 빌드 실패\n');
}

WATCH_DIRS.forEach((dir) => {
  if (!fs.existsSync(dir)) return;
  fs.watch(dir, { recursive: true }, (event, filename) => {
    clearTimeout(timer);
    timer = setTimeout(() => rebuild(path.join(dir, filename || '?')), 150);
  });
  console.log(`👀 watching ${dir}`);
});
rebuild('초기');
console.log('Ctrl+C 로 종료. src/ 안의 파일을 수정하면 자동 빌드됩니다.');
