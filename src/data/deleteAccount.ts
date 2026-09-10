/** mock: deleteAccount —— 模拟注销账号、清除全部数据 */
export default function deleteAccount() {
  console.info('[mock:deleteAccount] all user data cleared');
  return { deleted: true };
}
