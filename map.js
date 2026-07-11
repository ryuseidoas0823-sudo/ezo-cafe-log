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
  
  // 1️⃣ ベース作成: マスターデータを「🏳️未開拓」として全件配置
  if (typeof globalMasterShops !== 'undefined') {
    globalMasterShops.forEach(shop => {
      uniqueShops[shop.shop_id] = {
        lat: shop.latitude,
        lng: shop.longitude,
        shopName: shop.shop_name,
        isMasterOnly: true,
        isTakeout: false,
        isGoods: false,
        mainTag: "",
        visitCount: 0,
        isBookmarkOnly: false,
        isDraftOnly: false
      };
    });
  }
  
  // 2️⃣ 重ね塗り: ユーザーの日記で上書き ＆ 🚫閉店は除外！
  filteredDiaries.forEach(diary => {
    if (diary.latitude && diary.longitude) {
      const s = diary.shop_name; 
      const isBookmark = diary.weather_icon === "💭";
      const isDraft = diary.weather_icon === "📦";
      const isClosed = diary.weather_icon === "🚫"; // 🆕 閉店フラグ
      
      const uniqueKey = isDraft ? `draft_${diary.id}` : (diary.shop_id || s);

      // 🚨 DX機能: 閉店報告があるお店は、リストから問答無用で消し去る！
      if (isClosed) {
        if (uniqueShops[uniqueKey]) delete uniqueShops[uniqueKey];
        return; // これ以降の処理はスキップ
      }

      if (!uniqueShops[uniqueKey]) {
        uniqueShops[uniqueKey] = { 
          lat: diary.latitude, lng: diary.longitude, 
          isMasterOnly: false,
          isTakeout: diary.tags && diary.tags.includes('🥡テイクアウト'), 
          isGoods: diary.tags && diary.tags.includes('🛍️豆・グッズ'),
          shopName: isDraft ? '📦 未整理の写真' : s, 
          mainTag: "",
          visitCount: (isBookmark || isDraft) ? 0 : 1, 
          isBookmarkOnly: isBookmark,
          isDraftOnly: isDraft
        };
      } else {
        uniqueShops[uniqueKey].isMasterOnly = false;
        if (!isDraft) uniqueShops[uniqueKey].shopName = s; 
        
        if (!isBookmark && !isDraft) { 
          uniqueShops[uniqueKey].visitCount++; 
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

  // 3️⃣ 描画: ステータスに応じてピンの見た目を決定
  Object.values(uniqueShops).forEach(shop => {
    let customIcon;

    // 🆕 DX機能: 未開拓（マスタのみ）のピンは極小のドットにして密集を防ぐ！
    if (shop.isMasterOnly) {
      customIcon = L.divIcon({ 
        html: `<div style="background-color: #bdc3c7; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>`, 
        className: 'custom-div-icon', 
        iconSize: [16, 16], 
        iconAnchor: [8, 8] 
      });
    } else {
      // 訪問済みや行きたいお店は、今まで通りの目立つアイコン！
      let emoji = '☕️';
      let bgColor = '#34495e'; 

      if (shop.isDraftOnly) {
        emoji = '📦'; bgColor = '#95a5a6';
      } else if (shop.isBookmarkOnly) {
        emoji = '💭'; bgColor = '#f39c12'; 
      } else {
        emoji = shop.isGoods ? '🛍️' : (shop.isTakeout ? '🥡' : '☕️');
        bgColor = getColorFromTag(shop.mainTag); 
      }
      
      const badgeHtml = shop.visitCount > 0 ? `<div style="position:absolute; bottom:-5px; right:-5px; background:#e74c3c; color:white; border-radius:50%; width:18px; height:18px; font-size:11px; font-weight:bold; line-height:18px; text-align:center;">${shop.visitCount}</div>` : '';
      customIcon = L.divIcon({ html: `<div class="emoji-pin" style="background-color: ${bgColor}; position:relative;">${emoji}${badgeHtml}</div>`, className: 'custom-div-icon', iconSize: [36, 36], iconAnchor: [18, 18] });
    }
    
    const marker = L.marker([shop.lat, shop.lng], {icon: customIcon}).addTo(viewMap);
    
    let statusText = '💭 行きたいお店に登録中';
    if (shop.isMasterOnly) statusText = '🏳️ 未開拓（マスタ店舗）';
    else if (shop.visitCount > 0) statusText = `👣 訪問回数: ${shop.visitCount}回`;
    else if (shop.isDraftOnly) statusText = '📦 未整理の写真';

    const popupHtml = `
      <div style="text-align:center; min-width: 150px; padding: 5px;">
        <p style="margin: 0; font-weight:bold; font-size:1rem; color:#2c3e50;">${escapeHTML(shop.shopName)}</p>
        <p style="margin: 5px 0 0 0; font-size:0.85rem; color:#7f8c8d; font-weight:bold;">
          ${statusText}
        </p>
      </div>
    `;
    marker.bindPopup(popupHtml);
    
    // 未開拓の場合はラベルも出さず、スッキリさせる
    if (!shop.isMasterOnly) {
        marker.bindTooltip(escapeHTML(shop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
    }
    bounds.extend([shop.lat, shop.lng]);
  });

  if (Object.keys(uniqueShops).length > 0) viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}