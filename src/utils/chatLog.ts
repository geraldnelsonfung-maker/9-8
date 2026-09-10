/** AI 对话本地持久化：晨报页与悬浮球助理共用；超限截断最旧消息，读写失败静默降级为内存态 */
import Taro from '@tarojs/taro';

const CHAT_LOG_LIMIT = 60;

export function loadChatLog<T>(key: string): T[] {
  try {
    const list = Taro.getStorageSync(key);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('[chatLog] load failed:', err);
    return [];
  }
}

export function saveChatLog<T>(key: string, msgs: T[]) {
  try {
    Taro.setStorageSync(key, msgs.slice(-CHAT_LOG_LIMIT));
  } catch (err) {
    console.warn('[chatLog] save failed:', err);
  }
}
