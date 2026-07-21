// ==========================================
// 📊 src/components/b2c/analytics.js (Vanilla JS + CSS 軽量・完全版)
// ==========================================
import { getters } from '../../state.js';
import { parseTags, getColorFromTag, escapeHTML } from '../../utils/text.js';

export function renderAnalytics() {
    const container = document.getElementById('analyticsContent');
    if (!container) return;

    const diaries = getters.getAllDiaries();
    
    // ▼ 🎯 DX機能: 「行きたい(💭)」「未整理(📦)」「閉店(🚫)」を分析対象から完全に除外
    const validDiaries = diaries.filter(d => 
        d.weather_icon !== "💭" && d.weather_icon !== "📦" && d.weather_icon !== "🚫"
    );

   
    if (validDiaries.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; margin-top: 40px; animation: fadeIn 0.5s ease;">
                <p style="color: var(--text-sub); line-height: 1.8; margin-bottom: 20px;">
                    まだ訪問記録がありません。<br>お気に入りのカフェを記録して、<br>自分だけの分析データを作りましょう☕️
                </p>
                <!-- 記録フォームへ遷移するボタン（ルーティングの実装に合わせてonclickを調整） -->
                <button onclick="document.getElementById('nav-form').click()" class="btn-primary" style="width: auto; padding: 10px 24px; display: inline-block;">
                    ✍️ 最初の記録をつける
                </button>
            </div>
        `;
        return;
    }
    // ==========================================
    // 1. 基本統計の計算とID割り当て（マップ画像連携用）
    // ==========================================
    const totalVisits = validDiaries.length;
    const uniqueShops = new Set(validDiaries.map(d => d.shop_name)).size;

    let html = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 24px; animation: fadeIn 0.4s ease;">
            <div style="background: var(--card-bg); padding: 20px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: center;">
                <p style="font-size: 0.8rem; color: var(--text-sub); margin: 0; font-weight: bold;">累計訪問数</p>
                <p style="font-size: 2rem; color: var(--text-main); font-weight: 900; margin: 5px 0 0 0;"><span id="stat-total-visits">${totalVisits}</span><span style="font-size:1rem; font-weight:bold;"> 回</span></p>
            </div>
            <div style="background: var(--card-bg); padding: 20px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: center;">
                <p style="font-size: 0.8rem; color: var(--text-sub); margin: 0; font-weight: bold;">開拓した店舗数</p>
                <p style="font-size: 2rem; color: var(--primary-color); font-weight: 900; margin: 5px 0 0 0;"><span id="stat-unique-shops">${uniqueShops}</span><span style="font-size:1rem; font-weight:bold;"> 店</span></p>
            </div>
        </div>
    `;

    // ==========================================
    // 2. 実データでのタグ・利用形態の集計
    // ==========================================
    const tagCounts = {};
    const eatTypeCounts = {};
    const eatTypeKeywords = ['☕️店内', '🥡テイクアウト', '🛍️豆・グッズ', '🎪間借り・無店舗'];

    validDiaries.forEach(d => {
        parseTags(d.tags).forEach(tag => {
            if (eatTypeKeywords.includes(tag)) {
                eatTypeCounts[tag] = (eatTypeCounts[tag] || 0) + 1;
            } else if (!tag.startsWith("🤖") && !tag.startsWith("🚨")) {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
        });
    });

    // ==========================================
    // 📊 チャート1：利用タイプの割合 (CSS描画に置換)
    // ==========================================
    const eatLabels = Object.keys(eatTypeCounts).sort((a, b) => eatTypeCounts[b] - eatTypeCounts[a]);
    if (eatLabels.length > 0) {
        html += `<div style="background: var(--card-bg); padding: 20px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 24px; animation: fadeIn 0.5s ease;">
                    <h3 style="font-size: 1rem; color: var(--text-main); margin: 0 0 15px 0; border-bottom: 2px solid #e67e22; display: inline-block; padding-bottom: 4px;">🍽️ 利用タイプの割合</h3>
                    <div style="display: flex; flex-direction: column; gap: 12px;">`;
        
        const maxEatCount = Math.max(...eatLabels.map(tag => eatTypeCounts[tag]));
        const getEatTypeColor = (type) => {
            if(type === '☕️店内') return '#e67e22'; 
            if(type === '🥡テイクアウト') return '#27ae60'; 
            if(type === '🛍️豆・グッズ') return '#8e44ad'; 
            if(type === '🎪間借り・無店舗') return '#f39c12';
            return '#95a5a6';
        };

        eatLabels.forEach(tag => {
            const count = eatTypeCounts[tag];
            const percent = Math.max(5, Math.round((count / maxEatCount) * 100));
            html += `
                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px; font-weight: bold; color: var(--text-main);">
                        <span>${escapeHTML(tag)}</span>
                        <span>${count} 回</span>
                    </div>
                    <div style="background: #ecf0f1; height: 10px; border-radius: 5px; overflow: hidden;">
                        <div style="width: ${percent}%; height: 100%; background-color: ${getEatTypeColor(tag)}; border-radius: 5px; transition: width 1s ease;"></div>
                    </div>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    // ==========================================
    // 📊 チャート2：よく記録するタグ (CSS描画に置換)
    // ==========================================
    const sortedTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 6);
    
    if (sortedTags.length > 0) {
        html += `<div style="background: var(--card-bg); padding: 20px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 24px; animation: fadeIn 0.6s ease;">
                    <h3 style="font-size: 1rem; color: var(--text-main); margin: 0 0 15px 0; border-bottom: 2px solid var(--primary-color); display: inline-block; padding-bottom: 4px;">🏷️ よく記録するタグ（上位）</h3>
                    <div style="display: flex; flex-direction: column; gap: 12px;">`;
        
        const maxTagCount = tagCounts[sortedTags[0]];

        sortedTags.forEach(tag => {
            const count = tagCounts[tag];
            const percent = Math.max(5, Math.round((count / maxTagCount) * 100));
            const color = getColorFromTag(tag); // utilsの既存関数を活用

            html += `
                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px; font-weight: bold; color: var(--text-main);">
                        <span>${escapeHTML(tag)}</span>
                        <span>${count} 回</span>
                    </div>
                    <div style="background: #ecf0f1; height: 10px; border-radius: 5px; overflow: hidden;">
                        <div style="width: ${percent}%; height: 100%; background-color: ${color}; border-radius: 5px; transition: width 1s ease;"></div>
                    </div>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    container.innerHTML = html;
}