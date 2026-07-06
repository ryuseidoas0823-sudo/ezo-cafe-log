// ==========================================
// 🛠️ utils.js (便利ツール・計算処理まとめ)
// ==========================================

function parseTags(tagsString) { 
  return (!tagsString) ? [] : tagsString.split(',').map(t => t.trim()).filter(t => t !== ""); 
}

function getColorFromTag(tag) {
  if (!tag) return "#34495e";
  let hash = 0; 
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`; 
}

function escapeHTML(str) {
  if (!str) return "";
  const escapeMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
  return str.replace(/[&<>'"]/g, match => escapeMap[match] || match);
}

function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371e3; 
  const dLat = (lat2 - lat1) * Math.PI / 180; 
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}