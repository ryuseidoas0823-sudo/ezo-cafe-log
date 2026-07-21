// ==========================================
// 🔐 src/utils/crypto.js (暗号化・UUID生成関連)
// ==========================================

/**
 * ユーザー識別のためのUUIDを取得、なければ生成して保存する
 */
export function getOrGenerateUserUuid() {
  let uuid = localStorage.getItem('ezo_user_uuid');
  if (!uuid) {
    // ブラウザの暗号学的に安全な乱数ジェネレータを優先
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      uuid = crypto.randomUUID();
    } else {
      uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    localStorage.setItem('ezo_user_uuid', uuid);
  }
  return uuid;
}