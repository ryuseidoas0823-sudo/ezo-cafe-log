// ==========================================
// 🗺️ src/utils/geo.js (地理・座標計算関連)
// ==========================================

/**
 * 2地点間の距離（メートル）を計算する
 * (自宅ガード機能などで使用)
 */
export function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // 地球の半径 (m)
  const dLat = (lat2 - lat1) * Math.PI / 180; 
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}