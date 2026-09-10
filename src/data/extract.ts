import dayjs from 'dayjs';
import type { ExtractResult } from '../types';

/**
 * 从一段文字里识别日期/时间点（模拟「OCR / 多模态视觉模型」读截屏里的文字时间）。
 * 仅演示用：真实端由云函数把截图丢给 GLM-4V 等视觉模型识别。
 * 返回可用的 "YYYY-MM-DD HH:mm"；识别不到则返回 null。
 */
function recognizeTimeFrom(text: string): string | null {
  const now = dayjs();
  const today = now.format('YYYY-MM-DD');

  // 绝对时间：今天/某日 HH:mm 或 2026-09-09 14:00
  const iso = text.match(/(\d{4})[-年.](\d{1,2})[-月.](\d{1,2})日?[^\d]{0,6}(\d{1,2})[:：](\d{2})/);
  if (iso) {
    const y = iso[1], mo = iso[2], d = iso[3], h = iso[4], mi = iso[5];
    return dayjs(`${y}-${mo}-${d} ${h}:${mi}`).format('YYYY-MM-DD HH:mm');
  }

  // X月X日 + 时刻
  const md = text.match(/(\d{1,2})月(\d{1,2})日?[^\d]{0,6}(\d{1,2})[:：点][^\d]{0,2}(\d{1,2})?/);
  if (md) {
    const mo = md[1], dd = md[2], hh = md[3];
    const mm = md[4] ? String(md[4]).padStart(2, '0') : '00';
    let dt = dayjs(`${now.year()}-${mo}-${dd} ${hh}:${mm}`);
    return dt.format('YYYY-MM-DD HH:mm');
  }

  // 相对词 + 时刻：今晚/明天/后天/上午/下午/晚上 8点 / 20:00 / 8点半
  const rel = text.match(/(今晚|明天|后天|明晚|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[:：点](\d{1,2})?\s*(点半|半|分)?/);
  if (rel) {
    let dayOffset = 0;
    const kw = rel[1];
    if (kw === '明天' || kw === '明晚') dayOffset = 1;
    else if (kw === '后天') dayOffset = 2;
    let hh = Number(rel[2]);
    const mmText = rel[3] || rel[5] || '00';
    // 只说「下午3点/晚上8点」需要 +12；「上午/中午/早晚8点」不调整
    if ((kw === '下午' || kw === '晚上' || kw === '明晚' || kw === '今晚') && hh < 12) hh += 12;
    const mm = rel[5] === '半' ? '30' : String(mmText).padStart(2, '0');
    return now.add(dayOffset, 'day').hour(hh).minute(Number(mm)).format('YYYY-MM-DD HH:mm');
  }

  // 裸小时（如 "14:30"），默认今天
  const hm = text.match(/(\d{1,2})[:：](\d{2})/);
  if (hm) return dayjs(`${today} ${hm[1]}:${hm[2]}`).format('YYYY-MM-DD HH:mm');

  return null;
}

/**
 * mock: extract —— 模拟 LLM 提取（文字 + 截图双通道）
 * 真实环境由云函数调用大模型 JSON Mode（截图走多模态视觉模型）完成，字段结构与此一致
 * 日程时间取当天动态值，以便与 getBriefing 的现有日程演示「排班冲突检测」
 */
export default function extract(data?: { content?: string; images?: string[] }): ExtractResult {
  const content = data?.content || '';
  const images = data?.images || [];
  const today = dayjs().format('YYYY-MM-DD');
  console.info('[mock:extract] text length:', content.length, 'images:', images.length);

  if (images.length > 0) {
    // 「截屏也能识别时间」：从随附文字中识别出截图里的日期/时间，动态写入日程
    const t = recognizeTimeFrom(content);
    const eV = t || `${today} 14:00`;
    const toV = t || `${today} 13:00`;
    return {
      events: [
        {
          title: '季度复盘会（来自截图）',
          startTime: eV,
          endTime: dayjs(eV).add(90, 'minute').format('YYYY-MM-DD HH:mm'),
          location: '线上 · 腾讯会议',
          source: `截图提取 ×${images.length}`
        }
      ],
      todos: [
        {
          title: '按截图里的清单核对会议材料',
          dueDate: dayjs(toV).subtract(60, 'minute').format('YYYY-MM-DD HH:mm'),
          source: `截图提取 ×${images.length}`
        }
      ],
      collection: undefined,
      note: t
        ? `已识别 ${images.length} 张截图，并从截屏内容中解析出时间 ${t}（模拟视觉提取，正式版接入 GLM-4V 等多模态模型）`
        : `已识别 ${images.length} 张截图（模拟视觉提取，正式版接入 GLM-4V 等多模态模型）；未在文字中检测到明确时间，已用今天 14:00 占位，可手动修改`
    };
  }

  return {
    events: [
      {
        title: '产品评审会',
        startTime: `${today} 10:00`,
        endTime: `${today} 11:30`,
        location: '3 号会议室',
        source: content.slice(0, 50) || '手动输入'
      }
    ],
    todos: [
      {
        title: '评审前更新演示文稿',
        dueDate: `${today} 09:00`,
        source: content.slice(0, 50) || '手动输入'
      }
    ],
    collection: content.length > 120
      ? {
          title: '转发内容摘要',
          summary: content.slice(0, 80) + '……（模拟摘要：这段内容讲的是效率工具的实践方法，要点已提炼）',
          tags: ['待整理'],
          url: undefined,
          sourceType: 'message'
        }
      : undefined,
    note: undefined
  };
}
