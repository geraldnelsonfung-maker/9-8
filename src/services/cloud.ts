import Taro from '@tarojs/taro'

const isWeapp = process.env.TARO_ENV === 'weapp'

export async function callFunction<T = any>(
  name: string,
  data?: Record<string, any>
): Promise<T> {
  if (!isWeapp || name === 'getHotspot' || name === 'deleteAccount') {
    // getHotspot：真实端走 webSearch 云函数（RSS 聚合），未部署前双端先用本地 mock
    // deleteAccount：注销云函数部署前双端先用本地 mock（前端清 storage）
    const mockModule = await import(`../data/${name}`)
    return mockModule.default(data) as T
  }
  const res = await Taro.cloud.callFunction({ name, data })
  const result = res.result as { code: number; message: string; data: T }
  if (result.code !== 0) {
    console.error(`[Cloud] ${name} failed:`, result.message)
    throw new Error(result.message || '请求失败')
  }
  return result.data
}
