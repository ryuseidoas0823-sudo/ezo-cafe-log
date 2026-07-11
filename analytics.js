// ==========================================
// 📊 analytics.js (データ分析・Chart.js制御)
// ==========================================
let tagsChartInstance = null;
let eatTypeChartInstance = null; // 🆕 追加

function renderAnalytics() {
    if (!globalDiaries || globalDiaries.length === 0) return;

    // 1. 基本統計の計算（総記録数と、ユニークな店舗数）
    const totalVisits = globalDiaries.length;
    const uniqueShops = new Set(globalDiaries.map(d => d.shop_name)).size;

    document.getElementById('stat-total-visits').innerText = totalVisits;
    document.getElementById('stat-unique-shops').innerText = uniqueShops;

    // 2. タグの集計（利用タイプと、ユーザーの好みを「分離」して抽出）
    const tagCounts = {};
    const eatTypeCounts = {};
    const eatTypeKeywords = ['☕️店内', '🥡テイクアウト', '🛍️豆・グッズ'];

    globalDiaries.forEach(d => {
        parseTags(d.tags).forEach(tag => {
            if (eatTypeKeywords.includes(tag)) {
                // 🍽️ 利用タイプとして集計
                eatTypeCounts[tag] = (eatTypeCounts[tag] || 0) + 1;
            } else if (!tag.startsWith("🤖") && !tag.startsWith("🚨")) {
                // 📝 ユーザーの手動タグとして集計（AI・モデレーションタグは除外）
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
        });
    });

    // ==========================================
    // 📊 チャート1：利用タイプの割合
    // ==========================================
    const eatLabels = Object.keys(eatTypeCounts);
    const eatData = eatLabels.map(tag => eatTypeCounts[tag]);
    
    // 利用タイプは色がバラバラにならないよう、専用の固定色を割り当てます
    const getEatTypeColor = (type) => {
        if(type === '☕️店内') return '#e67e22'; // 暖かみのあるオレンジ
        if(type === '🥡テイクアウト') return '#27ae60'; // アクティブな緑
        if(type === '🛍️豆・グッズ') return '#8e44ad'; // 上品な紫
        return '#95a5a6';
    };
    const eatColors = eatLabels.map(tag => getEatTypeColor(tag));

    const ctxEat = document.getElementById('eatTypeChart').getContext('2d');
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

    // ==========================================
    // 📊 チャート2：よく記録するタグ（ユーザーの嗜好）
    // ==========================================
    // 出現回数が多い順にソートして、上位6個のタグを抽出
    const sortedTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 6);
    const chartLabels = sortedTags;
    const chartData = sortedTags.map(tag => tagCounts[tag]);
    
    // utils.js の関数を使ってタグ名から色を自動生成
    const chartColors = sortedTags.map(tag => getColorFromTag(tag));

    const ctxTags = document.getElementById('tagsChart').getContext('2d');
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