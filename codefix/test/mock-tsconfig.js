// 演示用 mock：模拟真实 LLM 对 TS2688 的修复（tsconfig 显式声明 types）。
export default async function mock({ files }) {
  const tsconfig = files.find((f) => f.path === 'tsconfig.json');
  if (!tsconfig) return { summary: 'mock: 未拿到 tsconfig.json', patches: [] };
  const json = JSON.parse(tsconfig.content);
  // 废弃存根包（无类型入口）导致 TS2688；显式声明 types 停止全量自动扫描
  json.compilerOptions.types = ['node'];
  return {
    summary: 'mock: tsconfig 显式声明 types，跳过废弃存根包 minimatch/sass',
    patches: [
      {
        file: 'tsconfig.json',
        reason: 'TS2688 由 @types/minimatch、@types/sass 废弃存根包引起，显式 types 可修复',
        content: JSON.stringify(json, null, 2) + '\n',
      },
    ],
  };
}
