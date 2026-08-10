const fs = require('fs');
const path = require('path');
const { evaluateWatchlist, pct } = require('./strategy_engine');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatCandidate(candidate) {
  const lines = [];
  lines.push(`### ${candidate.symbol} ${candidate.name || ''} - ${candidate.grade}`);
  lines.push(`- 族群：${candidate.group || '未分類'}；${candidate.groupStrength.note}`);
  lines.push(`- 部位：${candidate.positionLabel}${candidate.positionPct ? `（約總資金 ${pct(candidate.positionPct)}）` : ''}`);
  lines.push(`- 關鍵價：${candidate.keyPrice ?? '未設定'}；停損價：${candidate.stopPrice ?? '買前需補上'}`);
  lines.push(`- 通過：${candidate.signals.passed.length ? candidate.signals.passed.join('、') : '無'}`);
  lines.push(`- 缺少：${candidate.signals.missing.length ? candidate.signals.missing.join('、') : '無'}`);

  if (candidate.blockedReasons.length) {
    lines.push(`- 禁止交易原因：${candidate.blockedReasons.join('；')}`);
  }

  if (candidate.notes) {
    lines.push(`- 備註：${candidate.notes}`);
  }

  return lines.join('\n');
}

function renderReport(result) {
  const blocked = result.candidates.filter(c => c.grade === 'BLOCKED');
  const actionable = result.candidates.filter(c => c.grade !== 'BLOCKED');
  const lines = [];

  lines.push(`# 台股每日觀察清單`);
  lines.push('');
  lines.push(`日期：${result.date || new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(`## 大盤與風控`);
  lines.push(`- 大盤模式：${result.marketState.label}`);
  lines.push(`- 大盤原因：${result.marketState.reasons.join('；')}`);
  lines.push(`- 今日已實現損益：${pct(result.lossLimits.dailyPct)}`);
  lines.push(`- 本週已實現損益：${pct(result.lossLimits.weeklyPct)}`);
  if (result.lossLimits.stops.length) {
    lines.push(`- 停手機制：${result.lossLimits.stops.join('；')}`);
  }
  lines.push('');
  lines.push(`## 可觀察候選`);
  if (!actionable.length) {
    lines.push('- 今日無可觀察候選。');
  } else {
    actionable.forEach(candidate => {
      lines.push(formatCandidate(candidate));
      lines.push('');
    });
  }

  lines.push(`## 禁止交易 / 冷卻`);
  if (!blocked.length) {
    lines.push('- 無。');
  } else {
    blocked.forEach(candidate => {
      lines.push(formatCandidate(candidate));
      lines.push('');
    });
  }

  lines.push(`## 下單前檢核`);
  lines.push('- 買進前是否能一句話說出理由？');
  lines.push('- 是否已寫下停損價與出場條件？');
  lines.push('- 是否未觸發單日 2% 或單週 5% 虧損限制？');
  lines.push('- 是否沒有報復交易心態？若有，休息 10 分鐘。');

  return lines.join('\n');
}

function main() {
  const inputPath = process.argv[2] || path.join(__dirname, 'sample_market_data.json');
  const outputPath = process.argv[3] || path.join(__dirname, '每日觀察清單.md');
  const input = readJson(inputPath);
  const result = evaluateWatchlist(input);
  const report = renderReport(result);
  fs.writeFileSync(outputPath, report, 'utf8');
  console.log(`Wrote ${outputPath}`);
}

if (require.main === module) {
  main();
}

module.exports = { renderReport };

