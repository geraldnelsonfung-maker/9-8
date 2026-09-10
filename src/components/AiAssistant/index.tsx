import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import dayjs from 'dayjs';
import classnames from 'classnames';
import { apiChat } from '@/services/api';
import { useT } from '@/store/language';
import styles from './index.module.scss';

const isH5 = process.env.TARO_ENV === 'h5';

/** 视口尺寸（px）；H5 读 window，weapp 兜底 getWindowInfo */
const getViewport = () => {
  if (isH5 && typeof window !== 'undefined') {
    return { w: window.innerWidth, h: window.innerHeight };
  }
  try {
    const info = Taro.getWindowInfo();
    return { w: info.windowWidth, h: info.windowHeight };
  } catch {
    return { w: 375, h: 667 };
  }
};

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
    // 拖动结束后浏览器会补发一次合成 click，250ms 内的点击视为拖动余波，忽略
    if (Date.now() - lastDragEndRef.current < 250) return;
    setOpen(true);
    setHintVisible(false);
    if (messages.length === 0) {
      const greeting = suggestion ? `你好，我是你的 AI 助理 🤖\n\n需要我帮你做点什么？比如：「${suggestion}」` : '你好，我是你的 AI 助理 🤖 需要我帮你做点什么？';
      push('assistant', greeting);
    }
  };

  /** 悬浮球拖动位置（px，视口坐标）；null = 默认右下角。拖动状态存在 ref 中避免拖动中额外重渲染 */
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null);
  const fabRef = useRef<any>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const lastDragEndRef = useRef(0);

  /** 取 fab 的 DOM 元素：H5 端 Taro 不转发 ref，改用稳定 id 查询 */
  const getFabEl = (): HTMLElement | null => {
    if (isH5 && typeof document !== 'undefined') {
      return document.getElementById('ai-fab');
    }
    return (fabRef.current as HTMLElement | null) ?? null;
  };

  const beginDrag = useCallback(
    (x: number, y: number) => {
      const rect = getFabEl()?.getBoundingClientRect?.() ?? null;
      // base 取当前实际位置：首次拖动时读 fab 的视口坐标，之后以 fabPos 为基准
      const base = fabPos ?? { x: rect?.left ?? 0, y: rect?.top ?? 0 };
      dragState.current = {
        startX: x,
        startY: y,
        baseX: base.x,
        baseY: base.y,
        width: rect?.width ?? 54,
        height: rect?.height ?? 54,
        moved: false
      };
      // 拖动时收起建议气泡：气泡比球宽，会影响 wrapper 按坐标定位的准确性
      setHintVisible(false);
    },
    [fabPos]
  );

  const updateDrag = useCallback((x: number, y: number) => {
    const d = dragState.current;
    if (!d) return;
    const dx = x - d.startX;
    const dy = y - d.startY;
    // 位移 6px 以内视为点击，不进入拖动
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    d.moved = true;
    const { w: vw, h: vh } = getViewport();
    // 钳制在视口内：四周留 8px；H5 底部额外避让 TabBar（约 50px + 余量）
    const maxX = Math.max(8, vw - d.width - 8);
    const maxY = Math.max(8, vh - d.height - (isH5 ? 58 : 8));
    setFabPos({
      x: Math.min(Math.max(d.baseX + dx, 8), maxX),
      y: Math.min(Math.max(d.baseY + dy, 8), maxY)
    });
  }, []);

  const finishDrag = useCallback(() => {
    const d = dragState.current;
    dragState.current = null;
    if (d?.moved) lastDragEndRef.current = Date.now();
  }, []);

  /** 触屏按下（weapp 路径；H5 走下方原生绑定）：move/end 由 onTouchMove/onTouchEnd props 提供
   *  参数用 any 以兼容 Taro ViewProps 的 CommonEventFunction（实际只读 touches[0] 坐标） */
  const handleFabTouchStart = (e: any) => {
    const p0 = e.touches?.[0];
    if (!p0 || isH5) return;
    beginDrag(p0.clientX, p0.clientY);
  };

  const handleFabTouchMove = (e: any) => {
    const p0 = e.touches?.[0];
    if (p0) updateDrag(p0.clientX, p0.clientY);
  };

  /** H5：Taro 组件不转发 onMouseDown 等非标事件，故用原生绑定挂到 fab 元素上；
      move/up 挂 window，鼠标/手指移出球体也能继续拖动 */
  useEffect(() => {
    if (!isH5 || typeof window === 'undefined') return;
    const el = getFabEl();
    if (!el || typeof el.addEventListener !== 'function') return;

    const startWith = (x: number, y: number) => {
      beginDrag(x, y);
      const move = (ev: MouseEvent) => updateDrag(ev.clientX, ev.clientY);
      const touchMove = (ev: TouchEvent) => {
        const p = ev.touches?.[0];
        if (p) updateDrag(p.clientX, p.clientY);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('touchmove', touchMove);
        window.removeEventListener('touchend', up);
        window.removeEventListener('touchcancel', up);
        finishDrag();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      window.addEventListener('touchmove', touchMove, { passive: true });
      window.addEventListener('touchend', up);
      window.addEventListener('touchcancel', up);
    };

    const onMouseDown = (ev: Event) => {
      const me = ev as MouseEvent;
      startWith(me.clientX, me.clientY);
    };
    const onTouchStart = (ev: Event) => {
      const p0 = (ev as TouchEvent).touches?.[0];
      if (p0) startWith(p0.clientX, p0.clientY);
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onTouchStart);
    return () => {
      el.removeEventListener?.('mousedown', onMouseDown);
      el.removeEventListener?.('touchstart', onTouchStart);
    };
  }, [beginDrag, updateDrag, finishDrag]);

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

  /** 拖过位后位置生效：wrapper 从「全宽贴底」切换为「按坐标定位」 */
  const wrapperStyle = fabPos
    ? { left: fabPos.x, top: fabPos.y, right: 'auto', bottom: 'auto', padding: 0 }
    : fabStyle;

  /** 拖动事件：H5 由上方 useEffect 原生绑定（Taro 不转发鼠标事件），weapp 走 touch props */
  const fabDragProps = isH5
    ? { id: 'ai-fab' }
    : { ref: fabRef, onTouchStart: handleFabTouchStart, onTouchMove: handleFabTouchMove, onTouchEnd: finishDrag };

  return (
    <View className={styles.wrapper} style={wrapperStyle}>
      {hintVisible && suggestion ? (
        <View className={styles.hintBubble} onClick={handleHintTap}>
          <Text className={styles.hintText}>💡 {suggestion}</Text>
          <View className={styles.hintClose} onClick={handleHintClose}>
            ✕
          </View>
        </View>
      ) : null}

      <View id='ai-fab' className={styles.fab} onClick={handleFabTap} {...fabDragProps}>
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
