import { useMemo, useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import classnames from 'classnames';
import EmptyState from '@/components/EmptyState';
import { findCourse } from '@/data/learn';
import { getCourseProgress, markWords, setCourseCompleted } from '@/utils/learn';
import { useT } from '@/store/language';
import styles from './index.module.scss';

/** 课程学习页（MVP）：单词卡自测——看词回忆释义，翻卡核对，标记掌握；全课掌握自动完成+打卡 */
function LearnDetailPage() {
  const t = useT();
  const router = useRouter();
  const courseId = router.params.courseId || '';

  const found = useMemo(() => findCourse(courseId), [courseId]);

  const initial = useMemo(() => getCourseProgress(courseId), [courseId]);
  const [learned, setLearned] = useState<Set<string>>(() => new Set(initial.learned));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [finished, setFinished] = useState(false);

  if (!found) {
    return (
      <View className={styles.page}>
        <EmptyState icon='📖' title={t('learn.courseMissing')} hint={t('learn.backToPick')} />
      </View>
    );
  }

  const { course, lang } = found;
  const words = course.words;
  const word = words[index];

  const handleMark = (isKnown: boolean) => {
    if (!word) return;
    const next = new Set(learned);
    if (isKnown) next.add(word.id);
    else next.delete(word.id);
    setLearned(next);
    markWords(courseId, [word.id], isKnown);
    // 全课掌握 → 标记课程完成（含打卡）
    if (next.size >= words.length) setCourseCompleted(courseId, true, words.length);

    if (index + 1 >= words.length) {
      setFinished(true);
    } else {
      setIndex(index + 1);
      setFlipped(false);
    }
  };

  const restart = () => {
    setIndex(0);
    setFlipped(false);
    setFinished(false);
  };

  const back = () => {
    Taro.navigateBack().catch(() => {
      Taro.switchTab({ url: '/pages/mine/index' }).catch((err) =>
        console.warn('[LearnDetail] back failed:', err)
      );
    });
  };

  if (finished || !word) {
    const mastered = learned.size;
    return (
      <View className={styles.page}>
        <View className={styles.finishCard}>
          <Text className={styles.finishEmoji}>🎉</Text>
          <Text className={styles.finishTitle}>{t('learn.finishTitle')}</Text>
          <Text className={styles.finishStat}>
            {mastered}/{words.length} {t('learn.wordsMastered')}
          </Text>
          <Text className={styles.finishHint}>{t('learn.finishHint')}</Text>
          <View className={styles.finishActions}>
            <Text className={styles.btnGhost} onClick={restart}>
              {t('learn.again')}
            </Text>
            <Text className={styles.btnPrimary} onClick={back}>
              {t('learn.backCourses')}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className={styles.page}>
      <View className={styles.header}>
        <Text className={styles.courseTitle}>{course.title}</Text>
        <Text className={styles.counter}>
          {index + 1}/{words.length}
        </Text>
      </View>
      <View className={styles.progressTrack}>
        <View className={styles.progressFill} style={{ width: `${((index + 1) / words.length) * 100}%`, background: lang.accent }} />
      </View>

      {/* 单词卡：点按翻转 */}
      <View className={styles.cardWrap} onClick={() => setFlipped(!flipped)}>
        <View className={classnames(styles.card, flipped && styles.cardFlipped)}>
          {!flipped ? (
            <View className={styles.cardFront}>
              <Text className={styles.term} style={{ color: lang.accent }}>
                {word.term}
              </Text>
              {word.reading ? <Text className={styles.reading}>{word.reading}</Text> : null}
              <Text className={styles.flipHint}>{t('learn.tapToFlip')}</Text>
            </View>
          ) : (
            <View className={styles.cardBack}>
              <Text className={styles.meaning}>{word.meaning}</Text>
              <Text className={styles.example}>{word.example}</Text>
              <Text className={styles.exampleCn}>{word.exampleCn}</Text>
            </View>
          )}
        </View>
      </View>

      {/* 自测按钮 */}
      <View className={styles.actions}>
        <Text className={styles.btnGhost} onClick={() => handleMark(false)}>
          {t('learn.notYet')}
        </Text>
        <Text className={styles.btnPrimary} onClick={() => handleMark(true)}>
          {t('learn.gotIt')}
        </Text>
      </View>
      <Text className={styles.masteredCount}>
        {t('learn.sessionMastered', { count: learned.size, total: words.length })}
      </Text>
    </View>
  );
}

export default LearnDetailPage;
