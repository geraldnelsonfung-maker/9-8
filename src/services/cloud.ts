import Taro from '@tarojs/taro'

const isWeapp = process.env.TARO_ENV === 'weapp'

export async function callFunction<T = any>(
  name: string,
  data?: Record<string, any>
): Promise<T> {
  if (!isWeapp || name === 'deleteAccount') {
    // H5 预览或注销云函数未部署前：双端先用本地 mock（前端清 storage）
    if (name === 'getHotspot') {
      // 真实数据优先：同源聚合接口（IT之家/少数派/人民网/知乎日报，服务端 30 分钟缓存），失败降级本地 mock
      try {
        const res = await fetch('/api/hotspot')
        const payload = await res.json()
        if (Array.isArray(payload.items) && payload.items.length > 0) {
          return payload.items as T
        }
      } catch (err) {
        console.warn('[Cloud] /api/hotspot failed, fallback to mock:', err)
      }
      const mockModule = await import('../data/getHotspot')
      return mockModule.default() as T
    }
    if (name === 'getBriefing') {
      // 晨报：日程/待办照常本地 mock；intel（天气+资讯）用真实数据补齐，失败不阻塞晨报（v1.3 原则）
      const mockModule = await import('../data/getBriefing')
      const briefing: any = mockModule.default()
      try {
        const city = String(Taro.getStorageSync('user-city') || '北京')
        const [wRes, hRes] = await Promise.allSettled([
          fetch(`/api/briefing?city=${encodeURIComponent(city)}`),
          fetch('/api/hotspot')
        ])
        const intel: any = { subscribed: false, weather: null, intelItems: [], degraded: true }
        if (wRes.status === 'fulfilled' && wRes.value.ok) {
          const p = await wRes.value.json()
          if (p && p.weather) intel.weather = p.weather
        }
        if (hRes.status === 'fulfilled' && hRes.value.ok) {
          const p = await hRes.value.json()
          intel.intelItems = (p.items || []).slice(0, 3).map((it: any) => ({
            text: it.title,
            source: it.source
          }))
        }
        briefing.intel = intel
      } catch (err) {
        console.warn('[Cloud] briefing intel patch failed, keep mock:', err)
      }
      return briefing as T
    }
    const mockModule = await import(`../data/${name}`)
    return mockModule.default(data) as T
  }
  if (name === 'getHotspot') {
    // 热点资讯：真机走 webSearch 云函数（RSS 聚合，强制标注来源），失败降级本地 mock
    try {
      return await callFunction<T>('webSearch', { action: 'hotspot' })
    } catch (err) {
      console.warn('[Cloud] getHotspot via webSearch failed, fallback to mock:', err)
      const mockModule = await import('../data/getHotspot')
      return mockModule.default() as T
    }
  }
  const res = await Taro.cloud.callFunction({ name, data })
  const result = res.result as { code: number; message: string; data: T }
  if (result.code !== 0) {
    console.error(`[Cloud] ${name} failed:`, result.message)
    throw new Error(result.message || '请求失败')
  }
  return result.data
}
