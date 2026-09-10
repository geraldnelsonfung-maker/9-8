// 验证命令执行器：在指定目录（通常是 worktree）跑配置里的 verifyCommands，收集错误输出。
import { spawn } from 'node:child_process';
import path from 'node:path';

// 把当前 node 所在目录加入子进程 PATH，保证验证命令里的 node/npm 可解析
function childEnv() {
  const dir = path.dirname(process.execPath);
  const sep = path.delimiter;
  const cur = process.env.PATH || '';
  return { ...process.env, PATH: cur.includes(dir) ? cur : dir + sep + cur };
}

function runOne(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const parts = cmd.split(/\s+/);
    const [bin, ...args] = parts;
    const child = spawn(bin, args, {
      cwd,
      env: childEnv(),
      shell: process.platform === 'win32', // npm 在 Windows 需要 shell
    });
    let out = '';
    let timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ cmd, code, output: out });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ cmd, code: -1, output: String(e) });
    });
  });
}

// 依次执行全部验证命令；返回 { passed, results }
export async function runVerify(cwd, config) {
  const results = [];
  for (const cmd of config.verifyCommands) {
    results.push(await runOne(cmd, cwd, config.commandTimeoutMs));
  }
  return {
    passed: results.every((r) => r.code === 0),
    results,
  };
}

// 把验证输出压缩成适合喂给 LLM 的文本（去重、截断）
export function summarizeVerifyOutput(results, maxChars = 12000) {
  let text = '';
  for (const r of results) {
    if (r.code === 0) continue;
    text += `\n===== 命令失败 (exit ${r.code}): ${r.cmd} =====\n`;
    text += r.output + '\n';
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + '\n...(输出已截断)';
  }
  return text.trim() || '(无错误输出)';
}
