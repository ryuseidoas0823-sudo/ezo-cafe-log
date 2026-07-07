// ==========================================
// 🗺️ map.js (地図関係の処理まとめ)
// ==========================================

function initPickerMap() {
  if (!pickerMap) {
    pickerMap = L.map('pickerMap', { doubleClickZoom: false }).setView([HOME_LAT, HOME_LNG], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(pickerMap);
    pickerMarker = L.marker([HOME_LAT, HOME_LNG]).addTo(pickerMap);
    
    pickerMap.on('dblclick', function(e) {
      pickerMarker.setLatLng(e.latlng);
      checkSmartSuggest(e.latlng.lat, e.latlng.lng);
    });
  }
  setTimeout(() => { pickerMap.invalidateSize(); }, 200);
}

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
  
  const bounds = L.latLngBounds(); const uniqueShops = {};
  
  filteredDiaries.forEach(diary => {
    if (diary.latitude && diary.longitude) {
      const s = diary.shop_name; 
      const isBookmark = diary.weather_icon === "💭";
      const isDraft = diary.weather_icon === "📦";
      const uniqueKey = isDraft ? `draft_${diary.id}` : s;

      if (!uniqueShops[uniqueKey]) {
        uniqueShops[uniqueKey] = { 
          lat: diary.latitude, lng: diary.longitude, 
          isTakeout: diary.tags && diary.tags.includes('🥡テイクアウト'), 
          shopName: isDraft ? '📦 未整理の写真' : s, 
          mainTag: parseTags(diary.tags)[2]||"", 
          visitCount: (isBookmark || isDraft) ? 0 : 1, 
          isBookmarkOnly: isBookmark,
          isDraftOnly: isDraft,
          latestId: diary.id
        };
      } else {
        if (!isBookmark && !isDraft) { uniqueShops[uniqueKey].visitCount++; uniqueShops[uniqueKey].isBookmarkOnly = false; }
      }
    }
  });

  Object.values(uniqueShops).forEach(shop => {
    const emoji = shop.isDraftOnly ? '📦' : (shop.isBookmarkOnly ? '💭' : (shop.isTakeout ? '🥡' : '☕️'));
    const bgColor = shop.isDraftOnly ? '#95a5a6' : getColorFromTag(shop.mainTag);
    
    const badgeHtml = shop.visitCount > 0 ? `<div style="position:absolute; bottom:-5px; right:-5px; background:#e74c3c; color:white; border-radius:50%; width:18px; height:18px; font-size:11px; font-weight:bold; line-height:18px; text-align:center;">${shop.visitCount}</div>` : '';
    const customIcon = L.divIcon({ html: `<div class="emoji-pin" style="background-color: ${bgColor}; position:relative;">${emoji}${badgeHtml}</div>`, className: 'custom-div-icon', iconSize: [36, 36], iconAnchor: [18, 18] });
    
    const marker = L.marker([shop.lat, shop.lng], {icon: customIcon}).addTo(viewMap);
    
    // 変更前はここに <button onclick="openEditModal(...)"> がありましたが、削除して閲覧専用にします。
    const popupHtml = `
      <div style="text-align:center; min-width: 150px; padding: 5px;">
        <p style="margin: 0; font-weight:bold; font-size:1rem; color:#2c3e50;">${escapeHTML(shop.shopName)}</p>
        <p style="margin: 5px 0 0 0; font-size:0.85rem; color:#7f8c8d;">
          ${shop.visitCount > 0 ? `👣 訪問回数: ${shop.visitCount}回` : '💭 行きたいお店'}
        </p>
      </div>
    `;
    marker.bindPopup(popupHtml);
    marker.bindTooltip(escapeHTML(shop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
    
    bounds.extend([shop.lat, shop.lng]);
  });
  if (Object.keys(uniqueShops).length > 0) viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}

// ==========================================
// ✏️ 編集モーダル用のマップ初期化（タップ移動対応版）
// ==========================================
function initEditMap(lat, lng) {
  const defaultLat = lat || 43.0686;
  const defaultLng = lng || 141.3508;

  if (!window.leafletEditMap) {
    window.leafletEditMap = L.map('editMap', { doubleClickZoom: false }).setView([defaultLat, defaultLng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(window.leafletEditMap);
    window.leafletEditMarker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(window.leafletEditMap);
    
    // ★ 追加：マップをタップ、またはダブルクリックした場所にピンをワープさせる！
    window.leafletEditMap.on('click', function(e) {
      window.leafletEditMarker.setLatLng(e.latlng);
    });
    window.leafletEditMap.on('dblclick', function(e) {
      window.leafletEditMarker.setLatLng(e.latlng);
    });
  } else {
    window.leafletEditMap.setView([defaultLat, defaultLng], 15);
    window.leafletEditMarker.setLatLng([defaultLat, defaultLng]);
  }

  setTimeout(() => { window.leafletEditMap.invalidateSize(); }, 200);
}