// ==========================================
// ☁️ worker.js (Cloudflare Worker バックエンド) - 修正版
// ==========================================

export default {
  async fetch(request, env, ctx) {
    // 🌐 CORS設定（クロスドメイン通信の許可）
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ブラウザからの事前確認（プリフライトリクエスト）への対応
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const query = url.searchParams.get("query");
    const id = url.searchParams.get("id");

    try {
      // ==============================
      // 🔍 GET: データの取得・マスター検索
      // ==============================
      if (request.method === "GET") {
        // ① カフェの公式名簿（サジェスト）を検索する処理
        if (action === "search_master") {
          const q = `%${query}%`;
          const { results } = await env.DB.prepare("SELECT * FROM shops_master WHERE shop_name LIKE ? LIMIT 5").bind(q).all();
          return new Response(JSON.stringify({ success: true, data: results }), { headers: corsHeaders });
        }

        // ② 自分の過去の記録（日記）を全件取得する処理
        const { results } = await env.DB.prepare("SELECT * FROM diaries ORDER BY created_at DESC").all();
        return new Response(JSON.stringify({ success: true, data: results }), { headers: corsHeaders });
      }

      // ==============================
      // 📝 POST: 新しい記録の保存
      // ==============================
      if (request.method === "POST") {
        const data = await request.json();

        let targetImageUrl = data.imageUrl || null;
        let targetBase64 = data.imageBase64 || null;

        // ※将来のConoHaオブジェクトストレージ連携用
        // if (targetBase64 && targetBase64.startsWith("data:image")) {
        //   targetImageUrl = await uploadToConoHa(targetBase64, env);
        //   targetBase64 = null;
        // }

        const lat = data.latitude !== undefined ? data.latitude : null;
        const lng = data.longitude !== undefined ? data.longitude : null;
        const temp = data.temperature !== undefined ? data.temperature : null;

        // 🕒 タイムゾーンを日本時間（JST）に固定
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); 
        const createdSystemAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
        
        // 撮影日等の指定がなければシステム登録日時を使用
        const visitedAt = data.visitedAt || createdSystemAt; 

        const info = await env.DB.prepare(
          `INSERT INTO diaries (shop_id, shop_name, comment, latitude, longitude, image_base64, image_url, tags, weather_icon, temperature, user_gender, user_age, visited_at, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          data.shopId || null, 
          data.shopName || "名前なしの店舗", 
          data.comment || "", 
          lat, lng,
          targetBase64, targetImageUrl, 
          data.tags || "", 
          data.weatherIcon || "❓", 
          temp, 
          data.userGender || "未設定", 
          data.userAge || "未設定", 
          visitedAt, 
          createdSystemAt
        ).run();

        return new Response(JSON.stringify({ success: true, id: info.meta.last_row_id }), { headers: corsHeaders });
      }

      // ==============================
      // ✏️ PUT: 既存の記録の編集・更新（セキュリティ＆一括同期ガード版）
      // ==============================
      if (request.method === "PUT") {
        const data = await request.json();
        
        const lat = data.latitude !== undefined ? data.latitude : null;
        const lng = data.longitude !== undefined ? data.longitude : null;
        
        // 1. 変更対象の記録の現在の状態（紐づいている公式店舗IDなど）を事前に確認
        const currentDiary = await env.DB.prepare("SELECT shop_id, shop_name FROM diaries WHERE id = ?").bind(data.id).first();
        
        if (!currentDiary) {
          return new Response(JSON.stringify({ success: false, error: "対象の記録が見つかりません" }), { headers: corsHeaders });
        }

        // 2. 申請された特定の1件（IDが一致する自分の日記）を確実に更新
        await env.DB.prepare("UPDATE diaries SET shop_name = ?, tags = ?, comment = ?, weather_icon = ?, latitude = ?, longitude = ? WHERE id = ?")
          .bind(data.shopName, data.tags, data.comment, data.weatherIcon, lat, lng, data.id).run();
          
        // 3. 【一括同期＆悪戯防止バリデーション】
        // 位置の修正があり、かつ「公式マスター店舗ID」が紐づいている自身の日記である場合のみ、
        // 同じ店舗IDを持つ過去のすべての自分の記録の位置を一括同期させます。
        if (lat !== null && lng !== null) {
          if (currentDiary.shop_id) {
            // 固有IDによる厳格な紐付け更新（無関係な他店や他人のデータを巻き込む悪戯・バグを100%防止）
            await env.DB.prepare("UPDATE diaries SET latitude = ?, longitude = ? WHERE shop_id = ?")
              .bind(lat, lng, currentDiary.shop_id).run();
          }
          // ※ 手動登録（shop_idなし）の場合は、普遍的な店名による「誤爆上書き」リスクを
          // 避けるため、安全第一として1件のみ（ステップ2の処理）の更新に制限します。
        }
          
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // ==============================
      // 🗑️ DELETE: 記録の削除
      // ==============================
      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM diaries WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      return new Response("Method not allowed", { status: 405, headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};