// ==========================================
// 📊 analytics.js (データ分析・Chart.js制御)
// ==========================================
let tagsChartInstance = null;

function renderAnalytics() {
    if (!globalDiaries || globalDiaries.length === 0) return;

    // 1. 基本統計の計算（総記録数と、ユニークな店舗数）
    const totalVisits = globalDiaries.length;
    const uniqueShops = new Set(globalDiaries.map(d => d.shop_name)).size;

    document.getElementById('stat-total-visits').innerText = totalVisits;
    document.getElementById('stat-unique-shops').innerText = uniqueShops;

    // 2. タグの集計（AIタグや非公開タグを除外し、ユーザーの好みを抽出）
    const tagCounts = {};
    globalDiaries.forEach(d => {
        parseTags(d.tags).forEach(tag => {
            if (!tag.startsWith("🤖") && !tag.startsWith("🚨")) {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
        });
    });

    // 出現回数が多い順にソートして、上位6個のタグを抽出
    const sortedTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 6);
    const chartLabels = sortedTags;
    const chartData = sortedTags.map(tag => tagCounts[tag]);
    
    // utils.js の関数を使ってタグ名から色を自動生成
    const chartColors = sortedTags.map(tag => getColorFromTag(tag));

    // 3. Chart.js でドーナツチャートを描画
    const ctx = document.getElementById('tagsChart').getContext('2d');
    
    // 既にグラフがあれば破棄して再描画（タブ切り替え時のバグ防止）
    if (tagsChartInstance) {
        tagsChartInstance.destroy(); 
    }

    tagsChartInstance = new Chart(ctx, {
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
                title: { display: true, text: 'よく記録するタグ（上位）', font: { size: 14 } }
            }
        }
    });
}