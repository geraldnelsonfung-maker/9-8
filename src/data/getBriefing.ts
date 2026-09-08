import dayjs from 'dayjs';
import type { Briefing } from '../types';

/** mock: getBriefing —— 返回今日晨报 */
export default function getBriefing(): Briefing {
  const today = dayjs().format('YYYY-MM-DD');
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
  return {
    date: today,
    greeting: '早上好，新的一天从晨报开始',
    events: [
      {
        id: 'evt-mock-1',
        title: '产品评审会',
        startTime: `${today} 10:00`,
        endTime: `${today} 11:30`,
        location: '3 号会议室',
        source: '领导微信消息',
        status: 'confirmed'
      },
      {
        id: 'evt-mock-2',
        title: '和设计师对齐视觉稿',
        startTime: `${tomorrow} 14:00`,
        location: '线上会议',
        source: '群聊转发',
        status: 'confirmed'
      }
    ],
    todos: [
      {
        id: 'todo-mock-1',
        title: '评审前更新演示文稿',
        dueDate: `${today} 09:00`,
        status: 'confirmed'
      },
      {
        id: 'todo-mock-2',
        title: '回复客户关于合同条款的邮件',
        dueDate: `${today} 18:00`,
        status: 'confirmed'
      }
    ],
    digest: [
      '《效率工具的三个实践》：把重复动作模板化，每周节省约 2 小时',
      '《AI 时代的个人知识管理》：先收集后整理，避免过度分类'
    ],
    read: false
  };
}
