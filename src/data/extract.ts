import type { ExtractResult } from '../types';

/**
 * mock: extract —— 模拟 LLM 提取
 * 真实环境由云函数调用大模型 JSON Mode 完成，字段结构与此一致
 */
export default function extract(data?: { content?: string }): ExtractResult {
  const content = data?.content || '';
  console.info('[mock:extract] input length:', content.length);
  return {
    events: [
      {
        title: '产品评审会',
        startTime: '2026-09-09 10:00',
        endTime: '2026-09-09 11:30',
        location: '3 号会议室',
        source: content.slice(0, 50)
      }
    ],
    todos: [
      {
        title: '评审前更新演示文稿',
        dueDate: '2026-09-09 09:00',
        source: content.slice(0, 50)
      }
    ],
    collection: content.length > 120
      ? {
          title: '转发内容摘要',
          summary: content.slice(0, 80) + '……（模拟摘要：这段内容讲的是效率工具的实践方法，要点已提炼）',
          tags: ['待整理'],
          url: undefined,
          sourceType: 'message'
        }
      : undefined,
    note: undefined
  };
}
