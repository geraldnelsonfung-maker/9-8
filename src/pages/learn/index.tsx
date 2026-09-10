import { useEffect, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import classnames from 'classnames';
import { LEARN_LANGS, LearnLangId, LearnCourse } from '@/data/learn';
import {
  getLangStats,
  getStreak,
  isTodayCheckedIn,
  getCourseProgress,
  setActiveLang,
  readLearnStore,
  LearnStore
} from '@/utils/learn';
import { useT } from '@/store/language';
import styles from './index.module.scss';

/** 语言学习主页（MVP）：语种切换 + 分级课程 + 进度与打卡 */
function LearnPage() {
  const t = useT();
  const [langId, setLangId] = useState<LearnLangId>(() => readLearnStore().activeLang || 'en');
  // 只需 setStore 触发重渲染（渲染数据走 getLangStats/getCourseProgress 直读工具层）；store 值本身不使用
  const [, setStore] = useState<LearnStore>(() => readLearnStore());
  const [streak, setStreak] = useState(0);
  const [checkedIn, setCheckedIn] = useState(false);

  const refresh = () => {
    setStore(readLearnStore());
    setStreak(getStreak());
    setCheckedIn(isTodayCheckedIn());
  };

  useEffect(refresh, []);

  // 从课程页返回后刷新进度
  useDidShow(refresh);

  const lang = LEARN_LANGS.find((l) => l.id === langId) || LEARN_LANGS[0];
  const stats = getLangStats(langId);

  const handleLangChange = (id: LearnLangId) => {
    setLangId(id);
    setActiveLang(id);
  };

  const openCourse = (course: LearnCourse) => {
    Taro.navigateTo({ url: `/pages/learnDetail/index?courseId=${course.id}` }).catch((err) =>
      console.warn('[LearnPage] navigate failed:', err)
    );
  };

  return (
    <View className={styles.page}>
      {/* 语种切换 */}
      <View className={styles.langBar}>
        {LEARN_LANGS.map((l) => (
          <View
            key={l.id}
            className={classnames(styles.langTab, l.id === langId && styles.langTabActive)}
            style={l.id === langId ? { borderColor: l.accent, color: l.accent } : undefined}
            onClick={() => handleLangChange(l.id)}
          >
            <Text className={styles.langDot} style={{ background: l.accent }} />
            <Text>{l.name}</Text>
          </View>
        ))}
      </View>

      {/* 打卡与进度 */}
      <View className={styles.statsCard}>
        <View className={styles.statItem}>
          <Text className={styles.statNum}>{streak}</Text>
          <Text className={styles.statLabel}>{t('learn.streak')}</Text>
        </View>
        <View className={styles.statDivider} />
        <View className={styles.statItem}>
          <Text className={styles.statNum}>
            {stats.learned}
            <Text className={styles.statUnit}>/{stats.total}</Text>
          </Text>
          <Text className={styles.statLabel}>{t('learn.wordsLearned')}</Text>
        </View>
        <View className={styles.statDivider} />
        <View className={styles.statItem}>
          <Text className={classnames(styles.statNum, checkedIn && styles.statNumOn)}>
            {checkedIn ? '✓' : '·'}
          </Text>
          <Text className={styles.statLabel}>{checkedIn ? t('learn.checkedIn') : t('learn.notCheckedIn')}</Text>
        </View>
      </View>
      <View className={styles.progressTrack}>
        <View className={styles.progressFill} style={{ width: `${stats.percent}%`, background: lang.accent }} />
      </View>
      <Text className={styles.progressHint}>
        {t('learn.progressHint', { percent: stats.percent, done: stats.coursesDone, total: stats.coursesTotal })}
      </Text>

      {/* 分级课程 */}
      {lang.levels.map((level) => (
        <View key={level.id} className={styles.levelBlock}>
          <View className={styles.levelHeader}>
            <Text className={styles.levelName} style={{ color: lang.accent }}>
              {level.name}
            </Text>
            <Text className={styles.levelDesc}>{level.desc}</Text>
          </View>
          {level.courses.map((course) => {
            const prog = getCourseProgress(course.id);
            const done = course.words.length > 0 && prog.learned.length >= course.words.length;
            const percent = Math.round((prog.learned.length / course.words.length) * 100);
            return (
              <View key={course.id} className={styles.courseCard} onClick={() => openCourse(course)}>
                <View className={styles.courseMain}>
                  <View className={styles.courseTitleRow}>
                    <Text className={styles.courseTitle}>{course.title}</Text>
                    {done ? <Text className={styles.doneBadge}>{t('learn.done')}</Text> : null}
                  </View>
                  <Text className={styles.courseTheme}>{course.theme}</Text>
                  <View className={styles.courseBar}>
                    <View
                      className={styles.courseBarFill}
                      style={{ width: `${percent}%`, background: lang.accent }}
                    />
                  </View>
                  <Text className={styles.courseStat}>
                    {prog.learned.length}/{course.words.length} {t('learn.wordsUnit')}
                  </Text>
                </View>
                <Text className={styles.courseArrow}>›</Text>
              </View>
            );
          })}
        </View>
      ))}

      <View className={styles.footer}>
        <Text className={styles.footerText}>{t('learn.moreComing')}</Text>
      </View>
    </View>
  );
}

export default LearnPage;
