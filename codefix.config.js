// CodeFix 配置：验证命令用 tsc --noEmit（快、只读、能抓类型/语法错误）。
// 如需完整构建验证可改为 "npm run build:h5"（更慢，会写 dist/）。
export default {
  verifyCommands: ['node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json'],
  maxRounds: 3,
  allowPaths: ['src/', 'config/', 'cloudfunctions/', 'tsconfig.json', 'package.json'],
};
