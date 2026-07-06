// ==========================================
// ☁️ worker.js (Cloudflare Worker バックエンド)
// ==========================================

export default {
  async fetch(request, env, ctx) {
    // 🌐 CORS設定（どのURLからでもアクセスを許可する）
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ブラウザの事前確認（プリフライトリクエスト）への対応
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

        // ※将来的にここにConoHa連携の関数を組み込みます
        // if (targetBase64 && targetBase64.startsWith("data:image")) {
        //   targetImageUrl = await uploadToConoHa(targetBase64, env);
        //   targetBase64 = null;
        // }

        const lat = data.latitude !== undefined ? data.latitude : null;
        const lng = data.longitude !== undefined ? data.longitude : null;
        const temp = data.temperature !== undefined ? data.temperature : null;

        // 🕒 時間を確実に日本時間（JST）にする処理
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); 
        const createdSystemAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
        
        // 訪問日の指定がなければ、システム登録日を訪問日とする
        const visitedAt = data.visitedAt || createdSystemAt; 

        // データベース（D1）に保存
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
      // ✏️ PUT: 既存の記録の編集・更新
      // ==============================
      if (request.method === "PUT") {
        const data = await request.json();
        
        // 緯度・経度の更新データを受け取る（マップからの修正機能）
        const lat = data.latitude !== undefined ? data.latitude : null;
        const lng = data.longitude !== undefined ? data.longitude : null;
        
        await env.DB.prepare("UPDATE diaries SET shop_name = ?, tags = ?, comment = ?, weather_icon = ?, latitude = ?, longitude = ? WHERE id = ?")
          .bind(data.shopName, data.tags, data.comment, data.weatherIcon, lat, lng, data.id).run();
          
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // ==============================
      // 🗑️ DELETE: 記録の削除
      // ==============================
      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM diaries WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // 上記以外のメソッド（PATCHなど）が来た場合のエラー処理
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });

    } catch (error) {
      // データベースエラー等が起きた場合は詳細を返す
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};