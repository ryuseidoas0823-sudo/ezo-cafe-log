// ==========================================
// 📦 src/components/b2c/form.js
// ==========================================
import { saveDiaryApi } from '../../api.js';
import { refreshHistoryList } from './list.js';
import { getters } from '../../state.js';           // 🌟 追加: stateを静的インポート
import { parseTags } from '../../utils/text.js';    // 🌟 追加: タグパース用関数

let currentBase64 = null;
let editingDiaryId = null;

export function initFormHandlers() {
    const recordForm = document.getElementById('recordForm');
    if (recordForm) {
        recordForm.addEventListener('submit', handleFormSubmit);
    }
    
    const bulkInput = document.getElementById('imageInputBulk');
    if (bulkInput) {
        bulkInput.addEventListener('change', handleBulkUpload);
    }

    // 🌟 list.js からの編集イベントを受け取り、フォームへ値をセットする
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
        
        refreshHistoryList();
        
        // 記録成功後に自動で履歴タブへ遷移させる
        window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'history' } }));
    } else { 
        alert("エラー: " + result.error); 
    }
    
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
}

/**
 * 写真の一括ストック処理
 */
async function handleBulkUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!confirm(`${files.length}枚の写真が選択されました。\nすべて「未整理(📦)」として一括ストックしますか？`)) {
        e.target.value = ''; return;
    }

    const bulkStatusEl = document.getElementById('bulkStatus');
    e.target.disabled = true; 
    alert("📦 モジュール移行完了後にバックグラウンド並列処理が最適化されます。");
    e.target.disabled = false;
}

/**
 * 🌟 編集ボタンが押された際に、フォームへ既存データをセットする処理
 * （旧 main.js の editDiary の中身を完全移植）
 */
function setEditingData(id) {
    const diaries = getters.getAllDiaries();
    const diary = diaries.find(d => d.id === id);
    if (!diary) return;

    // 1. 記録タブへ画面を切り替える
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'record' } }));
    
    // 2. フォームへ値をセット
    document.getElementById('shopName').value = diary.shop_name === "未整理の写真" ? "" : (diary.shop_name || "");
    if (document.getElementById('shopId')) document.getElementById('shopId').value = diary.shop_id || "";
    document.getElementById('visitedAt').value = diary.visited_at ? diary.visited_at.split(' ')[0] : "";
    document.getElementById('comment').value = diary.comment || "";
    
    if (document.getElementById('isBookmark')) document.getElementById('isBookmark').checked = (diary.weather_icon === "💭");
    if (document.getElementById('isDraft')) document.getElementById('isDraft').checked = false; 

    if (document.getElementById('isPublicCheckbox')) {
        document.getElementById('isPublicCheckbox').checked = (diary.is_public === 1);
    }

    if (diary.weather_icon === "💭" || diary.weather_icon === "📦" || diary.weather_icon === "🚫") {
        if (document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = "❓";
    } else if (diary.weather_icon) {
        if (document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = diary.weather_icon;
    } else {
        if (document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = "❓";
    }

    document.getElementById('latitude').value = (diary.latitude !== null && diary.latitude !== "null") ? diary.latitude : "";
    document.getElementById('longitude').value = (diary.longitude !== null && diary.longitude !== "null") ? diary.longitude : "";
    document.getElementById('temperature').value = (diary.temperature !== null && diary.temperature !== "null") ? diary.temperature : "";
    document.getElementById('locationSource').value = "manual"; 
    
    if (document.getElementById('gpsStatus')) document.getElementById('gpsStatus').innerText = "";

    // タグの展開とラジオボタンの選択
    const allTags = parseTags(diary.tags);
    if (allTags.includes('🛍️豆・グッズ')) {
        document.querySelector('input[name="eatType"][value="🛍️豆・グッズ"]').checked = true;
    } else if (allTags.includes('🥡テイクアウト')) {
        document.querySelector('input[name="eatType"][value="🥡テイクアウト"]').checked = true;
    } else if (allTags.includes('🎪間借り・無店舗')) {
        document.querySelector('input[name="eatType"][value="🎪間借り・無店舗"]').checked = true;
    } else {
        document.querySelector('input[name="eatType"][value="☕️店内"]').checked = true;
    }

    const manualTags = allTags.filter(t => !t.startsWith("🤖") && !t.startsWith("🚨") && t !== '🥡テイクアウト' && t !== '☕️店内' && t !== '🛍️豆・グッズ' && t !== '🎪間借り・無店舗').join(', ');
    document.getElementById('tags').value = manualTags;

    // 画像の表示
    const imgPreview = document.getElementById('imagePreview');
    if (diary.image_base64 || diary.image_url) {
        imgPreview.src = diary.image_base64 || diary.image_url;
        imgPreview.style.display = 'block';
    } else { 
        imgPreview.style.display = 'none'; 
    }
    
    const dynamicForm = document.getElementById('dynamicFormFields');
    if (dynamicForm) dynamicForm.classList.add('show');

    currentBase64 = null; 
    editingDiaryId = diary.id;
    document.getElementById('submitBtn').innerHTML = "🔄 この内容で更新する";
    window.scrollTo(0, 0); 
}