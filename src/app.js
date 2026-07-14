// ==========================================
// 🚀 src/app.js (メインエントリポイント)
// ==========================================
import { getOrGenerateUserUuid } from './utils/crypto.js';
import { fetchMeApi, fetchDiariesApi, fetchMasterShopsApi } from './api.js';
import { mutators } from './state.js';
import { initHistoryTab, refreshHistoryList } from './components/b2c/list.js';
import { initFormHandlers } from './components/b2c/form.js';
import { initViewMap, updateViewMarkers } from './components/b2c/map.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 基本設定と認証の初期化
    resetDateToToday();
    getOrGenerateUserUuid(); // UUIDの確保
    
    // 2. ユーザー情報と初期データの並列取得
    const currentUser = await fetchMeApi();
    mutators.setCurrentUser(currentUser);
    
    const [diaries, masterShops] = await Promise.all([
        fetchDiariesApi(),
        fetchMasterShopsApi()
    ]);
    
    mutators.setDiaries(diaries);
    mutators.setMasterShops(masterShops);

    // 3. UIコンポーネントの初期化
    initFormHandlers();
    initHistoryTab();

    // 4. カスタムイベントのリスナー登録（コンポーネント間の疎結合な連携）
    setupGlobalEventListeners();
});

// タブ切り替えロジック
function switchTab(tabName) {
    const tabs = ['record', 'history', 'map', 'analytics', 'settings'];
    tabs.forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        if(el) el.classList.add('hidden');
    });

    document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');
    
    // ナビゲーションのハイライト変更
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
    if(activeNav) activeNav.classList.add('active');

    // タブごとの遅延初期化
    if (tabName === 'history') refreshHistoryList();
    if (tabName === 'map') { 
        initViewMap(); 
        updateViewMarkers(true); 
    }
}

// グローバルイベントの設定（他のモジュールから発火されたイベントを受け取る）
function setupGlobalEventListeners() {
    // コンポーネントからのタブ切り替え要求を受け取る
    window.addEventListener('switch-tab', (e) => {
        switchTab(e.detail.tab);
    });

    // マップからフォームへの値セット要求を受け取る
    window.addEventListener('set-form-from-map', (e) => {
        const { shopId, shopName, lat, lng } = e.detail;
        document.getElementById('recordForm').reset();
        document.getElementById('shopId').value = shopId || "";
        document.getElementById('shopName').value = shopName || "";
        document.getElementById('latitude').value = lat || "";
        document.getElementById('longitude').value = lng || "";
        document.getElementById('locationSource').value = 'master';
        resetDateToToday();
    });
}

function resetDateToToday() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateInput = document.getElementById('visitedAt');
    if(dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;
}

// HTMLのボトムナビゲーションの onclick から呼ばれるため window にアタッチ
window.switchTab = (tabName, element) => switchTab(tabName);