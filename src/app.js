// ==========================================
// 🚀 src/app.js (メインエントリポイント)
// ==========================================
import { getOrGenerateUserUuid } from './utils/crypto.js';
import { fetchMeApi, fetchDiariesApi, fetchMasterShopsApi, upgradeToAdminApi } from './api.js'; 
import { mutators } from './state.js';
import { initHistoryTab, refreshHistoryList } from './components/b2c/list.js';
import { initFormHandlers } from './components/b2c/form.js';
import { initViewMap, updateViewMarkers } from './components/b2c/map.js';
import { renderAnalytics } from './components/b2c/analytics.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 基本設定と認証の初期化
    resetDateToToday();
    loadSettings();
    getOrGenerateUserUuid(); 
    
    // 🌟 テスト・デバッグ用：現在のUUIDを設定画面に表示
    const uuidDisplay = document.getElementById('currentTestUuidDisplay');
    if (uuidDisplay) {
        uuidDisplay.textContent = localStorage.getItem('ezo_user_uuid') || '未設定 (自動生成されます)';
    }
    
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

    // 🌟 設定保存ボタンのイベントリスナー
    const saveSettingsBtn = document.getElementById('btnSaveSettings');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', window.saveSettings);
    }

    // 4. カスタムイベントのリスナー登録
    setupGlobalEventListeners();
});

// 🌟 UIの表示切替は index.html 側で行うため、ここではデータ更新とJSレンダリングのみを担当
function switchTabLogic(tabName) {
    // タブごとの遅延初期化
    if (tabName === 'history') refreshHistoryList();
    if (tabName === 'map') { 
        initViewMap(); 
        updateViewMarkers(true); 
    }
    if (tabName === 'analytics') renderAnalytics();
}

function loadSettings() {
    const g = localStorage.getItem('ezo_gender');
    const a = localStorage.getItem('ezo_age');
    if (g && document.getElementById('userGender')) document.getElementById('userGender').value = g;
    if (a && document.getElementById('userAge')) document.getElementById('userAge').value = a;
}

function setupGlobalEventListeners() {
    window.addEventListener('switch-tab', (e) => {
        switchTabLogic(e.detail.tab);
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

// 万が一HTML側に onclick="window.switchTab(...)" が残っていた場合のポカヨケ
window.switchTab = (tabName) => window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: tabName } }));

// 🌟 テスト用アカウント切替ロジック (統合)
window.switchTestUser = function(uuid) {
    if (uuid === 'reset') {
        if (confirm("テストモードを終了し、通常のアカウントに戻しますか？")) {
            localStorage.removeItem('ezo_user_uuid');
            alert("リセットしました。ページを再読み込みします。");
            location.reload();
        }
        return;
    }

    const roleNames = {
        'test-user-free-001': '無課金 (Free)',
        'test-user-premium-001': '課金 (Premium)',
        'test-user-business-001': '店舗側 (Business)'
    };

    if (confirm(`「${roleNames[uuid]}」アカウントに切り替えますか？`)) {
        localStorage.setItem('ezo_user_uuid', uuid);
        alert(`${roleNames[uuid]} に切り替えました！`);
        location.reload();
    }
};

window.saveSettings = function() {
    const g = document.getElementById('userGender')?.value || "";
    const a = document.getElementById('userAge')?.value || "";
    if (!g || !a || g === "未設定" || a === "未設定") { 
        alert("性別と年代を両方選択してください。"); 
        return; 
    }
    localStorage.setItem('ezo_gender', g);
    localStorage.setItem('ezo_age', a);
    alert("✨ 設定を保存しました！");
};

// 🌟 管理者権限への昇格
window.upgradeToAdmin = async function() {
    if(!confirm("あなたのアカウントを管理者(Admin)に昇格させますか？")) return;
    const res = await upgradeToAdminApi();
    if(res && res.success) {
        alert("👑 管理者に昇格しました！画面をリロードします。");
        window.location.reload();
    } else {
        alert("エラーが発生しました。");
    }
};

// 🌟 地図の画像ダウンロード機能（html2canvas）
window.downloadMapImage = function() {
    const mapContainer = document.getElementById('viewMap');
    const template = document.getElementById('map-watermark-template');
    const saveBtn = document.getElementById('btn-save-map-image');
    
    if (!mapContainer) return;

    let originalBtnText = "";
    if (saveBtn) {
        originalBtnText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = "📸 画像を生成中...";
    }

    // ウォーターマークがある場合は表示
    let watermarkClone = null;
    if (template) {
        const validShopsCount = document.getElementById('stat-unique-shops')?.innerText || "0";
        const countSpan = document.getElementById('watermark-shop-count');
        if(countSpan) countSpan.innerText = validShopsCount;

        watermarkClone = template.cloneNode(true);
        watermarkClone.style.display = 'block';
        mapContainer.appendChild(watermarkClone);
    }

    if (typeof html2canvas === 'undefined') {
        alert("画像生成ライブラリが読み込まれていません。");
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = originalBtnText; }
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
        
        if (watermarkClone) mapContainer.removeChild(watermarkClone);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = originalBtnText; }
    }).catch(err => {
        console.error("Map Image Export Error:", err);
        if (watermarkClone) mapContainer.removeChild(watermarkClone);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = originalBtnText; }
        alert("画像の生成に失敗しました。時間をおいて再度お試しください。");
    });
};