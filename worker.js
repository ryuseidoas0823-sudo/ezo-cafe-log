// ==========================================
// 🛡️ 権限チェックミドルウェア (門番)
// ==========================================
async function checkAuthorization(request, env, requiredRoles = []) {
  let userUuid = request.headers.get("X-Ezo-User-UUID");
  
  if (!userUuid) {
      const url = new URL(request.url);
      userUuid = url.searchParams.get("uuid");
  }

  if (!userUuid) {
    return { authorized: false, status: 401, error: "Authentication Required: ユーザーUUIDが提供されていません。" };
  }

  // 🌟 【DX改善】テストユーザーの特権マッピング定義
  const testUsers = {
      'test-user-premium-001': 'premium',
      'test-user-business-001': 'business',
      'test-user-admin-001': 'admin' // 念のため管理者用も定義
  };

  try {
    let user = await env.DB.prepare("SELECT role, associated_shop_id FROM users WHERE user_uuid = ?")
      .bind(userUuid)
      .first();

    if (!user) {
      // 🌟 新規登録時の自動プロビジョニング
      const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
      const initialRole = testUsers[userUuid] || 'free'; 
      
      await env.DB.prepare("INSERT INTO users (user_uuid, role, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(userUuid, initialRole, now, now)
        .run();
      
      const isAuthorized = requiredRoles.length === 0 || requiredRoles.includes(initialRole) || initialRole === "admin";
      return {
        authorized: isAuthorized,
        status: isAuthorized ? 200 : 403,
        user: { userUuid: userUuid, role: initialRole, associated_shop_id: null }
      };
      
    } else if (testUsers[userUuid] && user.role !== testUsers[userUuid]) {
      // 🌟 【自己修復ロジック】既に間違った権限(free等)で登録されている場合、自動で正しい権限に上書き修復する
      await env.DB.prepare("UPDATE users SET role = ? WHERE user_uuid = ?")
        .bind(testUsers[userUuid], userUuid)
        .run();
      user.role = testUsers[userUuid];
    }

    // 通常の権限チェック (adminは無条件で全許可)
    if (requiredRoles.length > 0 && !requiredRoles.includes(user.role) && user.role !== "admin") {
      return { authorized: false, status: 403, error: `Forbidden: この操作には ${requiredRoles.join(" または ")} 権限が必要です。` };
    }

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
      const auth = await checkAuthorization(request, env, ["free", "premium"]);
      if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

      try {
        const id = url.searchParams.get("id");
        if (!id) throw new Error("IDが指定されていません");
        
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
      if (action === "get_me") {
        const auth = await checkAuthorization(request, env, []); 
        if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        return new Response(JSON.stringify(auth.user), { headers: corsHeaders });
      }

      try {
        // 📊 B2B向け：経営用ダッシュボードのアナリティクスデータ取得
        if (action === "get_b2b_analytics") {
          const auth = await checkAuthorization(request, env, ["admin", "business"]);
          if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const shopId = url.searchParams.get("shop_id");
          if (!shopId) return new Response(JSON.stringify({ error: "shop_idが必要です" }), { status: 400, headers: corsHeaders });

          // 1. ロイヤルティ分析（新規 vs リピーター）
          const loyaltyStmt = env.DB.prepare(`
            WITH ValidDiaries AS (
              SELECT user_uuid
              FROM diaries
              WHERE shop_id = ? 
                AND weather_icon NOT IN ('💭', '📦', '🚫')
            ),
            UserVisits AS (
              SELECT user_uuid, COUNT(*) AS visit_count
              FROM ValidDiaries
              GROUP BY user_uuid
            )
            SELECT 
              SUM(CASE WHEN visit_count = 1 THEN 1 ELSE 0 END) AS new_customers,
              SUM(CASE WHEN visit_count > 1 THEN 1 ELSE 0 END) AS repeat_customers
            FROM UserVisits
          `);
          const loyaltyResult = await loyaltyStmt.bind(shopId).first() || {};

          // 2. ヒートマップ分析（時間帯 × 利用タイプ）
          const heatmapStmt = env.DB.prepare(`
            WITH ValidDiaries AS (
              SELECT 
                CASE 
                  WHEN CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 5 AND 10 THEN 'morning'
                  WHEN CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 11 AND 14 THEN 'afternoon'
                  WHEN CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 15 AND 17 THEN 'evening'
                  ELSE 'night'
                END AS time_zone,
                CASE 
                  WHEN tags LIKE '%☕️店内%' THEN '☕️店内'
                  WHEN tags LIKE '%🥡テイクアウト%' THEN '🥡テイクアウト'
                  WHEN tags LIKE '%🛍️豆・グッズ%' THEN '🛍️豆・グッズ'
                  WHEN tags LIKE '%🎪間借り・無店舗%' THEN '🎪間借り・無店舗'
                  ELSE 'その他'
                END AS usage_type
              FROM diaries
              WHERE shop_id = ? 
                AND weather_icon NOT IN ('💭', '📦', '🚫')
                AND created_at IS NOT NULL
            )
            SELECT time_zone, usage_type, COUNT(*) AS count
            FROM ValidDiaries
            WHERE usage_type != 'その他'
            GROUP BY time_zone, usage_type
            ORDER BY count DESC
          `);
          const heatmapResult = await heatmapStmt.bind(shopId).all();

          // データ成形
          const newCust = loyaltyResult.new_customers || 0;
          const repeatCust = loyaltyResult.repeat_customers || 0;
          const totalUsers = newCust + repeatCust;
          const repeatRate = totalUsers > 0 ? ((repeatCust / totalUsers) * 100).toFixed(1) + '%' : '0%';

          return new Response(JSON.stringify({
            success: true,
            data: {
              loyalty: {
                new_customers: newCust,
                repeat_customers: repeatCust,
                repeat_rate: repeatRate
              },
              heatmap: heatmapResult.results || []
            }
          }), { headers: corsHeaders });
        }

        if (action === "get_active_statuses") {
            const auth = await checkAuthorization(request, env, ["free", "premium", "business", "admin"]);
            if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

            const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
            const { results } = await env.DB.prepare(
                "SELECT shop_id, shop_name, status_type, reported_at, expires_at FROM shop_statuses WHERE expires_at > ?"
            ).bind(now).all();
            
            return new Response(JSON.stringify(results), { headers: corsHeaders });
        }

        if (action === "get_ghost_pins") {
          const auth = await checkAuthorization(request, env, ["premium", "admin"]);
          if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const { results } = await env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude, visited_at, tags FROM diaries WHERE is_public = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL AND user_uuid != ?").bind(auth.user.userUuid).all();

          const getAbstractTime = (dateStr) => {
              if (!dateStr) return "いつかの日";
              const date = new Date(dateStr.replace(/-/g, '/'));
              const month = date.getMonth() + 1;
              const hour = date.getHours();
              
              let season = "いつか";
              if (month >= 3 && month <= 5) season = "春";
              else if (month >= 6 && month <= 8) season = "夏";
              else if (month >= 9 && month <= 11) season = "秋";
              else season = "冬";

              let time = "時間帯";
              if (hour >= 5 && hour < 10) time = "朝";
              else if (hour >= 10 && hour < 14) time = "昼下がり";
              else if (hour >= 14 && hour < 18) time = "午後";
              else if (hour >= 18 && hour < 23) time = "夜";
              else time = "深夜";

              return `ある${season}の${time}`;
          };

          const ghosts = results.map(r => {
              const aiTags = r.tags ? r.tags.split(',').map(t => t.trim()).filter(t => t.startsWith("🤖")) : [];
              return {
                  shopId: r.shop_id, shopName: r.shop_name, lat: r.latitude, lng: r.longitude,
                  abstractTime: getAbstractTime(r.visited_at), tags: aiTags
              };
          });

          return new Response(JSON.stringify(ghosts), { headers: corsHeaders });
        }

        if (action === "get_shop_analytics") {
          const auth = await checkAuthorization(request, env, ["admin", "business"]);
          if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

          const shopId = url.searchParams.get("shop_id");
          const shopName = url.searchParams.get("shop_name");

          let query = "SELECT user_gender, user_age, tags FROM diaries WHERE ";
          let params = [];
          if (shopId && shopId !== 'null') { query += "shop_id = ?"; params.push(shopId); } 
          else { query += "shop_name = ?"; params.push(shopName); }

          const { results } = await env.DB.prepare(query).bind(...params).all();
          let total = results.length; let genders = {}; let ages = {}; let tagsCount = {};

          results.forEach(r => {
              const g = r.user_gender || '未設定'; const a = r.user_age || '未設定';
              genders[g] = (genders[g] || 0) + 1; ages[a] = (ages[a] || 0) + 1;
              if (r.tags) {
                  r.tags.split(',').forEach(t => {
                      let cleanTag = t.trim();
                      if (cleanTag && !cleanTag.includes('店内') && !cleanTag.includes('テイクアウト') && !cleanTag.includes('グッズ')) {
                          tagsCount[cleanTag] = (tagsCount[cleanTag] || 0) + 1;
                      }
                  });
              }
          });

          const topTags = Object.entries(tagsCount).sort((a,b) => b[1]-a[1]).slice(0, 10);
          return new Response(JSON.stringify({ total, genders, ages, topTags }), { headers: corsHeaders });
        }

        const auth = await checkAuthorization(request, env, ["free", "premium", "business"]);
        if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        if (action === "search_master") {
          const query = url.searchParams.get("query") || "";
          const { results } = await env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude FROM shops_master WHERE shop_name LIKE ? LIMIT 10").bind(`%${query}%`).all();
          return new Response(JSON.stringify(results), { headers: corsHeaders });

        } else if (action === "get_all_master") {
          if (auth.user.role === "admin") {
            const { results } = await env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude, is_local FROM shops_master").all();
            return new Response(JSON.stringify(results), { headers: corsHeaders });
          } else {
            const { results } = await env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude FROM shops_master WHERE is_local = 1").all();
            return new Response(JSON.stringify(results), { headers: corsHeaders });
          }

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
        
        if (data.action === "report_status") {
            const auth = await checkAuthorization(request, env, ["free", "premium"]);
            if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

            const shopId = data.shopId || null;
            const shopName = data.shopName || "名前なし";
            const statusType = data.statusType || "crowded"; 
            const userUuid = auth.user.userUuid;

            const nowMs = Date.now() + 9 * 60 * 60 * 1000;
            const nowStr = new Date(nowMs).toISOString();
            const oneHourAgoStr = new Date(nowMs - 60 * 60 * 1000).toISOString();
            const expiresAtStr = new Date(nowMs + 30 * 60 * 1000).toISOString(); 

            let recentReport;
            if (shopId) {
                recentReport = await env.DB.prepare("SELECT id FROM shop_statuses WHERE shop_id = ? AND user_uuid = ? AND reported_at > ?").bind(shopId, userUuid, oneHourAgoStr).first();
            } else {
                recentReport = await env.DB.prepare("SELECT id FROM shop_statuses WHERE shop_name = ? AND user_uuid = ? AND reported_at > ?").bind(shopName, userUuid, oneHourAgoStr).first();
            }

            if (recentReport) {
                return new Response(JSON.stringify({ success: false, error: "連続報告ブロック: 短時間での連投はできません。" }), { status: 429, headers: corsHeaders });
            }

            await env.DB.prepare(
                "INSERT INTO shop_statuses (shop_id, shop_name, status_type, user_uuid, reported_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).bind(shopId, shopName, statusType, userUuid, nowStr, expiresAtStr).run();

            return new Response(JSON.stringify({ success: true, expiresAt: expiresAtStr }), { headers: corsHeaders });
        }

        if (data.action === "upgrade_admin") {
            const auth = await checkAuthorization(request, env, []); 
            if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
            await env.DB.prepare("UPDATE users SET role = 'admin' WHERE user_uuid = ?").bind(auth.user.userUuid).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }
        
        if (data.action === "toggle_local") {
            const auth = await checkAuthorization(request, env, ["admin"]); 
            if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
            if (!data.shopId) return new Response(JSON.stringify({ error: "shopIdが必要です" }), { status: 400, headers: corsHeaders });

            await env.DB.prepare("UPDATE shops_master SET is_local = ? WHERE shop_id = ?").bind(data.isLocal, data.shopId).run();
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        const auth = await checkAuthorization(request, env, ["free", "premium"]);
        if (!auth.authorized) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });

        const comment = data.comment || "";
        const lat = data.lat !== undefined && data.lat !== null ? parseFloat(data.lat) : null;
        const lng = data.lng !== undefined && data.lng !== null ? parseFloat(data.lng) : null;
        const temp = data.temperature !== undefined && data.temperature !== null && data.temperature !== "" ? parseFloat(data.temperature) : null;
        
        const weatherIcon = data.weatherIcon || "❓"; 
        const userGender = data.userGender || "未設定";
        const userAge = data.userAge || "未設定";
        const userUuid = auth.user.userUuid;
        const isPublicVal = data.isPublic !== undefined ? data.isPublic : 0;

        // 🌟 R2への複数画像・並列オフロード処理
        let incomingImages = [];
        let uploadedUrls = [];

        if (Array.isArray(data.imageBase64)) {
            incomingImages = data.imageBase64;
        } else if (data.imageBase64) {
            incomingImages = [data.imageBase64];
        }

        if (incomingImages.length > 0) {
            const uploadPromises = incomingImages.map(async (base64Str) => {
                if (base64Str && base64Str.startsWith('data:image')) {
                    try {
                        const base64Data = base64Str.split(',')[1];
                        const binaryString = atob(base64Data);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        const fileName = `diaries/${Date.now()}_${crypto.randomUUID()}.jpg`;
                        
                        await env.BUCKET.put(fileName, bytes, { 
                            httpMetadata: { contentType: 'image/jpeg' } 
                        });
                        
                        return `https://pub-ada16c54772b47eb8e38f4b9f332ca73.r2.dev/${fileName}`;
                    } catch (err) {
                        console.error("R2 Upload Error:", err);
                        return null;
                    }
                }
                return base64Str; // 既にURLの場合はそのまま通す
            });

            const results = await Promise.all(uploadPromises);
            uploadedUrls = results.filter(url => url !== null);
        }

        const finalImageValue = uploadedUrls.length > 0 ? JSON.stringify(uploadedUrls) : null;

        let aiExtractedTags = ""; let unclassifiedTags = [];
        if (env.AI && comment.length > 5) {
          const systemPrompt = `あなたはカフェデータアナリストです。入力された日記から以下のJSONフォーマットでタグを抽出してください。厳密にJSON形式のみを出力し、マークダウン(\`\`\`json など)やその他のテキストは一切含めないでください。\n\n{\n  "tags": {\n    "coffee": ["抽出したコーヒー・ドリンク関連のタグ(品種, 焙煎, 抽出方法など)"],\n    "food": ["抽出したフード関連のタグ(ランチ, ケーキ, スイーツなど)"],\n    "atmosphere": ["抽出した雰囲気や設備のタグ(作業向き, リラックス, 音楽, 景色など)。なお、もし日記内にテイクアウトや物販が終了・廃止されたという記述があれば、それぞれ『テイクアウト廃止』や『物販終了』というキーワードを含めてください"]\n  },\n  "unclassified": ["上記に分類できないが重要そうなキーワード"]\n}`;
          try {
            const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
              messages: [{ role: "system", content: systemPrompt }, { role: "user", content: comment }]
            });
            if (aiResponse && aiResponse.response) {
              let rawText = aiResponse.response.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
              const result = JSON.parse(rawText);
              
              const coffeeTags = (result.tags?.coffee || []).map(t => `🤖☕️${t}`);
              const foodTags = (result.tags?.food || []).map(t => `🤖🍰${t}`);
              const atmosphereTags = (result.tags?.atmosphere || []).map(t => `🤖🛋️${t}`);
              aiExtractedTags = [...coffeeTags, ...foodTags, ...atmosphereTags].join(', ');
              unclassifiedTags = result.unclassified || [];
            }
          } catch (err) { unclassifiedTags = ["AIパースエラー"]; }
        }

        let combinedTags = data.tags || "";
        if (aiExtractedTags) combinedTags = combinedTags ? `${combinedTags}, ${aiExtractedTags}` : aiExtractedTags;

        // 🌟 DX改善アプローチ: GAS業務連携の最適化
        if (unclassifiedTags && unclassifiedTags.length > 0) {
          const gasWebhookUrl = env.GAS_WEBHOOK_URL || ""; 
          if (gasWebhookUrl) {
            // 元のキー構造(shopName, unclassified, comment)は既存のGAS側のパースを壊さないために完全維持。
            // その上で、バックオフィス部門の目視確認やステータス管理を助けるメタデータを _dx_metadata として拡張付与。
            const errorReportData = { 
                shopName: data.shopName || "名前なし", 
                unclassified: unclassifiedTags, 
                comment: comment,
                _dx_metadata: {
                    workflow_stage: "needs_manual_review",
                    timestamp: new Date().toISOString(),
                    user_uuid: userUuid
                }
            };
            ctx.waitUntil(fetch(gasWebhookUrl, { 
                method: "POST", 
                headers: { "Content-Type": "application/json" }, 
                body: JSON.stringify(errorReportData) 
            }).catch(err => console.error("[DX Alert] GAS Webhook Error:", err)));
          }
        }

        const now = new Date(Date.now() + 9 * 60 * 60 * 1000); 
        const createdSystemAt = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
        const visitedAt = data.visitedAt || createdSystemAt; 

        // 💾 D1へのデータベース保存
        if (data.id) {
          if (finalImageValue) {
            await env.DB.prepare(`UPDATE diaries SET shop_id = ?, shop_name = ?, comment = ?, tags = ?, visited_at = ?, image_base64 = ?, weather_icon = ?, temperature = ?, latitude = ?, longitude = ?, is_public = ? WHERE id = ? AND user_uuid = ?`)
              .bind(data.shopId || null, data.shopName, comment, combinedTags, visitedAt, finalImageValue, weatherIcon, temp, lat, lng, isPublicVal, data.id, userUuid).run();
          } else {
            await env.DB.prepare(`UPDATE diaries SET shop_id = ?, shop_name = ?, comment = ?, tags = ?, visited_at = ?, weather_icon = ?, temperature = ?, latitude = ?, longitude = ?, is_public = ? WHERE id = ? AND user_uuid = ?`)
              .bind(data.shopId || null, data.shopName, comment, combinedTags, visitedAt, weatherIcon, temp, lat, lng, isPublicVal, data.id, userUuid).run();
          }
          return new Response(JSON.stringify({ success: true, id: data.id }), { headers: corsHeaders });
        } else {
          const info = await env.DB.prepare(
            `INSERT INTO diaries (shop_id, shop_name, comment, latitude, longitude, image_base64, image_url, tags, weather_icon, temperature, user_gender, user_age, user_uuid, visited_at, created_at, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(data.shopId || null, data.shopName || "名前なし", comment, lat, lng, finalImageValue, null, combinedTags, weatherIcon, temp, userGender, userAge, userUuid, visitedAt, createdSystemAt, isPublicVal).run();
          return new Response(JSON.stringify({ success: true, id: info.meta.last_row_id }), { headers: corsHeaders });
        }
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: "D1_ERROR: " + err.message }), { status: 500, headers: corsHeaders });
      }
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  }
};