// 引擎核心：全自动「检查 → 修复 → 验证 → 决策」闭环。
// 所有修改只发生在 git worktree 中；验证通过则留在修复分支等用户合并，失败自动回滚。
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { isGitRepo, hasUncommittedChanges, createWorktree, removeWorktree, commitWorktree, runGit } from './git.js';
import { runVerify, summarizeVerifyOutput } from './runner.js';
import { requestFixes, extractCandidateFiles, selectFiles } from './llm.js';
import { collectTextFiles } from './files.js';
import { applyPatches, diffStat } from './apply.js';
import { writeReport } from './report.js';

// 把报告目录加入 .git/info/exclude，避免报告污染 git status
async function ensureReportIgnored(repoDir, reportDir) {
  const r = await runGit(['rev-parse', '--git-dir'], repoDir);
  if (r.code !== 0) return;
  const gitDir = path.resolve(repoDir, r.stdout.trim());
  const excludeFile = path.join(gitDir, 'info', 'exclude');
  const entry = `${reportDir.replace(/\\/g, '/')}/`;
  try {
    let cur = '';
    try {
      cur = await readFile(excludeFile, 'utf8');
    } catch {
      await mkdir(path.dirname(excludeFile), { recursive: true });
    }
    if (!cur.split('\n').includes(entry)) {
      await writeFile(excludeFile, cur + (cur.endsWith('\n') || cur === '' ? '' : '\n') + entry + '\n', 'utf8');
    }
  } catch {
    /* 非关键路径：忽略失败，最多是报告目录出现在 git status 里 */
  }
}

// opts: { goal, dryRun, onEvent(event) }
export async function runTask(repoDir, opts = {}) {
  const events = [];
  const emit = (e) => {
    events.push(e);
    if (opts.onEvent) opts.onEvent(e);
  };

  if (!(await isGitRepo(repoDir))) {
    throw new Error('目标目录不是 git 仓库。CodeFix 依赖 git worktree 保证安全，请先 git init。');
  }
  const config = await loadConfig(repoDir);
  if (config.verifyCommands.length === 0) {
    throw new Error('没有可用的验证命令。请在仓库根目录创建 codefix.config.js 并设置 verifyCommands。');
  }

  emit({ type: 'start', repoDir, verifyCommands: config.verifyCommands });
  await ensureReportIgnored(repoDir, config.reportDir);

  // 1) 基线：直接在仓库跑一次验证（只读，不修改文件）
  emit({ type: 'verify', phase: 'baseline' });
  const baseline = await runVerify(repoDir, config);
  emit({ type: 'verify_result', phase: 'baseline', passed: baseline.passed });
  if (baseline.passed) {
    return { passed: true, clean: true, rounds: [], repoDir, events };
  }

  // 2) 创建隔离 worktree（要求主工作区干净，避免基线漂移）
  if (await hasUncommittedChanges(repoDir)) {
    throw new Error('主工作区有未提交改动。请先 commit 或 stash，CodeFix 只在干净基线上工作。');
  }
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'codefix-'));
  const worktreeDir = path.join(tmpRoot, 'wt');
  const branch = `codefix/${Date.now()}`;
  emit({ type: 'worktree', path: worktreeDir });

  const result = { passed: false, rounds: [], repoDir, branch: null, worktreeDir };
  try {
    await createWorktree(repoDir, worktreeDir);

    let verifyText = summarizeVerifyOutput(baseline.results);

    // 3) 迭代修复
    for (let round = 1; round <= config.maxRounds; round++) {
      emit({ type: 'round', round });

      const allFiles = await collectTextFiles(worktreeDir);
      const candidates = extractCandidateFiles(verifyText);
      const filesForLlm = await selectFiles(worktreeDir, allFiles, candidates, config);
      emit({ type: 'context', files: filesForLlm.map((f) => f.path) });

      const plan = await requestFixes({
        verifyText,
        files: filesForLlm,
        round,
        goal: opts.goal,
      });
      emit({ type: 'plan', summary: plan.summary, patches: (plan.patches || []).length });

      const { applied, rejected } = await applyPatches(worktreeDir, plan.patches || [], config);
      const roundRecord = {
        round,
        summary: plan.summary,
        applied: applied.map((a) => ({ file: a.file, reason: a.reason })),
        rejected,
        verify: { passed: false, results: [] },
      };
      result.rounds.push(roundRecord);

      if (applied.length === 0 && rejected.length === 0) {
        emit({ type: 'no_change', round });
        break;
      }

      // 4) 在 worktree 重新验证
      emit({ type: 'verify', phase: 'round', round });
      const v = await runVerify(worktreeDir, config);
      roundRecord.verify = v;
      emit({ type: 'verify_result', phase: 'round', round, passed: v.passed });

      if (v.passed) {
        // 5) 提交到修复分支
        const c = await commitWorktree(
          worktreeDir,
          branch,
          `codefix: ${plan.summary}`
        );
        if (c.committed) {
          result.passed = true;
          result.branch = branch;
          result.diff = await runGit(['diff', 'HEAD~1', '--stat'], worktreeDir);
          // 分支已提交到主仓库对象库，worktree 可以安全移除
          await removeWorktree(repoDir, worktreeDir);
          result.worktreeDir = null;
          emit({ type: 'done', round, branch, applied: diffStat(applied) });
          break;
        }
      }
      // 失败：把新错误作为下一轮输入
      verifyText = summarizeVerifyOutput(v.results);
    }

    // 6) 未通过：回滚（worktree 直接删除，主仓库零污染）
    if (!result.passed) {
      emit({ type: 'failed_rollback' });
      await removeWorktree(repoDir, worktreeDir);
      result.worktreeDir = null;
    }
  } finally {
    // dryRun 或异常时确保清理
    if (result.worktreeDir && !result.passed) {
      await rm(result.worktreeDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // 7) 报告
  result.reportFile = await writeReport(repoDir, config.reportDir, result);
  emit({ type: 'report', file: result.reportFile });
  return { ...result, events };
}

// 把修复分支合并回当前分支（用户确认后用）
export async function applyFix(repoDir, branch) {
  const r = await runGit(['merge', '--no-ff', '-m', `merge ${branch}`, branch], repoDir);
  return { ok: r.code === 0, output: r.stdout + r.stderr };
}

// 丢弃修复分支
export async function discardFix(repoDir, branch, worktreeDir) {
  if (worktreeDir) await removeWorktree(repoDir, worktreeDir);
  await runGit(['branch', '-D', branch], repoDir);
  return { ok: true };
}
