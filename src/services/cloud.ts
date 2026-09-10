import Taro from '@tarojs/taro'

const isWeapp = process.env.TARO_ENV === 'weapp'

export async function callFunction<T = any>(
  name: string,
  data?: Record<string, any>
): Promise<T> {
  if (!isWeapp || name === 'deleteAccount') {
    // H5 预览或注销云函数未部署前：双端先用本地 mock（前端清 storage）
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
