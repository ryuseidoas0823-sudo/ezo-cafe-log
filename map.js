// ==========================================
// 🗺️ map.js (地図・位置情報に関する処理まとめ)
// ==========================================

function setupHidePinsButtons() {
  const hideFunc = (mapObj) => { if(mapObj) mapObj.eachLayer(l => { if(l instanceof L.Marker && l.setOpacity) l.setOpacity(0); }); };
  const showFunc = (mapObj) => { if(mapObj) mapObj.eachLayer(l => { if(l instanceof L.Marker && l.setOpacity) l.setOpacity(1); }); };

  const btnPicker = document.getElementById('hidePinsBtnPicker');
  if(btnPicker) {
    btnPicker.addEventListener('mousedown', () => hideFunc(pickerMap));
    btnPicker.addEventListener('touchstart', () => hideFunc(pickerMap), {passive: true});
    ['mouseup','mouseleave','touchend'].forEach(e => btnPicker.addEventListener(e, () => showFunc(pickerMap)));
  }

  const btnView = document.getElementById('hidePinsBtnView');
  if(btnView) {
    btnView.addEventListener('mousedown', () => hideFunc(viewMap));
    btnView.addEventListener('touchstart', () => hideFunc(viewMap), {passive: true});
    ['mouseup','mouseleave','touchend'].forEach(e => btnView.addEventListener(e, () => showFunc(viewMap)));
  }
}

function initPickerMap() {
  if (!pickerMap) {
    pickerMap = L.map('pickerMap', { doubleClickZoom: false }).setView([43.0686, 141.3508], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(pickerMap);
    pickerMarker = L.marker([43.0686, 141.3508], { draggable: true }).addTo(pickerMap);
    pickerMap.on('dblclick', function(e) { pickerMarker.setLatLng(e.latlng); checkSmartSuggest(e.latlng.lat, e.latlng.lng); });
    pickerMarker.on('dragend', function(e) { const pos = pickerMarker.getLatLng(); checkSmartSuggest(pos.lat, pos.lng); });
  }
  setTimeout(() => pickerMap.invalidateSize(), 100);
}

function initViewMap() {
  if (!viewMap) { 
    viewMap = L.map('mapView').setView([43.064, 141.35], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(viewMap);
  }
  setTimeout(() => { viewMap.invalidateSize(); }, 100); 
}

// ==========================================
// マップ画面のピン描画（メニュー表示機能の復活）
// ==========================================
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
          latestId: diary.id // ★ 編集用に最新のIDを保存
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
    
    // ★ マップピンのタップ（クリック）でメニュー（ポップアップ）を表示
    const popupHtml = `
      <div style="text-align:center; min-width: 150px;">
        <p style="margin: 0 0 10px; font-weight:bold; font-size:1rem; color:#2c3e50;">${escapeHTML(shop.shopName)}</p>
        <button onclick="openEditModal('${shop.latestId}', 'location')" style="background:#3498db; color:white; border:none; padding:8px 15px; border-radius:4px; font-weight:bold; cursor:pointer; width: 100%;">📍 位置を修正する</button>
      </div>
    `;
    marker.bindPopup(popupHtml);
    marker.bindTooltip(escapeHTML(shop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
    
    bounds.extend([shop.lat, shop.lng]);
  });
  if (Object.keys(uniqueShops).length > 0) viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}

// ==========================================
// ✏️ 編集モーダル用のマップ初期化
// ==========================================
function initEditMap(lat, lng) {
  const defaultLat = lat || 43.0686;
  const defaultLng = lng || 141.3508;

  // エラー原因：HTMLの id="editMap" と変数名が衝突していたため、leafletEditMap に変更
  if (!window.leafletEditMap) {
    window.leafletEditMap = L.map('editMap', { doubleClickZoom: false }).setView([defaultLat, defaultLng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(window.leafletEditMap);
    window.leafletEditMarker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(window.leafletEditMap);
  } else {
    window.leafletEditMap.setView([defaultLat, defaultLng], 15);
    window.leafletEditMarker.setLatLng([defaultLat, defaultLng]);
  }

  setTimeout(() => { window.leafletEditMap.invalidateSize(); }, 200);
}