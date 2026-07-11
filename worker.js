export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    // ==========================================
    // 🗑️ データの削除 (DELETEリクエスト)
    // ==========================================
    if (request.method === "DELETE") {
      try {
        const id = url.searchParams.get("id");
        if (!id) throw new Error("IDが指定されていません");
        
        await env.DB.prepare("DELETE FROM diaries WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==========================================
    // 📥 データの取得 (GETリクエスト)
    // ==========================================
    if (request.method === "GET") {
      try {
        if (action === "search_master") {
          const query = url.searchParams.get("query") || "";
          // 🛠️ 修正: shop_id と shop_name の両方を取得する
          const { results } = await env.DB.prepare("SELECT shop_id, shop_name FROM shops_master WHERE shop_name LIKE ? LIMIT 10").bind(`%${query}%`).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        } else {
          const { results } = await env.DB.prepare("SELECT * FROM diaries ORDER BY visited_at DESC, id DESC").all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
      } catch (err) {
         return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==========================================
    // 📤 データの保存・更新 (POSTリクエスト)
    // ==========================================
    if (request.method === "POST") {
      try {
        const data = await request.json();
        const comment = data.comment || "";
        const lat = data.lat || null;
        const lng = data.lng || null;
        const temp = data.temperature || null;
        const weatherIcon = data.weatherIcon || "❓"; 
        
        // ▼ 修正・追加：フロントエンドから「性別」と「年代」を受け取る！
        const userGender = data.userGender || "未設定";
        const userAge = data.userAge || "未設定";

        let targetBase64 = data.imageBase64 || null;
        let moderationTag = ""; 

        // 👁️ 画像のAIモデレーション (新規画像が送られてきた時のみ)
        if (env.AI && targetBase64) {
          try {
            const b64Data = targetBase64.split(',')[1] || targetBase64;
            const binaryStr = atob(b64Data);
            const uint8Array = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) uint8Array[i] = binaryStr.charCodeAt(i);
            
            const visionResponse = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
              prompt: "あなたは画像モデレーターです。この画像が、性的な内容・わいせつなもの、またはカフェと無関係な人物の自撮りである場合は「🚨NG」、通常の写真であれば「OK」とだけ出力してください。",
              image: Array.from(uint8Array)
            });

            if (visionResponse && visionResponse.response && visionResponse.response.includes("🚨NG")) {
               targetBase64 = null;
               moderationTag = "🚨共有不可";
            }
          } catch (err) { console.log("Vision AI Error:", err); }
        }

        // 🤖 テキストのAIモデレーション ＆ 自動タグ抽出
        let aiExtractedTags = "";
        if (env.AI && comment.length > 5) {
          try {
            const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
              messages: [
                { role: "system", content: "あなたはカフェデータアナリストです。性的表現や誹謗中傷は「🚨共有不可」「🚨要確認」を。通常時は「国, 品種, 農園, 席, 設備, 目的」をカンマ区切りで出力してください。" },
                { role: "user", content: comment }
              ]
            });
            
            if (aiResponse && aiResponse.response) {
              const rawText = aiResponse.response.trim();
              if (rawText.includes("🚨共有不可")) moderationTag = "🚨共有不可";
              else if (rawText.includes("🚨要確認") && moderationTag !== "🚨共有不可") moderationTag = "🚨要確認";
              else {
                aiExtractedTags = rawText.replace(/^"|"$/g, '').replace(/、/g, ',').split(',')
                  .map(t => t.trim()).filter(t => t !== "" && t !== "なし" && !t.includes("🚨"))
                  .map(t => `🤖${t}`).join(', ');
              }
            }
          } catch (err) { console.log("AI Text Extraction Error:", err); }
        }

        // 🔒 タグの結合
        let combinedTags = data.tags || "";
        if (moderationTag !== "") combinedTags = combinedTags ? `${combinedTags}, ${moderationTag}` : moderationTag;
        else if (aiExtractedTags) combinedTags = combinedTags ? `${combinedTags}, ${aiExtractedTags}` : aiExtractedTags;

        // 📅 日時の設定
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); 
        const createdSystemAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
        const visitedAt = data.visitedAt || createdSystemAt; 

        // 💾 データベース(D1)への保存・更新分岐
        if (data.id) {
          // ✏️ 更新モード (Edit)
          // ▼ 修正：lat, lng も UPDATE の対象に含める！
          if (targetBase64) {
            await env.DB.prepare(`UPDATE diaries SET shop_name = ?, comment = ?, tags = ?, visited_at = ?, image_base64 = ?, weather_icon = ?, temperature = ?, latitude = ?, longitude = ? WHERE id = ?`)
              .bind(data.shopName, comment, combinedTags, visitedAt, targetBase64, weatherIcon, temp, lat, lng, data.id).run();
          } else {
            // 画像が選択されなかった場合は画像カラムを上書きしない
            await env.DB.prepare(`UPDATE diaries SET shop_name = ?, comment = ?, tags = ?, visited_at = ?, weather_icon = ?, temperature = ?, latitude = ?, longitude = ? WHERE id = ?`)
              .bind(data.shopName, comment, combinedTags, visitedAt, weatherIcon, temp, lat, lng, data.id).run();
          }
          return new Response(JSON.stringify({ success: true, id: data.id }), { headers: corsHeaders });
        } else {
          // 🆕 新規作成モード (Insert)
          // ▼ 修正："未設定" のハードコードを削除し、フロントから受け取った userGender と userAge を使用する！
          const info = await env.DB.prepare(
            `INSERT INTO diaries (shop_id, shop_name, comment, latitude, longitude, image_base64, image_url, tags, weather_icon, temperature, user_gender, user_age, visited_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(data.shopId || null, data.shopName || "名前なし", comment, lat, lng, targetBase64, null, combinedTags, weatherIcon, temp, userGender, userAge, visitedAt, createdSystemAt).run();
          return new Response(JSON.stringify({ success: true, id: info.meta.last_row_id }), { headers: corsHeaders });
        }
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: "D1_ERROR: " + err.message }), { status: 500, headers: corsHeaders });
      }
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};