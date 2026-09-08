import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Input, Button } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import dayjs from 'dayjs';
import classnames from 'classnames';
import VoiceButton, { VoiceResult } from '@/components/VoiceButton';
import EmptyState from '@/components/EmptyState';
import { apiGetBriefing, apiChat } from '@/services/api';
import { useUserStore } from '@/store/user';
import { brandVars, useThemeStore } from '@/store/theme';
import { getGreeting, formatEventTime } from '@/utils/date';
import type { Briefing, ChatMessage } from '@/types';
import styles from './index.module.scss';

const isWeapp = process.env.TARO_ENV === 'weapp';
/** H5 预览端底部有 50px TabBar，输入栏需避让 */
const isH5 = process.env.TARO_ENV === 'h5';
/** 订阅消息模板 ID：上线前在小程序后台申请后替换（TODO） */
const SUBSCRIBE_TEMPLATE_ID = 'TODO_TEMPLATE_ID';
/** H5 预览时模拟语音转写的示例指令 */
const MOCK_TRANSCRIPTS = [
  '把产品评审会改到明天下午两点',
  '我今天有什么安排',
  '回复客户邮件这个待办完成了'
];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function BriefingPage() {
  const { theme } = useThemeStore();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [deepMode, setDeepMode] = useState(false);
  const { profile, usage, init, refreshUsage } = useUserStore();
  const mockIndexRef = useRef(0);
  const msgIdRef = useRef(0);

  const loadBriefing = useCallback(async () => {
    try {
      const data = await apiGetBriefing();
      setBriefing(data);
    } catch (err) {
      console.error('[BriefingPage] loadBriefing failed:', err);
      Taro.showToast({ title: '晨报加载失败', icon: 'none' });
    }
  }, []);

  useEffect(() => {
    init();
    loadBriefing();
  }, []);

  usePullDownRefresh(async () => {
    await Promise.all([loadBriefing(), refreshUsage()]);
    Taro.stopPullDownRefresh();
  });

  const pushMessage = (
    role: ChatMessage['role'],
    content: string,
    type: ChatMessage['type'] = 'text',
    deep = false
  ) => {
    msgIdRef.current += 1;
    setMessages((prev) => [
      ...prev,
      { id: `msg-${msgIdRef.current}`, role, type, deep, content, createTime: dayjs().toISOString() }
    ]);
  };

  const askAssistant = async (message: string, type: 'text' | 'voice') => {
    if (!message.trim() || sending) return;
    setSending(true);
    pushMessage('user', message, type);
    try {
      const res = await apiChat(message, type, deepMode);
      pushMessage('assistant', res.reply, 'text', deepMode);
    } catch (err) {
      console.error('[BriefingPage] chat failed:', err);
      pushMessage('assistant', '抱歉，我刚刚走神了，请再说一次。');
    } finally {
      setSending(false);
    }
  };

  const handleGoSearch = () => {
    Taro.navigateTo({ url: '/pages/search/index' });
  };

  const handleSendText = () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    askAssistant(text, 'text');
  };

  const checkVoiceQuota = (): boolean => {
    if (!usage) return true;
    if (usage.voiceQuota >= 0 && usage.voiceUsed >= usage.voiceQuota) {
      Taro.showModal({
        title: '语音额度已用完',
        content: '本月免费语音条数已用完，订阅后不限次畅聊。',
        confirmText: '去订阅',
        success: (res) => {
          if (res.confirm) Taro.switchTab({ url: '/pages/mine/index' });
        }
      });
      return false;
    }
    return true;
  };

  const handleVoiceResult = (result: VoiceResult) => {
    if (!result.confirmed) return;
    if (!checkVoiceQuota()) return;
    if (isWeapp && result.tempFilePath) {
      // TODO：发布版接入微信同声传译插件完成 ASR 转写后，把 transcript 传给 askAssistant
      console.info('[BriefingPage] voice recorded:', { duration: result.duration, tempFilePath: result.tempFilePath });
      Taro.showToast({ title: '语音转写将在正式版开放，先用文字试试', icon: 'none', duration: 2000 });
      return;
    }
    // 非微信端：模拟转写结果
    const transcript = MOCK_TRANSCRIPTS[mockIndexRef.current % MOCK_TRANSCRIPTS.length];
    mockIndexRef.current += 1;
    askAssistant(transcript, 'voice');
  };

  const handleSubscribe = async () => {
    if (!isWeapp) {
      Taro.showToast({ title: '微信端支持订阅消息提醒', icon: 'none' });
      return;
    }
    try {
      const res = await Taro.requestSubscribeMessage({ tmplIds: [SUBSCRIBE_TEMPLATE_ID] });
      console.info('[BriefingPage] subscribe result:', res[SUBSCRIBE_TEMPLATE_ID]);
      if (res[SUBSCRIBE_TEMPLATE_ID] === 'accept') {
        Taro.showToast({ title: '明早见！', icon: 'success' });
      }
    } catch (err) {
      console.error('[BriefingPage] subscribe failed:', err);
      Taro.showToast({ title: '订阅失败，请稍后再试', icon: 'none' });
    }
  };

  const todayEvents = (briefing?.events || []).filter((e) => dayjs(e.startTime).isSame(dayjs(), 'day'));
  const hasContent =
    briefing && (todayEvents.length > 0 || briefing.todos.length > 0 || briefing.digest.length > 0);
  const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : '';

  return (
    <View className={styles.page} style={brandVars(theme)}>
      <View className={styles.header}>
        <View className={styles.headerTop}>
          <View className={styles.headerMain}>
            <Text className={styles.greeting}>
              {profile ? `${profile.nickname}，${getGreeting(dayjs().hour())}` : getGreeting(dayjs().hour())}
            </Text>
            <View className={styles.dateRow}>
              <Text className={styles.date}>
                {dayjs().format('M月D日')} {WEEKDAYS[dayjs().day()]}
              </Text>
              {profile?.subscribed ? <Text className={styles.badge}>订阅中</Text> : null}
            </View>
          </View>
          <Button className={styles.searchButton} onClick={handleGoSearch}>
            🔍
          </Button>
        </View>
      </View>

      {!hasContent ? (
        <View className={styles.section}>
          <EmptyState
            icon='☕'
            title='今天还没有安排'
            hint='去收件箱把微信消息转发进来，我帮你提取日程和待办'
          />
        </View>
      ) : (
        <>
          {todayEvents.length > 0 ? (
            <View className={styles.section}>
              <View className={styles.sectionHeader}>
                <Text className={styles.sectionIcon}>📅</Text>
                <Text className={styles.sectionTitle}>今日日程</Text>
                <Text className={styles.sectionCount}>{todayEvents.length} 个</Text>
              </View>
              {todayEvents.map((evt) => (
                <View key={evt.id} className={styles.eventItem}>
                  <View className={styles.timeBlock}>
                    <Text className={styles.time}>{dayjs(evt.startTime).format('HH:mm')}</Text>
                  </View>
                  <View className={styles.eventBody}>
                    <Text className={styles.eventTitle}>{evt.title}</Text>
                    {evt.location ? <Text className={styles.eventLocation}>📍 {evt.location}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {briefing && briefing.todos.length > 0 ? (
            <View className={styles.section}>
              <View className={styles.sectionHeader}>
                <Text className={styles.sectionIcon}>✅</Text>
                <Text className={styles.sectionTitle}>待办</Text>
                <Text className={styles.sectionCount}>{briefing.todos.length} 项</Text>
              </View>
              {briefing.todos.map((todo) => (
                <View key={todo.id} className={styles.todoItem}>
                  <View className={styles.checkbox} />
                  <Text className={styles.todoTitle}>{todo.title}</Text>
                  {todo.dueDate ? <Text className={styles.todoDue}>{formatEventTime(todo.dueDate)}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {briefing && briefing.digest.length > 0 ? (
            <View className={styles.section}>
              <View className={styles.sectionHeader}>
                <Text className={styles.sectionIcon}>📚</Text>
                <Text className={styles.sectionTitle}>昨日收藏精选</Text>
              </View>
              {briefing.digest.map((text, i) => (
                <View key={i} className={styles.digestItem}>
                  <Text className={styles.digestText}>{text}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}

      <View className={styles.subscribeTip}>
        <Text className={styles.tipIcon}>☀️</Text>
        <Text className={styles.tipText}>
          订阅提醒后，每天早上 {profile?.briefingTime || '07:30'} 叫醒你。建议把小程序添加到「我的小程序」
        </Text>
        <Button className={styles.tipAction} onClick={handleSubscribe}>
          订阅
        </Button>
      </View>

      <View className={styles.usageHint}>
        {usage && usage.voiceQuota > 0
          ? `本月语音免费额度 ${usage.voiceUsed}/${usage.voiceQuota} 条`
          : '订阅用户语音畅聊'}
      </View>

      {messages.length > 0 ? (
        <ScrollView scrollY scrollIntoView={lastMsgId} className={styles.messages}>
          {messages.map((msg) => (
            <View key={msg.id} id={msg.id} className={classnames(styles.messageRow, msg.role === 'user' && styles.user)}>
              <View className={classnames(styles.bubble, msg.role === 'user' ? styles.user : styles.assistant)}>
                {msg.type === 'voice' ? <Text className={styles.voiceTag}>🎙 </Text> : null}
                {msg.deep ? <Text className={styles.deepTag}>🧠 深思 </Text> : null}
                <Text>{msg.content}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View className={styles.chatEmpty}>
          <Text className={styles.chatHint}>和助理说点什么，或按住麦克风说话</Text>
        </View>
      )}

      <View className={classnames(styles.inputBar, isH5 && styles.h5Fix)}>
        <View className={styles.inputRow}>
          <Input
            className={styles.textInput}
            value={inputText}
            placeholder='输入指令，如「把评审会挪到明天」'
            onInput={(e) => setInputText(e.detail.value)}
            confirmType='send'
            onConfirm={handleSendText}
          />
          <Button
            className={classnames(styles.modeButton, deepMode && styles.modeActive)}
            onClick={() => setDeepMode((v) => !v)}
          >
            🧠 深思
          </Button>
          <Button className={styles.sendButton} onClick={handleSendText} disabled={sending}>
            发送
          </Button>
        </View>
        <VoiceButton disabled={sending} onResult={handleVoiceResult} />
      </View>
    </View>
  );
}

export default BriefingPage;
