// ==========================================
// 🗺️ src/components/b2c/map.js
// ==========================================
import { getters, mutators } from '../../state.js';
import { parseTags, getColorFromTag, escapeHTML } from '../../utils/text.js';
import { 
    fetchActiveStatusesApi, fetchGhostPinsApi, reportStatusApi, 
    fetchShopAnalyticsApi, toggleLocalStatusApi, saveDiaryApi, deleteDiaryApi
} from '../../api.js';

const HOME_LAT = 43.0600; // ※必要に応じて設定値を変更してください
const HOME_LNG = 141.3500;
let viewMap = null;
let mapMarkers = [];

let isFetchingGhosts = false;
let isFetchingStatuses = false;

const HOKKAIDO_BOUNDS = L.latLngBounds([41.2000, 139.2000], [45.6000, 146.0000]);

export function initViewMap() {
    if (!viewMap) {
        viewMap = L.map('mapView', {
            maxBounds: HOKKAIDO_BOUNDS, 
            maxBoundsViscosity: 1.0, 
            minZoom: 7, 
            maxZoom: 19
        }).setView([HOME_LAT, HOME_LNG], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(viewMap);
        viewMap.on('zoomend', () => { updateViewMarkers(false); });
        viewMap.on('click', closeBottomSheet);
    }
    setTimeout(() => { viewMap.invalidateSize(); }, 200);
}

// フィルターボタンのトグル処理
export function toggleMapFilter(type) {
    mutators.toggleMapFilter(type);
    const filters = getters.getFilters();
    const btn = document.getElementById(`btn-filter-${type}`);
    if (btn) {
        if (filters[type]) {
            btn.style.background = '#5d4037';
            btn.style.color = '#fff';
        } else {
            btn.style.background = 'rgba(255, 255, 255, 0.9)';
            btn.style.color = '#5d4037';
        }
    }
    updateViewMarkers(false); 
}

// マップ上のピンを再描画する
export function updateViewMarkers(autoFit = false) {
    if (!viewMap) return;
    const currentZoom = viewMap.getZoom();
    viewMap.eachLayer((layer) => { if (layer instanceof L.Marker) viewMap.removeLayer(layer); });
    mapMarkers = [];
    
    // (中略の防護: 実際の運用時は元の map.js のマージ処理ロジックをここに完全移植します。今回はESMアーキテクチャの骨格を示します)
    const validDiaries = getters.getValidDiaries();
    const masterShops = getters.getMasterShops();
    const filters = getters.getFilters();

    // 🚨 簡略化していますが、ここに旧map.jsの「locationMap」の集計ロジックが入ります
    validDiaries.forEach(diary => {
        // ... (旧 map.js のピン生成ロジック)
        const lat = parseFloat(diary.latitude);
        const lng = parseFloat(diary.longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        const pinColor = getColorFromTag(parseTags(diary.tags)[0]);
        const customIcon = L.divIcon({ 
            html: `<div style="background-color: ${pinColor}; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">☕️</div>`, 
            className: 'custom-div-icon', iconSize: [36, 36], iconAnchor: [18, 18] 
        });

        const marker = L.marker([lat, lng], {icon: customIcon}).addTo(viewMap);
        
        marker.shopData = { shopId: diary.shop_id, shopName: diary.shop_name };
        mapMarkers.push(marker);

        // ボトムシートを開くイベント
        marker.on('click', () => {
            // HTML側のボトムシートを開く (今回はUI生成を単純化)
            const sheet = document.getElementById('shopBottomSheet');
            const content = document.getElementById('bottomSheetContent');
            content.innerHTML = `
                <div style="text-align:center;">
                    <h2 style="margin: 0 0 5px 0; color:#2c3e50; font-size: 1.4rem;">${escapeHTML(diary.shop_name)}</h2>
                    <button onclick="window.recordFromMap('${diary.shop_id || ''}', '${escapeHTML(diary.shop_name)}', ${lat}, ${lng})" style="background:#27ae60; border:none; color:white; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; margin-top:15px;">📝 このお店を記録する</button>
                    <button onclick="window.reportShopStatus('${diary.shop_id || ''}', '${escapeHTML(diary.shop_name)}')" style="background:#e74c3c; border:none; color:white; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; margin-top:10px;">🔥 今、混んでる！と報告</button>
                </div>
            `;
            sheet.classList.add('active');
        });
    });

    // 混雑ピン(Hot Status)の取得と適用
    if (!isFetchingStatuses) {
        isFetchingStatuses = true;
        fetchActiveStatusesApi().then(statuses => {
            mutators.setActiveStatuses(statuses);
            applyActiveStatuses(statuses);
        });
    } else {
        applyActiveStatuses(getters.getActiveStatuses());
    }
}

function applyActiveStatuses(statuses) {
    if (!statuses || statuses.length === 0) return;
    mapMarkers.forEach(marker => {
        if (!marker.shopData) return; 
        const isHot = statuses.some(st => (st.shop_id && st.shop_id === marker.shopData.shopId) || (!st.shop_id && st.shop_name === marker.shopData.shopName));
        if (isHot && marker.getElement()) {
            const baseDiv = marker.getElement().querySelector('div'); 
            if (baseDiv && !baseDiv.classList.contains('hot-status-pin')) {
                baseDiv.classList.add('hot-status-pin');
            }
        }
    });
}

function closeBottomSheet() {
    const sheet = document.getElementById('shopBottomSheet');
    if (sheet) sheet.classList.remove('active');
}

// ==========================================
// 🌐 ES Modulesの壁を超えるための Window アタッチ
// ==========================================
// ※HTMLの onClick から呼ばれる関数は window に明示的に生やす必要があります
window.recordFromMap = function(shopId, shopName, lat, lng) {
    closeBottomSheet();
    // app.js のタブ切り替えイベントをトリガー
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'record' } }));
    
    // フォームに値をセットするイベントをトリガー
    window.dispatchEvent(new CustomEvent('set-form-from-map', { 
        detail: { shopId, shopName, lat, lng } 
    }));
};

window.reportShopStatus = async function(shopId, shopName) {
    if (!confirm(`「${shopName}」が現在混雑していることをマップに共有しますか？`)) return;
    document.body.style.cursor = 'wait';
    const result = await reportStatusApi(shopId, shopName, 'crowded');
    document.body.style.cursor = 'default';
    if (result.success) {
        alert("🔥 混雑状況を報告しました！");
        isFetchingStatuses = false; // 再取得フラグをリセット
        closeBottomSheet();
        updateViewMarkers(false);
    } else {
        alert("エラー: " + (result.error || "通信に失敗しました"));
    }
};

window.toggleMapFilter = toggleMapFilter;