import dayjs from 'dayjs';

/** 晨报问候语：按小时返回 */
export function getGreeting(hour: number): string {
  if (hour < 6) return '夜深了，先看看明天的安排';
  if (hour < 11) return '早上好，新的一天从晨报开始';
  if (hour < 14) return '中午好，下午的日程在这';
  if (hour < 18) return '下午好，别忘了待办清单';
  return '晚上好，为明天做好准备';
}

/** 格式化事件时间显示：今天/明天/X月X日 HH:mm */
export function formatEventTime(time: string): string {
  const d = dayjs(time);
  if (!d.isValid()) return time;
  const today = dayjs().startOf('day');
  const diff = d.diff(today, 'day');
  const hm = d.format('HH:mm');
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `明天 ${hm}`;
  return d.format('M月D日 HH:mm');
}

/** 是否同一天 */
export function isSameDay(a: string | Date, b: string | Date): boolean {
  return dayjs(a).isSame(dayjs(b), 'day');
}

/** 相对时间显示：收藏列表用 */
export function fromNow(time: string): string {
  const d = dayjs(time);
  if (!d.isValid()) return time;
  const diffMinutes = dayjs().diff(d, 'minute');
  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = dayjs().diff(d, 'hour');
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = dayjs().diff(d, 'day');
  if (diffDays < 30) return `${diffDays} 天前`;
  return d.format('YYYY-MM-DD');
}
