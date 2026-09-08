import { callFunction } from './cloud';
import type {
  Briefing,
  CollectionItem,
  ExtractResult,
  PayOrder,
  Usage,
  UserProfile
} from '../types';

/** 登录（静默获取 openid + 用户档案） */
export function apiLogin(): Promise<UserProfile> {
  return callFunction<UserProfile>('login');
}

/** AI 提取转发内容 → 日程/待办/收藏 */
export function apiExtract(content: string): Promise<ExtractResult> {
  return callFunction<ExtractResult>('extract', { content });
}

/** 确认提取结果入库 */
export function apiConfirmItem(payload: {
  events: ExtractResult['events'];
  todos: ExtractResult['todos'];
  collection?: ExtractResult['collection'];
}): Promise<{ saved: number }> {
  return callFunction<{ saved: number }>('confirmItem', payload);
}

/** 获取今日晨报 */
export function apiGetBriefing(): Promise<Briefing> {
  return callFunction<Briefing>('getBriefing');
}

/** 语音/文字对话（deep=true 时进入深度思考模式） */
export function apiChat(message: string, type: 'text' | 'voice' = 'text', deep = false): Promise<{ reply: string; action: string }> {
  return callFunction<{ reply: string; action: string }>('chat', { message, type, deep });
}

/** 收藏列表 */
export function apiGetLibrary(): Promise<CollectionItem[]> {
  return callFunction<CollectionItem[]>('getLibrary');
}

/** 更新习惯设置 */
export function apiUpdateSettings(payload: Partial<Pick<UserProfile, 'nickname' | 'briefingTime' | 'preferences'>>): Promise<UserProfile> {
  return callFunction<UserProfile>('updateSettings', payload);
}

/** 用量查询 */
export function apiGetUsage(): Promise<Usage> {
  return callFunction<Usage>('getUsage');
}

/** 创建订阅订单 */
export function apiCreateOrder(planId: PayOrder['planId']): Promise<PayOrder> {
  return callFunction<PayOrder>('createOrder', { planId });
}
