/** mock: dailyPlan —— 待办与日程的统一持久化存储（本地） */
import Taro from '@tarojs/taro';
import dayjs from 'dayjs';
import type { ScheduleEvent, TodoItem } from '../types';

const PLAN_KEY = 'dailyPlanStore';

export interface DailyPlan {
  events: ScheduleEvent[];
  todos: TodoItem[];
}

/** 生成唯一 id */
export function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 默认种子数据（与晨报默认一致，便于演示） */
export function seedPlan(): DailyPlan {
  const today = dayjs().format('YYYY-MM-DD');
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
  return {
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
    ]
  };
}

function tryParse(raw: unknown): DailyPlan {
  try {
    const obj = raw as Partial<DailyPlan>;
    return {
      events: Array.isArray(obj?.events) ? obj.events : [],
      todos: Array.isArray(obj?.todos) ? obj.todos : []
    };
  } catch {
    return { events: [], todos: [] };
  }
}

export function readPlan(): DailyPlan {
  try {
    const raw = Taro.getStorageSync(PLAN_KEY);
    const stored = tryParse(raw);
    if (stored.events.length === 0 && stored.todos.length === 0) {
      return seedPlan();
    }
    return stored;
  } catch (err) {
    console.warn('[mock:dailyPlan] read failed:', err);
    return seedPlan();
  }
}

export function writePlan(plan: DailyPlan) {
  try {
    Taro.setStorageSync(PLAN_KEY, plan);
  } catch (err) {
    console.warn('[mock:dailyPlan] write failed:', err);
  }
}