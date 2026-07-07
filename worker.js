// ==========================================
// ☁️ worker.js (Cloudflare Worker バックエンド) - 強制同期版
// ==========================================

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const query = url.searchParams.get("query");
    const id = url.searchParams.get("id");

    try {
      if (request.method === "GET") {
        if (action === "search_master") {
          const q = `%${query}%`;
          const { results } = await env.DB.prepare("SELECT * FROM shops_master WHERE shop_name LIKE ? LIMIT 5").bind(q).all();
          return new Response(JSON.stringify({ success: true, data: results }), { headers: corsHeaders });
        }
        const { results } = await env.DB.prepare("SELECT * FROM diaries ORDER BY created_at DESC").all();
        return new Response(JSON.stringify({ success: true, data: results }), { headers: corsHeaders });
      }

      if (request.method === "POST") {
        const data = await request.json();
        let targetImageUrl = data.imageUrl || null;
        let targetBase64 = data.imageBase64 || null;
        const lat = data.latitude !== undefined ? data.latitude : null;
        const lng = data.longitude !== undefined ? data.longitude : null;
        const temp = data.temperature !== undefined ? data.temperature : null;

        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); 
        const createdSystemAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
        const visitedAt = data.visitedAt || createdSystemAt; 

        const info = await env.DB.prepare(
          `INSERT INTO diaries (shop_id, shop_name, comment, latitude, longitude, image_base64, image_url, tags, weather_icon, temperature, user_gender, user_age, visited_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          data.shopId || null, data.shopName || "名前なしの店舗", data.comment || "", lat, lng,
          targetBase64, targetImageUrl, data.tags || "", data.weatherIcon || "❓", temp, 
          data.userGender || "未設定", data.userAge || "未設定", visitedAt, createdSystemAt
        ).run();

        return new Response(JSON.stringify({ success: true, id: info.meta.last_row_id }), { headers: corsHeaders });
      }

      if (request.method === "PUT") {
        const data = await request.json();
        const lat = data.latitude !== undefined ? data.latitude : null;
        const lng = data.longitude !== undefined ? data.longitude : null;
        
        const currentDiary = await env.DB.prepare("SELECT shop_id, shop_name FROM diaries WHERE id = ?").bind(data.id).first();
        if (!currentDiary) return new Response(JSON.stringify({ success: false, error: "対象の記録が見つかりません" }), { headers: corsHeaders });

        await env.DB.prepare("UPDATE diaries SET shop_name = ?, tags = ?, comment = ?, weather_icon = ?, latitude = ?, longitude = ? WHERE id = ?")
          .bind(data.shopName, data.tags, data.comment, data.weatherIcon, lat, lng, data.id).run();
          
        if (lat !== null && lng !== null) {
          // ★修正ポイント：shop_idが明確に存在する場合以外は、すべて「店名」で強制的に一括同期する
          if (currentDiary.shop_id && currentDiary.shop_id !== "null" && currentDiary.shop_id !== "") {
            await env.DB.prepare("UPDATE diaries SET latitude = ?, longitude = ? WHERE shop_id = ?").bind(lat, lng, currentDiary.shop_id).run();
          } else {
            await env.DB.prepare("UPDATE diaries SET latitude = ?, longitude = ? WHERE shop_name = ?").bind(lat, lng, data.shopName).run();
          }
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      if (request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM diaries WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: corsHeaders });
    }
  }
};