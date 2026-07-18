// ==========================================
// 📚 src/components/b2c/list.js (フリックUI＆PC両端クリック 完全対応版)
// ==========================================
import { getters, mutators } from '../../state.js';
import { parseTags, getColorFromTag, escapeHTML } from '../../utils/text.js';
import { deleteDiaryApi, fetchDiariesApi } from '../../api.js';

// タイポグラフィ画像の生成結果を保持するキャッシュ（パフォーマンス改善）
const typographyCache = new Map();

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

        // 🌟 画像データのパース
        let imageUrls = [];
        const rawImageData = diary.image_base64 || diary.image_url;
        
        if (rawImageData) {
            try {
                imageUrls = JSON.parse(rawImageData);
                if (!Array.isArray(imageUrls)) {
                    imageUrls = [rawImageData]; 
                }
            } catch (e) {
                imageUrls = [rawImageData];
            }
        }

        let imageHTML = "";
        if (imageUrls.length > 0) {
            if (imageUrls.length === 1) {
                // 単一画像
                imageHTML = `<img src="${escapeHTML(imageUrls[0])}" class="diary-image" loading="lazy" alt="カフェの写真">`;
            } else {
                // 🌟 新仕様：複数画像（ラッパーとドットインジケーターを含める）
                // PC向けに cursor: pointer を追加し、クリックできることをアピール
                imageHTML = `
                    <div class="flick-wrapper">
                        <div class="flick-container" style="cursor: pointer;">
                            ${imageUrls.map(url => `<img src="${escapeHTML(url)}" class="flick-item" loading="lazy" alt="カフェの写真">`).join('')}
                        </div>
                        <div class="flick-dots">
                            ${imageUrls.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}"></div>`).join('')}
                        </div>
                    </div>
                `;
            }
        } else {
            // 画像がない場合はタイポグラフィ生成
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
        
        // 🌟 フリック時のドット連動 ＆ PC向け両端クリックロジック
        if (imageUrls.length > 1) {
            const flickContainer = card.querySelector('.flick-container');
            if (flickContainer) {
                // スクロール時のドット連動
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

                // 🌟 新機能：画像両端クリックでのスライド移動（PC向け）
                flickContainer.addEventListener('click', (e) => {
                    const rect = flickContainer.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const width = rect.width;
                    
                    // スクロール幅（画像1枚分 + ギャップ）を計算
                    const item = flickContainer.querySelector('.flick-item');
                    const scrollAmount = item ? item.clientWidth + 8 : width;

                    // 左側25%をクリックしたら前の画像へ
                    if (clickX < width * 0.25) {
                        flickContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
                    }
                    // 右側25%をクリックしたら次の画像へ
                    else if (clickX > width * 0.75) {
                        flickContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
                    }
                });
            }
        }

        // イベントリスナー設定
        card.querySelector('.data-delete-btn').addEventListener('click', () => deleteDiary(diary.id));
        card.querySelector('.data-edit-btn').addEventListener('click', () => {
            const event = new CustomEvent('edit-diary', { detail: { id: diary.id } });
            window.dispatchEvent(event);
        });

        container.appendChild(card);
    });
}

/**
 * 写真がないとき用のタイポグラフィ生成 (Canvas API)
 * 🌟 パフォーマンス改善：キャッシュ機能を追加
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

    const base64 = canvas.toDataURL('image/jpeg', 0.8);
    typographyCache.set(cacheKey, base64); // キャッシュに保存
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