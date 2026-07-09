// ==========================================
// ☁️ worker.js (Cloudflare Worker バックエンド) - AI連携対応版
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
    const id = url.searchParams.get("id");

    try {
      if (request.method === "GET") {
        if (action === "search_master") {
          const query = url.searchParams.get("query");
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
        const comment = data.comment || "";

        // ==========================================
        // 🤖 Cloudflare Workers AI による自動タグ抽出
        // ==========================================
        let aiExtractedTags = "";
        if (env.AI && comment.length > 5) { // 5文字以上の感想がある場合のみAIを起動
          try {
            const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
              messages: [
                { 
                  role: "system", 
                  content: "あなたは優秀なデータアナリストです。ユーザーの入力から、コーヒーの銘柄（コロンビア等）、特徴（デカフェ等）、滞在目的・感情（読書、静か等）を表す単語を抽出し、カンマ区切り（例: コロンビア,デカフェ,読書）でのみ出力してください。挨拶や説明は絶対に書かないでください。" 
                },
                { 
                  role: "user", 
                  content: comment 
                }
              ]
            });
            
            if (aiResponse && aiResponse.response) {
              // AIの返答から不要な改行や記号を掃除し、各タグの頭に「🤖」を付与
              const rawTags = aiResponse.response.trim().replace(/^"|"$/g, '').replace(/、/g, ',');
              aiExtractedTags = rawTags.split(',').map(t => `🤖${t.trim()}`).filter(t => t !== "🤖").join(', ');
            }
          } catch (err) {
            console.log("AI Extraction Error:", err);
            // エラー時は何もしない（通常の記録処理を続行させるため）
          }
        }

        // フロントエンドから送られた基本タグ（店内など）とAIタグを結合
        let combinedTags = data.tags || "";
        if (aiExtractedTags) {
          combinedTags = combinedTags ? `${combinedTags}, ${aiExtractedTags}` : aiExtractedTags;
        }

        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); 
        const createdSystemAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
        const visitedAt = data.visitedAt || createdSystemAt; 

        // データベースへ保存（combinedTags を記録）
        const info = await env.DB.prepare(
          `INSERT INTO diaries (shop_id, shop_name, comment, latitude, longitude, image_base64, image_url, tags, weather_icon, temperature, user_gender, user_age, visited_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          data.shopId || null, data.shopName || "名前なしの店舗", comment, lat, lng,
          targetBase64, targetImageUrl, combinedTags, data.weatherIcon || "❓", temp, 
          data.userGender || "未設定", data.userAge || "未設定", visitedAt, createdSystemAt
        ).run();

        return new Response(JSON.stringify({ success: true, id: info.meta.last_row_id }), { headers: corsHeaders });
      }

      if (request.method === "PUT") {
        const data = await request.json();
        const lat = data.latitude !== undefined ? data.latitude : null;
        const lng = data.longitude !== undefined ? data.longitude : null;
        const targetId = Number(data.id); 
        
        const currentDiary = await env.DB.prepare("SELECT shop_id, shop_name FROM diaries WHERE id = ?").bind(targetId).first();
        if (!currentDiary) return new Response(JSON.stringify({ success: false, error: "対象の記録が見つかりません" }), { headers: corsHeaders });

        const info = await env.DB.prepare("UPDATE diaries SET shop_name = ?, tags = ?, comment = ?, weather_icon = ?, latitude = ?, longitude = ? WHERE id = ?")
          .bind(data.shopName, data.tags, data.comment, data.weatherIcon, lat, lng, targetId).run();
          
        if (info.meta.changes === 0) {
           return new Response(JSON.stringify({ success: false, error: "データベースの書き込みが空振りしました（ID不一致）" }), { headers: corsHeaders });
        }
          
        if (lat !== null && lng !== null) {
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