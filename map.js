// ==========================================
// 🗺️ map.js (地図関係の処理まとめ)
// ==========================================
const HOME_LAT = 43.0600;
const HOME_LNG = 141.3500;
let viewMap = null;
let mapMarkers = []; 

let activeMapFilters = { dining: false, takeout: false, goods: false };
// 北海道内にパン（スクロール）を制限
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
    
    // 🎯 無限ループ防止: ズーム操作時は「自動フィット(autoFit)」を false にして呼ぶ
    viewMap.on('zoomend', () => { updateViewMarkers(globalDiaries, false); });
  }
  // DOMのレンダリング遅延に対応してマップサイズを再計算
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
    // 🎯 フィルター操作時もズーム位置はキープする (autoFit = false)
    updateViewMarkers(globalDiaries, false); 
}

function flyToShop(lat, lng) {
  if (viewMap) {
    viewMap.flyTo([lat, lng], 17, { duration: 1.5 });
    setTimeout(() => {
      const targetMarker = mapMarkers.find(m => m.getLatLng().lat === lat && m.getLatLng().lng === lng);
      // ポップアップではなくクリックイベントを発火させてボトムシートを開く
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
        // コントロール系のUI要素を画像出力から除外
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

// 🎯 無限ループ防止: autoFit 引数を追加（デフォルトは false）
function updateViewMarkers(filteredDiaries = globalDiaries, autoFit = false) {
  if (!viewMap) return;
  const currentZoom = viewMap.getZoom();
  
  // 既存のマーカーをクリア
  viewMap.eachLayer((layer) => { if (layer instanceof L.Marker) viewMap.removeLayer(layer); });
  
  const bounds = L.latLngBounds(); 
  const locationMap = {};
  let totalValidVisits = 0; 
  mapMarkers = []; 
  
  // 1️⃣ ベースレイヤー: 店舗マスタデータをすべて読み込む
  if (typeof globalMasterShops !== 'undefined') {
    globalMasterShops.forEach(shop => {
      const locKey = `${shop.latitude}_${shop.longitude}`;
      if (!locationMap[locKey]) locationMap[locKey] = { lat: shop.latitude, lng: shop.longitude, shops: {} };
      locationMap[locKey].shops[shop.shop_id] = {
        shopId: shop.shop_id, shopName: shop.shop_name,
        isMasterOnly: true, mainTag: "", visitCount: 0, isBookmarkOnly: false, isDraftOnly: false,
        isClosed: false, isGracePeriod: false, closedDiaryId: null, lastVisited: 0,
        hasDining: false, hasTakeout: false, hasGoods: false,
        allTagsSet: new Set(),
        isLocal: shop.is_local !== undefined ? shop.is_local : 1 // 👑 🆕 追加: ローカルフラグ
      };
    });
  }
  
  // 過去の日記を時系列順にソート
  const chronologicalDiaries = [...filteredDiaries].sort((a, b) => {
      const timeA = new Date((a.visited_at || "1970-01-01").replace(/-/g, '/')).getTime();
      const timeB = new Date((b.visited_at || "1970-01-01").replace(/-/g, '/')).getTime();
      return timeA - timeB; 
  });
  
  // 2️⃣ 重ね塗り: ユーザーの日記から「最新の店舗状態」を抽出・精製
  chronologicalDiaries.forEach(diary => {
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
          isMasterOnly: false, mainTag: "", visitCount: 0, isBookmarkOnly: false, isDraftOnly: isDraft,
          isClosed: false, isGracePeriod: false, closedDiaryId: null, lastVisited: 0,
          hasDining: false, hasTakeout: false, hasGoods: false,
          allTagsSet: new Set(),
          isLocal: 1 // 手動追加時は基本ローカル扱い
        };
        if (!isBookmark && !isDraft && !isClosedReport) totalValidVisits++;
      }

      let shop = locationMap[locKey].shops[uniqueKey];
      const allTags = parseTags(diary.tags);

      // 🆕 過去の訪問で付与されたタグをすべて蓄積する！
      allTags.forEach(t => shop.allTagsSet.add(t));

      // 🚨 閉店フラグの処理
      if (isClosedReport) {
        if (!shop.isClosed && !shop.isGracePeriod) {
          const reportDateStr = diary.created_at || diary.visited_at || "";
          const reportDate = reportDateStr ? new Date(reportDateStr.replace(/-/g, '/')) : new Date();
          const diffDays = (new Date() - reportDate) / (1000 * 60 * 60 * 24);
          // 報告から14日経過で完全な「思い出の地」へ昇華
          if (diffDays > 14) shop.isClosed = true; 
          else { shop.isGracePeriod = true; shop.closedDiaryId = diary.id; }
        }
        return; 
      }

      if (shop.isClosed) return;
      shop.isMasterOnly = false;
      if (!isDraft) shop.shopName = s; 
      
      const visitTime = new Date((diary.visited_at || "").replace(/-/g, '/')).getTime();
      if (visitTime > shop.lastVisited) shop.lastVisited = visitTime;
      
      if (allTags.includes('☕️店内')) shop.hasDining = true;
      if (allTags.includes('🥡テイクアウト')) shop.hasTakeout = true;
      if (allTags.includes('🛍️豆・グッズ')) shop.hasGoods = true;

      // 動的属性更新: AIが自動検知した「廃止・終了」情報を適用
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
          const aiOrManualTag = allTags.find(t => !t.startsWith('🚨') && !t.includes('🥡') && !t.includes('☕️店内') && !t.includes('🛍️'));
          shop.mainTag = aiOrManualTag || "";
      }
    }
  });

  // 🆕 セレクトボックスで選ばれている気分タグを取得
  const selectedMoodTag = document.getElementById('mapTagFilter') ? document.getElementById('mapTagFilter').value : "";

  // 3️⃣ 描画処理: フィルターの条件に合致するものだけをマップにプロット
  Object.values(locationMap).forEach(loc => {
    let shopList = Object.values(loc.shops).sort((a, b) => {
        const scoreA = a.isClosed ? 2 : (a.isGracePeriod ? 1 : 0);
        const scoreB = b.isClosed ? 2 : (b.isGracePeriod ? 1 : 0);
        if (scoreA !== scoreB) return scoreA - scoreB; 
        return b.lastVisited - a.lastVisited; 
    });

    if (shopList.length === 0) return;

    // 🧠 フィルター絞り込み判定（AND検索）
    if (activeMapFilters.dining)  shopList = shopList.filter(s => s.hasDining);
    if (activeMapFilters.takeout) shopList = shopList.filter(s => s.hasTakeout);
    if (activeMapFilters.goods)   shopList = shopList.filter(s => s.hasGoods);
    
    // 🆕 気分・目的タグによる絞り込み（マスタのみの未開拓店舗は属性がないため弾く）
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
      // 💡 LOD（Level of Detail）対応: 広域表示時は軽量化のため描画をスキップ
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
    
    // ==========================================
    // 🆕 ボトムシート連動: ピンがクリックされたらボトムシートを開く
    // ==========================================
    marker.on('click', () => {
        openShopBottomSheet(mainShop, shopList, loc, locTotalVisits);
    });
    
    // ツールチップ（ホバー時の店名表示）は維持
    if (!mainShop.isMasterOnly && !mainShop.isGracePeriod && !mainShop.isClosed) {
        marker.bindTooltip(escapeHTML(mainShop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
    }
    bounds.extend([loc.lat, loc.lng]);
  });

  // 🎯 autoFit が true の時（タブを開いた瞬間など）だけ、自動ズームを実行する！
  if (autoFit && Object.keys(locationMap).length > 0) {
      viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }

  // 🆕 地図の余白をタップした時にボトムシートを閉じる処理
  if (!viewMap.hasSheetCloseEvent) {
      viewMap.on('click', () => { closeBottomSheet(); });
      viewMap.hasSheetCloseEvent = true;
  }
}

// ==========================================
// 🆕 ボトムシートの制御関数
// ==========================================

function closeBottomSheet() {
    const sheet = document.getElementById('shopBottomSheet');
    if (sheet) sheet.classList.remove('active');
}

function openShopBottomSheet(mainShop, shopList, loc, locTotalVisits) {
    const sheet = document.getElementById('shopBottomSheet');
    const content = document.getElementById('bottomSheetContent');
    
    // ここからボトムシート内に表示するHTML（器）を組み立てる
    let html = `<div style="text-align:center;">`;
    html += `<h2 style="margin: 0 0 5px 0; color:#2c3e50; font-size: 1.4rem;">${escapeHTML(mainShop.shopName)}</h2>`;
    
    let servicesHtml = '<div style="margin: 8px 0 15px 0; font-size: 0.9rem; color: #7f8c8d;">✨ 対応: ';
    if (mainShop.hasDining) servicesHtml += '☕️店内 ';
    if (mainShop.hasTakeout) servicesHtml += '🥡テイクアウト ';
    if (mainShop.hasGoods) servicesHtml += '🛍️豆・グッズ ';
    if (!mainShop.hasDining && !mainShop.hasTakeout && !mainShop.hasGoods) servicesHtml += '🏳️ 未確認';
    servicesHtml += '</div>';
    html += servicesHtml;

    // 歴代店舗の表示
    if (shopList.length > 1) {
        html += `<div style="margin: 10px 0; padding: 12px; background: rgba(244,244,249,0.7); border-radius: 12px; font-size: 0.85rem; text-align: left;">`;
        html += `<p style="margin: 0 0 8px 0; font-weight: bold; color: #7f8c8d;">🏢 歴代・併設の店舗</p>`;
        shopList.forEach(s => {
            let badge = s.isClosed ? '<span style="color:#a67c52;">[🎞️思い出]</span>' : (s.isGracePeriod ? '<span style="color:#f39c12;">[👻休業中]</span>' : '<span style="color:#27ae60;">[☕️現存]</span>');
            html += `<div style="margin-bottom: 6px;">${badge} ${escapeHTML(s.shopName)}</div>`;
        });
        html += `</div>`;
    }

    // ステータス表示
    let statusText = ''; let actionBtn = '';
    if (mainShop.isClosed) { statusText = '<span style="color:#a67c52; font-size:1.1rem;">🎞️ 記憶に残る思い出の地</span>'; }
    else if (mainShop.isGracePeriod) {
        statusText = '<span style="color:#e74c3c;">🚨 閉店・移転の報告あり</span>';
        actionBtn = `<div style="margin-top:15px;"><button onclick="cancelCloseReport(${mainShop.closedDiaryId})" style="background:#e74c3c; width:100%; border:none; color:white; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">誤報を取り消す</button></div>`;
    } else {
        if (mainShop.isMasterOnly) statusText = '🏳️ 未開拓（マスタ店舗）';
        else if (locTotalVisits > 0) statusText = `👣 累計訪問回数: ${locTotalVisits}回`;
        else if (mainShop.isDraftOnly) statusText = '📦 未整理の写真';
        else statusText = '💭 行きたいお店に登録中';
        
        actionBtn = `<div style="margin-top:15px; border-top:1px solid rgba(0,0,0,0.1); padding-top:15px;"><a href="#" onclick="reportClosed('${mainShop.shopId || mainShop.shopName}', '${escapeHTML(mainShop.shopName)}', ${loc.lat}, ${loc.lng}); return false;" style="color:#95a5a6; font-size:0.85rem; text-decoration:none;">🚫 閉店を報告する</a></div>`;
    }
    html += `<p style="margin: 10px 0; font-weight:bold; color:#34495e;">${statusText}</p>`;
    
    // 【次フェーズ用】ここにアナリティクス用のプレースホルダーを準備
    html += `<div id="shopAnalyticsContainer" style="margin-top: 15px; text-align: left;">
                </div>`;

    html += actionBtn;

    // 👑 管理者(Admin)用バックドアUI
    if (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin' && mainShop.shopId && mainShop.shopId.startsWith('node/')) {
        const currentIsLocal = mainShop.isLocal !== 0; 
        const toggleVal = currentIsLocal ? 0 : 1;
        const toggleText = currentIsLocal ? '🚫 チェーン非表示化' : '✅ ローカル復活';
        const toggleColor = currentIsLocal ? '#e74c3c' : '#27ae60';
        
        html += `<div style="margin-top:20px; padding: 15px; background: rgba(252,236,235,0.8); border-radius: 12px; border: 1px solid #f5b7b1;">
            <p style="margin:0 0 10px 0; font-size:0.85rem; color:#c0392b; font-weight:bold;">👑 管理者メニュー</p>
            <button onclick="toggleLocalStatus('${mainShop.shopId}', ${toggleVal})" style="background:${toggleColor}; width:100%; border:none; color:white; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">${toggleText}</button>
        </div>`;
    }

    html += `</div>`;
    
    // DOM更新とシートのスライドアップアニメーション実行
    content.innerHTML = html;
    sheet.classList.add('active');
}

// ==========================================
// 👑 管理者バックドア：店舗のローカル/チェーン状態を切り替える
// ==========================================
window.toggleLocalStatus = async function(shopId, isLocal) {
    if (!confirm(`この店舗を「${isLocal === 1 ? 'ローカル店として表示' : 'チェーン店として非表示'}」に変更しますか？\n(一般ユーザーのマップから消去されます)`)) return;
    
    document.body.style.cursor = 'wait';
    const result = await toggleLocalStatusApi(shopId, isLocal);
    
    if (result.success) {
        // マスタデータを再取得してマップを再描画
        await fetchMasterShopsApi(); 
        updateViewMarkers(globalDiaries, false); 
        closeBottomSheet(); // 切り替え後にシートを閉じる
    } else {
        alert("エラー: " + result.error);
    }
    document.body.style.cursor = 'default';
};