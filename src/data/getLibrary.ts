import dayjs from 'dayjs';
import type { CollectionItem } from '../types';

const mockItems: CollectionItem[] = [
  ['碎片化学习如何不变成收藏夹吃灰', '关键是建立「每周回顾」机制：收藏时打标签，周日凌晨自动生成回顾清单，未处理的自动降级。', ['学习方法', '收藏'], 'article'],
  ['2026 年小程序云开发新特性速览', '云函数支持 Node 22 运行时，冷启动降低 40%；静态托管 CDN 与云存储合并计费。', ['科技', '小程序'], 'article'],
  ['和客户约定的付款节点', '9 月 15 日首付 30%，验收后 7 日内付尾款，记得提前 3 天发提醒邮件。', ['工作', '合同'], 'message'],
  ['一篇讲深度工作的长文', '作者提出 90 分钟沉浸单元 + 无通知环境，比番茄钟更适合创作者；附 4 周训练计划。', ['效率', '深度工作'], 'article'],
  ['健身计划 v3', '周一练胸背、周三腿、周五肩臂，每次 45 分钟力量 + 15 分钟拉伸。', ['健康'], 'message'],
  ['微信小程序订阅消息最佳实践', '授权率的关键是「价值前置」：先给一次完整服务，再请求订阅；文案写清「明早 7:30 提醒你」。', ['小程序', '增长'], 'article'],
  ['读书笔记：掌控习惯', '环境设计比意志力可靠：把想做的事放在 20 秒内可触达的位置。', ['阅读'], 'article'],
  ['租房合同要点备忘', '押一付三、物业费谁承担、提前退租违约条款、家具清单拍照留底。', ['生活', '合同'], 'message'],
  ['AI Agent 设计模式合集', 'Plan-Execute、Reflection、Tool-Use 三大模式，配套 12 个开源实现链接。', ['科技', 'AI'], 'link'],
  ['周末市集探店清单', '手作面包摊位在东门第三个， coffee 车通常 11 点出摊，早点去。', ['生活'], 'message']
].map((row, i) => ({
  id: `item-mock-${i + 1}`,
  title: row[0] as string,
  summary: row[1] as string,
  tags: row[2] as string[],
  sourceType: row[3] as CollectionItem['sourceType'],
  createTime: dayjs().subtract(i + 1, 'day').hour(9 + i).minute(12).toISOString()
}));

/** mock: getLibrary —— 收藏列表 */
export default function getLibrary(): CollectionItem[] {
  return mockItems;
}
