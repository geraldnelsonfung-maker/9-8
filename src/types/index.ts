// ============================================
// 领域类型定义 —— 私人晨报助理
// ============================================

/** 日程事件 */
export interface ScheduleEvent {
  id: string;
  title: string;
  /** ISO 日期时间或 'YYYY-MM-DD HH:mm' */
  startTime: string;
  endTime?: string;
  location?: string;
  /** 来源消息摘要 */
  source?: string;
  /** confirmed: 已确认入库 / pending: 待确认 */
  status: 'confirmed' | 'pending';
  createTime?: string;
}

/** 待办事项 */
export interface TodoItem {
  id: string;
  title: string;
  /** 截止日期，可选 */
  dueDate?: string;
  /** 来源消息摘要 */
  source?: string;
  status: 'confirmed' | 'pending' | 'done';
  createTime?: string;
}

/** 收藏条目（转发文章/链接/内容的摘要归档） */
export interface CollectionItem {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  /** 原文链接（若有） */
  url?: string;
  /** 原文类型：article 文章 / message 消息 / link 链接 */
  sourceType: 'article' | 'message' | 'link';
  createTime: string;
}

/** 晨报 */
export interface Briefing {
  /** 'YYYY-MM-DD' */
  date: string;
  greeting: string;
  events: ScheduleEvent[];
  todos: TodoItem[];
  /** 昨日收藏精选摘要 */
  digest: string[];
  /** 已读标记 */
  read: boolean;
}

/** AI 提取结果（收件箱处理产物） */
export interface ExtractResult {
  events: Array<Omit<ScheduleEvent, 'id' | 'status' | 'createTime'>>;
  todos: Array<Omit<TodoItem, 'id' | 'status' | 'createTime'>>;
  collection?: Omit<CollectionItem, 'id' | 'createTime'>;
  /** 无法归类时的原文备注 */
  note?: string;
}

/** 用户资料与设置 */
export interface UserProfile {
  openid: string;
  nickname: string;
  /** 晨报推送时间 'HH:mm' */
  briefingTime: string;
  /** 内容偏好标签 */
  preferences: string[];
  subscribed: boolean;
  /** 订阅到期时间，null 为未订阅 */
  expiredAt: string | null;
  isEarlyBird: boolean;
}

/** 用量（免费额度） */
export interface Usage {
  /** 本月已用语音次数 */
  voiceUsed: number;
  /** 语音月额度（-1 表示无限） */
  voiceQuota: number;
  /** 当前收藏数量 */
  collectionCount: number;
  /** 收藏额度（-1 表示无限） */
  collectionQuota: number;
}

/** 对话消息 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  type: 'text' | 'voice';
  content: string;
  /** 语音消息时长（秒） */
  duration?: number;
  /** 是否由深度思考模式生成 */
  deep?: boolean;
  createTime: string;
}

/** 支付订单 */
export interface PayOrder {
  orderId: string;
  planId: 'earlybird_monthly' | 'monthly' | 'yearly';
  price: number;
  status: 'created' | 'paid' | 'expired';
}
