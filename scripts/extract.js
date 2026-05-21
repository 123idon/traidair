#!/usr/bin/env node
// 단일 HTML(trading-hts.html / trading-dashboard.html)을 src/<name>/ 디렉토리의
// {template.html, style.css, body.html, script.js}로 분리.
// 이 스크립트는 1회성 (마이그레이션). 이후엔 build.js만 사용.
const fs = require('fs');
const path = require('path');

function extract(srcFile, outDir) {
  const html = fs.readFileSync(srcFile, 'utf8');

  const styleStart = html.indexOf('<style>');
  const styleEnd = html.indexOf('</style>');
  if (styleStart < 0 || styleEnd < 0) throw new Error('<style> 태그를 찾을 수 없습니다: ' + srcFile);
  const css = html.slice(styleStart + '<style>'.length, styleEnd);

  const bodyStart = html.indexOf('<body>');
  const scriptStart = html.indexOf('<script>', bodyStart);
  const scriptEnd = html.indexOf('</script>', scriptStart);
  const bodyEnd = html.indexOf('</body>', scriptEnd);
  if (bodyStart < 0 || scriptStart < 0 || scriptEnd < 0 || bodyEnd < 0) {
    throw new Error('body/script 경계 탐지 실패: ' + srcFile);
  }
  // body 시작 직후부터 <script> 직전까지가 마크업
  const bodyMarkup = html.slice(bodyStart + '<body>'.length, scriptStart);
  // <script>와 </script> 사이가 JS
  const js = html.slice(scriptStart + '<script>'.length, scriptEnd);

  // 골격(template): style/body markup/script 본문을 placeholder로 치환
  const template =
    html.slice(0, styleStart + '<style>'.length) +
    '\n/*##STYLES##*/\n' +
    html.slice(styleEnd, bodyStart + '<body>'.length) +
    '\n<!--##BODY##-->\n' +
    html.slice(scriptStart, scriptStart + '<script>'.length) +
    '\n/*##SCRIPT##*/\n' +
    html.slice(scriptEnd);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'template.html'), template);
  fs.writeFileSync(path.join(outDir, 'style.css'), css);
  fs.writeFileSync(path.join(outDir, 'body.html'), bodyMarkup);
  fs.writeFileSync(path.join(outDir, 'script.js'), js);
  console.log(`✅ 추출 완료: ${srcFile} → ${outDir}/`);
}

extract('trading-hts.html', 'src/hts');
extract('trading-dashboard.html', 'src/dashboard');
