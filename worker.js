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
          const { results } = await env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude FROM shops_master WHERE shop_name LIKE ? LIMIT 10").bind(`%${query}%`).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        } else if (action === "get_all_master") {
          const { results } = await env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude FROM shops_master").all();
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
        
        const userGender = data.userGender || "未設定";
        const userAge = data.userAge || "未設定";
        // 🆕 🧠 匿名UUIDの受け取り
        const userUuid = data.userUuid || null;

        let targetBase64 = data.imageBase64 || null;
        let moderationTag = ""; 

        // 👁️ 画像のAIモデレーション
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

        // 🤖 テキストのAIモデレーション ＆ 構造化タグ抽出 (JSON)
        let aiExtractedTags = "";
        let unclassifiedTags = [];
        
        if (env.AI && comment.length > 5 && moderationTag === "") {
          // 🆕 🧠 プロンプト強化：テイクアウト廃止などをAIに自動検知させる
          const systemPrompt = `
あなたはカフェデータアナリストです。入力された日記から以下のJSONフォーマットでタグを抽出してください。
厳密にJSON形式のみを出力し、マークダウン(\`\`\`json など)やその他のテキストは一切含めないでください。

{
  "moderation": "OK" または "🚨共有不可" または "🚨要確認",
  "tags": {
    "coffee": ["抽出したコーヒー関連のタグ(品種, 焙煎, 抽出方法など)"],
    "food": ["抽出したフード関連のタグ(ランチ, ケーキなど)"],
    "atmosphere": ["抽出した雰囲気や設備のタグ。なお、もし日記内にテイクアウトや物販が終了・廃止されたという記述があれば、それぞれ『テイクアウト廃止』や『物販終了』というキーワードをここに含めてください"]
  },
  "unclassified": ["上記に分類できないが重要そうなキーワード"]
}`;

          try {
            const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: comment }
              ]
            });
            
            if (aiResponse && aiResponse.response) {
              let rawText = aiResponse.response.trim();
              rawText = rawText.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

              const result = JSON.parse(rawText);
              
              if (result.moderation !== "OK") {
                moderationTag = result.moderation;
              } else {
                const coffeeTags = (result.tags.coffee || []).map(t => `🤖☕️${t}`);
                const foodTags = (result.tags.food || []).map(t => `🤖🍰${t}`);
                const atmosphereTags = (result.tags.atmosphere || []).map(t => `🤖🛋️${t}`);
                
                aiExtractedTags = [...coffeeTags, ...foodTags, ...atmosphereTags].join(', ');
                unclassifiedTags = result.unclassified || [];
              }
            }
          } catch (err) { 
            console.log("AI Text Extraction & Parse Error:", err); 
            unclassifiedTags = ["AIパースエラー"];
          }
        }

        // 🔒 タグの結合
        let combinedTags = data.tags || "";
        if (moderationTag !== "") combinedTags = combinedTags ? `${combinedTags}, ${moderationTag}` : moderationTag;
        else if (aiExtractedTags) combinedTags = combinedTags ? `${combinedTags}, ${aiExtractedTags}` : aiExtractedTags;

        // ▼ 🔄 ループエンジニアリング：未分類タグのGASエスカレーション
        if (unclassifiedTags && unclassifiedTags.length > 0) {
          const gasWebhookUrl = env.GAS_WEBHOOK_URL || ""; 
          
          if (gasWebhookUrl) {
            const errorReportData = {
              shopName: data.shopName || "名前なし",
              unclassified: unclassifiedTags,
              comment: comment
            };
            ctx.waitUntil(
              fetch(gasWebhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(errorReportData)
              }).catch(err => console.log("GAS Webhook Error:", err))
            );
          }
        }

        // 📅 日時の設定
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); 
        const createdSystemAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
        const visitedAt = data.visitedAt || createdSystemAt; 

        // 💾 データベース(D1)への保存・更新分岐
        if (data.id) {
          // ※編集時(UPDATE)はユーザーが変わることはないため、user_uuidの上書きはスキップして安全性を保ちます
          if (targetBase64) {
            await env.DB.prepare(`UPDATE diaries SET shop_name = ?, comment = ?, tags = ?, visited_at = ?, image_base64 = ?, weather_icon = ?, temperature = ?, latitude = ?, longitude = ? WHERE id = ?`)
              .bind(data.shopName, comment, combinedTags, visitedAt, targetBase64, weatherIcon, temp, lat, lng, data.id).run();
          } else {
            await env.DB.prepare(`UPDATE diaries SET shop_name = ?, comment = ?, tags = ?, visited_at = ?, weather_icon = ?, temperature = ?, latitude = ?, longitude = ? WHERE id = ?`)
              .bind(data.shopName, comment, combinedTags, visitedAt, weatherIcon, temp, lat, lng, data.id).run();
          }
          return new Response(JSON.stringify({ success: true, id: data.id }), { headers: corsHeaders });
        } else {
          // 🆕 🧠 新規登録時(INSERT)に、user_uuid を確実に保存！
          const info = await env.DB.prepare(
            `INSERT INTO diaries (shop_id, shop_name, comment, latitude, longitude, image_base64, image_url, tags, weather_icon, temperature, user_gender, user_age, user_uuid, visited_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(data.shopId || null, data.shopName || "名前なし", comment, lat, lng, targetBase64, null, combinedTags, weatherIcon, temp, userGender, userAge, userUuid, visitedAt, createdSystemAt).run();
          return new Response(JSON.stringify({ success: true, id: info.meta.last_row_id }), { headers: corsHeaders });
        }
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: "D1_ERROR: " + err.message }), { status: 500, headers: corsHeaders });
      }
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};