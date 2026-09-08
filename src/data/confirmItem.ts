/** mock: confirmItem —— 模拟确认入库 */
export default function confirmItem(data?: { eventCount?: number; todoCount?: number; hasCollection?: boolean }) {
  const saved = (data?.eventCount || 0) + (data?.todoCount || 0) + (data?.hasCollection ? 1 : 0);
  console.info('[mock:confirmItem] saved:', saved);
  return { saved };
}
