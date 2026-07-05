export default {
  async fetch(request, env) {
    // 1. スマホアプリ（フロントエンド）からの通信を許可する設定（CORS）
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 事前通信（OPTIONS）への即座の応答
    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    const url = new URL(request.url);

    try {
      // --------------------------------------------------------
      // 💾 【DELETE】データの削除（未整理からの昇格時・通常削除時）
      // --------------------------------------------------------
      if (request.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (!id) {
          return new Response(JSON.stringify({ success: false, error: "IDが指定されていません" }), { headers, status: 400 });
        }
        
        // D1データベースから該当のレコードを削除
        await env.DB.prepare("DELETE FROM diaries WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ success: true }), { headers });
      }

      // --------------------------------------------------------
      // 🔍 【GET】データの取得（履歴一覧・公式マスター検索）
      // --------------------------------------------------------
      if (request.method === "GET") {
        const action = url.searchParams.get("action");
        
        // 公式マスターデータの検索アクション
        if (action === "search_master") {
          const query = url.searchParams.get("query") || "";
          const result = await env.DB.prepare(
            "SELECT * FROM shops_master WHERE shop_name LIKE ? LIMIT 5"
          ).bind(`%${query}%`).all();
          return new Response(JSON.stringify({ success: true, data: result.results }), { headers });
        }

        // 通常の日記履歴の取得（新しい順）
        const result = await env.DB.prepare(
          "SELECT * FROM diaries ORDER BY created_at DESC"
        ).all();
        return new Response(JSON.stringify({ success: true, data: result.results }), { headers });
      }

      // --------------------------------------------------------
      // 🚀 【POST】新しく記録する（未整理ボックスの一括保存もここを通過）
      // --------------------------------------------------------
      if (request.method === "POST") {
        const data = await request.json();
        
        // データの足取りをログに出力（デバッグ用）
        console.log("保存要求を受信:", data.shopName, "天気:", data.weatherIcon);

        // 位置情報や気温が送られてこない（null）場合でも、エラーにせずデータベースに流し込む
        const lat = data.latitude !== undefined ? data.latitude : null;
        const lng = data.longitude !== undefined ? data.longitude : null;
        const temp = data.temperature !== undefined ? data.temperature : null;
        
        // 写真の撮影日時（visitedAt）があればそれを使う。なければ現在のシステム時刻
        const createdAt = data.visitedAt || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

        const info = await env.DB.prepare(
          `INSERT INTO diaries (shop_id, shop_name, comment, latitude, longitude, image_base64, tags, weather_icon, temperature, user_gender, user_age, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          data.shopId || null,
          data.shopName || "名前なしの店舗",
          data.comment || "",
          lat,
          lng,
          data.imageBase64 || null,
          data.tags || "",
          data.weatherIcon || "❓",
          temp,
          data.userGender || "未設定",
          data.userAge || "未設定",
          createdAt
        ).run();

        return new Response(JSON.stringify({ success: true, id: info.meta.last_row_id }), { headers });
      }

      // --------------------------------------------------------
      // ✏️ 【PUT】既存データの編集・上書き
      // --------------------------------------------------------
      if (request.method === "PUT") {
        const data = await request.json();
        await env.DB.prepare(
          "UPDATE diaries SET shop_name = ?, tags = ?, comment = ?, weather_icon = ? WHERE id = ?"
        ).bind(
          data.shopName,
          data.tags,
          data.comment,
          data.weatherIcon,
          data.id
        ).run();

        return new Response(JSON.stringify({ success: true }), { headers });
      }

      return new Response(JSON.stringify({ success: false, error: "許可されていないメソッドです" }), { headers, status: 405 });

    } catch (err) {
      // 万が一バックエンドでエラーが起きた場合は、詳細をフロントに送り返す
      console.error("システムエラー発生:", err.message);
      return new Response(JSON.stringify({ success: false, error: err.message }), { headers, status: 500 });
    }
  }
};