export default {
  async fetch(request, env, ctx) {
    // ==========================================
    // 🌐 CORS設定（セキュリティ通信許可）
    // ==========================================
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // ブラウザからの事前確認（プレフライトリクエスト）への応答
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    // ==========================================
    // 📥 データの取得 (GETリクエスト)
    // ==========================================
    if (request.method === "GET") {
      try {
        if (action === "search_master") {
          // サジェスト検索用（※テーブル名やカラム名はお使いの環境に合わせています）
          const query = url.searchParams.get("query") || "";
          const { results } = await env.DB.prepare(
            "SELECT shop_name FROM shops_master WHERE shop_name LIKE ? LIMIT 10"
          ).bind(`%${query}%`).all();
          
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        } else {
          // ▼ 最新順（訪問日時の新しい順）に並び替えて全件取得
          const { results } = await env.DB.prepare(
            "SELECT * FROM diaries ORDER BY visited_at DESC, id DESC"
          ).all();
          
          return new Response(JSON.stringify(results), { headers: corsHeaders });
        }
      } catch (err) {
         return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ==========================================
    // 📤 データの保存 (POSTリクエスト)
    // ==========================================
    if (request.method === "POST") {
      try {
        // フロントエンドから送られてきたデータを受け取る
        const data = await request.json();
        const comment = data.comment || "";
        const lat = data.lat || null;
        const lng = data.lng || null;
        const temp = data.temperature || null;
        
        let targetBase64 = data.imageBase64 || null;
        let targetImageUrl = data.imageUrl || null;
        let moderationTag = ""; 

        // ==========================================
        // 👁️ 画像のAIモデレーション (Cloudflare Vision AI)
        // ==========================================
        if (env.AI && targetBase64) {
          try {
            // "data:image/jpeg;base64,..." からBase64文字列だけを抽出して変換
            const b64Data = targetBase64.split(',')[1] || targetBase64;
            const binaryStr = atob(b64Data);
            const uint8Array = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                uint8Array[i] = binaryStr.charCodeAt(i);
            }
            const imgArray = Array.from(uint8Array);

            // 画像認識AIに判定させる
            const visionResponse = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
              prompt: "あなたは画像モデレーターです。この画像が、性的な内容・わいせつなもの、またはカフェと無関係な人物の自撮り（出会い目的のプロフィール写真のようなもの）である場合は「🚨NG」、コーヒー、スイーツ、店舗の様子、風景など通常の写真であれば「OK」とだけ出力してください。",
              image: imgArray
            });

            if (visionResponse && visionResponse.response && visionResponse.response.includes("🚨NG")) {
               // 🚨不適切と判定された場合、画像データを強制的に破棄（DB容量の節約とリスク排除）
               targetBase64 = null;
               targetImageUrl = null;
               moderationTag = "🚨共有不可";
            }
          } catch (err) {
            console.log("Vision AI Error:", err);
          }
        }

        // ==========================================
        // 🤖 テキストのAIモデレーション ＆ 自動タグ抽出
        // ==========================================
        let aiExtractedTags = "";

        if (env.AI && comment.length > 5) {
          try {
            const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
              messages: [
                { 
                  role: "system", 
                  content: `あなたはカフェに特化したデータアナリストであり、コンテンツ監視員です。
ユーザーの日記の内容をチェックし、以下の優先順位でタグを出力してください。

【🚨モデレーションルール（最優先）】
1. 性的表現、わいせつな内容、出会い・ナンパ目的が含まれる場合
👉 タグ抽出を行わず「🚨共有不可」とだけ出力してください。
2. 店舗や店員に対する激しい怒り、クレーム、誹謗中傷、暴力表現が含まれる場合（※人間による後日チェックが必要なもの）
👉 タグ抽出を行わず「🚨要確認」とだけ出力してください。

【通常時の抽出対象】（※純粋な個人的な不満・好みの違いはセーフです）
1. 生産国・地域・銘柄（例: コロンビア, エチオピア, ブルーマウンテン, ゲイシャ）
2. 品種・精製・特徴（例: ブルボン, ティピカ, ウォッシュド, ナチュラル, デカフェ）
3. 農園・生産者（例: ロスノガレス農園。「〜農園」は確実に拾うこと）
4. 席・空間（例: カウンター, 窓際, 2階席, 奥の席）
5. 設備・環境（例: トイレ, コンセント, Wi-Fi, 静か）
6. 目的・感情（例: 誕生日, プレゼント, 豆の購入, ギフト, 作業, 癒やし）

ルール: 挨拶や説明文は一切不要。モデレーションに引っかかった場合は指定の🚨タグを1つだけ出力し、通常時は抽出した単語のみをカンマ区切りで出力すること。` 
                },
                { 
                  role: "user", 
                  content: comment 
                }
              ]
            });
            
            if (aiResponse && aiResponse.response) {
              const rawText = aiResponse.response.trim();
              
              if (rawText.includes("🚨共有不可")) {
                moderationTag = "🚨共有不可";
              } else if (rawText.includes("🚨要確認") && moderationTag !== "🚨共有不可") {
                // 画像がすでに「共有不可」になっていない場合のみ上書き
                moderationTag = "🚨要確認";
              } else {
                const rawTags = rawText.replace(/^"|"$/g, '').replace(/、/g, ',');
                aiExtractedTags = rawTags.split(',')
                  .map(t => t.trim())
                  .filter(t => t !== "" && t !== "なし" && t !== "該当なし" && !t.includes("🚨"))
                  .map(t => `🤖${t}`)
                  .join(', ');
              }
            }
          } catch (err) {
            console.log("AI Text Extraction Error:", err);
          }
        }

        // ==========================================
        // 🔒 タグの結合処理
        // ==========================================
        let combinedTags = data.tags || "";
        if (moderationTag !== "") {
          // 🚨AIが危険と判定した場合はAIタグは作らず指定の🚨マークだけを付与
          combinedTags = combinedTags ? `${combinedTags}, ${moderationTag}` : moderationTag;
        } else if (aiExtractedTags) {
          combinedTags = combinedTags ? `${combinedTags}, ${aiExtractedTags}` : aiExtractedTags;
        }

        // ==========================================
        // 📅 日時の設定 (日本時間 JST)
        // ==========================================
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); 
        const createdSystemAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
        const visitedAt = data.visitedAt || createdSystemAt; 

        // ==========================================
        // 💾 データベース(D1)への保存
        // ==========================================
        const info = await env.DB.prepare(
          `INSERT INTO diaries (shop_id, shop_name, comment, latitude, longitude, image_base64, image_url, tags, weather_icon, temperature, user_gender, user_age, visited_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          data.shopId || null, 
          data.shopName || "名前なしの店舗", 
          comment, 
          lat, 
          lng,
          targetBase64, 
          targetImageUrl, 
          combinedTags, 
          data.weatherIcon || "❓", 
          temp, 
          data.userGender || "未設定", 
          data.userAge || "未設定", 
          visitedAt, 
          createdSystemAt
        ).run();

        return new Response(JSON.stringify({ success: true, id: info.meta.last_row_id }), { headers: corsHeaders });
        
      } catch (err) {
        // エラーが発生した場合はフロントエンドに詳細を返す
        return new Response(JSON.stringify({ success: false, error: "D1_ERROR: " + err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // どの条件にも当てはまらない場合
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};