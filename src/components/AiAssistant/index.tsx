import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Input } from '@tarojs/components';
import dayjs from 'dayjs';
import classnames from 'classnames';
import { apiChat } from '@/services/api';
import { useT } from '@/store/language';
import styles from './index.module.scss';

const isH5 = process.env.TARO_ENV === 'h5';

/** 各页面上下文对应的默认主动建议 */
const CONTEXT_HINTS: Record<string, string> = {
  briefing: '帮我梳理一下今天的时间安排',
  inbox: '帮我把转发的内容提取成日程和待办',
  hotspot: '帮我总结一下今天的热点新闻',
  calendar: '把今天的待办整理给我看看',
  mine: '介绍一下订阅方案和语音额度',
  search: '告诉我你想找什么，我帮你搜',
  history: '看看我最近浏览过什么',
  settings: '帮我检查一下我的设置',
  shopping: '帮我看下购物清单，哪些值得跟进比价'
};

interface AiAssistantProps {
  /** 页面标识，用于生成默认主动建议 */
  context?: string;
  /** 页面主动传入的动态建议（如搜索无结果时），优先于默认建议 */
  activeHint?: string;
  /** 额外抬升距离（rpx），用于避让晨报页常驻输入栏 */
  offset?: number;
}

interface AssistantMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createTime: string;
}

function AiAssistant({ context = '', activeHint, offset = 0 }: AiAssistantProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [messages, setMessages] = useState<AssistantMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const msgIdRef = useRef(0);
  /** 自动弹出的主动建议每会话只弹一次，避免骚扰 */
  const hintShownRef = useRef(false);

  const suggestion = useMemo(() => activeHint || CONTEXT_HINTS[context] || '', [activeHint, context]);

  /** 主动建议气泡：动态建议即时显示；默认建议延迟一次；面板打开时隐藏 */
  useEffect(() => {
    if (open) {
      setHintVisible(false);
      return;
    }
    if (!suggestion) return;
    if (activeHint) {
      setHintVisible(true);
      return;
    }
    if (!hintShownRef.current) {
      hintShownRef.current = true;
      const timer = setTimeout(() => setHintVisible(true), 1200);
      return () => clearTimeout(timer);
    }
  }, [open, activeHint, suggestion]);

  /** 气泡 8s 自动收起 */
  useEffect(() => {
    if (!hintVisible) return;
    const timer = setTimeout(() => setHintVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [hintVisible]);

  const push = useCallback((role: AssistantMsg['role'], content: string) => {
    msgIdRef.current += 1;
    setMessages((prev) => [
      ...prev,
      { id: `ai-msg-${msgIdRef.current}`, role, content, createTime: dayjs().toISOString() }
    ]);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || sending) return;
      setSending(true);
      push('user', content);
      try {
        const res = await apiChat(content, 'text');
        push('assistant', res.reply);
      } catch (err) {
        console.error('[AiAssistant] chat failed:', err);
        push('assistant', '抱歉，我刚刚走神了，请再说一次。');
      } finally {
        setSending(false);
      }
    },
    [sending, push]
  );

  const handleFabTap = () => {
    setOpen(true);
    setHintVisible(false);
    if (messages.length === 0) {
      const greeting = suggestion ? `你好，我是你的 AI 助理 🤖\n\n需要我帮你做点什么？比如：「${suggestion}」` : '你好，我是你的 AI 助理 🤖 需要我帮你做点什么？';
      push('assistant', greeting);
    }
  };

  /** 点击主动建议气泡：唤起面板并直接发送 */
  const handleHintTap = () => {
    setHintVisible(false);
    setOpen(true);
    if (suggestion) sendMessage(suggestion);
  };

  const handleHintClose = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setHintVisible(false);
  };

  const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : '';

  const fabStyle = { bottom: `calc(${isH5 ? '50px' : '0px'} + env(safe-area-inset-bottom) + ${100 + offset}rpx)` };

  return (
    <View className={styles.wrapper} style={fabStyle}>
      {hintVisible && suggestion ? (
        <View className={styles.hintBubble} onClick={handleHintTap}>
          <Text className={styles.hintText}>💡 {suggestion}</Text>
          <View className={styles.hintClose} onClick={handleHintClose}>
            ✕
          </View>
        </View>
      ) : null}

      <View className={styles.fab} onClick={handleFabTap}>
        <Text className={styles.fabIcon}>🤖</Text>
      </View>

      {open ? (
        <View className={styles.panel}>
          <View className={styles.panelHeader}>
            <Text className={styles.panelTitle}>{t('ai.title')}</Text>
            <View className={styles.panelClose} onClick={() => setOpen(false)}>
              ✕
            </View>
          </View>

          <ScrollView scrollY scrollIntoView={lastMsgId} className={styles.msgList}>
            {messages.map((m) => (
              <View
                key={m.id}
                id={m.id}
                className={classnames(styles.msgRow, m.role === 'user' && styles.msgRowUser)}
              >
                <View
                  className={classnames(styles.msgBubble, m.role === 'user' ? styles.msgBubbleUser : styles.msgBubbleAi)}
                >
                  <Text className={styles.msgText}>{m.content}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View className={styles.inputRow}>
            <Input
              className={styles.input}
              value={input}
              placeholder={t('ai.placeholder')}
              confirmType='send'
              onInput={(e) => setInput(e.detail.value)}
              onConfirm={() => {
                sendMessage(input);
                setInput('');
              }}
            />
            <View
              className={classnames(styles.sendBtn, sending && styles.sendBtnDisabled)}
              onClick={() => {
                sendMessage(input);
                setInput('');
              }}
            >
              {sending ? '…' : t('ai.send')}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default AiAssistant;
