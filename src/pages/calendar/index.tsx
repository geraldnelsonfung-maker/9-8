import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro from '@tarojs/taro';
import dayjs, { Dayjs } from 'dayjs';
import classnames from 'classnames';
import EmptyState from '@/components/EmptyState';
import { apiGetBriefing, apiChat } from '@/services/api';
import { brandVars, useThemeStore } from '@/store/theme';
import { formatEventTime } from '@/utils/date';
import { logActivity } from '@/utils/activityLog';
import type { Briefing, TodoItem } from '@/types';
import { useT, useLanguageStore } from '@/store/language';
import styles from './index.module.scss';

const isWeapp = process.env.TARO_ENV === 'weapp';
const WEEK_HEAD = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAYS_FULL_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_FULL_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function CalendarPage() {
  const t = useT();
  const lang = useLanguageStore((s) => s.lang);
  const { theme } = useThemeStore();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [month, setMonth] = useState(() => dayjs());
  const [selected, setSelected] = useState(() => dayjs().format('YYYY-MM-DD'));
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const loadBriefing = useCallback(async () => {
    try {
      setBriefing(await apiGetBriefing());
    } catch (err) {
      console.error('[CalendarPage] load failed:', err);
      Taro.showToast({ title: '日历加载失败', icon: 'none' });
    }
  }, []);

  useEffect(() => {
    loadBriefing();
  }, []);

  /** 42 格月视图：从当月首个所在周的周日开始 */
  const cells = useMemo(() => {
    const first = month.startOf('month').startOf('week');
    return Array.from({ length: 42 }, (_, i) => first.add(i, 'day'));
  }, [month]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, number>();
    (briefing?.events || []).forEach((e) => {
      const key = dayjs(e.startTime).format('YYYY-MM-DD');
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [briefing]);

  const todosByDay = useMemo(() => {
    const map = new Map<string, number>();
    (briefing?.todos || []).forEach((t) => {
      if (doneIds.has(t.id)) return;
      const key = t.dueDate ? dayjs(t.dueDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD');
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [briefing, doneIds]);

  /** F24 忙闲统计：本月日程/待办/忙日（日程 ≥3 场的天数）与最忙星期 */
  const monthStats = useMemo(() => {
    const prefix = month.format('YYYY-MM');
    const events = (briefing?.events || []).filter((e) => dayjs(e.startTime).format('YYYY-MM') === prefix);
    const todos = (briefing?.todos || []).filter((td) => td.dueDate && dayjs(td.dueDate).format('YYYY-MM') === prefix);
    const byDay = new Map<string, number>();
    events.forEach((e) => {
      const key = dayjs(e.startTime).format('YYYY-MM-DD');
      byDay.set(key, (byDay.get(key) || 0) + 1);
    });
    const byWeekday = new Array<number>(7).fill(0);
    let busyDays = 0;
    byDay.forEach((count, key) => {
      if (count >= 3) busyDays += 1;
      byWeekday[dayjs(key).day()] += count;
    });
    const peak = byWeekday.indexOf(Math.max(...byWeekday));
    // 该星期 ≥2 场才展示「最忙星期」，避免日程极少时的误导
    const peakLabel = byWeekday[peak] >= 2 ? (lang === 'en' ? WEEKDAYS_FULL_EN[peak] : WEEKDAYS_FULL_ZH[peak]) : null;
    return { events: events.length, todos: todos.length, busyDays, peakLabel };
  }, [briefing, month, lang]);

  const selectedDate = dayjs(selected);
  const dayEvents = (briefing?.events || []).filter((e) => dayjs(e.startTime).format('YYYY-MM-DD') === selected);
  /** 无截止日期的待办默认归入今日（与晨报页"今日日程"口径一致） */
  const dayTodos = (briefing?.todos || []).filter(
    (t) => (t.dueDate ? dayjs(t.dueDate).format('YYYY-MM-DD') === selected : selected === dayjs().format('YYYY-MM-DD'))
  );

  const handleToggleTodo = async (todo: TodoItem) => {
    const next = new Set(doneIds);
    const finishing = !next.has(todo.id);
    if (finishing) next.add(todo.id);
    else next.delete(todo.id);
    setDoneIds(next);
    if (finishing) logActivity('✅', `完成待办：${todo.title.slice(0, 14)}`);
    try {
      // 复用对话通道记录状态（真实端由 confirmItem 扩展承接）
      await apiChat(finishing ? `完成了「${todo.title}」` : `取消完成「${todo.title}」`);
    } catch (err) {
      console.error('[CalendarPage] toggle todo failed:', err);
    }
  };

  /** 单向写入手机系统日历（小程序支持写入、不支持读取） */
  const handleWriteSystemCalendar = async () => {
    if (!isWeapp) {
      Taro.showToast({ title: '微信端可写入手机日历', icon: 'none' });
      return;
    }
    if (dayEvents.length === 0) {
      Taro.showToast({ title: '当天没有日程', icon: 'none' });
      return;
    }
    try {
      for (const evt of dayEvents) {
        await Taro.addPhoneCalendar({
          title: evt.title,
          startTime: dayjs(evt.startTime).unix(),
          endTime: evt.endTime ? dayjs(evt.endTime).unix() : dayjs(evt.startTime).add(1, 'hour').unix(),
          location: evt.location,
          description: evt.source ? `来源：${evt.source}` : undefined,
          alarm: true,
          alarmOffset: 15 * 60
        } as any);
      }
      Taro.showToast({ title: `已写入 ${dayEvents.length} 条日程`, icon: 'success' });
    } catch (err) {
      console.error('[CalendarPage] addPhoneCalendar failed:', err);
      Taro.showToast({ title: '写入失败，请检查日历权限', icon: 'none' });
    }
  };

  const monthLabel = month.format('YYYY年M月');

  const renderCell = (d: Dayjs) => {
    const key = d.format('YYYY-MM-DD');
    const inMonth = d.isSame(month, 'month');
    const isToday = d.isSame(dayjs(), 'day');
    const isSelected = key === selected;
    const evtCount = eventsByDay.get(key) || 0;
    const todoCount = todosByDay.get(key) || 0;
    return (
      <View
        key={key}
        className={classnames(
          styles.cell,
          evtCount >= 3 ? styles.cellHot : evtCount >= 1 && styles.cellWarm,
          !inMonth && styles.dim,
          isSelected && styles.selected,
          isToday && styles.today
        )}
        onClick={() => setSelected(key)}
      >
        <Text className={styles.cellDay}>{d.date()}</Text>
        <View className={styles.dots}>
          {evtCount > 0 ? <View className={styles.dotEvent} /> : null}
          {todoCount > 0 ? <View className={styles.dotTodo} /> : null}
        </View>
      </View>
    );
  };

  return (
    <View className={styles.page} style={brandVars(theme)}>
      <View className={styles.panel}>
        <View className={styles.monthBar}>
          <Button
            className={styles.navButton}
            onClick={() => setMonth((m) => m.subtract(1, 'month'))}
            aria-label='上个月'
          >
            ‹
          </Button>
          <Text className={styles.monthLabel}>{monthLabel}</Text>
          <Button
            className={styles.navButton}
            onClick={() => setMonth((m) => m.add(1, 'month'))}
            aria-label='下个月'
          >
            ›
          </Button>
        </View>

        <View className={styles.weekHead}>
          {WEEK_HEAD.map((w) => (
            <Text key={w} className={styles.weekDay}>
              {w}
            </Text>
          ))}
        </View>
        <View className={styles.grid}>{cells.map(renderCell)}</View>

        <View className={styles.legend}>
          <View className={styles.legendItem}>
            <View className={styles.dotEvent} />
            <Text className={styles.legendText}>{t('calendar.legendSchedule')}</Text>
          </View>
          <View className={styles.legendItem}>
            <View className={styles.dotTodo} />
            <Text className={styles.legendText}>{t('calendar.legendTodo')}</Text>
          </View>
        </View>

        {/* F24 忙闲统计：本月日程 / 待办 / 忙日 / 最忙星期 */}
        <View className={styles.statsBar}>
          <Text className={styles.statsTitle}>{t('calendar.statsTitle')}</Text>
          {monthStats.events + monthStats.todos === 0 ? (
            <Text className={styles.statsEmpty}>{t('calendar.statsEmpty')}</Text>
          ) : (
            <View className={styles.statsRow}>
              <View className={styles.statItem}>
                <Text className={styles.statValue}>{monthStats.events}</Text>
                <Text className={styles.statLabel}>{t('calendar.statsEvents')}</Text>
              </View>
              <View className={styles.statItem}>
                <Text className={styles.statValue}>{monthStats.todos}</Text>
                <Text className={styles.statLabel}>{t('calendar.statsTodos')}</Text>
              </View>
              <View className={styles.statItem}>
                <Text className={styles.statValue}>{monthStats.busyDays}</Text>
                <Text className={styles.statLabel}>{t('calendar.statsBusy')}</Text>
              </View>
              {monthStats.peakLabel ? (
                <View className={styles.statItem}>
                  <Text className={styles.statValue}>{monthStats.peakLabel}</Text>
                  <Text className={styles.statLabel}>{t('calendar.statsPeak')}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </View>

      <View className={styles.dayPanel}>
        <View className={styles.dayHeader}>
          <Text className={styles.dayTitle}>
            {selectedDate.isSame(dayjs(), 'day') ? '今天 · ' : ''}
            {selectedDate.format('M月D日')}{' '}
            {['周日', '周一', '周二', '周三', '周四', '周五', '周六'][selectedDate.day()]}
          </Text>
          <Button className={styles.syncButton} onClick={handleWriteSystemCalendar}>
            写入手机日历
          </Button>
        </View>

        {dayEvents.length === 0 && dayTodos.length === 0 ? (
          <EmptyState icon='🗓' title='这一天没有安排' hint='转发消息到收件箱，或直接告诉助理帮你安排' />
        ) : (
          <>
            {dayEvents.map((evt) => (
              <View key={evt.id} className={styles.eventRow}>
                <View className={styles.timeTag}>
                  <Text className={styles.timeText}>{dayjs(evt.startTime).format('HH:mm')}</Text>
                </View>
                <View className={styles.eventBody}>
                  <Text className={styles.eventTitle}>{evt.title}</Text>
                  {evt.location ? <Text className={styles.eventLoc}>📍 {evt.location}</Text> : null}
                </View>
              </View>
            ))}
            {dayTodos.map((todo) => {
              const done = doneIds.has(todo.id);
              return (
                <View key={todo.id} className={styles.todoRow} onClick={() => handleToggleTodo(todo)}>
                  <View className={classnames(styles.todoCheck, done && styles.todoChecked)}>
                    {done ? <Text className={styles.checkMark}>✓</Text> : null}
                  </View>
                  <Text className={classnames(styles.todoTitle, done && styles.todoDone)}>{todo.title}</Text>
                  {todo.dueDate ? <Text className={styles.todoDue}>{formatEventTime(todo.dueDate)}</Text> : null}
                </View>
              );
            })}
          </>
        )}
      </View>
    </View>
  );
}

export default CalendarPage;
