// 端到端测试：搭建临时 git 夹具仓库 → 跑引擎闭环 → 断言结果。
// 运行: node test/run.js
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTask, applyFix } from '../src/index.js';
import { runGit, isGitRepo, hasUncommittedChanges } from '../src/git.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK = path.join(__dirname, 'mock-llm.js');

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

const BROKEN = `function add(a, b) {
  return a + b
console.log(add(1, 2)
`;

// mock 的修复结果 = BROKEN 应用同一替换
const FIXED = BROKEN.replace('console.log(add(1, 2)', 'console.log(add(1, 2))\n}');

// git autocrlf 会把 worktree 内文件转成 CRLF，比较前统一换行符
const norm = (s) => s.replace(/\r\n/g, '\n');

async function makeFixtureRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codefix-fixture-'));
  await runGit(['init', '-b', 'main'], dir);
  await runGit(['config', 'user.email', 'test@example.com'], dir);
  await runGit(['config', 'user.name', 'CodeFix Test'], dir);
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'app.js'), BROKEN, 'utf8');
  await writeFile(
    path.join(dir, 'codefix.config.js'),
    `export default { verifyCommands: ["node --check src/app.js"], maxRounds: 2 };\n`,
    'utf8'
  );
  await runGit(['add', '-A'], dir);
  await runGit(['commit', '-m', 'init with broken file'], dir);
  return dir;
}

async function testHappyPath() {
  console.log('\n[test] 全自动修复闭环（成功路径）');
  const repo = await makeFixtureRepo();
  process.env.CODEFIX_LLM_MOCK = MOCK;
  process.env.CODEFIX_MOCK_MODE = 'fix';
  try {
    const result = await runTask(repo, {});
    assert(result.passed === true, '任务通过验证');
    assert(typeof result.branch === 'string' && result.branch.startsWith('codefix/'), '生成修复分支');
    assert(result.worktreeDir === null, 'worktree 已清理');
    assert(existsSync(result.reportFile), '报告已生成');
    // 主工作区文件未被改动
    const mainContent = await readFile(path.join(repo, 'src', 'app.js'), 'utf8');
    assert(mainContent === BROKEN, '主工作区保持原样（未污染）');
    assert((await hasUncommittedChanges(repo)) === false, '主工作区仍然干净');
    // 合并分支后文件被修好
    const ap = await applyFix(repo, result.branch);
    assert(ap.ok, 'apply 合并成功');
    const after = await readFile(path.join(repo, 'src', 'app.js'), 'utf8');
    assert(norm(after) === norm(FIXED), '合并后文件已修复');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

async function testRollbackPath() {
  console.log('\n[test] 修复失败自动回滚');
  const repo = await makeFixtureRepo();
  process.env.CODEFIX_LLM_MOCK = MOCK;
  process.env.CODEFIX_MOCK_MODE = 'broken';
  try {
    const result = await runTask(repo, {});
    assert(result.passed === false, '任务未通过');
    assert(result.rounds.length === 2, '用满 maxRounds=2 轮');
    assert(result.worktreeDir === null, 'worktree 已回滚清理');
    const mainContent = await readFile(path.join(repo, 'src', 'app.js'), 'utf8');
    assert(mainContent === BROKEN, '主工作区零污染');
    assert((await hasUncommittedChanges(repo)) === false, '主工作区仍然干净');
  } finally {
    delete process.env.CODEFIX_MOCK_MODE;
    await rm(repo, { recursive: true, force: true });
  }
}

async function testCleanBaseline() {
  console.log('\n[test] 基线已通过（无需修复）');
  const repo = await makeFixtureRepo();
  // 手动修好并提交
  await writeFile(path.join(repo, 'src', 'app.js'), FIXED, 'utf8');
  await runGit(['add', '-A'], repo);
  await runGit(['commit', '-m', 'fix manually'], repo);
  process.env.CODEFIX_LLM_MOCK = MOCK;
  try {
    const result = await runTask(repo, {});
    assert(result.clean === true, '识别为 clean');
    assert(result.rounds.length === 0, '未调用 LLM');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

// 三个测试共享 process.env，必须串行执行
const results = await Promise.allSettled([
  (async () => {
    await testHappyPath();
    await testRollbackPath();
    await testCleanBaseline();
  })(),
]);
for (const r of results) {
  if (r.status === 'rejected') {
    failed++;
    console.error('测试异常:', r.reason);
  }
}
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
