// ==========================================
// 📊 src/components/b2b/demographics.js
// ==========================================
import { escapeHTML } from '../../utils/text.js'; // 既存のXSS対策ユーティリティ

/**
 * 年齢・性別分布のHTML文字列を生成する関数
 * @param {Object} analyticsData - APIから取得した { total, genders, ages } のオブジェクト
 * @returns {string} 描画用のHTML文字列
 */
export function generateDemographicsHTML(analyticsData) {
    const { total, genders, ages } = analyticsData;

    // データが1件もない場合のフォールバック
    if (!total || total === 0) {
        return `<p style="color: var(--text-sub); font-size: 0.85rem; text-align: center; padding: 10px 0;">まだデータがありません</p>`;
    }

    // ==========================================
    // 1. 性別分布（積み上げ横棒グラフ）
    // ==========================================
    const maleCount = genders['男性'] || 0;
    const femaleCount = genders['女性'] || 0;
    const otherCount = total - maleCount - femaleCount; // 未設定など

    // 割合（パーセンテージ）の計算
    const malePct = ((maleCount / total) * 100).toFixed(1);
    const femalePct = ((femaleCount / total) * 100).toFixed(1);
    const otherPct = ((otherCount / total) * 100).toFixed(1);

    let html = `
        <div style="margin-top: 10px; animation: fadeIn 0.4s ease;">
            <!-- 性別ブロック -->
            <div style="margin-bottom: 20px;">
                <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0 0 6px 0; font-weight: bold;">👥 性別割合</p>
                
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: bold; margin-bottom: 4px;">
                    ${maleCount > 0 ? `<span style="color: #3498db;">男性 ${malePct}%</span>` : ''}
                    ${femaleCount > 0 ? `<span style="color: #e74c3c;">女性 ${femalePct}%</span>` : ''}
                    ${otherCount > 0 ? `<span style="color: #95a5a6;">未設定 ${otherPct}%</span>` : ''}
                </div>
                
                <!-- CSSフレックスボックスによるプログレスバー -->
                <div style="display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: #ecf0f1;">
                    <div style="width: ${malePct}%; background-color: #3498db; transition: width 1s ease;"></div>
                    <div style="width: ${femalePct}%; background-color: #e74c3c; transition: width 1s ease;"></div>
                    <div style="width: ${otherPct}%; background-color: #95a5a6; transition: width 1s ease;"></div>
                </div>
            </div>
    `;

    // ==========================================
    // 2. 年齢分布（独立した横棒グラフ）
    // ==========================================
    // 年代がきれいに並ぶように順序を定義
    const ageLabels = ['10代', '20代', '30代', '40代', '50代', '60代以上', '未設定'];

    html += `
            <!-- 年齢ブロック -->
            <div>
                <p style="font-size: 0.85rem; color: var(--text-sub); margin: 0 0 10px 0; font-weight: bold;">🎂 年齢層</p>
                <div style="display: flex; flex-direction: column; gap: 8px;">
    `;

    // グラフのバーの長さを相対的に計算するため、最も人数の多い年代のカウントを取得
    const maxAgeCount = Math.max(...Object.values(ages), 1);

    ageLabels.forEach(age => {
        const count = ages[age] || 0;
        
        // 0人の年代は非表示にすることで、UIをスッキリ保つ（DX視点のノイズ除去）
        if (count === 0) return;

        // バーの描画幅（最大値に対する割合）と、表示用の割合（全体に対する割合）を分ける
        const percentOfMax = ((count / maxAgeCount) * 100).toFixed(1);
        const percentOfTotal = ((count / total) * 100).toFixed(1);

        html += `
            <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 3px; color: var(--text-main);">
                    <span>${escapeHTML(age)}</span>
                    <span style="font-weight: bold;">${count}人 <span style="color: var(--text-sub); font-weight: normal;">(${percentOfTotal}%)</span></span>
                </div>
                <div style="background: #ecf0f1; height: 8px; border-radius: 4px; overflow: hidden;">
                    <!-- メインカラー(例: 紫)でバーを描画 -->
                    <div style="width: ${percentOfMax}%; height: 100%; background-color: #8e44ad; border-radius: 4px; transition: width 1s ease;"></div>
                </div>
            </div>
        `;
    });

    html += `
                </div>
            </div>
        </div>
    `;

    return html;
}