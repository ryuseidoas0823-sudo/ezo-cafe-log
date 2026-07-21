// ==========================================
// 📝 src/utils/text.js (テキスト処理・装飾関連)
// ==========================================

/**
 * タグ文字列をカンマで分割し、配列として返す
 */
export function parseTags(tagsString) { 
  return (!tagsString) ? [] : tagsString.split(',').map(t => t.trim()).filter(t => t !== ""); 
}

/**
 * タグの文字列から一意の色（HSL）を自動生成する
 */
export function getColorFromTag(tag) {
  if (!tag) return "#34495e";
  let hash = 0; 
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`; 
}

/**
 * XSS対策: HTML特殊文字をエスケープする
 */
export function escapeHTML(str) {
  if (!str) return "";
  const escapeMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
  return str.replace(/[&<>'"]/g, match => escapeMap[match] || match);
}