// 对外统一入口：CLI 与 VS Code 插件都从这里调用引擎。
export { runTask, applyFix, discardFix } from './engine.js';
export { loadConfig } from './config.js';
export { runVerify, summarizeVerifyOutput } from './runner.js';
export { loadEnvLocal } from './env.js';
