import { callFunction } from './cloud';
import type {
  Briefing,
  CollectionItem,
  ExtractResult,
  HotspotNews,
  PayOrder,
  Usage,
  UserProfile
} from '../types';

/** 登录（静默获取 openid + 用户档案） */
export function apiLogin(): Promise<UserProfile> {
  return callFunction<UserProfile>('login');
}

/** AI 提取转发内容/截图 → 日程/待办/收藏（images 为 base64 数组，不含 dataURL 前缀） */
export function apiExtract(payload: { content?: string; images?: string[] }): Promise<ExtractResult> {
  return callFunction<ExtractResult>('extract', payload);
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

/** 工作助手动作 */
export type WorkAction = 'summary' | 'points' | 'advice';

/** 语音/文字对话（deep=true 深度思考；work 传入时进入工作助手模式：总结/要点/建议） */
export function apiChat(
  message: string,
  type: 'text' | 'voice' = 'text',
  deep = false,
  work?: { action: WorkAction }
): Promise<{ reply: string; action: string }> {
  return callFunction<{ reply: string; action: string }>('chat', {
    message,
    type,
    deep,
    mode: work ? 'work' : undefined,
    workAction: work ? work.action : undefined
  });
}

/** 收藏列表 */
export function apiGetLibrary(): Promise<CollectionItem[]> {
  return callFunction<CollectionItem[]>('getLibrary');
}

/** 今日热点资讯（v2.0，来源强制标注；云函数就绪前双端走本地 mock） */
export function apiGetHotspot(): Promise<HotspotNews[]> {
  return callFunction<HotspotNews[]>('getHotspot');
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

/** 注销账号并删除全部数据（F18） */
export function apiDeleteAccount(): Promise<{ deleted: boolean }> {
  return callFunction<{ deleted: boolean }>('deleteAccount');
}

/** 购物清单：list/add/toggleBought/remove/addPrice（真机用云函数按 openid 隔离；H5 走本地 mock） */
export interface ShoppingPrice {
  platform: string;
  price: number;
}
export interface ShoppingItem {
  id: string;
  name: string;
  targetPrice?: number;
  link?: string;
  bought: boolean;
  createdAt: string;
  prices: ShoppingPrice[];
}
export function apiShoppingList(): Promise<ShoppingItem[]> {
  return callFunction<ShoppingItem[]>('shopping', { action: 'list' });
}
export function apiShoppingAdd(payload: { name: string; targetPrice?: number }): Promise<ShoppingItem | null> {
  return callFunction<ShoppingItem | null>('shopping', { action: 'add', ...payload });
}
export function apiShoppingToggleBought(id: string): Promise<{ id: string; bought: boolean } | null> {
  return callFunction<{ id: string; bought: boolean } | null>('shopping', { action: 'toggleBought', id });
}
export function apiShoppingRemove(id: string): Promise<{ id: string } | null> {
  return callFunction<{ id: string } | null>('shopping', { action: 'remove', id });
}
export function apiShoppingAddPrice(
  id: string,
  platform: string,
  price: number
): Promise<{ id: string; prices: ShoppingPrice[] } | null> {
  return callFunction<{ id: string; prices: ShoppingPrice[] } | null>('shopping', {
    action: 'addPrice',
    id,
    platform,
    price
  });
}
