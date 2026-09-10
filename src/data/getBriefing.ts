import dayjs from 'dayjs';
import type { Briefing } from '../types';
import { readPlan } from './dailyPlan';
import { computeAdaptive } from '../utils/adaptive';

/** mock: getBriefing —— 返回今日晨报（动态读取统一的待办/日程存储，自适应排序 F21） */
export default function getBriefing(): Briefing {
  const plan = readPlan();
  const today = dayjs().format('YYYY-MM-DD');
  const adaptive = computeAdaptive(plan.events, plan.todos);

  // 自适应开场：爆满日强调日程前置；有高优待办先点名
  let greeting = '早上好，新的一天从晨报开始';
  if (adaptive.busyDay) greeting = '今天日程很满，先看日程再逐项推进';
  else if (adaptive.focusTodo) greeting = `先办「${adaptive.focusTodo}」，其他从容推进`;

  return {
    date: today,
    greeting,
    events: plan.events,
    todos: plan.todos,
    digest: [
      '《效率工具的三个实践》：把重复动作模板化，每周节省约 2 小时',
      '《AI 时代的个人知识管理》：先收集后整理，避免过度分类'
    ],
    read: false,
    adaptive
  };
}
