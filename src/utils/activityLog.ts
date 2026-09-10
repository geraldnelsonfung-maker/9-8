import Taro from '@tarojs/taro';
import dayjs from 'dayjs';

export interface ActivityLogItem {
  id: string;
  icon: string;
  text: string;
  time: string;
}

const ACTIVITY_KEY = 'activity-log';
const ACTIVITY_LIMIT = 20;

/** 追加一条活动日志（保留最近 20 条，「我的」页展示最新 3 条） */
export function logActivity(icon: string, text: string) {
  try {
    const list = (Taro.getStorageSync(ACTIVITY_KEY) as ActivityLogItem[]) || [];
    const next: ActivityLogItem[] = [
      { id: `log-${Date.now()}`, icon, text, time: dayjs().toISOString() },
      ...list
    ].slice(0, ACTIVITY_LIMIT);
    Taro.setStorageSync(ACTIVITY_KEY, next);
  } catch (err) {
    console.error('[activityLog] write failed:', err);
  }
}

/** 读取活动日志（新→旧） */
export function getActivityLogs(): ActivityLogItem[] {
  try {
    return (Taro.getStorageSync(ACTIVITY_KEY) as ActivityLogItem[]) || [];
  } catch (err) {
    console.error('[activityLog] read failed:', err);
    return [];
  }
}
