// ==========================================
// 🗺️ map.js (地図関係の処理まとめ)
// ==========================================
const HOME_LAT = 43.0600;
const HOME_LNG = 141.3500;
let viewMap = null;
let mapMarkers = []; 

function initViewMap() {
  if (!viewMap) {
    viewMap = L.map('mapView').setView([HOME_LAT, HOME_LNG], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(viewMap);
  }
  setTimeout(() => { viewMap.invalidateSize(); }, 200);
}

function flyToShop(lat, lng) {
  if (viewMap) {
    viewMap.flyTo([lat, lng], 17, { duration: 1.5 });
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
  
  // 🎯 DX機能: 緯度・経度をキーにして「その場所にある歴代の店舗」をグループ化！
  const locationMap = {};
  let totalValidVisits = 0; 
  mapMarkers = []; 
  
  // 1️⃣ ベース作成: マスターデータを配置
  if (typeof globalMasterShops !== 'undefined') {
    globalMasterShops.forEach(shop => {
      const locKey = `${shop.latitude}_${shop.longitude}`;
      if (!locationMap[locKey]) locationMap[locKey] = { lat: shop.latitude, lng: shop.longitude, shops: {} };
      
      locationMap[locKey].shops[shop.shop_id] = {
        shopId: shop.shop_id, shopName: shop.shop_name,
        isMasterOnly: true, isTakeout: false, isGoods: false, mainTag: "", visitCount: 0, 
        isBookmarkOnly: false, isDraftOnly: false,
        isClosed: false, isGracePeriod: false, closedDiaryId: null, lastVisited: 0
      };
    });
  }
  
  // 2️⃣ 重ね塗り: ユーザーの日記で上書き（座標ごとに集計）
  filteredDiaries.forEach(diary => {
    if (diary.latitude && diary.longitude) {
      const locKey = `${diary.latitude}_${diary.longitude}`;
      if (!locationMap[locKey]) locationMap[locKey] = { lat: diary.latitude, lng: diary.longitude, shops: {} };

      const s = diary.shop_name; 
      const isBookmark = diary.weather_icon === "💭";
      const isDraft = diary.weather_icon === "📦";
      const isClosedReport = diary.weather_icon === "🚫"; 
      
      const uniqueKey = isDraft ? `draft_${diary.id}` : (diary.shop_id || s);

      if (!locationMap[locKey].shops[uniqueKey]) {
        locationMap[locKey].shops[uniqueKey] = { 
          shopId: diary.shop_id || null, shopName: isDraft ? '📦 未整理の写真' : s,
          isMasterOnly: false, isTakeout: false, isGoods: false, mainTag: "", visitCount: 0, 
          isBookmarkOnly: false, isDraftOnly: isDraft,
          isClosed: false, isGracePeriod: false, closedDiaryId: null, lastVisited: 0
        };
        if (!isBookmark && !isDraft && !isClosedReport) totalValidVisits++;
      }

      let shop = locationMap[locKey].shops[uniqueKey];

      // 🚨 閉店フラグの処理
      if (isClosedReport) {
        if (!shop.isClosed && !shop.isGracePeriod) {
          const reportDateStr = diary.created_at || diary.visited_at || "";
          const reportDate = reportDateStr ? new Date(reportDateStr.replace(/-/g, '/')) : new Date();
          const diffDays = (new Date() - reportDate) / (1000 * 60 * 60 * 24);
          
          if (diffDays > 14) {
            shop.isClosed = true; // 完全閉店（削除せずステータス変更のみ！）
          } else {
            shop.isGracePeriod = true;
            shop.closedDiaryId = diary.id;
          }
        }
        return; 
      }

      // 🌟 通常の記録の重ね塗り処理
      shop.isMasterOnly = false;
      if (!isDraft) shop.shopName = s; 
      
      const visitTime = new Date((diary.visited_at || "").replace(/-/g, '/')).getTime();
      if (visitTime > shop.lastVisited) shop.lastVisited = visitTime;
      
      if (!isBookmark && !isDraft) { 
        shop.visitCount++; 
        if (shop.visitCount > 1) totalValidVisits++; 
        shop.isBookmarkOnly = false; 
        shop.isTakeout = diary.tags && diary.tags.includes('🥡テイクアウト');
        shop.isGoods = diary.tags && diary.tags.includes('🛍️豆・グッズ');
      } else if (isBookmark && shop.visitCount === 0) {
        shop.isBookmarkOnly = true;
      }

      if (!isBookmark && !isDraft && shop.mainTag === "") {
          const allTags = parseTags(diary.tags);
          const aiOrManualTag = allTags.find(t => !t.startsWith('🚨') && !t.includes('🥡') && !t.includes('☕️店内') && !t.includes('🛍️'));
          shop.mainTag = aiOrManualTag || "";
      }
    }
  });

  // 3️⃣ 描画処理: グループ化された場所ごとにピンを生成
  Object.values(locationMap).forEach(loc => {
    // 🏢 同じ場所にある店舗をソート（現役の店を先頭に、古い店を後ろに）
    const shopList = Object.values(loc.shops).sort((a, b) => {
        const scoreA = a.isClosed ? 2 : (a.isGracePeriod ? 1 : 0);
        const scoreB = b.isClosed ? 2 : (b.isGracePeriod ? 1 : 0);
        if (scoreA !== scoreB) return scoreA - scoreB; // 状態優先
        return b.lastVisited - a.lastVisited; // 次に訪問日
    });

    if (shopList.length === 0) return;

    // 最新・現役の店舗がその座標の「顔（メイン）」になる
    const mainShop = shopList[0];
    // その場所全体の訪問回数を合算
    const locTotalVisits = shopList.reduce((sum, s) => sum + s.visitCount, 0);

    let customIcon;
    let opacity = 1.0;

    if (mainShop.isClosed) {
      // 🎞️ 歴代店舗がすべて閉店した場所は「思い出の地」としてノスタルジックな表現に！
      customIcon = L.divIcon({ 
        html: `<div class="emoji-pin" style="background-color: #a67c52; position:relative; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">🎞️</div>`, 
        className: 'custom-div-icon', iconSize: [36, 36], iconAnchor: [18, 18] 
      });
      opacity = 0.85;
    } else if (mainShop.isGracePeriod) {
      customIcon = L.divIcon({ 
        html: `<div class="emoji-pin" style="background-color: #7f8c8d; position:relative;">👻</div>`, 
        className: 'custom-div-icon', iconSize: [36, 36], iconAnchor: [18, 18] 
      });
      opacity = 0.6;
    } else if (mainShop.isMasterOnly) {
      customIcon = L.divIcon({ 
        html: `<div style="background-color: #bdc3c7; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>`, 
        className: 'custom-div-icon', iconSize: [16, 16], iconAnchor: [8, 8] 
      });
    } else {
      let emoji = mainShop.isGoods ? '🛍️' : (mainShop.isTakeout ? '🥡' : '☕️');
      let bgColor = getColorFromTag(mainShop.mainTag); 
      if (mainShop.isDraftOnly) { emoji = '📦'; bgColor = '#95a5a6'; }
      if (mainShop.isBookmarkOnly) { emoji = '💭'; bgColor = '#f39c12'; }
      
      let scale = 1.0;
      if (locTotalVisits > 0 && totalValidVisits > 0) {
          const percentage = (locTotalVisits / totalValidVisits) * 100;
          const roundedPercentage = Math.round(percentage / 10) * 10;
          scale = 1.0 + (roundedPercentage / 100);
      }
      const scaledSize = Math.round(36 * scale);
      const anchorSize = Math.round(scaledSize / 2);
      const fontSize = Math.round(18 * scale);
      const badgeHtml = locTotalVisits > 0 ? `<div style="position:absolute; bottom:-2px; right:-2px; background:#e74c3c; color:white; border-radius:50%; width:20px; height:20px; font-size:11px; font-weight:bold; line-height:20px; text-align:center; box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index:10;">${locTotalVisits}</div>` : '';
      
      customIcon = L.divIcon({ 
        html: `<div style="background-color: ${bgColor}; width: ${scaledSize}px; height: ${scaledSize}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: ${fontSize}px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); position: relative; transition: all 0.3s ease;">${emoji}${badgeHtml}</div>`, 
        className: 'custom-div-icon', iconSize: [scaledSize, scaledSize], iconAnchor: [anchorSize, anchorSize] 
      });
    }
    
    const marker = L.marker([loc.lat, loc.lng], {icon: customIcon, opacity: opacity}).addTo(viewMap);
    mapMarkers.push(marker);
    
    // 📝 ポップアップの生成
    let popupHtml = `<div style="text-align:center; min-width: 180px; padding: 5px;">`;
    popupHtml += `<p style="margin: 0; font-weight:bold; font-size:1.1rem; color:#2c3e50;">${escapeHTML(mainShop.shopName)}</p>`;

    // 🏢 歴代店舗の表示（同じ場所に複数のお店がある場合）
    if (shopList.length > 1) {
        popupHtml += `<div style="margin: 10px 0; padding: 8px; background: #f4f4f9; border-radius: 8px; font-size: 0.8rem; text-align: left; border: 1px solid #eee;">`;
        popupHtml += `<p style="margin: 0 0 5px 0; font-weight: bold; color: #7f8c8d; font-size: 0.75rem;">🏢 歴代・併設の店舗</p>`;
        shopList.forEach(s => {
            let badge = s.isClosed ? '<span style="color:#a67c52; font-weight:bold;">[🎞️思い出]</span>' : (s.isGracePeriod ? '<span style="color:#f39c12; font-weight:bold;">[👻休業中]</span>' : '<span style="color:#27ae60; font-weight:bold;">[☕️現存]</span>');
            popupHtml += `<div style="margin-bottom: 4px; border-bottom: 1px dashed #ddd; padding-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${badge} ${escapeHTML(s.shopName)}</div>`;
        });
        popupHtml += `</div>`;
    }

    // メイン店舗に対するステータスとボタン
    let statusText = '';
    let actionBtn = '';

    if (mainShop.isClosed) {
        statusText = '<span style="color:#a67c52;">🎞️ 記憶に残る思い出の地</span>';
    } else if (mainShop.isGracePeriod) {
        statusText = '<span style="color:#e74c3c;">🚨 閉店・移転の報告あり<br>(2週間後にマップから消去)</span>';
        actionBtn = `<div style="margin-top:12px;"><button onclick="cancelCloseReport(${mainShop.closedDiaryId})" style="background:#e74c3c; width:100%; border:none; color:white; padding:8px; border-radius:5px; font-weight:bold; cursor:pointer;">誤報を取り消す</button></div>`;
    } else {
        if (mainShop.isMasterOnly) statusText = '🏳️ 未開拓（マスタ店舗）';
        else if (locTotalVisits > 0) statusText = `👣 訪問回数: ${locTotalVisits}回`;
        else if (mainShop.isDraftOnly) statusText = '📦 未整理の写真';
        else statusText = '💭 行きたいお店に登録中';
        
        actionBtn = `<div style="margin-top:12px; border-top:1px dashed #ddd; padding-top:8px;"><a href="#" onclick="reportClosed('${mainShop.shopId || mainShop.shopName}', '${escapeHTML(mainShop.shopName)}', ${loc.lat}, ${loc.lng}); return false;" style="color:#7f8c8d; font-size:0.75rem; text-decoration:none;">🚫 ${escapeHTML(mainShop.shopName)} の閉店を報告</a></div>`;
    }

    popupHtml += `<p style="margin: 5px 0 0 0; font-size:0.85rem; color:#7f8c8d; font-weight:bold;">${statusText}</p>`;
    popupHtml += actionBtn;
    popupHtml += `</div>`;

    marker.bindPopup(popupHtml);
    
    if (!mainShop.isMasterOnly && !mainShop.isGracePeriod && !mainShop.isClosed) {
        marker.bindTooltip(escapeHTML(mainShop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
    }
    bounds.extend([loc.lat, loc.lng]);
  });

  if (Object.keys(locationMap).length > 0) viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}