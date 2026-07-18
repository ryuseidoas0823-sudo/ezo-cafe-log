// ==========================================
// 🗺️ src/components/b2c/map.js
// ==========================================
import { getters, mutators } from '../../state.js';
import { parseTags, getColorFromTag, escapeHTML } from '../../utils/text.js';
import { fetchActiveStatusesApi, fetchGhostPinsApi, reportStatusApi, fetchShopAnalyticsApi, toggleLocalStatusApi, saveDiaryApi, deleteDiaryApi } from '../../api.js';

const HOME_LAT = 43.0600;
const HOME_LNG = 141.3500;
let viewMap = null;
let mapMarkers = [];

let isFetchingGhosts = false;
let isFetchingStatuses = false;

const HOKKAIDO_BOUNDS = L.latLngBounds([41.2000, 139.2000], [45.6000, 146.0000]);

export function initViewMap() {
    // 🌟 修正ポイント1: コンテナが存在するか確認し、なければ中断（エラー回避）
    const container = document.getElementById('viewMap');
    if (!container) return;

    if (!viewMap) {
        // 🌟 修正ポイント2: 'mapView' を 'viewMap' に変更
        viewMap = L.map('viewMap', {
            maxBounds: HOKKAIDO_BOUNDS, maxBoundsViscosity: 1.0, minZoom: 7, maxZoom: 19
        }).setView([HOME_LAT, HOME_LNG], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true }).addTo(viewMap);
        viewMap.on('zoomend', () => { updateViewMarkers(false); });
        viewMap.on('click', closeBottomSheet);
    }
    
    // 🌟 修正ポイント3: タブ表示後、地図のサイズを正確に再計算させる（少し長めの300ms）
    setTimeout(() => { 
        if (viewMap) {
            viewMap.invalidateSize(); 
        }
    }, 300);
}

export function toggleMapFilter(type) {
    mutators.toggleMapFilter(type);
    const filters = getters.getFilters();
    const btn = document.getElementById(`btn-filter-${type}`);
    if (btn) {
        if (filters[type]) { btn.style.background = '#5d4037'; btn.style.color = '#fff'; } 
        else { btn.style.background = 'rgba(255, 255, 255, 0.9)'; btn.style.color = '#5d4037'; }
    }
    updateViewMarkers(false); 
}

export function updateViewMarkers(autoFit = false) {
    if (!viewMap) return;
    const currentZoom = viewMap.getZoom();
    viewMap.eachLayer((layer) => { if (layer instanceof L.Marker) viewMap.removeLayer(layer); });
    
    const bounds = L.latLngBounds(); 
    const locationMap = {};
    let totalValidVisits = 0; 
    mapMarkers = []; 
    
    const masterShops = getters.getMasterShops() || [];
    masterShops.forEach(shop => {
        const lat = parseFloat(shop.latitude); const lng = parseFloat(shop.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
            const locKey = `${lat}_${lng}`;
            if (!locationMap[locKey]) locationMap[locKey] = { lat: lat, lng: lng, shops: {} };
            locationMap[locKey].shops[shop.shop_id] = {
                shopId: shop.shop_id, shopName: shop.shop_name, isMasterOnly: true, mainTag: "", visitCount: 0, 
                isBookmarkOnly: false, isDraftOnly: false, isClosed: false, isGracePeriod: false, closedDiaryId: null, 
                lastVisited: 0, latestDiaryId: null, hasDining: false, hasTakeout: false, hasGoods: false, hasEvent: false, 
                allTagsSet: new Set(), isLocal: shop.is_local !== undefined ? shop.is_local : 1
            };
        }
    });
    
    const validDiaries = getters.getAllDiaries();
    const chronologicalDiaries = [...validDiaries].sort((a, b) => {
        const timeA = new Date((a.visited_at || "1970-01-01").replace(/-/g, '/')).getTime();
        const timeB = new Date((b.visited_at || "1970-01-01").replace(/-/g, '/')).getTime();
        return timeA - timeB; 
    });
    
    chronologicalDiaries.forEach(diary => {
        const lat = parseFloat(diary.latitude); const lng = parseFloat(diary.longitude);
        if (!isNaN(lat) && !isNaN(lng)) {
            const locKey = `${lat}_${lng}`;
            if (!locationMap[locKey]) locationMap[locKey] = { lat: lat, lng: lng, shops: {} };

            const s = diary.shop_name; 
            const isBookmark = diary.weather_icon === "💭";
            const isDraft = diary.weather_icon === "📦";
            const isClosedReport = diary.weather_icon === "🚫"; 
            let uniqueKey = isDraft ? `draft_${diary.id}` : (diary.shop_id || s);

            if (!locationMap[locKey].shops[uniqueKey]) {
                locationMap[locKey].shops[uniqueKey] = { 
                    shopId: diary.shop_id || null, shopName: isDraft ? '📦 未整理の写真' : s, isMasterOnly: false, mainTag: "", 
                    visitCount: 0, isBookmarkOnly: false, isDraftOnly: isDraft, isClosed: false, isGracePeriod: false, closedDiaryId: null, 
                    lastVisited: 0, latestDiaryId: null, hasDining: false, hasTakeout: false, hasGoods: false, hasEvent: false, allTagsSet: new Set(), isLocal: 1
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
                shop.lastVisited = visitTime; shop.latestDiaryId = diary.id;
            }
            
            if (allTags.includes('☕️店内')) shop.hasDining = true;
            if (allTags.includes('🥡テイクアウト')) shop.hasTakeout = true;
            if (allTags.includes('🛍️豆・グッズ')) shop.hasGoods = true;
            if (allTags.includes('🎪間借り・無店舗')) shop.hasEvent = true; 

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

    const filters = getters.getFilters();
    const selectedMoodTag = document.getElementById('mapTagFilter') ? document.getElementById('mapTagFilter').value : "";

    Object.values(locationMap).forEach(loc => {
        const mergedShops = {};
        Object.values(loc.shops).forEach(s => {
            const normName = (s.shopName || "").trim().toLowerCase();
            if (!mergedShops[normName]) { mergedShops[normName] = { ...s, allTagsSet: new Set(s.allTagsSet) }; } 
            else {
                const existing = mergedShops[normName];
                existing.visitCount += s.visitCount;
                if (s.lastVisited >= existing.lastVisited) { existing.lastVisited = s.lastVisited; if (s.latestDiaryId) existing.latestDiaryId = s.latestDiaryId; }
                if (s.hasDining) existing.hasDining = true; if (s.hasTakeout) existing.hasTakeout = true; if (s.hasGoods) existing.hasGoods = true; if (s.hasEvent) existing.hasEvent = true; 
                s.allTagsSet.forEach(t => existing.allTagsSet.add(t));
                if (!existing.shopId && s.shopId) existing.shopId = s.shopId;
                existing.isClosed = existing.isClosed || s.isClosed; existing.isGracePeriod = existing.isGracePeriod || s.isGracePeriod;
                if (s.mainTag && !existing.mainTag) existing.mainTag = s.mainTag;
                existing.isMasterOnly = existing.isMasterOnly && s.isMasterOnly; existing.isBookmarkOnly = existing.isBookmarkOnly && s.isBookmarkOnly;
            }
        });

        let shopList = Object.values(mergedShops).sort((a, b) => {
            const scoreA = a.isClosed ? 2 : (a.isGracePeriod ? 1 : 0);
            const scoreB = b.isClosed ? 2 : (b.isGracePeriod ? 1 : 0);
            if (scoreA !== scoreB) return scoreA - scoreB; 
            return b.lastVisited - a.lastVisited; 
        });

        if (shopList.length === 0) return;
        if (filters.dining)  shopList = shopList.filter(s => s.hasDining);
        if (filters.takeout) shopList = shopList.filter(s => s.hasTakeout);
        if (filters.goods)   shopList = shopList.filter(s => s.hasGoods);
        
        if (selectedMoodTag !== "") { shopList = shopList.filter(s => !s.isMasterOnly && s.allTagsSet && s.allTagsSet.has(selectedMoodTag)); }
        if (shopList.length === 0) return;

        const mainShop = shopList[0];
        const locTotalVisits = shopList.reduce((sum, s) => sum + s.visitCount, 0);

        let customIcon; let opacity = 1.0;
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
                scale = 1.0 + (Math.round(percentage / 10) * 10 / 100);
            }
            const scaledSize = Math.round(36 * scale);
            const anchorSize = Math.round(scaledSize / 2);
            const badgeHtml = locTotalVisits > 0 ? `<div style="position:absolute; bottom:-2px; right:-2px; background:#e74c3c; color:white; border-radius:50%; width:20px; height:20px; font-size:11px; font-weight:bold; line-height:20px; text-align:center; box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index:10;">${locTotalVisits}</div>` : '';
            
            customIcon = L.divIcon({ html: `<div style="background-color: ${bgColor}; width: ${scaledSize}px; height: ${scaledSize}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: ${Math.round(18 * scale)}px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); position: relative; transition: all 0.3s ease;">${emoji}${badgeHtml}</div>`, className: 'custom-div-icon', iconSize: [scaledSize, scaledSize], iconAnchor: [anchorSize, anchorSize] });
        }
        
        const marker = L.marker([loc.lat, loc.lng], {icon: customIcon, opacity: opacity}).addTo(viewMap);
        marker.shopData = mainShop;
        mapMarkers.push(marker);
        
        marker.on('click', () => { openShopBottomSheet(mainShop, shopList, loc, locTotalVisits); });
        
        if (!mainShop.isMasterOnly && !mainShop.isGracePeriod && !mainShop.isClosed) {
            marker.bindTooltip(escapeHTML(mainShop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
        }
        bounds.extend([loc.lat, loc.lng]);
    });

    if (autoFit && Object.keys(locationMap).length > 0) {
        viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    }

    // 混雑ステータスの適用
    if (!isFetchingStatuses) {
        isFetchingStatuses = true;
        fetchActiveStatusesApi().then(statuses => {
            mutators.setActiveStatuses(statuses);
            applyActiveStatuses(statuses);
        });
    } else if (getters.getActiveStatuses().length > 0) {
        setTimeout(() => applyActiveStatuses(getters.getActiveStatuses()), 100);
    }
}

function applyActiveStatuses(statuses) {
    if (!statuses || statuses.length === 0) return;
    mapMarkers.forEach(marker => {
        if (!marker.shopData) return; 
        const isHot = statuses.some(st => (st.shop_id && st.shop_id === marker.shopData.shopId) || (!st.shop_id && st.shop_name === marker.shopData.shopName));
        if (isHot) {
            const iconEl = marker.getElement();
            if (iconEl) {
                const baseDiv = iconEl.querySelector('div'); 
                if (baseDiv && !baseDiv.classList.contains('hot-status-pin')) {
                    baseDiv.classList.add('hot-status-pin');
                    const badge = document.createElement('div');
                    badge.className = 'hot-badge'; badge.innerText = '🔥';
                    baseDiv.appendChild(badge);
                }
            }
        }
    });
}

function closeBottomSheet() {
    const sheet = document.getElementById('shopBottomSheet');
    if (sheet) sheet.classList.remove('active');
}

function openShopBottomSheet(mainShop, shopList, loc, locTotalVisits) {
    const sheet = document.getElementById('shopBottomSheet');
    const content = document.getElementById('bottomSheetContent');
    const currentUser = getters.getCurrentUser();
    
    let html = `<div style="text-align:center;">`;
    html += `<h2 style="margin: 0 0 5px 0; color:#2c3e50; font-size: 1.4rem;">${escapeHTML(mainShop.shopName)}</h2>`;
    
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
            actionBtn += `<button onclick="window.recordFromMap('${mainShop.shopId || ''}', '${escapeHTML(mainShop.shopName)}', ${loc.lat}, ${loc.lng})" style="background:#27ae60; border:none; color:white; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">📝 このお店を開拓・記録する</button>`;
        }
        
        if (!mainShop.isDraftOnly && !mainShop.isBookmarkOnly) {
            actionBtn += `
            <div style="margin-top:5px; background: rgba(231, 76, 60, 0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(231, 76, 60, 0.2); text-align: center;">
                <button onclick="window.reportShopStatus('${mainShop.shopId || ''}', '${escapeHTML(mainShop.shopName)}')" style="background:#e74c3c; border:none; color:white; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; box-shadow: 0 2px 4px rgba(231, 76, 60, 0.3);">🔥 今、混んでる！と報告する</button>
            </div>`;
        }
    }

    if (!mainShop.isClosed) {
        let closeBtnColor = mainShop.isGracePeriod ? "#e74c3c" : "#95a5a6";
        let closeBtnText = mainShop.isGracePeriod ? "🚨 閉店報告を取り消す" : "🚫 閉店・移転を報告する";
        let closeAction = mainShop.isGracePeriod ? `window.cancelCloseReport(${mainShop.closedDiaryId})` : `window.reportClosed('${mainShop.shopId || mainShop.shopName}', '${escapeHTML(mainShop.shopName)}', ${loc.lat}, ${loc.lng})`;
        actionBtn += `<a href="#" onclick="${closeAction}; return false;" style="color:${closeBtnColor}; font-size:0.85rem; text-decoration:none; text-align:center; margin-top:5px;">${closeBtnText}</a>`;
    }
    actionBtn += `</div>`;

    html += `<p style="margin: 10px 0; font-weight:bold; color:#34495e;">${statusText}</p>`;
    
    let analyticsHtml = "";
    const allDiaries = getters.getAllDiaries();
    const shopDiaries = allDiaries.filter(d =>
        ((mainShop.shopId && d.shop_id === mainShop.shopId) || (!mainShop.shopId && d.shop_name === mainShop.shopName))
        && d.weather_icon !== "💭" && d.weather_icon !== "📦" && d.weather_icon !== "🚫"
    );

    if (shopDiaries.length > 0) {
        const tagsCount = {};
        shopDiaries.forEach(d => {
            parseTags(d.tags).forEach(t => {
                if (!t.startsWith("🤖") && !t.startsWith("🚨") && t !== "☕️店内" && t !== "🥡テイクアウト" && t !== "🛍️豆・グッズ" && t !== "🎪間借り・無店舗") {
                    tagsCount[t] = (tagsCount[t] || 0) + 1;
                }
            });
        });
        const topTags = Object.entries(tagsCount).sort((a,b) => b[1] - a[1]).slice(0, 5); 

        analyticsHtml += `<details style="margin-top: 15px; background: rgba(255, 255, 255, 0.7); padding: 12px 15px; border-radius: 12px; border: 1px solid rgba(0,0,0,0.05); text-align: left;"><summary style="font-size: 0.95rem; color: #2c3e50; font-weight: bold; outline: none; cursor:pointer;">📊 あなたの訪問傾向</summary><div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed rgba(0,0,0,0.1);">`;
        if (topTags.length > 0) {
            analyticsHtml += `<div style="display: flex; flex-wrap: wrap; gap: 6px;">`;
            topTags.forEach(tag => {
                analyticsHtml += `<span style="background: ${getColorFromTag(tag[0])}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold;">#${escapeHTML(tag[0])} <span style="opacity: 0.8; font-size: 0.65rem;">x${tag[1]}</span></span>`;
            });
            analyticsHtml += `</div>`;
        } else {
            analyticsHtml += `<p style="margin: 0; font-size: 0.8rem; color: #bdc3c7;">タグの記録はまだありません</p>`;
        }
        analyticsHtml += `</div></details>`;
    }

    html += analyticsHtml;

    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'business')) {
        const safeShopId = mainShop.shopId ? `'${mainShop.shopId}'` : 'null';
        const safeShopName = `'${mainShop.shopName.replace(/'/g, "\\'")}'`;
        const containerId = mainShop.shopId ? mainShop.shopId.replace(/\W/g, '') : 'manual';
        
        html += `<div style="margin-top:20px; padding: 15px; background: rgba(41, 128, 185, 0.05); border-radius: 12px; border: 1px solid rgba(41, 128, 185, 0.2); text-align: left;">
            <p style="margin:0 0 10px 0; font-size:0.85rem; color:#2980b9; font-weight:bold;">🏢 店舗全体アナリティクス (B2B)</p>
            <div id="b2b-analytics-container-${containerId}">
                <button onclick="window.loadShopAnalytics(this, ${safeShopId}, ${safeShopName})" style="background: #2980b9; width:100%; border:none; color:white; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer; font-size: 0.85rem;">📊 顧客データと客層を集計する</button>
            </div>
        </div>`;
    }

    html += actionBtn;
    html += `</div>`;
    
    content.innerHTML = html;
    sheet.classList.add('active');
}

// ==========================================
// 🌐 window へのグローバル関数の公開
// ==========================================
window.recordFromMap = function(shopId, shopName, lat, lng) {
    closeBottomSheet();
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'record' } }));
    window.dispatchEvent(new CustomEvent('set-form-from-map', { detail: { shopId, shopName, lat, lng } }));
};

window.reportShopStatus = async function(shopId, shopName) {
    if (!confirm(`「${shopName}」が現在混雑していることを共有しますか？`)) return;
    document.body.style.cursor = 'wait';
    const result = await reportStatusApi(shopId, shopName, 'crowded');
    document.body.style.cursor = 'default';
    if (result.success) {
        alert("🔥 混雑状況を報告しました！");
        isFetchingStatuses = false; 
        closeBottomSheet(); updateViewMarkers(false);
    } else { alert("エラー: " + (result.error || "通信に失敗しました")); }
};

window.loadShopAnalytics = async function(btnElement, shopId, shopName) {
    btnElement.innerHTML = "⏳ データを集計中..."; btnElement.disabled = true;
    const data = await fetchShopAnalyticsApi(shopId, shopName);
    if (!data || data.total === 0) { btnElement.innerHTML = "❌ データがありません"; return; }

    let html = `<div style="animation: fadeIn 0.4s ease;"><p style="font-size:0.8rem; color:#7f8c8d; margin: 0 0 10px 0; font-weight: bold;">👥 累計来店記録: ${data.total}件</p>`;
    html += `<p style="font-size:0.75rem; margin:0 0 6px 0; color:#2c3e50; font-weight:bold;">客観的イメージ（AI抽出タグ）</p><div style="display: flex; flex-wrap: wrap; gap: 6px;">`;
    data.topTags.forEach(t => {
        let bgColor = t[0].startsWith('🚨') ? '#e74c3c' : (t[0].startsWith('🤖') ? '#8e44ad' : '#f39c12');
        html += `<span style="background: ${bgColor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold;">${escapeHTML(t[0].replace(/🤖[☕️🍰🛋️]/, '🤖 '))} <span style="opacity:0.8; font-size:0.65rem;">x${t[1]}</span></span>`;
    });
    html += `</div></div>`;
    btnElement.parentElement.innerHTML = html;
};

window.reportClosed = async function(shopId, shopName, lat, lng) {
    if (!confirm(`「${shopName}」を閉店・移転として報告しますか？`)) return;
    document.body.style.cursor = 'wait'; 
    await saveDiaryApi({ shopId: shopId, shopName: shopName, weatherIcon: "🚫", userUuid: localStorage.getItem('ezo_user_uuid') });
    closeBottomSheet(); document.body.style.cursor = 'default';
    alert("閉店・移転を報告しました。");
};

window.cancelCloseReport = async function(diaryId) {
    if (!confirm(`この閉店報告を取り消しますか？`)) return;
    document.body.style.cursor = 'wait';
    await deleteDiaryApi(diaryId); 
    closeBottomSheet(); document.body.style.cursor = 'default';
};

window.toggleMapFilter = toggleMapFilter;