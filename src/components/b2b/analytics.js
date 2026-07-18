// ==========================================
// 📊 src/components/b2b/analytics.js (経営者向けダッシュボード)
// ==========================================
import { state } from '../../state.js'; // 既存のステート管理を想定
import { escapeHTML } from '../../utils/text.js'; // 既存のXSS対策ユーティリティ

export async function renderB2BAnalytics(shopId) {
    const container = document.getElementById('b2bAnalyticsContent');
    if (!container) return;

    // ローディング表示
    container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-sub);">
            <p>📊 店舗データを集計中...</p>
        </div>
    `;

    try {
        // 1. APIからのデータ取得
        // ※認証トークン(UUID)は環境に合わせて取得してください
        const userUuid = state.userUuid || localStorage.getItem('ezo_user_uuid'); 
        const response = await fetch(`/api?action=get_b2b_analytics&shop_id=${shopId}`, {
            method: 'GET',
            headers: {
                'X-Ezo-User-UUID': userUuid
            }
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'データの取得に失敗しました');
        }

        const data = result.data;

        // データが0件の場合のフォールバック
        if (data.loyalty.new_customers === 0 && data.loyalty.repeat_customers === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-sub); background: var(--card-bg); border-radius: 16px;">
                    <p>まだ有効な来店データがありません。</p>
                </div>
            `;
            return;
        }

        // ==========================================
        // 2. ロイヤルティ分析（新規 vs リピーター）のUI構築
        // ==========================================
        const newCount = data.loyalty.new_customers;
        const repeatCount = data.loyalty.repeat_customers;
        const totalUsers = newCount + repeatCount;
        const repeatRate = data.loyalty.repeat_rate;
        const newRate = totalUsers > 0 ? ((newCount / totalUsers) * 100).toFixed(1) + '%' : '0%';

        let html = `
            <div style="background: var(--card-bg); padding: 20px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 24px; animation: fadeIn 0.4s ease;">
                <h3 style="font-size: 1rem; color: var(--text-main); margin: 0 0 15px 0; border-bottom: 2px solid #2980b9; display: inline-block; padding-bottom: 4px;">🤝 顧客ロイヤルティ分析</h3>
                
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <div style="text-align: center; flex: 1;">
                        <p style="font-size: 0.8rem; color: var(--text-sub); margin: 0;">新規顧客</p>
                        <p style="font-size: 1.5rem; color: #3498db; font-weight: 900; margin: 0;">${newCount}<span style="font-size:0.9rem;">人</span></p>
                    </div>
                    <div style="text-align: center; flex: 1; border-left: 1px solid #eee;">
                        <p style="font-size: 0.8rem; color: var(--text-sub); margin: 0;">リピーター</p>
                        <p style="font-size: 1.5rem; color: #2ecc71; font-weight: 900; margin: 0;">${repeatCount}<span style="font-size:0.9rem;">人</span></p>
                    </div>
                </div>

                <!-- CSSによるスタックド・バー（積み上げ横棒グラフ） -->
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: bold; margin-bottom: 4px;">
                    <span style="color: #3498db;">新規 ${newRate}</span>
                    <span style="color: #2ecc71;">リピート ${repeatRate}</span>
                </div>
                <div style="display: flex; height: 16px; border-radius: 8px; overflow: hidden; background: #ecf0f1;">
                    <div style="width: ${newRate}; background-color: #3498db; transition: width 1s ease;"></div>
                    <div style="width: ${repeatRate}; background-color: #2ecc71; transition: width 1s ease;"></div>
                </div>
            </div>
        `;

        // ==========================================
        // 3. ヒートマップ分析（時間帯 × 利用タイプ）のUI構築
        // ==========================================
        const heatmap = data.heatmap || [];
        
        // 時間帯の日本語マッピングと表示順
        const timeZoneMap = {
            'morning': { label: '🌅 朝 (5:00-11:00)', order: 1 },
            'afternoon': { label: '☀️ 昼 (11:00-15:00)', order: 2 },
            'evening': { label: '🌇 夕方 (15:00-18:00)', order: 3 },
            'night': { label: '🌙 夜 (18:00-)', order: 4 }
        };

        // データを時間帯ごとにグループ化
        const groupedData = heatmap.reduce((acc, curr) => {
            if (!acc[curr.time_zone]) acc[curr.time_zone] = [];
            acc[curr.time_zone].push(curr);
            return acc;
        }, {});

        if (Object.keys(groupedData).length > 0) {
            html += `
                <div style="background: var(--card-bg); padding: 20px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 24px; animation: fadeIn 0.6s ease;">
                    <h3 style="font-size: 1rem; color: var(--text-main); margin: 0 0 15px 0; border-bottom: 2px solid #e67e22; display: inline-block; padding-bottom: 4px;">🔥 時間帯別トレンド（ヒートマップ）</h3>
                    <div style="display: flex; flex-direction: column; gap: 20px;">
            `;

            // 時間帯順にソートして描画
            Object.keys(groupedData)
                .sort((a, b) => timeZoneMap[a].order - timeZoneMap[b].order)
                .forEach(tz => {
                    const items = groupedData[tz];
                    const maxCountForTz = Math.max(...items.map(i => i.count)); // その時間帯での最大値

                    html += `
                        <div>
                            <h4 style="font-size: 0.9rem; color: var(--text-sub); margin: 0 0 8px 0;">${timeZoneMap[tz].label}</h4>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                    `;

                    items.forEach(item => {
                        // 最大値に対する割合でバーの長さを決定
                        const percent = Math.max(5, Math.round((item.count / maxCountForTz) * 100));
                        
                        html += `
                            <div>
                                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 2px; color: var(--text-main);">
                                    <span>${escapeHTML(item.usage_type)}</span>
                                    <span style="font-weight: bold;">${item.count} 回</span>
                                </div>
                                <div style="background: #ecf0f1; height: 8px; border-radius: 4px; overflow: hidden;">
                                    <!-- countが多いほど濃いオレンジ（ヒートマップ表現） -->
                                    <div style="width: ${percent}%; height: 100%; background-color: #e67e22; opacity: ${0.4 + (percent / 100) * 0.6}; border-radius: 4px; transition: width 1s ease;"></div>
                                </div>
                            </div>
                        `;
                    });

                    html += `</div></div>`;
                });

            html += `</div></div>`;
        }

        // 描画実行
        container.innerHTML = html;

    } catch (err) {
        console.error('B2B Analytics Error:', err);
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #e74c3c; background: #fadbd8; border-radius: 8px;">
                <p>データの読み込みに失敗しました。</p>
                <p style="font-size: 0.8rem;">${escapeHTML(err.message)}</p>
            </div>
        `;
    }
}