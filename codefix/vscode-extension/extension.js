// CodeFix VS Code 扩展：薄壳，通过子进程调用 codefix CLI（--json），不直接 import ESM 引擎。
const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

let outputChannel;
let lastFix = null; // { branch, repo, reportFile }

function cfg() {
  return vscode.workspace.getConfiguration('codefix');
}

function resolveCli() {
  const explicit = cfg().get('cliPath');
  if (explicit && fs.existsSync(explicit)) return explicit;
  // 默认：插件与 codefix 仓库同仓（vscode-extension 的上一级就是仓库根）
  const guess = path.join(__dirname, '..', 'bin', 'codefix.js');
  if (fs.existsSync(guess)) return guess;
  // 打包进 vsix 的自带引擎（engine/bin/codefix.js）
  const bundled = path.join(__dirname, 'engine', 'bin', 'codefix.js');
  if (fs.existsSync(bundled)) return bundled;
  throw new Error('未找到 codefix CLI。请设置 codefix.cliPath 指向 bin/codefix.js。');
}

function env() {
  const c = cfg();
  const e = { ...process.env };
  if (c.get('apiKey')) e.CODEFIX_LLM_API_KEY = c.get('apiKey');
  if (c.get('baseUrl')) e.CODEFIX_LLM_BASE_URL = c.get('baseUrl');
  if (c.get('model')) e.CODEFIX_LLM_MODEL = c.get('model');
  if (c.get('gitPath')) e.CODEFIX_GIT = c.get('gitPath');
  return e;
}

function repoDir() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error('请先打开一个项目文件夹。');
  }
  return folders[0].uri.fsPath;
}

function runCli(args, token) {
  return new Promise((resolve, reject) => {
    const node = cfg().get('nodePath') || 'node';
    const child = cp.spawn(node, [resolveCli(), ...args], {
      cwd: repoDir(),
      env: env(),
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      outputChannel.append(String(d));
    });
    child.stderr.on('data', (d) => {
      err += d;
      outputChannel.append(String(d));
    });
    const kill = () => child.kill();
    if (token) token.onCancellationRequested(kill);
    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolve({ code, stdout: out, stderr: err });
      } else {
        reject(new Error(err || `CLI 退出码 ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function withOutput(fn) {
  outputChannel.show(true);
  try {
    await fn();
  } catch (e) {
    vscode.window.showErrorMessage('CodeFix: ' + e.message);
  }
}

async function check() {
  await withOutput(async () => {
    const r = await runCli(['check']);
    outputChannel.appendLine('\n--- check 完成 ---');
    if (r.code !== 0) {
      vscode.window.showWarningMessage('CodeFix: 验证命令存在错误，可运行「自动修复」。');
    } else {
      vscode.window.showInformationMessage('CodeFix: 验证全部通过 ✅');
    }
  });
}

async function fix() {
  await withOutput(async () => {
    const goal = await vscode.window.showInputBox({
      prompt: '可选：给 AI 的附加目标（留空 = 让验证命令全部通过）',
      placeHolder: '例如：只修编译错误，不要动测试',
    });
    if (goal === undefined) return; // 用户取消
    const args = ['fix', '--json'];
    if (goal) args.push('--goal', goal);

    const progress = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'CodeFix 自动修复中…', cancellable: true },
      async (_p, token) => runCli(args, token)
    );

    let result;
    try {
      result = JSON.parse(progress.stdout);
    } catch {
      throw new Error('无法解析 CLI JSON 输出:\n' + progress.stdout.slice(0, 500));
    }

    if (result.clean) {
      vscode.window.showInformationMessage('CodeFix: 基线验证通过，无需修复 ✅');
      return;
    }
    if (result.passed) {
      lastFix = { branch: result.branch, repo: repoDir(), reportFile: result.reportFile };
      const pick = await vscode.window.showInformationMessage(
        `CodeFix: 修复完成！分支 ${result.branch} 验证通过。要合并吗？`,
        '合并到当前分支', '稍后决定', '查看报告'
      );
      if (pick === '合并到当前分支') await applyBranch();
      else if (pick === '查看报告' && result.reportFile) {
        const doc = await vscode.workspace.openTextDocument(result.reportFile);
        await vscode.window.showTextDocument(doc);
      }
    } else {
      vscode.window.showWarningMessage(
        'CodeFix: 自动修复未成功，已回滚（主仓库零污染）。详见输出面板与报告。'
      );
    }
  });
}

async function applyBranch() {
  await withOutput(async () => {
    if (!lastFix) {
      vscode.window.showWarningMessage('CodeFix: 没有待合并的修复分支。');
      return;
    }
    const r = await runCli(['apply', lastFix.branch]);
    if (r.code === 0) {
      vscode.window.showInformationMessage(`CodeFix: 已合并 ${lastFix.branch}。建议重新打开文件查看改动。`);
      lastFix = null;
    } else {
      vscode.window.showErrorMessage('CodeFix 合并失败: ' + r.stderr);
    }
  });
}

async function discardBranch() {
  await withOutput(async () => {
    if (!lastFix) {
      vscode.window.showWarningMessage('CodeFix: 没有待处理的修复分支。');
      return;
    }
    await runCli(['discard', lastFix.branch]);
    vscode.window.showInformationMessage(`CodeFix: 已丢弃 ${lastFix.branch}`);
    lastFix = null;
  });
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('CodeFix');
  context.subscriptions.push(
    vscode.commands.registerCommand('codefix.check', check),
    vscode.commands.registerCommand('codefix.fix', fix),
    vscode.commands.registerCommand('codefix.applyBranch', applyBranch),
    vscode.commands.registerCommand('codefix.discardBranch', discardBranch)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
