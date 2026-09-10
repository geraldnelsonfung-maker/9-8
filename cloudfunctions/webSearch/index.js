/**
 * webSearch 云函数 —— 联网内容聚合（F15 今日情报 / F29 热点资讯流）
 *
 * action=hotspot   热点页资讯流：RSS 聚合，强制标注来源，免费可用，1 小时缓存，无 LLM 成本
 * action=briefing  今日情报（订阅专属）：和风天气 + 偏好 RSS → LLM 摘要，日限额 10 次
 *                  每一步失败均降级，绝不阻塞调用方（getBriefing 晨报生成）
 *
 * 环境变量（云开发控制台配置）：
 *   WEATHER_KEY        和风天气 Key（免费档；缺失时天气降级为 null）
 *   WEATHER_LOCATION   和风天气 location（坐标或城市 ID，选填，默认北京 116.41,39.92）
 *   LLM_API_KEY        DeepSeek Key（摘要用；缺失/失败时降级为原始资讯并标 degraded）
 *   LLM_BASE_URL       选填，默认 https://api.deepseek.com
 *   LLM_MODEL          选填，默认 deepseek-chat
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const { URL } = require('url');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const INTEL_DAILY_LIMIT = 10;
const HOTSPOT_CACHE_MS = 60 * 60 * 1000; // 热点缓存 1 小时
const FETCH_TIMEOUT_MS = 6000;

/** RSS 源清单（公开授权源；name 为来源标注，合规要求必须展示，不转载正文只出摘要） */
const RSS_SOURCES = [
  { name: '36氪', url: 'https://36kr.com/feed', tag: '商业' },
  { name: '少数派', url: 'https://sspai.com/feed', tag: '科技' },
  { name: '爱范儿', url: 'https://www.ifanr.com/feed', tag: '科技' },
  { name: '虎嗅', url: 'https://www.huxiu.com/rss/0.xml', tag: '商业' },
  { name: '澎湃新闻', url: 'https://feedx.net/rss/thepaper.xml', tag: '时事' }
];

/* ---------------- 网络与解析工具 ---------------- */

/** https GET 文本（支持一次以上重定向），非 2xx / 超时 reject */
function fetchText(url, headers = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 2) return reject(new Error('too many redirects: ' + url));
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 MorningBriefing/1.0',
          'Accept-Encoding': 'identity',
          ...headers
        },
        timeout: FETCH_TIMEOUT_MS
      },
      (res) => {
        // 重定向跟随（部分 RSS 源会 301 到 www / https 变体）
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve(fetchText(new URL(res.headers.location, url).href, headers, depth + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} ${url}`));
        }
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve(raw));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
  });
}

/** 取标签内文本（兼容 CDATA） */
function pickTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

/** 取链接：RSS <link>text</link> 或 Atom <link href="..." /> */
function pickLink(block) {
  const plain = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (plain && plain[1].trim()) return plain[1].trim();
  const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return href ? href[1] : '';
}

/** 抽取条目真实配图：media:content / media:thumbnail / enclosure(image) / 正文首个 <img>；无则 undefined */
function pickImage(block) {
  const candidates = [
    (block.match(/<media:content[^>]*url=["']([^"']+)["']/i) || [])[1],
    (block.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i) || [])[1],
    (block.match(/<enclosure[^>]*type=["'][^"']*image[^"']*["'][^>]*url=["']([^"']+)["']/i) || [])[1],
    (block.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["'][^"']*image/i) || [])[1],
    (block.match(/<img[^>]*src=["'](https?:\/\/[^"']+)["']/i) || [])[1]
  ];
  const url = candidates.find(Boolean);
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  return url.replace(/&amp;/g, '&');
}

/** 去 HTML 标签与实体，压成单行摘要 */
function stripHtml(s) {
  return String(s || '')
    .replace(/<[\s\S]*?>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 短 hash：由链接生成稳定 id */
function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  return h.toString(36);
}

/** 解析 RSS2.0 / Atom 文本 → 中间条目 [{ title, link, image, summary, ts }] */
function parseFeed(xml, sourceName, tag) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 12).map((b) => {
    const title = stripHtml(pickTag(b, 'title'));
    const link = pickLink(b);
    const image = pickImage(b);
    let summary = stripHtml(
      pickTag(b, 'description') || pickTag(b, 'summary') || pickTag(b, 'content')
    );
    // 部分源 description 以标题开头，去重避免摘要重复
    if (title && summary.startsWith(title)) summary = summary.slice(title.length).trim();
    const dateStr = pickTag(b, 'pubDate') || pickTag(b, 'updated') || pickTag(b, 'published');
    const ts = dateStr ? new Date(dateStr).getTime() : 0;
    return { title, link, image, summary: summary.slice(0, 120), ts, sourceName, tag };
  });
}

/** 中间条目 → HotspotNews 输出形状（source 必填，合规标注来源） */
function toNews(it) {
  return {
    id: `web-${shortHash(it.link || it.title || it.sourceName)}`,
    title: it.title,
    summary: it.summary,
    source: it.sourceName,
    url: it.link || undefined,
    image: it.image || undefined,
    tags: it.tag ? [it.tag] : [],
    createTime: it.ts ? new Date(it.ts).toISOString() : new Date().toISOString()
  };
}

/* ---------------- F29 全网资讯搜索（Bing News RSS 主通道 + LLM 联网兜底） ---------------- */

/** LLM 联网搜索兜底（通义 DashScope enable_search，需 LLM_WEB_API_KEY）；未配置/失败返回 [] */
async function searchNewsByLLM(keyword) {
  const apiKey = process.env.LLM_WEB_API_KEY;
  if (!apiKey) return [];
  const base = process.env.LLM_WEB_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = process.env.LLM_WEB_MODEL || 'qwen-plus';
  const body = JSON.stringify({
    model,
    temperature: 0.4,
    enable_search: true, // 通义 Qwen OpenAI 兼容模式开启联网检索
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          '你是新闻检索助手。基于联网搜索结果查找与关键词相关的近期新闻，输出 JSON：{"items":[{"title":"标题","summary":"一句话摘要(60字内)","source":"媒体名","url":"原文链接，没有则空字符串"}]}，最多 6 条，禁止编造来源和链接。'
      },
      { role: 'user', content: `今天是 ${new Date().toISOString().slice(0, 10)}。关键词：${keyword}` }
    ]
  });
  try {
    const endpoint = new URL('/chat/completions', base);
    const raw = await new Promise((resolve, reject) => {
      const req = https.request(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(body)
          },
          timeout: 20000
        },
        (res) => {
          let resp = '';
          res.on('data', (chunk) => (resp += chunk));
          res.on('end', () => {
            try {
              const data = JSON.parse(resp);
              if (res.statusCode !== 200) return reject(new Error(`LLM ${res.statusCode}`));
              resolve(data.choices[0].message.content);
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('LLM search timeout')));
      req.write(body);
      req.end();
    });
    const parsed = safeParse(raw);
    const list = (parsed && parsed.items) || (Array.isArray(parsed) ? parsed : []);
    return list
      .filter((it) => it && it.title)
      .slice(0, 10)
      .map((it, i) => ({
        id: `llm-${shortHash(`${it.url || ''}${it.title}${i}`)}`,
        title: String(it.title).slice(0, 80),
        summary: String(it.summary || '').slice(0, 120),
        source: String(it.source || '网络资讯').slice(0, 20),
        url: it.url || undefined,
        image: undefined,
        tags: ['搜索'],
        createTime: new Date().toISOString()
      }));
  } catch (err) {
    console.warn('[webSearch] searchNews llm failed:', err && err.message);
    return [];
  }
}

/** 全网新闻检索瀑布：① Bing News RSS（免费直连）→ ② LLM 联网兜底；全部失败返回 []，不阻塞 */
async function searchNewsOnline(keyword) {
  const kw = String(keyword || '').trim().slice(0, 30);
  if (!kw) return [];
  const url = `https://cn.bing.com/news/search?q=${encodeURIComponent(kw)}&format=RSS&setmkt=zh-CN`;
  try {
    const xml = await fetchText(url);
    const items = parseFeed(xml, '必应新闻', '搜索').filter((it) => it.title);
    if (items.length) return items.slice(0, 10).map(toNews);
  } catch (err) {
    console.warn('[webSearch] searchNews bing failed:', err && err.message);
  }
  return searchNewsByLLM(kw);
}

/** 并发抓取全部源（单源失败不影响整体），按时间倒序取前 10 */
async function fetchAllSources() {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(async (src) => parseFeed(await fetchText(src.url), src.name, src.tag))
  );
  const items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else console.warn(`[webSearch] rss ${RSS_SOURCES[i].name} failed:`, r.reason && r.reason.message);
  });
  return items
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10)
    .map(toNews);
}

/* ---------------- hotspot：热点页资讯流 ---------------- */

async function readHotspotCache() {
  try {
    const res = await db.collection('hotspotCache').where({ key: 'hotspot' }).limit(1).get();
    return res.data[0] || null;
  } catch (err) {
    // 集合不存在等场景按无缓存处理
    return null;
  }
}

async function writeHotspotCache(items, prev) {
  try {
    const data = { key: 'hotspot', items, updateTime: new Date().toISOString() };
    if (prev && prev._id) await db.collection('hotspotCache').doc(prev._id).update({ data });
    else await db.collection('hotspotCache').add({ data });
  } catch (err) {
    console.warn('[webSearch] writeHotspotCache failed:', err && err.message);
  }
}

async function getHotspotNews() {
  const cache = await readHotspotCache();
  if (cache && cache.updateTime && Date.now() - new Date(cache.updateTime).getTime() < HOTSPOT_CACHE_MS) {
    return { items: cache.items || [], fromCache: true };
  }
  const items = await fetchAllSources(); // allSettled，不会 throw
  if (items.length > 0) {
    await writeHotspotCache(items, cache);
    return { items, fromCache: false };
  }
  // 全源抓取失败：有旧缓存就降级用旧的（不阻塞前端）
  if (cache && cache.items && cache.items.length > 0) {
    return { items: cache.items, fromCache: true, degraded: true };
  }
  throw new Error('所有 RSS 源抓取失败');
}

/* ---------------- briefing：今日情报（订阅专属） ---------------- */

async function getUser(openid) {
  const res = await db.collection('users').where({ openid }).limit(1).get();
  return res.data[0] || null;
}

function isSubscribed(user) {
  return !!(user && user.subscribed && user.expiredAt && new Date(user.expiredAt) > new Date());
}

function todayStr() {
  return new Date().toLocaleDateString('sv-SE');
}

/** 月度 usage 文档（与 chat/getUsage 同一集合约定） */
async function getUsageDoc(openid) {
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
  const res = await db.collection('usage').where({ openid, month }).limit(1).get();
  if (res.data.length > 0) return res.data[0];
  const doc = { openid, month, voiceUsed: 0, updatedAt: new Date().toISOString() };
  const added = await db.collection('usage').add({ data: doc });
  return { _id: added._id, ...doc };
}

/** 检查今日情报限额（日 10 次）；返回 { allowed, limited }，不消耗额度（只有真调 LLM 才计费） */
async function checkIntelQuota(openid) {
  const usage = await getUsageDoc(openid);
  const used = usage.intelDate === todayStr() ? usage.intelUsed || 0 : 0;
  return { allowed: used < INTEL_DAILY_LIMIT, limited: used >= INTEL_DAILY_LIMIT, usage };
}

/** 消耗一次今日情报额度 */
async function consumeIntelQuota(usage) {
  const today = todayStr();
  const intelUsed = usage.intelDate === today ? (usage.intelUsed || 0) + 1 : 1;
  await db
    .collection('usage')
    .doc(usage._id)
    .update({ data: { intelUsed, intelDate: today, updatedAt: new Date().toISOString() } });
}

/** 和风天气现况（免费档）；未配 KEY 或失败返回 null，不阻塞。
 *  F21：传入 tripCity 时改查目的地天气（和风 location 支持中文城市名），失败回退默认位置。 */
async function getWeather(tripCity) {
  const key = process.env.WEATHER_KEY;
  if (!key) return null;
  const loc = tripCity
    ? encodeURIComponent(String(tripCity).slice(0, 12))
    : process.env.WEATHER_LOCATION || '116.41,39.92';
  try {
    const raw = await fetchText(
      `https://devapi.qweather.com/v7/weather/now?location=${loc}`,
      { 'X-QW-Api-Key': key }
    );
    const data = JSON.parse(raw);
    if (data.code !== '200' || !data.now) {
      console.warn('[webSearch] weather bad response:', data.code);
      return null;
    }
    const n = data.now;
    const wind = n.windDir ? `，${n.windDir}${n.windScale || ''}级` : '';
    const prefix = tripCity ? `目的地${tripCity}：` : '';
    return { text: `${prefix}${n.text} ${n.temp}°C${wind}`, updateTime: new Date().toISOString() };
  } catch (err) {
    console.warn('[webSearch] weather failed:', err && err.message);
    return null;
  }
}

/** 按用户偏好关键词把资讯前置（无偏好保持原序） */
function rankByPreferences(items, prefs) {
  const keywords = Array.isArray(prefs) ? prefs.filter((k) => typeof k === 'string' && k) : [];
  if (!keywords.length) return items;
  return items
    .map((it) => ({
      it,
      hit: keywords.filter((k) => `${it.title} ${it.summary}`.includes(k)).length
    }))
    .sort((a, b) => b.hit - a.hit)
    .map((s) => s.it);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        /* fallthrough */
      }
    }
    return null;
  }
}

/** LLM 摘要（DeepSeek，与 chat 云函数同约定）；失败 throw 由上层降级 */
async function summarize(weather, newsItems) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error('LLM_API_KEY not configured');
  const base = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  const material = [
    weather ? `[天气] ${weather.text}` : '',
    ...newsItems.slice(0, 8).map((n) => `[${n.source}] ${n.title}：${n.summary}`)
  ]
    .filter(Boolean)
    .join('\n');
  const payload = JSON.stringify({
    model,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          '你是私人晨报编辑。基于给定天气与资讯素材，产出 3-5 条「今日情报」短句：每条 ≤40 字，说清事件与对用户的实际影响或建议，source 字段标注该条来源媒体名（必须来自素材）。输出 JSON：{"items":[{"text":"...","source":"来源名"}]}。不得编造素材里没有的信息。'
      },
      { role: 'user', content: material }
    ]
  });
  const content = await new Promise((resolve, reject) => {
    const endpoint = new URL('/chat/completions', base);
    const req = https.request(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 25000
      },
      (res) => {
        let resp = '';
        res.on('data', (chunk) => (resp += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(resp);
            if (res.statusCode !== 200) return reject(new Error(`LLM ${res.statusCode}: ${resp.slice(0, 200)}`));
            resolve(data.choices[0].message.content);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('LLM request timeout')));
    req.write(payload);
    req.end();
  });
  const parsed = safeParse(content);
  if (!parsed || !Array.isArray(parsed.items)) throw new Error('LLM output invalid');
  const items = parsed.items
    .filter((it) => it && it.text)
    .slice(0, 5)
    .map((it) => ({ text: String(it.text).slice(0, 80), source: String(it.source || '综合') }));
  if (!items.length) throw new Error('LLM output empty');
  return items;
}

/** 降级：LLM 不可用时直接用原始资讯（标注来源，不编造） */
function fallbackIntel(newsItems) {
  return newsItems.slice(0, 5).map((n) => ({
    text: `${n.title}${n.summary ? '：' + n.summary : ''}`.slice(0, 80),
    source: n.source
  }));
}

/* ---------------- 入口 ---------------- */

exports.main = async (event) => {
  const action = (event && event.action) || 'hotspot';
  try {
    if (action === 'hotspot') {
      const { items } = await getHotspotNews();
      return { code: 0, message: 'ok', data: items };
    }

    if (action === 'searchNews') {
      // F29 全网搜索：Bing News RSS 按关键词全网检索，结果带来源标注（合规）
      const kw = String((event && event.keyword) || '').trim();
      if (!kw) return { code: -1, message: 'keyword required', data: null };
      const items = await searchNewsOnline(kw);
      return { code: 0, message: 'ok', data: items };
    }

    if (action === 'feedback') {
      // F22 资讯反馈：记录 👍/👎 到 newsFeedback 集合，数据驱动内容瘦身
      const ctx = cloud.getWXContext();
      const openid = ctx.OPENID || (event && event.openid) || '';
      if (!openid) return { code: -1, message: 'no openid', data: null };
      const newsId = String((event && event.id) || '').slice(0, 64);
      const value = (event && event.feedback) === 'up' ? 'up' : 'down';
      if (!newsId) return { code: -1, message: 'id required', data: null };
      try {
        await db.collection('newsFeedback').add({
          data: { openid, newsId, value, createdAt: new Date().toISOString() }
        });
        return { code: 0, message: 'ok', data: { id: newsId, feedback: value } };
      } catch (err) {
        console.warn('[webSearch] feedback write failed:', err && err.message);
        return { code: -1, message: 'feedback write failed', data: null };
      }
    }

    if (action === 'briefing') {
      // openid：优先取微信上下文（前端直接调用）；无上下文时允许服务端
      // （getBriefing 定时/聚合路径）显式传入——同环境云函数间调用无 OPENID
      const ctx = cloud.getWXContext();
      const openid = ctx.OPENID || (event && event.openid) || '';
      if (!openid) return { code: -1, message: 'no openid', data: null };

      const user = await getUser(openid);
      if (!isSubscribed(user)) {
        // 非订阅：直接告知未订阅，前端可展示引导
        return {
          code: 0,
          message: 'ok',
          data: { subscribed: false, limited: false, weather: null, intelItems: [], degraded: true }
        };
      }

      // 天气与资讯免费；LLM 摘要才计费，故仅 LLM 前消耗额度
      // F21：getBriefing 传入 tripCity（次日外地行程）时切目的地天气
      const tripCity = (event && event.tripCity) || undefined;
      const weather = await getWeather(tripCity);
      const news = await fetchAllSources();
      if (news.length === 0 && !weather) {
        return {
          code: 0,
          message: 'ok',
          data: { subscribed: true, limited: false, weather: null, intelItems: [], degraded: true }
        };
      }
      const quota = await checkIntelQuota(openid);
      let intelItems = [];
      let degraded = true;
      if (quota.limited) {
        intelItems = fallbackIntel(rankByPreferences(news, user.preferences));
      } else {
        try {
          intelItems = await summarize(weather, rankByPreferences(news, user.preferences));
          degraded = false;
        } catch (err) {
          console.warn('[webSearch] summarize degraded:', err && err.message);
          intelItems = fallbackIntel(news);
        }
        await consumeIntelQuota(quota.usage).catch((err) =>
          console.warn('[webSearch] consume quota failed:', err && err.message)
        );
      }
      return {
        code: 0,
        message: 'ok',
        data: { subscribed: true, limited: quota.limited, weather, intelItems, degraded }
      };
    }

    return { code: -1, message: 'unknown action: ' + action, data: null };
  } catch (err) {
    console.error('[webSearch] failed:', err && err.message);
    return { code: -1, message: String((err && err.message) || 'error'), data: null };
  }
};
