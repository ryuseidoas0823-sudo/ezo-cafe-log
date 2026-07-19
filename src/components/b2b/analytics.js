// ==========================================
// 📊 src/components/b2b/analytics.js (経営者・店舗向けダッシュボード)
// 責務: APIからのデータ取得と、B2B向けUIコンポーネントの統合描画
// ==========================================
import { state } from '../../state.js'; 
import { escapeHTML } from '../../utils/text.js';
import { generateDemographicsHTML } from './demographics.js';
import { fetchB2bAnalyticsApi, fetchShopAnalyticsApi } from '../../api.js'; // 🌟 API共通基盤からのインポート

/**
 * B2B向けアナリティクスダッシュボードを描画するメイン関数
 * @param {string} shopId - 対象店舗のID
 * @param {string} containerId - 描画先のDOM要素のID (デフォルト: 'b2bAnalyticsContent')
 */
export async function renderB2BAnalytics(shopId, containerId = 'b2bAnalyticsContent') {
    const container = document.getElementById(containerId);
    if (!container) return;

    // ⏳ データフェッチ中のローディングUI
    container.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-sub);">
            <p style="animation: pulse 1.5s infinite;">📊 店舗データを高度集計・分析中...</p>
        </div>
    `;

    try {
        // 🎯 DX実践: 共通API層を利用してデータフェッチを並列化＆クリーンに保つ
        // ※認証ヘッダーの付与やエラーハンドリングは api.js 側に委譲しています
        const [b2bResult, demoResult] = await Promise.all([
            fetchB2bAnalyticsApi(shopId),
            fetchShopAnalyticsApi(shopId, null)
        ]);

        // 🛡️ 権限エラー(403) or 取得失敗時のハンドリング: api.jsがnullを返した場合は権限なしと判定
        if (!b2bResult || !demoResult) {
            container.innerHTML = `
                <div style="background: #fdf2e9; padding: 20px; border-radius: 12px; border: 1px solid #f39c12; text-align: center; margin-top: 15px;">
                    <p style="color: #e67e22; font-weight: bold; margin: 0 0 10px 0;">🔒 経営者・管理者専用データ</p>
                    <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0; line-height: 1.6;">
                        この店舗の詳細な分析データ（顧客ロイヤルティ、ペルソナ、行動変容など）を閲覧するには、ビジネス権限が必要です。<br>
                        ※一般ユーザーのプライバシーは完全に保護されています。
                    </p>
                </div>
            `;
            return;
        }

        const b2bData = b2bResult.data;
        const advanced = b2bData.advanced_analytics || {};
        const newCount = b2bData.loyalty?.new_customers || 0;
        const repeatCount = b2bData.loyalty?.repeat_customers || 0;
        
        // 店舗に有効な実データが全くない場合
        if (newCount === 0 && repeatCount === 0 && demoResult.total === 0) {
            container.innerHTML = `
                <div style="background: var(--card-bg); border: 1px dashed #ccc; border-radius: 12px; text-align: center; padding: 30px; margin-top: 15px;">
                    <p style="color: var(--text-sub); font-size: 0.9rem; margin: 0;">来店データがまだ十分に蓄積されていません。</p>
                </div>
            `;
            return;
        }

        // ==========================================
        // 🧱 B2Bダッシュボード HTMLの構築開始
        // ==========================================
        let html = `<div style="display: flex; flex-direction: column; gap: 16px; margin-top: 15px; animation: fadeIn 0.4s ease;">`;

        // --- 1. 🎯 マイクロコンバージョン (DX指標: 店内→物販への転換率) ---
        if (advanced.micro_conversion) {
            html += `
                <div style="background: #f0f8ff; padding: 15px; border-radius: 12px; border: 1px solid #bcdcfa;">
                    <p style="font-size: 0.85rem; color: #2c3e50; margin: 0 0 10px 0; font-weight: bold;">🎯 マイクロコンバージョン (店内利用 → 物販購入)</p>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.75rem; color: var(--text-sub);">店内利用ユーザー: ${advanced.micro_conversion.eatin_users}人</span>
                        <span style="font-size: 1.2rem; font-weight: bold; color: #2980b9;">転換率 ${advanced.micro_conversion.conversion_rate}</span>
                    </div>
                </div>
            `;
        }

        // --- 2. 🤝 顧客ロイヤルティ分析 (新規 vs リピーター) ---
        const totalUsers = newCount + repeatCount;
        const repeatRate = b2bData.loyalty.repeat_rate || '0%';
        const newRate = totalUsers > 0 ? ((newCount / totalUsers) * 100).toFixed(1) + '%' : '0%';

        html += `
            <div style="background: #f8f9fa; padding: 15px; border-radius: 12px; border: 1px dashed #bdc3c7;">
                <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0 0 10px 0; font-weight: bold;">🤝 顧客ロイヤルティ (新規 vs リピーター)</p>
                
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: bold; margin-bottom: 6px;">
                    <span style="color: #3498db;">新規 ${newCount}人 (${newRate})</span>
                    <span style="color: #2ecc71;">リピーター ${repeatCount}人 (${repeatRate})</span>
                </div>
                <div style="display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: #ecf0f1; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
                    <div style="width: ${newRate}; background-color: #3498db; transition: width 1s ease;"></div>
                    <div style="width: ${repeatRate}; background-color: #2ecc71; transition: width 1s ease;"></div>
                </div>
            </div>
        `;

        // --- 3. 👥 メインペルソナ像 (自動クラスタリング) ---
        if (advanced.top_personas && advanced.top_personas.length > 0) {
            html += `
                <div style="background: #fff; padding: 15px; border-radius: 12px; border: 1px dashed #bdc3c7;">
                    <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0 0 12px 0; font-weight: bold;">👥 メインペルソナ像 (AI自動抽出)</p>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
            `;
            advanced.top_personas.forEach(p => {
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; padding: 6px 10px; background: #f8f9fa; border-left: 4px solid #3498db; border-radius: 4px;">
                        <span style="font-weight: bold; color: var(--text-main);">${escapeHTML(p.time_zone)} × ${escapeHTML(p.age)}</span>
                        <span style="color: #7f8c8d; font-size: 0.75rem;">${escapeHTML(p.usage_scene)}</span>
                    </div>
                `;
            });
            html += `</div></div>`;
        }

        // --- 4. 🌦️ 天候別の行動変容分析 ---
        if (advanced.weather_behavior && advanced.weather_behavior.length > 0) {
            html += `
                <div style="background: #fff; padding: 15px; border-radius: 12px; border: 1px dashed #bdc3c7;">
                    <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0 0 10px 0; font-weight: bold;">🌦️ 天候別の行動変容</p>
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem; text-align: center;">
                        <thead>
                            <tr style="background: #f8f9fa; border-bottom: 1px solid #eee;">
                                <th style="padding: 6px; color: var(--text-sub);">天候</th>
                                <th style="padding: 6px; color: var(--text-sub);">☕️ 店内</th>
                                <th style="padding: 6px; color: var(--text-sub);">🥡 持帰</th>
                                <th style="padding: 6px; color: var(--text-sub);">🛍️ 物販</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            advanced.weather_behavior.forEach(w => {
                html += `
                    <tr style="border-bottom: 1px solid #f1f2f6;">
                        <td style="padding: 8px; font-size: 1.1rem;">${escapeHTML(w.weather_icon)}</td>
                        <td style="padding: 8px; color: var(--text-main); font-weight: bold;">${w.eat_in_count}</td>
                        <td style="padding: 8px; color: var(--text-main);">${w.takeout_count}</td>
                        <td style="padding: 8px; color: var(--text-main);">${w.merch_count}</td>
                    </tr>
                `;
            });
            html += `</tbody></table></div>`;
        }

        // --- 5. 🔥 時間帯別利用トレンド（ヒートマップ） ---
        const heatmap = b2bData.heatmap || [];
        const timeZoneMap = {
            'morning': { label: '🌅 朝の部', order: 1 },
            'afternoon': { label: '☀️ 昼の部', order: 2 },
            'evening': { label: '🌇 夕の部', order: 3 },
            'night': { label: '🌙 夜の部', order: 4 }
        };
        
        const groupedData = heatmap.reduce((acc, curr) => {
            if (!acc[curr.time_zone]) acc[curr.time_zone] = [];
            acc[curr.time_zone].push(curr);
            return acc;
        }, {});

        if (Object.keys(groupedData).length > 0) {
            html += `
                <div style="background: #f8f9fa; padding: 15px; border-radius: 12px; border: 1px dashed #bdc3c7;">
                    <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0 0 12px 0; font-weight: bold;">🔥 時間帯別利用トレンド</p>
            `;
            
            Object.keys(groupedData).sort((a, b) => timeZoneMap[a].order - timeZoneMap[b].order).forEach(tz => {
                const items = groupedData[tz];
                const maxCountForTz = Math.max(...items.map(i => i.count));
                
                html += `
                    <div style="margin-bottom: 14px; border-bottom: 1px solid #eee; padding-bottom: 8px;">
                        <span style="font-size: 0.75rem; color: var(--text-sub); display:block; margin-bottom: 6px; font-weight: bold;">${timeZoneMap[tz].label}</span>
                `;
                
                items.forEach(item => {
                    const percent = Math.max(5, Math.round((item.count / maxCountForTz) * 100));
                    html += `
                        <div style="display: flex; align-items: center; margin-bottom: 6px; gap: 8px;">
                            <span style="font-size: 0.75rem; width: 85px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: var(--text-main);">${escapeHTML(item.usage_type)}</span>
                            <div style="flex: 1; background: #ecf0f1; height: 10px; border-radius: 5px; overflow: hidden;">
                                <div style="width: ${percent}%; height: 100%; background-color: #e67e22; opacity: ${0.4 + (percent / 100) * 0.6}; border-radius: 5px; transition: width 1s ease;"></div>
                            </div>
                            <span style="font-size: 0.7rem; color: var(--text-sub); width: 25px; text-align: right;">${item.count}</span>
                        </div>
                    `;
                });
                html += `</div>`;
            });
            html += `</div>`;
        }

        // --- 6. 🤖 AI認識 vs 👤 顧客の主観 (タグギャップ分析) ---
        if (advanced.tag_gap) {
            html += `
                <div style="background: #fff; padding: 15px; border-radius: 12px; border: 1px dashed #bdc3c7;">
                    <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0 0 10px 0; font-weight: bold;">🤖 AI分析 vs 👤 顧客の声 (ギャップ)</p>
                    <div style="display: flex; gap: 10px; flex-direction: column;">
                        <div style="background: #f8f9fa; padding: 10px; border-radius: 8px; border-left: 3px solid #f39c12;">
                            <span style="font-size: 0.7rem; font-weight: bold; color: #7f8c8d; display: block; margin-bottom: 6px;">AI (客観的抽出)</span>
                            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                                ${advanced.tag_gap.ai_generated.map(t => `<span style="font-size:0.7rem; background:#fff; border: 1px solid #e0e0e0; padding:3px 8px; border-radius:12px;">${escapeHTML(t.tag)} <span style="color:#aaa; font-size:0.6rem;">x${t.count}</span></span>`).join('')}
                            </div>
                        </div>
                        <div style="background: #fdfefe; border: 1px solid #eee; padding: 10px; border-radius: 8px; border-left: 3px solid #2ecc71;">
                            <span style="font-size: 0.7rem; font-weight: bold; color: #7f8c8d; display: block; margin-bottom: 6px;">ユーザー入力 (主観)</span>
                            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                                ${advanced.tag_gap.user_generated.map(t => `<span style="font-size:0.7rem; background:#f9ebea; padding:3px 8px; border-radius:12px; color: #c0392b;">${escapeHTML(t.tag)} <span style="color:#aaa; font-size:0.6rem;">x${t.count}</span></span>`).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // --- 7. 👤 年齢・性別分布 (分離したモジュールから描画) ---
        html += `
            <div style="background: #f8f9fa; padding: 15px; border-radius: 12px; border: 1px dashed #bdc3c7;">
                ${generateDemographicsHTML(demoResult)}
            </div>
        `;

        // 外枠終了
        html += `</div>`; 
        
        // DOMへ一括流し込み
        container.innerHTML = html;

    } catch (err) {
        console.error('[DX Alert] B2B Analytics Render Error:', err);
        container.innerHTML = `
            <div style="text-align:center; padding: 20px; color: #e74c3c; background: #fadbd8; border-radius: 12px; margin-top: 15px;">
                <p style="margin: 0 0 5px 0; font-weight: bold;">❌ データの読み込みに失敗しました</p>
                <span style="font-size:0.8rem;">${escapeHTML(err.message)}</span>
            </div>
        `;
    }
}