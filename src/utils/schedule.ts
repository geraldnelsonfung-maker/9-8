import dayjs from 'dayjs';
import type { ScheduleEvent } from '@/types';

/** 排班冲突信息 */
export interface ConflictInfo {
  /** 对应待确认条目的 key */
  draftKey: string;
  title: string;
  startTime: string;
  endTime: string;
  /** 与之冲突的现有日程 */
  clashTitle: string;
  clashTime: string;
  /** 建议的空闲时段（'YYYY-MM-DD HH:mm'） */
  suggestions: string[];
}

/** 判断两个时间区间是否重叠（缺省 endTime 按开始时间 + 90 分钟） */
export function isOverlap(
  aStart: string,
  aEnd: string | undefined,
  bStart: string,
  bEnd: string | undefined
): boolean {
  const as = dayjs(aStart).valueOf();
  const ae = dayjs(aEnd || dayjs(aStart).add(90, 'minute').format('YYYY-MM-DD HH:mm')).valueOf();
  const bs = dayjs(bStart).valueOf();
  const be = dayjs(bEnd || dayjs(bStart).add(90, 'minute').format('YYYY-MM-DD HH:mm')).valueOf();
  return as < be && bs < ae;
}

/** 与现有日程做冲突检测，返回冲突列表 */
export function detectConflicts(
  candidates: Array<{ key: string; title: string; startTime: string; endTime?: string }>,
  existing: ScheduleEvent[]
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  candidates.forEach((c) => {
    if (!c.startTime) return;
    const endTime = c.endTime || dayjs(c.startTime).add(90, 'minute').format('YYYY-MM-DD HH:mm');
    existing.forEach((ex) => {
      if (!isOverlap(c.startTime, c.endTime, ex.startTime, ex.endTime)) return;
      conflicts.push({
        draftKey: c.key,
        title: c.title,
        startTime: c.startTime,
        endTime,
        clashTitle: ex.title,
        clashTime: `${dayjs(ex.startTime).format('MM-DD HH:mm')}${
          ex.endTime ? `-${dayjs(ex.endTime).format('HH:mm')}` : ''
        }`,
        suggestions: suggestSlots(c.startTime, c.endTime, existing)
      });
    });
  });
  return conflicts;
}

/**
 * 生成建议时段：按事件时长从 09:00 起逐格扫描当天 09:00-18:00，
 * 跳过与现有日程重叠的时段，返回前 2 个空闲时段
 */
export function suggestSlots(
  startTime: string,
  endTime: string | undefined,
  existing: ScheduleEvent[]
): string[] {
  const start = dayjs(startTime);
  const end = dayjs(endTime || start.add(90, 'minute').format('YYYY-MM-DD HH:mm'));
  const durMinutes = Math.max(30, end.diff(start, 'minute') || 90);
  const day = start.format('YYYY-MM-DD');
  const slots: string[] = [];
  for (let h = 9; h <= 18 && slots.length < 2; h += 1) {
    const candidate = dayjs(`${day} ${String(h).padStart(2, '0')}:00`);
    const candidateEnd = candidate.add(durMinutes, 'minute');
    const clash = existing.some((ex) =>
      isOverlap(candidate.format('YYYY-MM-DD HH:mm'), candidateEnd.format('YYYY-MM-DD HH:mm'), ex.startTime, ex.endTime)
    );
    if (!clash) slots.push(candidate.format('YYYY-MM-DD HH:mm'));
  }
  return slots;
}
