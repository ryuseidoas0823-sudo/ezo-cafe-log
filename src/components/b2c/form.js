// ==========================================
// 📦 src/components/b2c/form.js
// ==========================================
import { saveDiaryApi, searchMasterApi } from '../../api.js';
import { refreshHistoryList } from './list.js';

let currentBase64 = null;
let editingDiaryId = null;

export function initFormHandlers() {
    const recordForm = document.getElementById('recordForm');
    if (recordForm) {
        recordForm.addEventListener('submit', handleFormSubmit);
    }
    
    // 一括アップロードのトリガー設定
    const bulkInput = document.getElementById('imageInputBulk');
    if (bulkInput) {
        bulkInput.addEventListener('change', handleBulkUpload);
    }

    // 編集イベントのグローバルリッスンを設定 (list.js からの伝播用)
    window.addEventListener('edit-diary', (e) => {
        setEditingData(e.detail.id);
    });
}

// フォームの外部操作用セッター (画像処理モジュールやマップ等から状態を受け取る用)
export const formState = {
    setCurrentBase64: (base64) => { currentBase64 = base64; },
    setEditingDiaryId: (id) => { editingDiaryId = id; }
};

/**
 * 通常日記の送信処理
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const eatType = document.querySelector('input[name="eatType"]:checked').value;
    let latVal = document.getElementById('latitude')?.value || "";
    let lngVal = document.getElementById('longitude')?.value || "";
    const shopId = document.getElementById('shopId')?.value || null;

    if (eatType !== '🎪間借り・無店舗') {
        if (latVal === "" || lngVal === "" || latVal === "null" || lngVal === "null") {
            alert("⚠️ 店舗の位置情報が設定されていません！\n新規店舗を登録する場合は、手動で位置を指定してください。");
            return; 
        }
    }

    const submitBtn = document.getElementById('submitBtn');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = "🤖 通信中...";

    const userTags = document.getElementById('tags').value;
    const combinedTags = userTags ? `${eatType}, ${userTags}` : eatType;

    let finalLat = (latVal === "" || latVal === "null" || eatType === '🎪間借り・無店舗') ? null : parseFloat(latVal);
    let finalLng = (lngVal === "" || lngVal === "null" || eatType === '🎪間借り・無店舗') ? null : parseFloat(lngVal);

    let finalStatusIcon = document.getElementById('weatherSelect').value;
    if (document.getElementById('isBookmark')?.checked) finalStatusIcon = "💭";
    if (document.getElementById('isDraft')?.checked) finalStatusIcon = "📦";

    const isPublicVal = document.getElementById('isPublicCheckbox')?.checked ? 1 : 0;

    const payload = {
        id: editingDiaryId,
        shopId: shopId,
        shopName: document.getElementById('shopName').value,
        comment: document.getElementById('comment').value,
        visitedAt: document.getElementById('visitedAt').value,
        tags: combinedTags, 
        imageBase64: currentBase64,
        lat: finalLat, lng: finalLng,
        temperature: document.getElementById('temperature')?.value || null,
        weatherIcon: finalStatusIcon,
        userGender: localStorage.getItem('ezo_gender') || "未設定",
        userAge: localStorage.getItem('ezo_age') || "未設定",
        userUuid: localStorage.getItem('ezo_user_uuid'),
        isPublic: isPublicVal 
    };

    const result = await saveDiaryApi(payload); 
    
    if (result.success) {
        document.getElementById('recordForm').reset();
        document.getElementById('imagePreview').style.display = 'none';
        if(document.getElementById('gpsStatus')) document.getElementById('gpsStatus').innerText = ""; 
        
        const dynamicForm = document.getElementById('dynamicFormFields');
        if (dynamicForm) dynamicForm.classList.remove('show');
        
        currentBase64 = null;
        editingDiaryId = null;
        document.getElementById('submitBtn').innerHTML = "🚀 記録する";
        
        alert("✨ 記録が保存されました！");
        
        // 履歴一覧を即時更新
        refreshHistoryList();
        
        // タブ切り替えイベントをトリガー（app.js側でリッスン可能にするためのカスタムイベント）
        window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'history' } }));
    } else { 
        alert("エラー: " + result.error); 
    }
    
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
}

/**
 * 写真の一括ストック（バルク保存）処理
 */
async function handleBulkUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!confirm(`${files.length}枚の写真が選択されました。\nすべて「未整理(📦)」として一括ストックしますか？`)) {
        e.target.value = ''; return;
    }

    const bulkStatusEl = document.getElementById('bulkStatus');
    e.target.disabled = true; 

    // main.js側に残る、または将来統合される画像圧縮・Exif解析処理と繋ぐための関数
    // ※今回はインテント制御の移行のため枠組みを先行構築
    alert("📦 モジュール移行完了後にバックグラウンド並列処理が最適化されます。");
    e.target.disabled = false;
}

/**
 * 編集ボタンが押された際に、フォームへ既存データをセットする処理
 */
function setEditingData(id) {
    // 状態管理から直接該当する日記を検索（グローバル変数汚染の排除）
    const { getters } = require('../../state.js'); // 動的インポート、または上部インポート
    const diaries = getters.getAllDiaries();
    const diary = diaries.find(d => d.id === id);
    if (!diary) return;

    document.getElementById('shopName').value = diary.shop_name === "未整理の写真" ? "" : (diary.shop_name || "");
    // (中略: main.js 内のフォームセット処理をそのまま移行)
    
    editingDiaryId = diary.id;
    document.getElementById('submitBtn').innerHTML = "🔄 この内容で更新する";
}