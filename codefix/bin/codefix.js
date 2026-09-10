#!/usr/bin/env node
// CodeFix CLI：
//   codefix check            只跑验证命令，输出错误（不修改任何文件）
//   codefix fix              全自动：检查→修复→验证（在隔离 worktree 中）
//   codefix apply <branch>   把修复分支合并进当前分支
//   codefix discard <branch> 丢弃修复分支
import { parseArgs } from 'node:util';
import { runTask, applyFix, discardFix, loadConfig, runVerify } from '../src/index.js';

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: 'string', default: process.cwd() },
    goal: { type: 'string', default: '' },
    'max-rounds': { type: 'string' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

function help() {
  console.log(`CodeFix — 自动代码检查/修复引擎

用法:
  codefix check   [--repo <dir>]                只检查，不修改
  codefix fix     [--repo <dir>] [--goal <文本>] 全自动修复闭环
  codefix apply   <branch> [--repo <dir>]        合并修复分支
  codefix discard <branch> [--repo <dir>]        丢弃修复分支

环境变量:
  CODEFIX_LLM_API_KEY   DeepSeek/OpenAI 兼容 key（或 DEEPSEEK_API_KEY）
  CODEFIX_LLM_BASE_URL  默认 https://api.deepseek.com/v1
  CODEFIX_LLM_MODEL     默认 deepseek-chat
  CODEFIX_LLM_MOCK      指向本地 mock 模块（演示/测试用）
  CODEFIX_GIT           git 可执行文件路径

密钥文件:
  在仓库根目录放 .env.local（KEY=VALUE），启动时自动加载且不会进 git。
  例: CODEFIX_LLM_API_KEY=sk-xxxx`);
}

const command = positionals[0];

async function main() {
  if (flags.help || !command) return help();
  const repo = flags.repo;
  await loadEnvLocal(repo);

  if (command === 'check') {
    const config = await loadConfig(repo);
    console.log(`验证命令: ${config.verifyCommands.join(' | ') || '(无)'}`);
    const r = await runVerify(repo, config);
    for (const x of r.results) {
      console.log(`\n$ ${x.cmd}  → exit ${x.code}`);
      if (x.code !== 0) console.log(x.output.slice(-4000));
    }
    process.exit(r.passed ? 0 : 1);
  }

  if (command === 'fix') {
    const onEvent = (e) => {
      if (e.type === 'start') console.log(`基线验证: ${e.verifyCommands.join(' | ')}`);
      if (e.type === 'verify_result') console.log(`  [${e.phase}] ${e.passed ? '通过' : '未通过'}`);
      if (e.type === 'round') console.log(`\n—— 第 ${e.round} 轮修复 ——`);
      if (e.type === 'context') console.log(`  上下文文件: ${e.files.join(', ') || '(无匹配)'}`);
      if (e.type === 'plan') console.log(`  方案: ${e.summary}（${e.patches} 个补丁）`);
      if (e.type === 'no_change') console.log(`  LLM 未返回有效补丁，停止`);
      if (e.type === 'done') console.log(`\n✅ 第 ${e.round} 轮验证通过，已提交到分支 ${e.branch}`);
      if (e.type === 'failed_rollback') console.log(`\n❌ 达到轮数上限仍未通过，已自动回滚（主仓库零污染）`);
      if (e.type === 'report') console.log(`报告: ${e.file}`);
    };
    const result = await runTask(repo, { goal: flags.goal, onEvent });
    if (flags.json) {
      console.log(JSON.stringify({
        clean: !!result.clean,
        passed: !!result.passed,
        branch: result.branch || null,
        rounds: result.rounds,
        reportFile: result.reportFile || null,
      }));
    } else if (result.clean) {
      console.log('✅ 基线验证通过，无需修复。');
    } else if (result.passed) {
      console.log(`\n下一步: codefix apply ${result.branch} --repo ${repo}`);
    }
    process.exit(result.clean || result.passed ? 0 : 1);
  }

  if (command === 'apply' || command === 'discard') {
    const branch = positionals[1];
    if (!branch) {
      console.error(`用法: codefix ${command} <branch>`);
      process.exit(2);
    }
    if (command === 'apply') {
      const r = await applyFix(repo, branch);
      console.log(r.output);
      process.exit(r.ok ? 0 : 1);
    } else {
      await discardFix(repo, branch);
      console.log(`已丢弃分支 ${branch}`);
    }
    return;
  }

  console.error(`未知命令: ${command}`);
  help();
  process.exit(2);
}

main().catch((e) => {
  console.error('错误:', e.message);
  process.exit(1);
});
