export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);

    // 📝 【新規保存（POST）】
    if (request.method === "POST") {
      try {
        const json = await request.json();
        
        // 🌟 修正ポイント1: constではなく、後でIDを書き換えられるように let で受け取る
        let { shopId, shopName, comment, latitude, longitude, imageBase64, tags, weatherIcon, temperature, userGender, userAge, visitedAt } = json;
        
        const nowJst = new Date(Date.now() + (9 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19);
        const finalCreatedAt = visitedAt ? visitedAt : nowJst;

        // 🌟 修正ポイント2: 新規店舗（shopIdが空っぽ）の場合、先にマスタへ登録する
        if (!shopId) {
          // INSERTすると同時に、新しく発行された shop_id を取得 (RETURNING句)
          const newShop = await env.DB.prepare(
            "INSERT INTO shops_master (shop_name, latitude, longitude) VALUES (?, ?, ?) RETURNING shop_id"
          ).bind(shopName, latitude, longitude).first();
          
          if (newShop && newShop.shop_id) {
            shopId = newShop.shop_id; // 発行された新しいIDをセットしてあげる
          }
        }

        // あとは通常通り日記を保存
        await env.DB.prepare(
          `INSERT INTO diaries 
          (shop_id, shop_name, comment, latitude, longitude, image_base64, created_at, tags, weather_icon, temperature, user_gender, user_age) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          shopId || null, shopName, comment, latitude, longitude, imageBase64, finalCreatedAt, tags || "", 
          weatherIcon || "❓", temperature || null, userGender || "未設定", userAge || "未設定"
        ).run();

        return new Response(JSON.stringify({ success: true, message: "記録完了しました" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ✏️📍 【更新・編集（PUT）】
    if (request.method === "PUT") {
      try {
        const json = await request.json();
        if (json.id) {
          const { id, shopName, tags, comment, weatherIcon } = json;
          await env.DB.prepare(
            "UPDATE diaries SET shop_name = ?, tags = ?, comment = ?, weather_icon = ? WHERE id = ?"
          ).bind(shopName, tags, comment, weatherIcon || "❓", id).run();
          return new Response(JSON.stringify({ success: true, message: "日記を更新しました" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else {
          const { shopName, latitude, longitude } = json;
          await env.DB.prepare(
            "UPDATE diaries SET latitude = ?, longitude = ? WHERE shop_name = ?"
          ).bind(latitude, longitude, shopName).run();
          return new Response(JSON.stringify({ success: true, message: "位置情報を更新しました" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 🗑️ 【削除（DELETE）】
    if (request.method === "DELETE") {
      try {
        const id = url.searchParams.get("id");
        if (!id) throw new Error("IDが指定されていません");
        await env.DB.prepare("DELETE FROM diaries WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ success: true, message: "削除しました" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 🔍 【検索（GET）】
    if (request.method === "GET") {
      try {
        const action = url.searchParams.get("action");
        const query = url.searchParams.get("query") || "";

        if (action === "search_master") {
          const result = await env.DB.prepare(
            "SELECT * FROM shops_master WHERE shop_name LIKE ? LIMIT 10"
          ).bind(`%${query}%`).all();
          return new Response(JSON.stringify({ success: true, data: result.results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        let result;
        if (query === "") {
          result = await env.DB.prepare("SELECT * FROM diaries ORDER BY created_at DESC").all();
        } else {
          result = await env.DB.prepare(
            "SELECT * FROM diaries WHERE shop_name LIKE ? OR comment LIKE ? ORDER BY created_at DESC"
          ).bind(`%${query}%`, `%${query}%`).all();
        }
        return new Response(JSON.stringify({ success: true, data: result.results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }
    
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }
};