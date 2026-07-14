// ==========================================
// 🚀 src/app.js (メインエントリポイント)
// ==========================================
import { getOrGenerateUserUuid } from './utils/crypto.js';
import { fetchMeApi, fetchDiariesApi, fetchMasterShopsApi, upgradeToAdminApi } from './api.js'; // 🌟 upgradeToAdminApiを追加
import { mutators } from './state.js';
import { initHistoryTab, refreshHistoryList } from './components/b2c/list.js';
import { initFormHandlers } from './components/b2c/form.js';
import { initViewMap, updateViewMarkers } from './components/b2c/map.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 基本設定と認証の初期化
    resetDateToToday();
    loadSettings(); // 🌟 保存されている性別・年代を読み込む
    getOrGenerateUserUuid(); 
    
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

    // 4. カスタムイベントのリスナー登録
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

// 🌟 設定（性別・年代）の読み込み
function loadSettings() {
    const g = localStorage.getItem('ezo_gender');
    const a = localStorage.getItem('ezo_age');
    if (g && document.getElementById('settingGender')) document.getElementById('settingGender').value = g;
    if (a && document.getElementById('settingAge')) document.getElementById('settingAge').value = a;
}

function setupGlobalEventListeners() {
    window.addEventListener('switch-tab', (e) => {
        switchTab(e.detail.tab);
    });

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


// ==========================================
// 🌐 HTMLの onclick から呼ばれるグローバル関数の公開
// ==========================================

// タブ切り替え
window.switchTab = (tabName, element) => switchTab(tabName);

// 🌟 設定の保存（エラー修正済み）
window.saveSettings = function() {
    const g = document.getElementById('settingGender')?.value || "";
    const a = document.getElementById('settingAge')?.value || "";
    if (!g || !a) { 
        alert("性別と年代を両方選択してください。"); 
        return; 
    }
    localStorage.setItem('ezo_gender', g);
    localStorage.setItem('ezo_age', a);
    alert("✨ 設定を保存しました！");
};

// 🌟 管理者権限への昇格（復活）
window.upgradeToAdmin = async function() {
    if(!confirm("あなたのアカウントを管理者(Admin)に昇格させますか？")) return;
    const res = await upgradeToAdminApi();
    if(res.success) {
        alert("👑 管理者に昇格しました！画面をリロードします。");
        window.location.reload();
    } else {
        alert("エラーが発生しました。");
    }
};

// 🌟 地図の画像ダウンロード機能（復活）
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

    if (typeof html2canvas === 'undefined') {
        alert("画像生成ライブラリが読み込まれていません。");
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnText;
        return;
    }

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