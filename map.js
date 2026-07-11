// ==========================================
// 🗺️ map.js (地図関係の処理まとめ)
// ==========================================
const HOME_LAT = 43.0600;
const HOME_LNG = 141.3500;
let viewMap = null;
let mapMarkers = []; // 🆕 検索移動用: マップ上の全マーカーを保持する配列

function initViewMap() {
  if (!viewMap) {
    viewMap = L.map('mapView').setView([HOME_LAT, HOME_LNG], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(viewMap);
  }
  setTimeout(() => { viewMap.invalidateSize(); }, 200);
}

// 🆕 マップ検索移動関数（滑らかにズームインしてポップアップを開く！）
function flyToShop(lat, lng) {
  if (viewMap) {
    viewMap.flyTo([lat, lng], 17, { duration: 1.5 });
    // 移動完了を待ってからポップアップを開く
    setTimeout(() => {
      const targetMarker = mapMarkers.find(m => m.getLatLng().lat === lat && m.getLatLng().lng === lng);
      if (targetMarker) targetMarker.openPopup();
    }, 1500);
  }
}

function updateViewMarkers(filteredDiaries = globalDiaries) {
  if (!viewMap) return;
  viewMap.eachLayer((layer) => { if (layer instanceof L.Marker) viewMap.removeLayer(layer); });
  
  const bounds = L.latLngBounds(); 
  const uniqueShops = {};
  let totalValidVisits = 0; 
  mapMarkers = []; // 初期化
  
  // 1️⃣ ベース作成: マスターデータを全件配置
  if (typeof globalMasterShops !== 'undefined') {
    globalMasterShops.forEach(shop => {
      uniqueShops[shop.shop_id] = {
        lat: shop.latitude, lng: shop.longitude, shopName: shop.shop_name, shopId: shop.shop_id,
        isMasterOnly: true, isTakeout: false, isGoods: false, mainTag: "", visitCount: 0, 
        isBookmarkOnly: false, isDraftOnly: false,
        isPermanentlyClosed: false, isGracePeriod: false, closedDiaryId: null 
      };
    });
  }
  
  // 2️⃣ 重ね塗り: ユーザーの日記で上書き
  filteredDiaries.forEach(diary => {
    if (diary.latitude && diary.longitude) {
      const s = diary.shop_name; 
      const isBookmark = diary.weather_icon === "💭";
      const isDraft = diary.weather_icon === "📦";
      const isClosed = diary.weather_icon === "🚫"; 
      
      const uniqueKey = isDraft ? `draft_${diary.id}` : (diary.shop_id || s);

      if (!uniqueShops[uniqueKey]) {
        uniqueShops[uniqueKey] = { 
          lat: diary.latitude, lng: diary.longitude, shopName: isDraft ? '📦 未整理の写真' : s, shopId: diary.shop_id || null,
          isMasterOnly: false, isTakeout: false, isGoods: false, mainTag: "", visitCount: 0, 
          isBookmarkOnly: false, isDraftOnly: isDraft,
          isPermanentlyClosed: false, isGracePeriod: false, closedDiaryId: null
        };
        // 新規店舗の場合、有効な訪問なら全体カウントを+1
        if (!isBookmark && !isDraft && !isClosed) totalValidVisits++;
      }

      // 🚨 閉店フラグの処理（最新の報告のみを判定）
      if (isClosed) {
        if (!uniqueShops[uniqueKey].isPermanentlyClosed && !uniqueShops[uniqueKey].isGracePeriod) {
          // 報告日を計算し、現在から14日経過しているかチェック
          const targetDateStr = diary.created_at || diary.visited_at || "";
          const reportDate = targetDateStr ? new Date(targetDateStr.replace(/-/g, '/')) : new Date();
          const diffDays = (new Date() - reportDate) / (1000 * 60 * 60 * 24);
          
          if (diffDays > 14) {
            uniqueShops[uniqueKey].isPermanentlyClosed = true; // 14日経過（完全除外）
          } else {
            uniqueShops[uniqueKey].isGracePeriod = true; // 14日以内（半透明で猶予）
            uniqueShops[uniqueKey].closedDiaryId = diary.id; // 取り消し用にIDを保持
          }
        }
        return; // 閉店記録は訪問回数としてカウントしないためスキップ
      }

      // すでに完全閉店判定になっているお店の過去記録は無視する
      if (uniqueShops[uniqueKey].isPermanentlyClosed) return;

      // 🌟 通常の記録の重ね塗り処理
      uniqueShops[uniqueKey].isMasterOnly = false;
      if (!isDraft) uniqueShops[uniqueKey].shopName = s; 
      
      if (!isBookmark && !isDraft) { 
        uniqueShops[uniqueKey].visitCount++; 
        if (uniqueShops[uniqueKey].visitCount > 1) totalValidVisits++; // 既存への追加なら全体増
        uniqueShops[uniqueKey].isBookmarkOnly = false; 
        uniqueShops[uniqueKey].isTakeout = diary.tags && diary.tags.includes('🥡テイクアウト');
        uniqueShops[uniqueKey].isGoods = diary.tags && diary.tags.includes('🛍️豆・グッズ');
      } else if (isBookmark && uniqueShops[uniqueKey].visitCount === 0) {
        uniqueShops[uniqueKey].isBookmarkOnly = true;
      }

      if (!isBookmark && !isDraft && uniqueShops[uniqueKey].mainTag === "") {
          const allTags = parseTags(diary.tags);
          const aiOrManualTag = allTags.find(t => !t.startsWith('🚨') && !t.includes('🥡') && !t.includes('☕️店内') && !t.includes('🛍️'));
          uniqueShops[uniqueKey].mainTag = aiOrManualTag || "";
      }
    }
  });

  // 3️⃣ 描画処理
  Object.values(uniqueShops).forEach(shop => {
    // 💀 完全閉店は地図上から消滅させる！
    if (shop.isPermanentlyClosed) return;

    let customIcon;
    let opacity = 1.0;

    if (shop.isGracePeriod) {
      // 👻 猶予期間中（14日以内）は半透明のゴーストピン
      customIcon = L.divIcon({ 
        html: `<div class="emoji-pin" style="background-color: #7f8c8d; position:relative;">👻</div>`, 
        className: 'custom-div-icon', iconSize: [36, 36], iconAnchor: [18, 18] 
      });
      opacity = 0.6;
    } else if (shop.isMasterOnly) {
      // 📍 未開拓の極小ドット
      customIcon = L.divIcon({ 
        html: `<div style="background-color: #bdc3c7; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>`, 
        className: 'custom-div-icon', iconSize: [16, 16], iconAnchor: [8, 8] 
      });
    } else {
      // ☕️ 通常ピン（訪問数による巨大化ロジック）
      let emoji = shop.isGoods ? '🛍️' : (shop.isTakeout ? '🥡' : '☕️');
      let bgColor = getColorFromTag(shop.mainTag); 
      if (shop.isDraftOnly) { emoji = '📦'; bgColor = '#95a5a6'; }
      if (shop.isBookmarkOnly) { emoji = '💭'; bgColor = '#f39c12'; }
      
      let scale = 1.0;
      if (shop.visitCount > 0 && totalValidVisits > 0) {
          const percentage = (shop.visitCount / totalValidVisits) * 100;
          const roundedPercentage = Math.round(percentage / 10) * 10;
          scale = 1.0 + (roundedPercentage / 100);
      }
      const scaledSize = Math.round(36 * scale);
      const anchorSize = Math.round(scaledSize / 2);
      const fontSize = Math.round(18 * scale);
      const badgeHtml = shop.visitCount > 0 ? `<div style="position:absolute; bottom:-2px; right:-2px; background:#e74c3c; color:white; border-radius:50%; width:20px; height:20px; font-size:11px; font-weight:bold; line-height:20px; text-align:center; box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index:10;">${shop.visitCount}</div>` : '';
      
      customIcon = L.divIcon({ 
        html: `<div style="background-color: ${bgColor}; width: ${scaledSize}px; height: ${scaledSize}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: ${fontSize}px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); position: relative; transition: all 0.3s ease;">${emoji}${badgeHtml}</div>`, 
        className: 'custom-div-icon', iconSize: [scaledSize, scaledSize], iconAnchor: [anchorSize, anchorSize] 
      });
    }
    
    // 描画とマーカー配列への保存
    const marker = L.marker([shop.lat, shop.lng], {icon: customIcon, opacity: opacity}).addTo(viewMap);
    mapMarkers.push(marker);
    
    // 📝 ポップアップの生成（ボタンの出し分け）
    let statusText = '';
    let actionBtn = '';

    if (shop.isGracePeriod) {
        statusText = '<span style="color:#e74c3c;">🚨 閉店・移転の報告あり<br>(2週間後にマップから消去)</span>';
        actionBtn = `<div style="margin-top:12px;"><button onclick="cancelCloseReport(${shop.closedDiaryId})" style="background:#e74c3c; width:100%; border:none; color:white; padding:8px; border-radius:5px; font-weight:bold; cursor:pointer;">誤報を取り消す</button></div>`;
    } else {
        if (shop.isMasterOnly) statusText = '🏳️ 未開拓（マスタ店舗）';
        else if (shop.visitCount > 0) statusText = `👣 訪問回数: ${shop.visitCount}回`;
        else if (shop.isDraftOnly) statusText = '📦 未整理の写真';
        else statusText = '💭 行きたいお店に登録中';
        
        // 閉店報告へのアクションリンク（Aタグ）
        actionBtn = `<div style="margin-top:12px; border-top:1px dashed #ddd; padding-top:8px;"><a href="#" onclick="reportClosed('${shop.shopId || shop.shopName}', '${escapeHTML(shop.shopName)}', ${shop.lat}, ${shop.lng}); return false;" style="color:#7f8c8d; font-size:0.75rem; text-decoration:none;">🚫 閉店・移転を報告</a></div>`;
    }

    const popupHtml = `
      <div style="text-align:center; min-width: 160px; padding: 5px;">
        <p style="margin: 0; font-weight:bold; font-size:1.1rem; color:#2c3e50;">${escapeHTML(shop.shopName)}</p>
        <p style="margin: 5px 0 0 0; font-size:0.85rem; color:#7f8c8d; font-weight:bold;">${statusText}</p>
        ${actionBtn}
      </div>
    `;
    marker.bindPopup(popupHtml);
    
    if (!shop.isMasterOnly && !shop.isGracePeriod) {
        marker.bindTooltip(escapeHTML(shop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
    }
    bounds.extend([shop.lat, shop.lng]);
  });

  if (Object.keys(uniqueShops).length > 0) viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}