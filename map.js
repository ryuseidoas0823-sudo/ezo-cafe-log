// ==========================================
// 🗺️ map.js (地図関係の処理まとめ)
// ==========================================
const HOME_LAT = 43.0600;
const HOME_LNG = 141.3500;
let viewMap = null;

function initViewMap() {
  if (!viewMap) {
    viewMap = L.map('mapView').setView([HOME_LAT, HOME_LNG], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(viewMap);
  }
  setTimeout(() => { viewMap.invalidateSize(); }, 200);
}

function updateViewMarkers(filteredDiaries = globalDiaries) {
  if (!viewMap) return;
  viewMap.eachLayer((layer) => { if (layer instanceof L.Marker) viewMap.removeLayer(layer); });
  
  const bounds = L.latLngBounds(); 
  const uniqueShops = {};
  let totalValidVisits = 0; // 🆕 負荷ゼロ！全体の有効な訪問数をカウントする変数
  
  // 1️⃣ ベース作成: マスターデータを「🏳️未開拓」として全件配置
  if (typeof globalMasterShops !== 'undefined') {
    globalMasterShops.forEach(shop => {
      uniqueShops[shop.shop_id] = {
        lat: shop.latitude, lng: shop.longitude, shopName: shop.shop_name,
        isMasterOnly: true, isTakeout: false, isGoods: false,
        mainTag: "", visitCount: 0, isBookmarkOnly: false, isDraftOnly: false
      };
    });
  }
  
  // 2️⃣ 重ね塗り: ユーザーの日記で上書き ＆ 🚫閉店は除外
  filteredDiaries.forEach(diary => {
    if (diary.latitude && diary.longitude) {
      const s = diary.shop_name; 
      const isBookmark = diary.weather_icon === "💭";
      const isDraft = diary.weather_icon === "📦";
      const isClosed = diary.weather_icon === "🚫"; 
      
      const uniqueKey = isDraft ? `draft_${diary.id}` : (diary.shop_id || s);

      if (isClosed) {
        if (uniqueShops[uniqueKey]) delete uniqueShops[uniqueKey];
        return; 
      }

      if (!uniqueShops[uniqueKey]) {
        uniqueShops[uniqueKey] = { 
          lat: diary.latitude, lng: diary.longitude, isMasterOnly: false,
          isTakeout: diary.tags && diary.tags.includes('🥡テイクアウト'), 
          isGoods: diary.tags && diary.tags.includes('🛍️豆・グッズ'),
          shopName: isDraft ? '📦 未整理の写真' : s, 
          mainTag: "", visitCount: (isBookmark || isDraft) ? 0 : 1, 
          isBookmarkOnly: isBookmark, isDraftOnly: isDraft
        };
        // 🆕 新規店舗の場合、有効な訪問なら全体カウントを+1
        if (!isBookmark && !isDraft) totalValidVisits++;
      } else {
        uniqueShops[uniqueKey].isMasterOnly = false;
        if (!isDraft) uniqueShops[uniqueKey].shopName = s; 
        
        if (!isBookmark && !isDraft) { 
          uniqueShops[uniqueKey].visitCount++; 
          totalValidVisits++; // 🆕 既存店舗の訪問回数追加時も、全体カウントを+1
          uniqueShops[uniqueKey].isBookmarkOnly = false; 
          uniqueShops[uniqueKey].isTakeout = diary.tags && diary.tags.includes('🥡テイクアウト');
          uniqueShops[uniqueKey].isGoods = diary.tags && diary.tags.includes('🛍️豆・グッズ');
        } else if (isBookmark && uniqueShops[uniqueKey].visitCount === 0) {
          uniqueShops[uniqueKey].isBookmarkOnly = true;
        }
      }

      if (!isBookmark && !isDraft && uniqueShops[uniqueKey]) {
          const allTags = parseTags(diary.tags);
          const aiOrManualTag = allTags.find(t => !t.startsWith('🚨') && !t.includes('🥡') && !t.includes('☕️店内') && !t.includes('🛍️'));
          uniqueShops[uniqueKey].mainTag = aiOrManualTag || "";
      }
    }
  });

  // 3️⃣ 描画: ステータスと「熱量」に応じてピンの大きさを決定！
  Object.values(uniqueShops).forEach(shop => {
    let customIcon;

    if (shop.isMasterOnly) {
      customIcon = L.divIcon({ 
        html: `<div style="background-color: #bdc3c7; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>`, 
        className: 'custom-div-icon', iconSize: [16, 16], iconAnchor: [8, 8] 
      });
    } else {
      let emoji = shop.isGoods ? '🛍️' : (shop.isTakeout ? '🥡' : '☕️');
      let bgColor = getColorFromTag(shop.mainTag); 
      
      if (shop.isDraftOnly) { emoji = '📦'; bgColor = '#95a5a6'; }
      if (shop.isBookmarkOnly) { emoji = '💭'; bgColor = '#f39c12'; }
      
      // 🎯 DX機能: 訪問割合に応じたピンの巨大化ロジック
      let scale = 1.0;
      if (shop.visitCount > 0 && totalValidVisits > 0) {
          // 割合を計算し、10%刻みで四捨五入 (例: 34% -> 30, 46% -> 50)
          const percentage = (shop.visitCount / totalValidVisits) * 100;
          const roundedPercentage = Math.round(percentage / 10) * 10;
          // スケールに変換 (0% = 1.0倍, 30% = 1.3倍, 100% = 2.0倍)
          scale = 1.0 + (roundedPercentage / 100);
      }

      // ベースサイズ36pxにスケールを乗算して安全に拡大
      const baseSize = 36;
      const scaledSize = Math.round(baseSize * scale);
      const anchorSize = Math.round(scaledSize / 2);
      const fontSize = Math.round(18 * scale);

      // バッジ自体は大きくなりすぎないようにサイズを微調整して固定
      const badgeHtml = shop.visitCount > 0 ? `<div style="position:absolute; bottom:-2px; right:-2px; background:#e74c3c; color:white; border-radius:50%; width:20px; height:20px; font-size:11px; font-weight:bold; line-height:20px; text-align:center; box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index:10;">${shop.visitCount}</div>` : '';
      
      customIcon = L.divIcon({ 
        html: `<div style="background-color: ${bgColor}; width: ${scaledSize}px; height: ${scaledSize}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: ${fontSize}px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); position: relative; transition: all 0.3s ease;">${emoji}${badgeHtml}</div>`, 
        className: 'custom-div-icon', 
        iconSize: [scaledSize, scaledSize], 
        iconAnchor: [anchorSize, anchorSize] 
      });
    }
    
    const marker = L.marker([shop.lat, shop.lng], {icon: customIcon}).addTo(viewMap);
    
    let statusText = '💭 行きたいお店に登録中';
    if (shop.isMasterOnly) statusText = '🏳️ 未開拓（マスタ店舗）';
    else if (shop.visitCount > 0) statusText = `👣 訪問回数: ${shop.visitCount}回`;
    else if (shop.isDraftOnly) statusText = '📦 未整理の写真';

    const popupHtml = `
      <div style="text-align:center; min-width: 150px; padding: 5px;">
        <p style="margin: 0; font-weight:bold; font-size:1rem; color:#2c3e50;">${escapeHTML(shop.shopName)}</p>
        <p style="margin: 5px 0 0 0; font-size:0.85rem; color:#7f8c8d; font-weight:bold;">${statusText}</p>
      </div>
    `;
    marker.bindPopup(popupHtml);
    
    if (!shop.isMasterOnly) {
        marker.bindTooltip(escapeHTML(shop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
    }
    bounds.extend([shop.lat, shop.lng]);
  });

  if (Object.keys(uniqueShops).length > 0) viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}