import type { Usage } from '../types';

/** mock: getUsage —— 免费额度（未订阅状态） */
export default function getUsage(): Usage {
  return {
    voiceUsed: 6,
    voiceQuota: 20,
    collectionCount: 12,
    collectionQuota: 50
  };
}
