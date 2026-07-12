// ==========================================
// 🛡️ 権限チェックミドルウェア (門番)
// ==========================================
async function checkAuthorization(request, env, requiredRoles = []) {
  // 1. ヘッダーから UUID を抽出
  let userUuid = request.headers.get("X-Ezo-User-UUID");
  
  // POSTリクエストなどでヘッダーにない場合のフォールバック(URLパラメータ等)
  if (!userUuid) {
      const url = new URL(request.url);
      userUuid = url.searchParams.get("uuid");
  }

  if (!userUuid) {
    return { authorized: false, status: 401, error: "Authentication Required: ユーザーUUIDが提供されていません。" };
  }

  try {
    // 2. D1データベースからユーザー情報を取得
    const user = await env.DB.prepare("SELECT role, associated_shop_id FROM users WHERE user_uuid = ?")
      .bind(userUuid)
      .first();

    // 3. 未登録ユーザーの場合、自動的に Free ユーザーとして登録 (オンボーディング)
    if (!user) {
      const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
      await env.DB.prepare("INSERT INTO users (user_uuid, role, created_at, updated_at) VALUES (?, 'free', ?, ?)")
        .bind(userUuid, now, now)
        .run();
      
      const isAuthorized = requiredRoles.length === 0 || requiredRoles.includes("free");
      return {
        authorized: isAuthorized,
        status: isAuthorized ? 200 : 403,
        user: { userUuid: userUuid, role: "free", associated_shop_id: null }
      };
    }

    // 4. ロール（権限）の検証
    // 管理者(admin)は特権として無条件で全操作を通過できるようにする
    if (requiredRoles.length > 0 && !requiredRoles.includes(user.role) && user.role !== "admin") {
      return { authorized: false, status: 403, error: `Forbidden: この操作には ${requiredRoles.join(" または ")} 権限が必要です。` };
    }

    // 検証通過
    return { authorized: true, status: 200, user: { userUuid: userUuid, ...user } };

  } catch (err) {
    return { authorized: false, status: 500, error: "D1_AUTH_ERROR: " + err.message };
  }
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Ezo-User-UUID",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    // ==========================================
    // 🗑️ データの削除 (DELETEリクエスト)
    // ==========================================
    if (request.method === "DELETE") {
      // 🔒 削除は Free, Premium に許可 (Adminはミドルウェア側で自動許可)
      const auth = await checkAuthorization(request, env, ["free", "premium"]);
      if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

      try {
        const id = url.searchParams.get("id");
        if (!id) throw new Error("IDが指定されていません");
        
        // 管理者は全件削除可能、一般ユーザーは自分のUUIDに紐づくデータのみ削除可能に制限
        if (auth.user.role === "admin") {
          await env.DB.prepare("DELETE FROM diaries WHERE id = ?").bind(id).run();
        } else {
          await env.DB.prepare("DELETE FROM diaries WHERE id = ? AND user_uuid = ?").bind(id, auth.user.userUuid).run();
        }
        
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==========================================
    // 📥 データの取得 (GETリクエスト)
    // ==========================================
    if (request.method === "GET") {
      // ユーザー自身の権限情報を取得するためのエンドポイント
      if (action === "get_me") {
        const auth = await checkAuthorization(request, env, []); 
        if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        return new Response(JSON.stringify(auth.user), { headers: corsHeaders });
      }

      // データの読み込みは全ユーザーに一旦許可
      const auth = await checkAuthorization(request, env, ["free", "premium", "business"]);
      if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

      try {
        if (action === "search_master") {
          // サジェスト検索は、ユーザーの利便性（自由な記録）のため全件から検索可能にする
          const query = url.searchParams.get("query") || "";
          const { results } = await env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude FROM shops_master WHERE shop_name LIKE ? LIMIT 10").bind(`%${query}%`).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });

        } else if (action === "get_all_master") {
          // 🗺️ マップ描画用のマスタ全件取得
          if (auth.user.role === "admin") {
            // 管理者(Admin)は、非表示(is_local=0)のチェーン店も含めて全件見れる
            const { results } = await env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude, is_local FROM shops_master").all();
            return new Response(JSON.stringify(results), { headers: corsHeaders });
          } else {
            // 一般ユーザー(Free/Premium)には、ローカル店(is_local=1)のみを返却してデータ量を削減
            const { results } = await env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude FROM shops_master WHERE is_local = 1").all();
            return new Response(JSON.stringify(results), { headers: corsHeaders });
          }

        } else {
          // 日記データの取得
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
        
        // 👑 管理者バックドア用アクション（チェーン店非表示切替）
        if (data.action === "toggle_local") {
            const auth = await checkAuthorization(request, env, ["admin"]); // 管理者のみ許可
            if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
            if (!data.shopId) return new Response(JSON.stringify({ error: "shopIdが必要です" }), { status: 400, headers: corsHeaders });

            await env.DB.prepare("UPDATE shops_master SET is_local = ? WHERE shop_id = ?").bind(data.isLocal, data.shopId).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        // 🔒 データ保存は Free, Premium に許可 (Adminも通過可能)
        const auth = await checkAuthorization(request, env, ["free", "premium"]);
        if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const comment = data.comment || "";
        const lat = data.lat || null;
        const lng = data.lng || null;
        const temp = data.temperature || null;
        const weatherIcon = data.weatherIcon || "❓"; 
        
        const userGender = data.userGender || "未設定";
        const userAge = data.userAge || "未設定";
        // 門番が検証した信頼できるUUIDを使用
        const userUuid = auth.user.userUuid;

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

        // 🤖 テキストのAIモデレーション ＆ 構造化タグ抽出
        let aiExtractedTags = "";
        let unclassifiedTags = [];
        
        if (env.AI && comment.length > 5 && moderationTag === "") {
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

        let combinedTags = data.tags || "";
        if (moderationTag !== "") combinedTags = combinedTags ? `${combinedTags}, ${moderationTag}` : moderationTag;
        else if (aiExtractedTags) combinedTags = combinedTags ? `${combinedTags}, ${aiExtractedTags}` : aiExtractedTags;

        // ▼ 🔄 ループエンジニアリング：未分類タグのGASエスカレーション
        if (unclassifiedTags && unclassifiedTags.length > 0) {
          const gasWebhookUrl = env.GAS_WEBHOOK_URL || ""; 
          if (gasWebhookUrl) {
            const errorReportData = { shopName: data.shopName || "名前なし", unclassified: unclassifiedTags, comment: comment };
            ctx.waitUntil(
              fetch(gasWebhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(errorReportData) })
              .catch(err => console.log("GAS Webhook Error:", err))
            );
          }
        }

        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); 
        const createdSystemAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
        const visitedAt = data.visitedAt || createdSystemAt; 

        if (data.id) {
          // 自分自身のデータのみ上書き可能にする安全装置（UPDATE文に user_uuid = ? を追加）
          if (targetBase64) {
            await env.DB.prepare(`UPDATE diaries SET shop_name = ?, comment = ?, tags = ?, visited_at = ?, image_base64 = ?, weather_icon = ?, temperature = ?, latitude = ?, longitude = ? WHERE id = ? AND user_uuid = ?`)
              .bind(data.shopName, comment, combinedTags, visitedAt, targetBase64, weatherIcon, temp, lat, lng, data.id, userUuid).run();
          } else {
            await env.DB.prepare(`UPDATE diaries SET shop_name = ?, comment = ?, tags = ?, visited_at = ?, weather_icon = ?, temperature = ?, latitude = ?, longitude = ? WHERE id = ? AND user_uuid = ?`)
              .bind(data.shopName, comment, combinedTags, visitedAt, weatherIcon, temp, lat, lng, data.id, userUuid).run();
          }
          return new Response(JSON.stringify({ success: true, id: data.id }), { headers: corsHeaders });
        } else {
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