// ==========================================
// 📚 src/components/b2c/list.js (DX強化・パフォーマンス最適化版)
// 責務: 履歴リストの描画、フィルター処理、イベント統合
// ==========================================
import { getters, mutators } from '../../state.js';
import { parseTags, getColorFromTag, escapeHTML } from '../../utils/text.js';
import { deleteDiaryApi, fetchDiariesApi } from '../../api.js';

// タイポグラフィ画像の生成結果を保持するキャッシュ
const typographyCache = new Map();

/**
 * 履歴タブの初期化
 */
export function initHistoryTab() {
    // 🏷️ タグフィルターの監視
    const tagFilterEl = document.getElementById('tagFilter');
    if (tagFilterEl && !tagFilterEl.dataset.listened) {
        tagFilterEl.addEventListener('change', filterDiaries);
        tagFilterEl.dataset.listened = "true";
    }

    // 📦 未整理フィルターの監視（業務効率化用）
    const unorganizedFilterEl = document.getElementById('unorganizedFilter');
    if (unorganizedFilterEl && !unorganizedFilterEl.dataset.listened) {
        unorganizedFilterEl.addEventListener('change', filterDiaries);
        unorganizedFilterEl.dataset.listened = "true";
    }

    // 🌟 改善: イベントデリゲーション（親要素で一括してクリックイベントを監視）
    const container = document.getElementById('diariesList');
    if (container && !container.dataset.delegated) {
        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('data-delete-btn')) {
                deleteDiary(e.target.dataset.id);
            } else if (e.target.classList.contains('data-edit-btn')) {
                window.dispatchEvent(new CustomEvent('edit-diary', { detail: { id: e.target.dataset.id } }));
            }
        });
        container.dataset.delegated = "true";
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
    filterDiaries(); // 現在のフィルター状態を適用して描画
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
 * ドロップダウンとチェックボックスの選択に応じてリストをフィルタリングする
 */
function filterDiaries() {
    const selectedTag = document.getElementById('tagFilter')?.value || "";
    const isUnorganizedOnly = document.getElementById('unorganizedFilter')?.checked || false;
    
    mutators.setTagFilter(selectedTag);
    let filtered = getters.getAllDiaries();
    
    if (selectedTag !== "") {
        filtered = filtered.filter(diary => parseTags(diary.tags).includes(selectedTag));
    }
    
    // 🌟 改善: 未整理バックログの抽出処理
    if (isUnorganizedOnly) {
        filtered = filtered.filter(diary => diary.weather_icon === "📦");
    }
    
    renderDiariesList(filtered);
}

/**
 * 履歴カード一覧をHTMLにレンダリングする
 */
export function renderDiariesList(diaries) {
    const container = document.getElementById('diariesList');
    if (!container) return;
    
    container.innerHTML = "";
    
    // 🌟 改善: DocumentFragmentを使用してDOMへの書き込みを1回にまとめる（高速化）
    const fragment = document.createDocumentFragment();

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

        let imageUrls = [];
        const rawImageData = diary.image_base64 || diary.image_url;
        
        if (rawImageData) {
            try {
                imageUrls = JSON.parse(rawImageData);
                if (!Array.isArray(imageUrls)) imageUrls = [rawImageData]; 
            } catch (e) {
                imageUrls = [rawImageData];
            }
        }

        let imageHTML = "";
        if (imageUrls.length > 0) {
            if (imageUrls.length === 1) {
                imageHTML = `<img src="${escapeHTML(imageUrls[0])}" class="diary-image" loading="lazy" alt="カフェの写真">`;
            } else {
                imageHTML = `
                    <div class="flick-wrapper">
                        <div class="flick-container">
                            ${imageUrls.map(url => `<img src="${escapeHTML(url)}" class="flick-item" loading="lazy" alt="カフェの写真">`).join('')}
                        </div>
                        <div class="flick-dots">
                            ${imageUrls.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}"></div>`).join('')}
                        </div>
                    </div>
                `;
            }
        } else {
            const typoBase64 = generateTypographyBase64(diary.shop_name, diary.tags, diary.weather_icon);
            imageHTML = `<img src="${typoBase64}" class="diary-image" loading="lazy" alt="タイポグラフィカード">`;
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
        
        if (imageUrls.length > 1) {
            const flickContainer = card.querySelector('.flick-container');
            if (flickContainer) {
                flickContainer.addEventListener('scroll', (e) => {
                    const c = e.target;
                    const item = c.querySelector('.flick-item');
                    if (!item) return;
                    
                    const itemWidthWithGap = item.clientWidth + 8;
                    const index = Math.round(c.scrollLeft / itemWidthWithGap);
                    
                    const dots = c.parentElement.querySelectorAll('.dot');
                    dots.forEach((dot, i) => {
                        dot.classList.toggle('active', i === index);
                    });
                }, { passive: true }); 
            }
        }

        // イベントリスナーの個別付与を廃止し、フラグメントに追加
        fragment.appendChild(card);
    });
    
    // 全カードを1回の処理でDOMに追加
    container.appendChild(fragment);
    
    // リストが更新されたら初期状態では非表示になっているコンテナを表示する
    if (container.style.display === 'none') {
        container.style.display = 'block';
        const loader = document.getElementById('history-loading');
        if (loader) loader.style.display = 'none';
    }
}

/**
 * 写真がないとき用のタイポグラフィ生成 (Canvas API)
 */
function generateTypographyBase64(shopName, tags, weatherIcon) {
    const cacheKey = `${shopName}_${tags}_${weatherIcon}`;
    if (typographyCache.has(cacheKey)) {
        return typographyCache.get(cacheKey);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 450;
    const ctx = canvas.getContext('2d');
    const tagList = parseTags(tags);
    const manualTags = tagList.filter(t => !t.startsWith('🤖') && !t.startsWith('🚨') && !['🥡テイクアウト', '☕️店内', '🛍️豆・グッズ', '🎪間借り・無店舗'].includes(t));
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

    const base64 = canvas.toDataURL('image/jpeg', 0.8);
    typographyCache.set(cacheKey, base64); 
    return base64;
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