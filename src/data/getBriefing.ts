import dayjs from 'dayjs';
import type { Briefing } from '../types';
import { readPlan } from './dailyPlan';

/** mock: getBriefing —— 返回今日晨报（动态读取统一的待办/日程存储） */
export default function getBriefing(): Briefing {
  const plan = readPlan();
  const today = dayjs().format('YYYY-MM-DD');
  return {
    date: today,
    greeting: '早上好，新的一天从晨报开始',
    events: plan.events,
    todos: plan.todos,
    digest: [
      '《效率工具的三个实践》：把重复动作模板化，每周节省约 2 小时',
      '《AI 时代的个人知识管理》：先收集后整理，避免过度分类'
    ],
    read: false
  };
}
