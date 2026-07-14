// ==========================================
// 📚 src/components/b2c/list.js
// ==========================================
import { getters, mutators } from '../../state.js';
import { parseTags, getColorFromTag, escapeHTML } from '../../utils/text.js';
import { deleteDiaryApi, fetchDiariesApi } from '../../api.js';

/**
 * 履歴タブの初期化
 */
export function initHistoryTab() {
    const tagFilterEl = document.getElementById('tagFilter');
    if (tagFilterEl) {
        tagFilterEl.addEventListener('change', filterDiaries);
    }
    refreshHistoryList();
}

/**
 * 最新のデータをAPIから取得し、画面とタグクラウドを再描画する
 */
export async function refreshHistoryList() {
    const diaries = await fetchDiariesApi();
    mutators.setDiaries(diaries);
    
    renderTagClouds();
    renderDiariesList(getters.getAllDiaries());
}

/**
 * 登録されている全タグを抽出し、絞り込み用ドロップダウンを生成する
 */
export function renderTagClouds() {
    const selectHistory = document.getElementById('tagFilter');
    const selectMap = document.getElementById('mapTagFilter');
    
    const currentHistoryVal = selectHistory ? selectHistory.value : "";
    const currentMapVal = selectMap ? selectMap.value : "";

    if (selectHistory) selectHistory.innerHTML = '<option value="">すべてのタグ（全件表示）</option>';
    if (selectMap) selectMap.innerHTML = '<option value="">🏷️ すべての気分・目的・タグ</option>';

    const allTags = new Set();
    getters.getAllDiaries().forEach(d => {
        parseTags(d.tags).forEach(t => {
            if (!t.startsWith("🚨") && t !== '🥡テイクアウト' && t !== '☕️店内' && t !== '🛍️豆・グッズ' && t !== '🎪間借り・無店舗') {
                allTags.add(t);
            }
        });
    });

    Array.from(allTags).sort().forEach(tag => {
        if (selectHistory) {
            const option = document.createElement('option');
            option.value = tag; option.textContent = tag;
            if (tag === currentHistoryVal) option.selected = true;
            selectHistory.appendChild(option);
        }
        if (selectMap) {
            const option = document.createElement('option');
            option.value = tag; 
            option.textContent = tag.replace(/🤖[☕️🍰🛋️]/, '🤖 ');
            if (tag === currentMapVal) option.selected = true;
            selectMap.appendChild(option);
        }
    });
}

/**
 * ドロップダウンの選択に応じてリストをフィルタリングする
 */
function filterDiaries() {
    const selectedTag = document.getElementById('tagFilter').value;
    mutators.setTagFilter(selectedTag);
    
    if (selectedTag === "") {
        renderDiariesList(getters.getAllDiaries());
    } else {
        const filtered = getters.getAllDiaries().filter(diary => parseTags(diary.tags).includes(selectedTag));
        renderDiariesList(filtered);
    }
}

/**
 * 履歴カード一覧をHTMLにレンダリングする
 */
export function renderDiariesList(diaries) {
    const container = document.getElementById('diariesList');
    if (!container) return;
    container.innerHTML = "";

    diaries.forEach(diary => {
        const isClosed = diary.weather_icon === "🚫";
        const card = document.createElement('div');
        card.className = "diary-card";

        let tagsHTML = "";
        parseTags(diary.tags).forEach(tag => { 
            if (!tag.startsWith("🤖") && !tag.startsWith("🚨") && tag !== '🎪間借り・無店舗') {
                tagsHTML += `<span class="tag-badge" style="background-color: ${getColorFromTag(tag)};">${escapeHTML(tag)}</span>`; 
            }
        });

        let imageHTML = "";
        if (diary.image_base64 || diary.image_url) {
            imageHTML = `<img src="${diary.image_base64 || diary.image_url}" class="diary-image" alt="カフェの写真">`;
        } else {
            const typoBase64 = generateTypographyBase64(diary.shop_name, diary.tags, diary.weather_icon);
            imageHTML = `<img src="${typoBase64}" class="diary-image" alt="タイポグラフィカード">`;
        }

        const displayDate = diary.visited_at ? diary.visited_at.split(' ')[0] : '日付不明';

        let weatherStr = "";
        if (isClosed) weatherStr = "🚫 閉店・移転報告済み";
        else if (diary.weather_icon === "💭") weatherStr = "💭 行きたい";
        else if (diary.weather_icon === "📦") weatherStr = "📦 未整理";
        else {
            let tempStr = diary.temperature ? `${diary.temperature}℃` : '';
            weatherStr = diary.weather_icon && diary.weather_icon !== "❓" ? `${diary.weather_icon} ${tempStr}` : '';
        }

        card.innerHTML = `
            <div class="diary-header">
                <span class="diary-date">${escapeHTML(displayDate)} <span style="margin-left: 8px; color: ${isClosed ? '#e74c3c' : 'inherit'};">${escapeHTML(weatherStr)}</span></span>
                <h3 class="diary-shop">${escapeHTML(diary.shop_name)}</h3>
            </div>
            ${imageHTML}
            <p class="diary-comment">${escapeHTML(diary.comment)}</p>
            <div class="diary-tags">${tagsHTML}</div>
            <div class="card-actions">
                <button class="action-btn data-edit-btn" data-id="${diary.id}">✏️ 編集</button>
                <button class="action-btn data-delete-btn" data-id="${diary.id}">🗑️ 削除</button>
            </div>
        `;
        
        // 動的に生成したボタンにイベントイベントリスナーを設定
        card.querySelector('.data-delete-btn').addEventListener('click', () => deleteDiary(diary.id));
        card.querySelector('.data-edit-btn').addEventListener('click', () => {
            // main.js側の編集処理を呼び出すカスタムイベントを発火
            const event = new CustomEvent('edit-diary', { detail: { id: diary.id } });
            window.dispatchEvent(event);
        });

        container.appendChild(card);
    });
}

/**
 * 写真がないとき用のタイポグラフィ生成 (Canvas API)
 */
function generateTypographyBase64(shopName, tags, weatherIcon) {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 450;
    const ctx = canvas.getContext('2d');
    const tagList = parseTags(tags);
    const manualTags = tagList.filter(t => !t.startsWith('🤖') && !t.startsWith('🚨') && t !== '🥡テイクアウト' && t !== '☕️店内' && t !== '🛍️豆・グッズ' && t !== '🎪間借り・無店舗');
    const mainTag = manualTags.length > 0 ? manualTags[0] : (tagList[0] || "カフェ");
    const baseColor = getColorFromTag(mainTag);

    ctx.fillStyle = baseColor; ctx.fillRect(0, 0, 800, 450);
    const gradient = ctx.createLinearGradient(0, 0, 800, 450);
    gradient.addColorStop(0, 'rgba(255,255,255,0.25)'); gradient.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 800, 450);

    ctx.fillStyle = "rgba(255, 255, 255, 0.2)"; ctx.font = "200px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(weatherIcon && weatherIcon !== "❓" ? weatherIcon : "☕️", 400, 225);

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath(); ctx.roundRect(100, 125, 600, 200, 20); ctx.fill();

    ctx.fillStyle = '#2c3e50'; ctx.font = 'bold 36px sans-serif'; ctx.fillText(shopName || '名前なし', 400, 200);
    ctx.fillStyle = '#7f8c8d'; ctx.font = '22px sans-serif';
    ctx.fillText(manualTags.length > 0 ? manualTags.join(' / ') : '日常の記録', 400, 260);

    return canvas.toDataURL('image/jpeg', 0.8);
}

/**
 * 日記の削除処理
 */
async function deleteDiary(id) {
    if (!confirm("本当にこの記録を削除しますか？\n(削除後は元に戻せません)")) return;
    const result = await deleteDiaryApi(id);
    if (result.success) { 
        alert("削除しました。"); 
        refreshHistoryList(); 
    } else { 
        alert("エラー: " + result.error); 
    }
}