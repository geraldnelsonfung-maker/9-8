// 任务报告：把每轮的补丁、验证结果写成 markdown，落在目标仓库 .codefix/ 下。
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function renderReport(result) {
  const lines = [];
  lines.push('# CodeFix 任务报告');
  lines.push('');
  lines.push(`- 时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push(`- 仓库: ${result.repoDir}`);
  lines.push(`- 结果: ${result.passed ? '✅ 验证通过' : '❌ 未通过（已回滚）'}`);
  if (result.branch) lines.push(`- 修复分支: \`${result.branch}\`（用 git merge 应用，或运行 codefix apply）`);
  lines.push('');
  for (const round of result.rounds) {
    lines.push(`## 第 ${round.round} 轮`);
    lines.push('');
    lines.push(`- 修复摘要: ${round.summary}`);
    lines.push(`- 应用补丁: ${round.applied.length} 个，拒绝: ${round.rejected.length} 个`);
    for (const p of round.applied) {
      lines.push(`  - \`${p.file}\` — ${p.reason}`);
    }
    for (const rj of round.rejected) {
      lines.push(`  - [拒绝] \`${rj.file}\` — ${rj.why}`);
    }
    lines.push(`- 验证: ${round.verify.passed ? '通过' : '未通过'}`);
    if (!round.verify.passed) {
      for (const v of round.verify.results.filter((x) => x.code !== 0)) {
        lines.push(`  - 失败命令 \`${v.cmd}\` (exit ${v.code})`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function writeReport(repoDir, reportDir, result) {
  const dir = path.join(repoDir, reportDir);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `report-${stamp}.md`);
  await writeFile(file, renderReport(result), 'utf8');
  return file;
}
