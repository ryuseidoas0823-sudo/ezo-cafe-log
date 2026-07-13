// ==========================================
// 🗺️ map.js (地図関係の処理まとめ - 間借り・無店舗対応版)
// ==========================================
const HOME_LAT = 43.0600;
const HOME_LNG = 141.3500;
let viewMap = null;
let mapMarkers = []; 

window.globalGhostPins = [];
window.isFetchingGhosts = false;

let activeMapFilters = { dining: false, takeout: false, goods: false };
const HOKKAIDO_BOUNDS = L.latLngBounds([41.2000, 139.2000], [45.6000, 146.0000]);

function initViewMap() {
  if (!viewMap) {
    viewMap = L.map('mapView', {
      maxBounds: HOKKAIDO_BOUNDS, 
      maxBoundsViscosity: 1.0, 
      minZoom: 7, 
      maxZoom: 19
    }).setView([HOME_LAT, HOME_LNG], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(viewMap);
    viewMap.on('zoomend', () => { updateViewMarkers(globalDiaries, false); });
  }
  setTimeout(() => { viewMap.invalidateSize(); }, 200);
}

function toggleMapFilter(type) {
    activeMapFilters[type] = !activeMapFilters[type];
    const btn = document.getElementById(`btn-filter-${type}`);
    if (btn) {
        if (activeMapFilters[type]) {
            btn.style.background = '#5d4037';
            btn.style.color = '#fff';
        } else {
            btn.style.background = 'rgba(255, 255, 255, 0.9)';
            btn.style.color = '#5d4037';
        }
    }
    updateViewMarkers(globalDiaries, false); 
}

function flyToShop(lat, lng) {
  if (viewMap) {
    viewMap.flyTo([lat, lng], 17, { duration: 1.5 });
    setTimeout(() => {
      const targetMarker = mapMarkers.find(m => m.getLatLng().lat === lat && m.getLatLng().lng === lng);
      if (targetMarker) targetMarker.fire('click');
    }, 1500);
  }
}

window.downloadMapImage = function() {
    const mapContainer = document.getElementById('mapView');
    const template = document.getElementById('map-watermark-template');
    const saveBtn = document.getElementById('btn-save-map-image');
    
    if (!mapContainer || !template) return;

    const originalBtnText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = "📸 画像を生成中...";

    const validShopsCount = document.getElementById('stat-unique-shops')?.innerText || "0";
    document.getElementById('watermark-shop-count').innerText = validShopsCount;

    const watermarkClone = template.cloneNode(true);
    watermarkClone.style.display = 'block';
    mapContainer.appendChild(watermarkClone);

    html2canvas(mapContainer, {
        useCORS: true, 
        allowTaint: false,
        ignoreElements: (el) => el.id === 'mapSearchInput' || el.closest('#mapSearchSuggestList') || el.classList.contains('floating-map-controls') || el.classList.contains('bottom-sheet')
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `EzoCafe_Log_MyMap_${new Date().toISOString().split('T')[0]}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        mapContainer.removeChild(watermarkClone);
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnText;
    }).catch(err => {
        console.error("Map Image Export Error:", err);
        mapContainer.removeChild(watermarkClone);
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnText;
        alert("画像の生成に失敗しました。時間をおいて再度お試しください。");
    });
};

function updateViewMarkers(filteredDiaries = globalDiaries, autoFit = false) {
  if (!viewMap) return;
  const currentZoom = viewMap.getZoom();
  
  viewMap.eachLayer((layer) => { if (layer instanceof L.Marker) viewMap.removeLayer(layer); });
  
  const bounds = L.latLngBounds(); 
  const locationMap = {};
  let totalValidVisits = 0; 
  mapMarkers = []; 
  
  if (typeof globalMasterShops !== 'undefined') {
    globalMasterShops.forEach(shop => {
      const locKey = `${shop.latitude}_${shop.longitude}`;
      if (!locationMap[locKey]) locationMap[locKey] = { lat: shop.latitude, lng: shop.longitude, shops: {} };
      locationMap[locKey].shops[shop.shop_id] = {
        shopId: shop.shop_id, shopName: shop.shop_name,
        isMasterOnly: true, mainTag: "", visitCount: 0, isBookmarkOnly: false, isDraftOnly: false,
        isClosed: false, isGracePeriod: false, closedDiaryId: null, lastVisited: 0, latestDiaryId: null,
        hasDining: false, hasTakeout: false, hasGoods: false, hasEvent: false, // 🎪 追加
        allTagsSet: new Set(),
        isLocal: shop.is_local !== undefined ? shop.is_local : 1
      };
    });
  }
  
  const chronologicalDiaries = [...filteredDiaries].sort((a, b) => {
      const timeA = new Date((a.visited_at || "1970-01-01").replace(/-/g, '/')).getTime();
      const timeB = new Date((b.visited_at || "1970-01-01").replace(/-/g, '/')).getTime();
      return timeA - timeB; 
  });
  
  chronologicalDiaries.forEach(diary => {
    if (diary.latitude && diary.longitude) {
      const locKey = `${diary.latitude}_${diary.longitude}`;
      if (!locationMap[locKey]) locationMap[locKey] = { lat: diary.latitude, lng: diary.longitude, shops: {} };

      const s = diary.shop_name; 
      const isBookmark = diary.weather_icon === "💭";
      const isDraft = diary.weather_icon === "📦";
      const isClosedReport = diary.weather_icon === "🚫"; 
      
      let uniqueKey = isDraft ? `draft_${diary.id}` : (diary.shop_id || s);

      if (!locationMap[locKey].shops[uniqueKey]) {
        locationMap[locKey].shops[uniqueKey] = { 
          shopId: diary.shop_id || null, shopName: isDraft ? '📦 未整理の写真' : s,
          isMasterOnly: false, mainTag: "", visitCount: 0, isBookmarkOnly: false, isDraftOnly: isDraft,
          isClosed: false, isGracePeriod: false, closedDiaryId: null, lastVisited: 0, latestDiaryId: null,
          hasDining: false, hasTakeout: false, hasGoods: false, hasEvent: false, // 🎪 追加
          allTagsSet: new Set(),
          isLocal: 1
        };
        if (!isBookmark && !isDraft && !isClosedReport) totalValidVisits++;
      }

      let shop = locationMap[locKey].shops[uniqueKey];
      const allTags = parseTags(diary.tags);

      allTags.forEach(t => shop.allTagsSet.add(t));

      if (isClosedReport) {
        if (!shop.isClosed && !shop.isGracePeriod) {
          const reportDateStr = diary.created_at || diary.visited_at || "";
          const reportDate = reportDateStr ? new Date(reportDateStr.replace(/-/g, '/')) : new Date();
          const diffDays = (new Date() - reportDate) / (1000 * 60 * 60 * 24);
          if (diffDays > 14) shop.isClosed = true; 
          else { shop.isGracePeriod = true; shop.closedDiaryId = diary.id; }
        }
        return; 
      }

      if (shop.isClosed) return;
      shop.isMasterOnly = false;
      if (!isDraft) shop.shopName = s; 
      
      const visitTime = new Date((diary.visited_at || "").replace(/-/g, '/')).getTime();
      if (visitTime >= shop.lastVisited) {
          shop.lastVisited = visitTime;
          shop.latestDiaryId = diary.id;
      }
      
      // 🎪 判定に追加
      if (allTags.includes('☕️店内')) shop.hasDining = true;
      if (allTags.includes('🥡テイクアウト')) shop.hasTakeout = true;
      if (allTags.includes('🛍️豆・グッズ')) shop.hasGoods = true;
      if (allTags.includes('🎪間借り・無店舗')) shop.hasEvent = true; 

      if (allTags.some(t => t.includes('テイクアウト廃止') || t.includes('テイクアウト終了') || t.includes('テイクアウトなし'))) shop.hasTakeout = false;
      if (allTags.some(t => t.includes('物販終了') || t.includes('豆販売終了'))) shop.hasGoods = false;

      if (!isBookmark && !isDraft) { 
        shop.visitCount++; 
        if (shop.visitCount > 1) totalValidVisits++; 
        shop.isBookmarkOnly = false; 
      } else if (isBookmark && shop.visitCount === 0) {
        shop.isBookmarkOnly = true;
      }

      if (!isBookmark && !isDraft && shop.mainTag === "") {
          const aiOrManualTag = allTags.find(t => !t.startsWith('🚨') && !t.includes('🥡') && !t.includes('☕️店内') && !t.includes('🛍️') && !t.includes('🎪'));
          shop.mainTag = aiOrManualTag || "";
      }
    }
  });

  const selectedMoodTag = document.getElementById('mapTagFilter') ? document.getElementById('mapTagFilter').value : "";

  Object.values(locationMap).forEach(loc => {
    const mergedShops = {};
    Object.values(loc.shops).forEach(s => {
        const normName = (s.shopName || "").trim().toLowerCase();
        if (!mergedShops[normName]) {
            mergedShops[normName] = { ...s, allTagsSet: new Set(s.allTagsSet) }; 
        } else {
            const existing = mergedShops[normName];
            existing.visitCount += s.visitCount;
            if (s.lastVisited >= existing.lastVisited) {
                existing.lastVisited = s.lastVisited;
                if (s.latestDiaryId) existing.latestDiaryId = s.latestDiaryId;
            }
            if (s.hasDining) existing.hasDining = true;
            if (s.hasTakeout) existing.hasTakeout = true;
            if (s.hasGoods) existing.hasGoods = true;
            if (s.hasEvent) existing.hasEvent = true; // 🎪 追加
            s.allTagsSet.forEach(t => existing.allTagsSet.add(t));
            if (!existing.shopId && s.shopId) existing.shopId = s.shopId;
            existing.isClosed = existing.isClosed || s.isClosed;
            existing.isGracePeriod = existing.isGracePeriod || s.isGracePeriod;
            if (s.mainTag && !existing.mainTag) existing.mainTag = s.mainTag;
            existing.isMasterOnly = existing.isMasterOnly && s.isMasterOnly;
            existing.isBookmarkOnly = existing.isBookmarkOnly && s.isBookmarkOnly;
        }
    });

    let shopList = Object.values(mergedShops).sort((a, b) => {
        const scoreA = a.isClosed ? 2 : (a.isGracePeriod ? 1 : 0);
        const scoreB = b.isClosed ? 2 : (b.isGracePeriod ? 1 : 0);
        if (scoreA !== scoreB) return scoreA - scoreB; 
        return b.lastVisited - a.lastVisited; 
    });

    if (shopList.length === 0) return;

    if (activeMapFilters.dining)  shopList = shopList.filter(s => s.hasDining);
    if (activeMapFilters.takeout) shopList = shopList.filter(s => s.hasTakeout);
    if (activeMapFilters.goods)   shopList = shopList.filter(s => s.hasGoods);
    
    if (selectedMoodTag !== "") {
        shopList = shopList.filter(s => !s.isMasterOnly && s.allTagsSet && s.allTagsSet.has(selectedMoodTag));
    }

    if (shopList.length === 0) return;

    const mainShop = shopList[0];
    const locTotalVisits = shopList.reduce((sum, s) => sum + s.visitCount, 0);

    let customIcon;
    let opacity = 1.0;

    if (mainShop.isClosed) {
      customIcon = L.divIcon({ html: `<div class="emoji-pin" style="background-color: #a67c52; position:relative; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">🎞️</div>`, className: 'custom-div-icon', iconSize: [36, 36], iconAnchor: [18, 18] });
      opacity = 0.85;
    } else if (mainShop.isGracePeriod) {
      customIcon = L.divIcon({ html: `<div class="emoji-pin" style="background-color: #7f8c8d; position:relative;">👻</div>`, className: 'custom-div-icon', iconSize: [36, 36], iconAnchor: [18, 18] });
      opacity = 0.6;
    } else if (mainShop.isMasterOnly) {
      if (currentZoom < 12) return; 
      customIcon = L.divIcon({ html: `<div style="background-color: #bdc3c7; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>`, className: 'custom-div-icon', iconSize: [16, 16], iconAnchor: [8, 8] });
    } else {
      let emoji = mainShop.hasGoods ? '🛍️' : (mainShop.hasTakeout ? '🥡' : '☕️');
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
      
      customIcon = L.divIcon({ html: `<div style="background-color: ${bgColor}; width: ${scaledSize}px; height: ${scaledSize}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: ${fontSize}px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); position: relative; transition: all 0.3s ease;">${emoji}${badgeHtml}</div>`, className: 'custom-div-icon', iconSize: [scaledSize, scaledSize], iconAnchor: [anchorSize, anchorSize] });
    }
    
    const marker = L.marker([loc.lat, loc.lng], {icon: customIcon, opacity: opacity}).addTo(viewMap);
    mapMarkers.push(marker);
    
    marker.on('click', () => {
        openShopBottomSheet(mainShop, shopList, loc, locTotalVisits);
    });
    
    if (!mainShop.isMasterOnly && !mainShop.isGracePeriod && !mainShop.isClosed) {
        marker.bindTooltip(escapeHTML(mainShop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
    }
    bounds.extend([loc.lat, loc.lng]);
  });

  if (autoFit && Object.keys(locationMap).length > 0) {
      viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }

  if (window.currentUser && (window.currentUser.role === 'premium' || window.currentUser.role === 'admin')) {
      const drawGhostPins = (ghosts) => {
          ghosts.forEach(ghost => {
              if (!ghost.lat || !ghost.lng) return;

              if (selectedMoodTag !== "") {
                  let hasMatch = false;
                  if (ghost.tags) { ghost.tags.forEach(t => { if (t.includes(selectedMoodTag)) hasMatch = true; }); }
                  if (!hasMatch) return;
              }

              const customIcon = L.divIcon({ 
                  html: `<div class="ghost-pin-icon" style="width: 24px; height: 24px;">👤</div>`, 
                  className: 'custom-div-icon', 
                  iconSize: [24, 24], 
                  iconAnchor: [12, 12] 
              });
              
              const marker = L.marker([ghost.lat, ghost.lng], {
                  icon: customIcon, 
                  zIndexOffset: -100 
              }).addTo(viewMap);
              
              mapMarkers.push(marker);
              
              marker.on('click', () => { openGhostBottomSheet(ghost); });
          });
      };

      if (window.globalGhostPins && window.globalGhostPins.length > 0) {
          drawGhostPins(window.globalGhostPins);
      } else if (!window.isFetchingGhosts) {
          window.isFetchingGhosts = true;
          if (typeof fetchGhostPinsApi === 'function') {
              fetchGhostPinsApi().then(ghosts => {
                  window.globalGhostPins = ghosts;
                  drawGhostPins(window.globalGhostPins);
              });
          }
      }
  }

  if (!viewMap.hasSheetCloseEvent) {
      viewMap.on('click', () => { closeBottomSheet(); });
      viewMap.hasSheetCloseEvent = true;
  }
}

function closeBottomSheet() {
    const sheet = document.getElementById('shopBottomSheet');
    if (sheet) sheet.classList.remove('active');
}

function openShopBottomSheet(mainShop, shopList, loc, locTotalVisits) {
    const sheet = document.getElementById('shopBottomSheet');
    const content = document.getElementById('bottomSheetContent');
    
    let html = `<div style="text-align:center;">`;
    html += `<h2 style="margin: 0 0 5px 0; color:#2c3e50; font-size: 1.4rem;">${escapeHTML(mainShop.shopName)}</h2>`;
    
    // 🎪 🆕 ボトムシートの対応サービスに「無店舗」を追加表示
    let servicesHtml = '<div style="margin: 8px 0 15px 0; font-size: 0.9rem; color: #7f8c8d;">✨ 対応: ';
    if (mainShop.hasDining) servicesHtml += '☕️店内 ';
    if (mainShop.hasTakeout) servicesHtml += '🥡テイクアウト ';
    if (mainShop.hasGoods) servicesHtml += '🛍️豆・グッズ ';
    if (mainShop.hasEvent) servicesHtml += '🎪無店舗/イベント ';
    if (!mainShop.hasDining && !mainShop.hasTakeout && !mainShop.hasGoods && !mainShop.hasEvent) servicesHtml += '🏳️ 未確認';
    servicesHtml += '</div>';
    html += servicesHtml;

    if (shopList.length > 1) {
        html += `<div style="margin: 10px 0; padding: 12px; background: rgba(244,244,249,0.7); border-radius: 12px; font-size: 0.85rem; text-align: left;">`;
        html += `<p style="margin: 0 0 8px 0; font-weight: bold; color: #7f8c8d;">🏢 歴代・併設の店舗</p>`;
        shopList.forEach(s => {
            let badge = s.isClosed ? '<span style="color:#a67c52;">[🎞️思い出]</span>' : (s.isGracePeriod ? '<span style="color:#f39c12;">[👻休業中]</span>' : '<span style="color:#27ae60;">[☕️現存]</span>');
            html += `<div style="margin-bottom: 6px;">${badge} ${escapeHTML(s.shopName)}</div>`;
        });
        html += `</div>`;
    }

    let statusText = ''; 
    let actionBtn = `<div style="margin-top:15px; border-top:1px solid rgba(0,0,0,0.1); padding-top:15px; display:flex; flex-direction:column; gap:10px;">`;

    if (mainShop.isClosed) { 
        statusText = '<span style="color:#a67c52; font-size:1.1rem;">🎞️ 記憶に残る思い出の地</span>'; 
    } else if (mainShop.isGracePeriod) {
        statusText = '<span style="color:#e74c3c;">🚨 閉店・移転の報告あり</span>';
    } else {
        if (mainShop.isMasterOnly) statusText = '🏳️ 未開拓（マスタ店舗）';
        else if (locTotalVisits > 0) statusText = `👣 累計訪問回数: ${locTotalVisits}回`;
        else if (mainShop.isDraftOnly) statusText = '📦 未整理の写真';
        else statusText = '💭 行きたいお店に登録中';
    }

    if (!mainShop.isClosed && !mainShop.isGracePeriod) {
        if (mainShop.isMasterOnly || mainShop.isBookmarkOnly) {
            actionBtn += `<button onclick="recordFromMap('${mainShop.shopId || ''}', '${escapeHTML(mainShop.shopName)}', ${loc.lat}, ${loc.lng})" style="background:#27ae60; border:none; color:white; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">📝 このお店を開拓・記録する</button>`;
        } else if (mainShop.latestDiaryId && !mainShop.isDraftOnly) {
            actionBtn += `<button onclick="editDiary(${mainShop.latestDiaryId}); closeBottomSheet();" style="background:#f39c12; border:none; color:white; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">✏️ 最新の記録を編集する</button>`;
        }
    }

    if (!mainShop.isClosed) {
        let closeBtnColor = mainShop.isGracePeriod ? "#e74c3c" : "#95a5a6";
        let closeBtnText = mainShop.isGracePeriod ? "🚨 閉店報告を取り消す" : "🚫 閉店・移転を報告する";
        let closeAction = mainShop.isGracePeriod ? `cancelCloseReport(${mainShop.closedDiaryId})` : `reportClosed('${mainShop.shopId || mainShop.shopName}', '${escapeHTML(mainShop.shopName)}', ${loc.lat}, ${loc.lng})`;
        
        actionBtn += `<a href="#" onclick="${closeAction}; return false;" style="color:${closeBtnColor}; font-size:0.85rem; text-decoration:none; text-align:center; margin-top:5px;">${closeBtnText}</a>`;
    }
    actionBtn += `</div>`;

    html += `<p style="margin: 10px 0; font-weight:bold; color:#34495e;">${statusText}</p>`;
    
    let analyticsHtml = "";
    const shopDiaries = globalDiaries.filter(d =>
        ((mainShop.shopId && d.shop_id === mainShop.shopId) || (!mainShop.shopId && d.shop_name === mainShop.shopName))
        && d.weather_icon !== "💭" && d.weather_icon !== "📦" && d.weather_icon !== "🚫"
    );

    if (shopDiaries.length > 0) {
        const weathers = {};
        shopDiaries.forEach(d => {
            const w = d.weather_icon;
            if (w && w !== "❓") { weathers[w] = (weathers[w] || 0) + 1; }
        });
        const topWeather = Object.keys(weathers).sort((a,b) => weathers[b] - weathers[a])[0];

        const tagsCount = {};
        shopDiaries.forEach(d => {
            parseTags(d.tags).forEach(t => {
                // 🎪 アナリティクス用のAIタグ集計からも間借りタグを除外
                if (!t.startsWith("🤖") && !t.startsWith("🚨") && t !== "☕️店内" && t !== "🥡テイクアウト" && t !== "🛍️豆・グッズ" && t !== "🎪間借り・無店舗") {
                    tagsCount[t] = (tagsCount[t] || 0) + 1;
                }
            });
        });
        const topTags = Object.entries(tagsCount).sort((a,b) => b[1] - a[1]).slice(0, 5); 

        analyticsHtml += `<details style="margin-top: 15px; background: rgba(255, 255, 255, 0.7); padding: 12px 15px; border-radius: 12px; border: 1px solid rgba(0,0,0,0.05); text-align: left; box-shadow: 0 2px 4px rgba(0,0,0,0.02); cursor: pointer; transition: all 0.3s ease;">`;
        analyticsHtml += `<summary style="font-size: 0.95rem; color: #2c3e50; font-weight: bold; outline: none; list-style: none; display: flex; justify-content: space-between; align-items: center;">`;
        analyticsHtml += `<span>📊 あなたの訪問傾向</span> <span style="font-size: 0.8rem; color: #3498db; background: #ebf5fb; padding: 4px 10px; border-radius: 12px;">開く / 閉じる</span>`;
        analyticsHtml += `</summary>`;
        
        analyticsHtml += `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed rgba(0,0,0,0.1);">`;

        if (topWeather) {
            analyticsHtml += `<p style="margin: 0 0 10px 0; font-size: 0.8rem; color: #7f8c8d; display: flex; align-items: center; gap: 6px;">`;
            analyticsHtml += `<span style="background: #fdf2e9; padding: 4px 8px; border-radius: 6px; color: #e67e22; font-weight: bold;">${topWeather} の日によく訪れています</span>`;
            analyticsHtml += `</p>`;
        }

        if (topTags.length > 0) {
            analyticsHtml += `<div style="display: flex; flex-wrap: wrap; gap: 6px;">`;
            topTags.forEach(tag => {
                analyticsHtml += `<span style="background: ${getColorFromTag(tag[0])}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">#${escapeHTML(tag[0])} <span style="opacity: 0.8; font-size: 0.65rem;">x${tag[1]}</span></span>`;
            });
            analyticsHtml += `</div>`;
        } else {
            analyticsHtml += `<p style="margin: 0; font-size: 0.8rem; color: #bdc3c7;">タグの記録はまだありません</p>`;
        }
        
        analyticsHtml += `</div></details>`;
        
    } else if (mainShop.isBookmarkOnly) {
        analyticsHtml += `<div style="margin-top: 15px; background: #fef9e7; padding: 12px; border-radius: 12px; font-size: 0.85rem; color: #d4ac0d; text-align: center; border: 1px dashed #f1c40f;">💭 いつか行きたいお店としてストックされています</div>`;
    }

    html += analyticsHtml;

    if (window.currentUser && (window.currentUser.role === 'admin' || window.currentUser.role === 'business')) {
        const safeShopId = mainShop.shopId ? `'${mainShop.shopId}'` : 'null';
        const safeShopName = `'${mainShop.shopName.replace(/'/g, "\\'")}'`;
        const containerId = mainShop.shopId ? mainShop.shopId.replace(/\W/g, '') : 'manual';
        
        html += `<div style="margin-top:20px; padding: 15px; background: rgba(41, 128, 185, 0.05); border-radius: 12px; border: 1px solid rgba(41, 128, 185, 0.2); text-align: left;">
            <p style="margin:0 0 10px 0; font-size:0.85rem; color:#2980b9; font-weight:bold;">🏢 店舗全体アナリティクス (B2B)</p>
            <div id="b2b-analytics-container-${containerId}">
                <button onclick="loadShopAnalytics(this, ${safeShopId}, ${safeShopName})" style="background: #2980b9; width:100%; border:none; color:white; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size: 0.85rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">📊 顧客データと客層を集計する</button>
            </div>
        </div>`;
    }

    if (window.currentUser && window.currentUser.role === 'admin' && mainShop.shopId && mainShop.shopId.startsWith('node/')) {
        const currentIsLocal = mainShop.isLocal !== 0; 
        const toggleVal = currentIsLocal ? 0 : 1;
        const toggleText = currentIsLocal ? '🚫 チェーン非表示化' : '✅ ローカル復活';
        const toggleColor = currentIsLocal ? '#e74c3c' : '#27ae60';
        
        html += `<div style="margin-top:20px; padding: 15px; background: rgba(252,236,235,0.8); border-radius: 12px; border: 1px solid #f5b7b1;">
            <p style="margin:0 0 10px 0; font-size:0.85rem; color:#c0392b; font-weight:bold;">👑 管理者メニュー</p>
            <button onclick="toggleLocalStatus('${mainShop.shopId}', ${toggleVal})" style="background:${toggleColor}; width:100%; border:none; color:white; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">${toggleText}</button>
        </div>`;
    }

    html += actionBtn;
    html += `</div>`;
    
    content.innerHTML = html;
    sheet.classList.add('active');
}

function openGhostBottomSheet(ghost) {
    const sheet = document.getElementById('shopBottomSheet');
    const content = document.getElementById('bottomSheetContent');
    
    let html = `<div style="text-align:center;">`;
    
    html += `<h2 style="margin: 0 0 5px 0; color:#2c3e50; font-size: 1.4rem;">${escapeHTML(ghost.shopName)}</h2>`;
    html += `<p style="color:#8e44ad; font-weight:bold; font-size: 0.95rem; margin-top: 0; display:flex; align-items:center; justify-content:center; gap:6px;">
                <span style="font-size:1.2rem;">👤</span> 匿名のトラベラー
             </p>`;
    
    html += `<div style="margin-top: 15px; background: rgba(142, 68, 173, 0.05); padding: 15px; border-radius: 12px; border: 1px solid rgba(142, 68, 173, 0.2); text-align: left;">`;
    
    html += `<p style="margin: 0 0 12px 0; font-size: 0.85rem; color: #7f8c8d; display:flex; align-items:center; gap:8px;">
                <span style="background: rgba(142, 68, 173, 0.1); padding: 4px 8px; border-radius: 6px; color: #8e44ad; font-weight: bold;">🕰 訪問時期</span> 
                ${escapeHTML(ghost.abstractTime)}
             </p>`;
    
    if (ghost.tags && ghost.tags.length > 0) {
        html += `<p style="margin: 0 0 6px 0; font-size: 0.8rem; font-weight:bold; color: #2c3e50;">💡 この場所の印象（AI抽出）</p>`;
        html += `<div style="display: flex; flex-wrap: wrap; gap: 6px;">`;
        ghost.tags.forEach(t => {
            let tagName = escapeHTML(t.replace(/🤖[☕️🍰🛋️]/, '🤖 '));
            html += `<span style="background: rgba(142, 68, 173, 0.7); color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: bold; box-shadow: 0 2px 4px rgba(142, 68, 173, 0.2);">${tagName}</span>`;
        });
        html += `</div>`;
    } else {
        html += `<p style="margin: 0; font-size: 0.8rem; color: #bdc3c7;">印象の記録はありません</p>`;
    }
    
    html += `</div>`;
    
    html += `<div style="margin-top: 20px; font-size: 0.75rem; color: #95a5a6; line-height: 1.5;">`;
    html += `※この記録は、ユーザー本人の同意のもと、個人が特定されないよう時間を抽象化して共有されています。<br>静かな繋がりをお楽しみください。`;
    html += `</div>`;

    html += `</div>`;
    
    content.innerHTML = html;
    sheet.classList.add('active');
}

window.loadShopAnalytics = async function(btnElement, shopId, shopName) {
    btnElement.innerHTML = "⏳ データを集計中...";
    btnElement.disabled = true;

    const data = await fetchShopAnalyticsApi(shopId, shopName);
    if (!data || data.total === 0) {
        btnElement.innerHTML = "❌ データがありません";
        return;
    }

    let html = `<div style="animation: fadeIn 0.4s ease;">`;
    html += `<p style="font-size:0.8rem; color:#7f8c8d; margin: 0 0 10px 0; font-weight: bold;">👥 累計来店記録: ${data.total}件</p>`;

    html += `<div style="margin-bottom: 12px;">`;
    html += `<p style="font-size:0.75rem; margin:0 0 4px 0; color:#2c3e50; font-weight:bold;">性別分布</p>`;
    Object.entries(data.genders).sort((a,b) => b[1]-a[1]).forEach(([k, v]) => {
        const percent = Math.round((v / data.total) * 100);
        html += `<div style="display:flex; align-items:center; margin-bottom:4px; font-size:0.75rem; color:#34495e;">
            <span style="width:60px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${k}</span>
            <div style="flex-grow:1; background:rgba(0,0,0,0.05); height:12px; border-radius:6px; margin:0 8px; position:relative; overflow:hidden;">
                <div style="width:${percent}%; background:#3498db; height:100%; border-radius:6px; transition: width 1s ease-out;"></div>
            </div>
            <span style="width:30px; text-align:right;">${percent}%</span>
        </div>`;
    });
    html += `</div>`;

    html += `<div style="margin-bottom: 12px;">`;
    html += `<p style="font-size:0.75rem; margin:0 0 4px 0; color:#2c3e50; font-weight:bold;">年代分布</p>`;
    Object.entries(data.ages).sort((a,b) => b[1]-a[1]).forEach(([k, v]) => {
        const percent = Math.round((v / data.total) * 100);
        html += `<div style="display:flex; align-items:center; margin-bottom:4px; font-size:0.75rem; color:#34495e;">
            <span style="width:60px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${k}</span>
            <div style="flex-grow:1; background:rgba(0,0,0,0.05); height:12px; border-radius:6px; margin:0 8px; position:relative; overflow:hidden;">
                <div style="width:${percent}%; background:#2ecc71; height:100%; border-radius:6px; transition: width 1s ease-out;"></div>
            </div>
            <span style="width:30px; text-align:right;">${percent}%</span>
        </div>`;
    });
    html += `</div>`;

    if (data.topTags.length > 0) {
        html += `<p style="font-size:0.75rem; margin:0 0 6px 0; color:#2c3e50; font-weight:bold;">客観的イメージ（AI抽出タグ）</p>`;
        html += `<div style="display: flex; flex-wrap: wrap; gap: 6px;">`;
        data.topTags.forEach(t => {
            let bgColor = t[0].startsWith('🚨') ? '#e74c3c' : (t[0].startsWith('🤖') ? '#8e44ad' : '#f39c12');
            let tagName = escapeHTML(t[0].replace(/🤖[☕️🍰🛋️]/, '🤖 '));
            html += `<span style="background: ${bgColor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">${tagName} <span style="opacity:0.8; font-size:0.65rem;">x${t[1]}</span></span>`;
        });
        html += `</div>`;
    }

    html += `</div>`;
    btnElement.parentElement.innerHTML = html;
};

window.toggleLocalStatus = async function(shopId, isLocal) {
    if (!confirm(`この店舗を「${isLocal === 1 ? 'ローカル店として表示' : 'チェーン店として非表示'}」に変更しますか？\n(一般ユーザーのマップから消去されます)`)) return;
    
    document.body.style.cursor = 'wait';
    const result = await toggleLocalStatusApi(shopId, isLocal);
    
    if (result.success) {
        await fetchMasterShopsApi(); 
        updateViewMarkers(globalDiaries, false); 
        closeBottomSheet(); 
    } else {
        alert("エラー: " + result.error);
    }
    document.body.style.cursor = 'default';
};