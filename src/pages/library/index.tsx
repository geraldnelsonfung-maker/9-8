import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import dayjs from 'dayjs';
import classnames from 'classnames';
import TagChip from '@/components/TagChip';
import EmptyState from '@/components/EmptyState';
import { apiGetLibrary, apiGetHotspot } from '@/services/api';
import { useUserStore } from '@/store/user';
import { fromNow } from '@/utils/date';
import { logActivity } from '@/utils/activityLog';
import type { CollectionItem, HotspotNews } from '@/types';
import { useT } from '@/store/language';
import styles from './index.module.scss';

const TYPE_ICONS: Record<CollectionItem['sourceType'], string> = {
  article: '📄',
  message: '💬',
  link: '🔗'
};

const HISTORY_KEY = 'browseHistory';
const HISTORY_LIMIT = 50;

/** 记录浏览历史（v2.0，点头像在「我的-浏览历史」查看） */
export function recordBrowseHistory(entry: { id: string; title: string; source?: string }) {
  try {
    const list = Taro.getStorageSync(HISTORY_KEY) || [];
    const next = [
      { ...entry, viewedAt: dayjs().toISOString() },
      ...list.filter((it: { id: string }) => it.id !== entry.id)
    ].slice(0, HISTORY_LIMIT);
    Taro.setStorageSync(HISTORY_KEY, next);
  } catch (err) {
    console.error('[LibraryPage] record history failed:', err);
  }
}

function LibraryPage() {
  const t = useT();
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [news, setNews] = useState<HotspotNews[]>([]);
  const [activeTag, setActiveTag] = useState('全部');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'up' | 'down'>>(() => readNewsFeedback());
  const { refreshUsage } = useUserStore();

  useEffect(() => {
    Promise.all([apiGetLibrary(), apiGetHotspot().catch(() => [])])
      .then(([lib, hotspot]) => {
        setItems(lib);
        setNews(hotspot);
        refreshUsage();
      })
      .catch((err) => {
        console.error('[LibraryPage] load failed:', err);
        Taro.showToast({ title: '加载失败', icon: 'none' });
      })
      .finally(() => setLoading(false));
  }, []);

  const tags = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => item.tags.forEach((t) => set.add(t)));
    return ['全部', ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (activeTag === '全部' || item.tags.includes(activeTag)) &&
          (!keyword ||
            item.title.includes(keyword) ||
            item.summary.includes(keyword) ||
            item.tags.some((t) => t.includes(keyword)))
      ),
    [items, activeTag, keyword]
  );

  const newsFiltered = useMemo(
    () =>
      keyword
        ? news.filter((n) => n.title.includes(keyword) || n.summary.includes(keyword))
        : news,
    [news, keyword]
  );

  const handleCopy = (item: CollectionItem) => {
    Taro.setClipboardData({
      data: `${item.title}\n${item.summary}`,
      success: () => Taro.showToast({ title: '摘要已复制', icon: 'success' })
    }).catch((err) => console.error('[LibraryPage] copy failed:', err));
  };

  const handleNewsTap = (item: HotspotNews) => {
    recordBrowseHistory({ id: item.id, title: item.title, source: item.source });
    logActivity('🔥', `浏览热点：${item.title.slice(0, 14)}`);
    Taro.showToast({ title: `来源：${item.source}`, icon: 'none', duration: 1500 });
  };

  /** 资讯反馈（F22）：👍 有用 / 👎 不感兴趣；再点一次取消；本地持久化 + 云端落库 */
  const handleNewsFeedback = (item: HotspotNews, value: 'up' | 'down') => {
    const current = feedbackMap[item.id];
    const next = current === value ? undefined : value;
    const nextMap = { ...feedbackMap };
    if (next) nextMap[item.id] = next;
    else delete nextMap[item.id];
    setFeedbackMap(nextMap);
    try {
      Taro.setStorageSync(NEWS_FEEDBACK_KEY, nextMap);
    } catch (err) {
      console.warn('[LibraryPage] persist newsFeedback failed:', err);
    }
    if (next) {
      logActivity(next === 'up' ? '👍' : '👎', `资讯反馈：${item.title.slice(0, 14)}`);
      Taro.showToast({ title: t('library.feedbackSaved'), icon: 'none', duration: 1200 });
      // 云端落库（真机生效；取消反馈只改本地，云端按最新一条聚合）
      apiNewsFeedback(item.id, next).catch(() => {});
    }
  };

  return (
    <View className={styles.page}>
      <View className={styles.searchBar}>
        <Text className={styles.searchIcon}>🔍</Text>
        <Input
          className={styles.searchInput}
          value={keyword}
          placeholder={t('library.searchPlaceholder')}
          confirmType='search'
          onInput={(e) => setKeyword(e.detail.value)}
        />
        {keyword ? (
          <Text className={styles.searchClear} onClick={() => setKeyword('')}>
            ✕
          </Text>
        ) : null}
      </View>

      {newsFiltered.length > 0 ? (
        <View className={styles.hotspot}>
          <View className={styles.sectionBar}>
            <Text className={styles.sectionBarIcon}>🔥</Text>
            <Text className={styles.sectionBarTitle}>{t('library.hotTitle')}</Text>
            <Text className={styles.sectionBarHint}>{t('library.hotHint')}</Text>
          </View>
          {newsFiltered.map((item) => {
            const fb = feedbackMap[item.id];
            return (
              <View key={item.id} className={styles.newsCard} onClick={() => handleNewsTap(item)}>
                <Text className={styles.newsTitle}>{item.title}</Text>
                <Text className={styles.newsSummary}>{item.summary}</Text>
                <View className={styles.newsMeta}>
                  <Text className={styles.newsSource}>来源 · {item.source}</Text>
                  <Text className={styles.newsTime}>{fromNow(item.createTime)}</Text>
                </View>
                <View className={styles.feedbackRow} onClick={(e) => e.stopPropagation()}>
                  <Text
                    className={classnames(styles.feedbackBtn, fb === 'up' && styles.feedbackActive)}
                    onClick={() => handleNewsFeedback(item, 'up')}
                  >
                    👍 {t('library.feedbackUp')}
                  </Text>
                  <Text
                    className={classnames(styles.feedbackBtn, fb === 'down' && styles.feedbackActive)}
                    onClick={() => handleNewsFeedback(item, 'down')}
                  >
                    👎 {t('library.feedbackDown')}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <View className={styles.sectionBar}>
        <Text className={styles.sectionBarIcon}>🔖</Text>
        <Text className={styles.sectionBarTitle}>{t('library.favTitle')}</Text>
        <Text className={styles.sectionBarHint}>{t('library.favHint')}</Text>
      </View>

      <View className={styles.filterBar}>
        <ScrollView scrollX className={styles.chipScroll}>
          {tags.map((tag) => (
            <TagChip key={tag} label={tag} active={tag === activeTag} onClick={() => setActiveTag(tag)} />
          ))}
        </ScrollView>
      </View>

      <View className={styles.list}>
        {filtered.map((item) => (
          <View key={item.id} className={styles.card} onClick={() => handleCopy(item)}>
            <View className={styles.cardHeader}>
              <Text className={styles.typeIcon}>{TYPE_ICONS[item.sourceType]}</Text>
              <Text className={styles.title}>{item.title}</Text>
              <Text className={styles.time}>{fromNow(item.createTime)}</Text>
            </View>
            <Text className={styles.summary}>{item.summary}</Text>
            <View className={styles.tagRow}>
              {item.tags.map((t) => (
                <TagChip key={t} label={t} />
              ))}
            </View>
          </View>
        ))}
      </View>

      {!loading && filtered.length === 0 ? (
        <EmptyState
          icon='🔖'
          title={keyword ? '没有找到相关内容' : activeTag === '全部' ? '还没有收藏' : '这个标签下还没有内容'}
          hint={
            keyword
              ? '换个关键词试试，支持匹配标题、摘要和标签'
              : '在收件箱粘贴内容时勾选「收藏」，AI 摘要会存到这里'
          }
        />
      ) : null}
    </View>
  );
}

export default LibraryPage;
