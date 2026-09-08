import React, { useState } from 'react';
import { View, Text, Textarea, Input, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import dayjs from 'dayjs';
import classnames from 'classnames';
import EmptyState from '@/components/EmptyState';
import { apiExtract, apiConfirmItem } from '@/services/api';
import { useUserStore } from '@/store/user';
import { fromNow } from '@/utils/date';
import type { ExtractResult } from '@/types';
import styles from './index.module.scss';

/** 待确认条目（提取结果 + 本地编辑状态） */
interface DraftItem {
  key: string;
  kind: 'event' | 'todo' | 'collection';
  title: string;
  time?: string;
  summary?: string;
  tags?: string[];
  checked: boolean;
  origin: ExtractResult['events'][number] | ExtractResult['todos'][number];
}

interface HistoryRecord {
  id: string;
  text: string;
  count: number;
  time: string;
}

let draftKey = 0;

function InboxPage() {
  const [content, setContent] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [note, setNote] = useState<string>('');
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const { refreshUsage } = useUserStore();

  const handleExtract = async () => {
    const text = content.trim();
    if (!text) {
      Taro.showToast({ title: '先粘贴微信里复制的内容', icon: 'none' });
      return;
    }
    if (extracting) return;
    setExtracting(true);
    try {
      const result = await apiExtract(text);
      console.info('[InboxPage] extract result:', JSON.stringify(result));
      const next: DraftItem[] = [];
      result.events.forEach((evt) => {
        draftKey += 1;
        next.push({
          key: `d${draftKey}`,
          kind: 'event',
          title: evt.title,
          time: evt.startTime,
          checked: true,
          origin: evt
        });
      });
      result.todos.forEach((todo) => {
        draftKey += 1;
        next.push({
          key: `d${draftKey}`,
          kind: 'todo',
          title: todo.title,
          time: todo.dueDate,
          checked: true,
          origin: todo
        });
      });
      if (result.collection) {
        draftKey += 1;
        next.push({
          key: `d${draftKey}`,
          kind: 'collection',
          title: result.collection.title,
          summary: result.collection.summary,
          tags: result.collection.tags,
          checked: true,
          origin: result.collection
        });
      }
      setDrafts(next);
      setNote(result.note || '');
      if (next.length === 0) {
        Taro.showToast({ title: '没有提取到日程或待办', icon: 'none' });
      }
    } catch (err) {
      console.error('[InboxPage] extract failed:', err);
      Taro.showToast({ title: '提取失败，请稍后再试', icon: 'none' });
    } finally {
      setExtracting(false);
    }
  };

  const toggleDraft = (key: string) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, checked: !d.checked } : d)));
  };

  const editDraftTitle = (key: string, title: string) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, title } : d)));
  };

  const editDraftTime = (key: string, time: string) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, time } : d)));
  };

  const handleConfirm = async () => {
    const checked = drafts.filter((d) => d.checked);
    if (checked.length === 0) {
      Taro.showToast({ title: '请至少勾选一条', icon: 'none' });
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const events = checked
        .filter((d) => d.kind === 'event')
        .map((d) => {
          const origin = d.origin as ExtractResult['events'][number];
          return { ...origin, title: d.title, startTime: d.time || origin.startTime };
        });
      const todos = checked
        .filter((d) => d.kind === 'todo')
        .map((d) => {
          const origin = d.origin as ExtractResult['todos'][number];
          return { ...origin, title: d.title, dueDate: d.time || origin.dueDate };
        });
      const collection = checked.find((d) => d.kind === 'collection')?.origin as
        | ExtractResult['collection']
        | undefined;
      const res = await apiConfirmItem({ events, todos, collection });
      console.info('[InboxPage] confirmed:', res.saved);
      Taro.showToast({ title: `已入库 ${res.saved} 条`, icon: 'success' });
      setHistory((prev) => [
        {
          id: `h-${Date.now()}`,
          text: content.trim().slice(0, 40),
          count: res.saved,
          time: dayjs().toISOString()
        },
        ...prev
      ]);
      setDrafts([]);
      setNote('');
      setContent('');
      refreshUsage();
    } catch (err) {
      console.error('[InboxPage] confirm failed:', err);
      Taro.showToast({ title: '入库失败，请重试', icon: 'none' });
    } finally {
      setSaving(false);
    }
  };

  const kindLabel: Record<DraftItem['kind'], string> = {
    event: '日程',
    todo: '待办',
    collection: '收藏'
  };

  return (
    <View className={styles.page}>
      <View className={styles.howTo}>
        <Text className={styles.howIcon}>💡</Text>
        <Text className={styles.howText}>
          在微信里长按消息「复制」，回到这里粘贴提取；正式版支持直接把消息转发给本小程序。
        </Text>
      </View>

      <View className={styles.inputCard}>
        <Text className={styles.inputTitle}>粘贴要处理的内容</Text>
        <Textarea
          className={styles.textarea}
          value={content}
          maxlength={2000}
          placeholder='例：明天上午 10 点在 3 号会议室开产品评审会，会前把演示文稿更新一下'
          onInput={(e) => setContent(e.detail.value)}
        />
        <Button
          className={classnames(styles.extractButton, extracting && styles.disabled)}
          onClick={handleExtract}
        >
          {extracting ? 'AI 提取中…' : 'AI 提取'}
        </Button>
      </View>

      {drafts.length > 0 ? (
        <View className={styles.resultCard}>
          <View className={styles.resultHeader}>
            <Text className={styles.resultTitle}>提取结果</Text>
            <Text className={styles.resultMeta}>点击文字可修改</Text>
          </View>
          {drafts.map((draft) => (
            <View
              key={draft.key}
              className={classnames(
                styles.itemRow,
                draft.kind === 'event' && styles.eventRow,
                draft.kind === 'todo' && styles.todoRow,
                draft.kind === 'collection' && styles.collectionRow
              )}
            >
              <View className={classnames(styles.check, draft.checked && styles.checked)} onClick={() => toggleDraft(draft.key)}>
                {draft.checked ? <Text className={styles.checkIcon}>✓</Text> : null}
              </View>
              <View className={styles.itemBody}>
                <Input
                  className={styles.itemTitleInput}
                  value={draft.title}
                  onInput={(e) => editDraftTitle(draft.key, e.detail.value)}
                />
                {draft.kind === 'collection' ? (
                  <>
                    <Text className={styles.itemSummary}>{draft.summary}</Text>
                    <View className={styles.tagRow}>
                      {(draft.tags || []).map((t) => (
                        <Text key={t} className={styles.miniTag}>
                          {t}
                        </Text>
                      ))}
                    </View>
                  </>
                ) : (
                  <Input
                    className={styles.itemTimeInput}
                    value={draft.time || ''}
                    placeholder='时间，如 2026-09-09 10:00'
                    onInput={(e) => editDraftTime(draft.key, e.detail.value)}
                  />
                )}
                <Text className={styles.miniTag} style={{ marginTop: '8rpx', display: 'inline-block' }}>
                  {kindLabel[draft.kind]}
                </Text>
              </View>
            </View>
          ))}
          {note ? <Text className={styles.itemSummary}>{note}</Text> : null}
          <Button
            className={classnames(styles.confirmButton, saving && styles.disabled)}
            onClick={handleConfirm}
          >
            {saving ? '入库中…' : '确认入库'}
          </Button>
        </View>
      ) : null}

      {history.length > 0 ? (
        <>
          <Text className={styles.historyTitle}>最近处理</Text>
          {history.map((h) => (
            <View key={h.id} className={styles.historyItem}>
              <Text className={styles.historyIcon}>📥</Text>
              <View className={styles.historyBody}>
                <Text className={styles.historyText}>{h.text}</Text>
                <Text className={styles.historyMeta}>
                  入库 {h.count} 条 · {fromNow(h.time)}
                </Text>
              </View>
            </View>
          ))}
        </>
      ) : (
        <EmptyState icon='📥' title='收件箱还是空的' hint='粘贴一条微信消息试试，AI 会帮你拆出日程和待办' />
      )}
    </View>
  );
}

export default InboxPage;
