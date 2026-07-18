// ==========================================
// 📊 src/components/b2b/analytics.js (経営者・店舗向けダッシュボード)
// 責務: APIからのデータ取得と、B2B向けUIコンポーネントの統合描画
// ==========================================
import { state } from '../../state.js'; 
import { escapeHTML } from '../../utils/text.js';
import { generateDemographicsHTML } from './demographics.js'; // 先ほど作成したモジュール

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
            <p style="animation: pulse 1.5s infinite;">📊 店舗データを集計・分析中...</p>
        </div>
    `;

    try {
        // セキュリティ: ユーザーのUUIDを取得してヘッダーに付与（権限チェック用）
        const userUuid = state?.userUuid || localStorage.getItem('ezo_user_uuid') || '';
        const headers = { 'X-Ezo-User-UUID': userUuid };
        
        // 🎯 DX実践: 異なる2つの集計APIを並列(Promise.all)で叩き、ユーザーの待ち時間を半減させる
        // ※ 本番デプロイ時は、ローカルとリモートでbaseUrlを動的に切り替える運用を推奨します
        const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'http://localhost:8787' 
            : ''; // 本番環境のURL（空文字なら相対パスで動作）

        const [b2bResponse, shopAnalyticsResponse] = await Promise.all([
            fetch(`${baseUrl}/?action=get_b2b_analytics&shop_id=${shopId}`, { method: 'GET', headers }),
            fetch(`${baseUrl}/?action=get_shop_analytics&shop_id=${shopId}`, { method: 'GET', headers })
        ]);

        // 🛡️ 権限エラー(403 Forbidden)のハンドリング: 一般ユーザーにはアップセルや警告を表示
        if (b2bResponse.status === 403 || shopAnalyticsResponse.status === 403) {
            container.innerHTML = `
                <div style="background: #fdf2e9; padding: 20px; border-radius: 12px; border: 1px solid #f39c12; text-align: center; margin-top: 15px;">
                    <p style="color: #e67e22; font-weight: bold; margin: 0 0 10px 0;">🔒 経営者・管理者専用データ</p>
                    <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0; line-height: 1.6;">
                        この店舗の「顧客ロイヤルティ」や「利用トレンド」を閲覧するには、ビジネス権限が必要です。<br>
                        ※一般ユーザーのプライバシーは完全に保護されています。
                    </p>
                </div>
            `;
            return;
        }

        const b2bResult = await b2bResponse.json();
        const demoResult = await shopAnalyticsResponse.json();

        // エラーハンドリング
        if (!b2bResult.success) throw new Error(b2bResult.error || 'B2Bデータの取得に失敗しました');

        const b2bData = b2bResult.data;
        const newCount = b2bData.loyalty.new_customers || 0;
        const repeatCount = b2bData.loyalty.repeat_customers || 0;
        
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

        // --- 1. 🤖 AI客観分析 (抽出タグ) ---
        if (demoResult.topTags && demoResult.topTags.length > 0) {
            html += `
                <div style="margin-bottom: 5px;">
                    <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0 0 8px 0; font-weight: bold;">🤖 AI客観分析（抽出タグ）</p>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            `;
            demoResult.topTags.forEach(([tag, count]) => {
                html += `<span style="background: #f39c12; color: #fff; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">${escapeHTML(tag)} <span style="font-size:0.65rem; opacity:0.9; margin-left: 2px;">x${count}</span></span>`;
            });
            html += `</div></div>`;
        }

        // --- 2. 🤝 顧客ロイヤルティ分析 (新規 vs リピーター) ---
        const totalUsers = newCount + repeatCount;
        const repeatRate = b2bData.loyalty.repeat_rate;
        const newRate = totalUsers > 0 ? ((newCount / totalUsers) * 100).toFixed(1) + '%' : '0%';

        html += `
            <div style="background: #f8f9fa; padding: 15px; border-radius: 12px; border: 1px dashed #bdc3c7;">
                <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0 0 10px 0; font-weight: bold;">🤝 顧客ロイヤルティ (新規 vs リピーター)</p>
                
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: bold; margin-bottom: 6px;">
                    <span style="color: #3498db;">新規 ${newCount}人 (${newRate})</span>
                    <span style="color: #2ecc71;">リピーター ${repeatCount}人 (${repeatRate})</span>
                </div>
                <!-- バニラCSSによるスタックド・バー -->
                <div style="display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: #ecf0f1; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
                    <div style="width: ${newRate}; background-color: #3498db; transition: width 1s ease;"></div>
                    <div style="width: ${repeatRate}; background-color: #2ecc71; transition: width 1s ease;"></div>
                </div>
            </div>
        `;

        // --- 3. 🔥 時間帯別利用トレンド（ヒートマップ） ---
        const heatmap = b2bData.heatmap || [];
        const timeZoneMap = {
            'morning': { label: '🌅 朝の部', order: 1 },
            'afternoon': { label: '☀️ 昼の部', order: 2 },
            'evening': { label: '🌇 夕の部', order: 3 },
            'night': { label: '🌙 夜の部', order: 4 }
        };
        
        // データを時間帯(morning, afternoon...)ごとにグループ化
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
            
            // 定義したorder（順番）に従ってソートして描画
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
                            <!-- 透明度(opacity)を活用したヒートマップバー -->
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

        // --- 4. 👤 年齢・性別分布 (分離したモジュールから描画) ---
        html += `
            <div style="background: #f8f9fa; padding: 15px; border-radius: 12px; border: 1px dashed #bdc3c7;">
                ${generateDemographicsHTML(demoResult)}
            </div>
        `;

        // 外枠終了
        html += `</div>`; 
        
        // DOMへ一括流し込み（レンダリング）
        container.innerHTML = html;

    } catch (err) {
        console.error('B2B Analytics Render Error:', err);
        container.innerHTML = `
            <div style="text-align:center; padding: 20px; color: #e74c3c; background: #fadbd8; border-radius: 12px; margin-top: 15px;">
                <p style="margin: 0 0 5px 0; font-weight: bold;">❌ データの読み込みに失敗しました</p>
                <span style="font-size:0.8rem;">${escapeHTML(err.message)}</span>
            </div>
        `;
    }
}