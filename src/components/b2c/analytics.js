// ==========================================
// 📊 src/components/b2c/analytics.js (データ分析・Chart.js制御)
// ==========================================
import { getters } from '../../state.js';
import { parseTags, getColorFromTag } from '../../utils/text.js';

let tagsChartInstance = null;
let eatTypeChartInstance = null; 

export function renderAnalytics() {
    const diaries = getters.getAllDiaries();
    if (!diaries || diaries.length === 0) return;

    // ▼ 🎯 DX機能: 「行きたい(💭)」「未整理(📦)」「閉店(🚫)」を分析対象から完全に除外する
    const validDiaries = diaries.filter(d => 
        d.weather_icon !== "💭" && d.weather_icon !== "📦" && d.weather_icon !== "🚫"
    );

    // 1. 基本統計の計算
    const totalVisits = validDiaries.length;
    const uniqueShops = new Set(validDiaries.map(d => d.shop_name)).size;

    const statTotalEl = document.getElementById('stat-total-visits');
    const statUniqueEl = document.getElementById('stat-unique-shops');
    if (statTotalEl) statTotalEl.innerText = totalVisits;
    if (statUniqueEl) statUniqueEl.innerText = uniqueShops;

    const tagCounts = {};
    const eatTypeCounts = {};
    const eatTypeKeywords = ['☕️店内', '🥡テイクアウト', '🛍️豆・グッズ', '🎪間借り・無店舗'];

    // 2. フィルタリング後の実データのみでタグを集計
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
    // 📊 チャート1：利用タイプの割合
    // ==========================================
    const eatLabels = Object.keys(eatTypeCounts);
    const eatData = eatLabels.map(tag => eatTypeCounts[tag]);
    
    const getEatTypeColor = (type) => {
        if(type === '☕️店内') return '#e67e22'; 
        if(type === '🥡テイクアウト') return '#27ae60'; 
        if(type === '🛍️豆・グッズ') return '#8e44ad'; 
        if(type === '🎪間借り・無店舗') return '#f39c12';
        return '#95a5a6';
    };
    const eatColors = eatLabels.map(tag => getEatTypeColor(tag));

    const ctxEatEl = document.getElementById('eatTypeChart');
    if (ctxEatEl) {
        const ctxEat = ctxEatEl.getContext('2d');
        if (eatTypeChartInstance) eatTypeChartInstance.destroy(); 

        eatTypeChartInstance = new Chart(ctxEat, {
            type: 'doughnut',
            data: {
                labels: eatLabels,
                datasets: [{
                    data: eatData,
                    backgroundColor: eatColors,
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom' },
                    title: { display: true, text: '利用タイプの割合', font: { size: 14, color: '#5d4037' } }
                }
            }
        });
    }

    // ==========================================
    // 📊 チャート2：よく記録するタグ（ユーザーの嗜好）
    // ==========================================
    const sortedTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 6);
    const chartLabels = sortedTags;
    const chartData = sortedTags.map(tag => tagCounts[tag]);
    const chartColors = sortedTags.map(tag => getColorFromTag(tag));

    const ctxTagsEl = document.getElementById('tagsChart');
    if (ctxTagsEl) {
        const ctxTags = ctxTagsEl.getContext('2d');
        if (tagsChartInstance) tagsChartInstance.destroy(); 

        tagsChartInstance = new Chart(ctxTags, {
            type: 'doughnut',
            data: {
                labels: chartLabels,
                datasets: [{
                    data: chartData,
                    backgroundColor: chartColors,
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom' },
                    title: { display: true, text: 'よく記録するタグ（上位）', font: { size: 14, color: '#5d4037' } }
                }
            }
        });
    }
}