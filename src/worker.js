import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

// ==========================================
// 🌐 1. CORSミドルウェア & ヘルスチェック
// ==========================================
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Ezo-User-UUID']
}))

app.get('/', (c) => {
  return c.text('Ezo Cafe Log API Server is Running! (Hono化完了)')
})

// ==========================================
// 🛡️ 2. 権限チェック関数 (RBAC基盤)
// ==========================================
async function checkAuthorization(c, requiredRoles = []) {
  let userUuid = c.req.header("X-Ezo-User-UUID") || c.req.query("uuid");
  
  if (!userUuid) {
    return { authorized: false, status: 401, error: "Authentication Required" };
  }

  const testUsers = {
      'test-user-premium-001': 'premium',
      'test-user-business-001': 'business',
      'test-user-admin-001': 'admin'
  };

  try {
    let user = await c.env.DB.prepare("SELECT role, associated_shop_id FROM users WHERE user_uuid = ?")
      .bind(userUuid)
      .first();

    if (!user) {
      const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
      const initialRole = testUsers[userUuid] || 'free'; 
      
      await c.env.DB.prepare("INSERT INTO users (user_uuid, role, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(userUuid, initialRole, now, now)
        .run();
      
      const isAuthorized = requiredRoles.length === 0 || requiredRoles.includes(initialRole) || initialRole === "admin";
      return {
        authorized: isAuthorized,
        status: isAuthorized ? 200 : 403,
        user: { userUuid: userUuid, role: initialRole, associated_shop_id: null }
      };
      
    } else if (testUsers[userUuid] && user.role !== testUsers[userUuid]) {
      await c.env.DB.prepare("UPDATE users SET role = ? WHERE user_uuid = ?")
        .bind(testUsers[userUuid], userUuid)
        .run();
      user.role = testUsers[userUuid];
    }

    if (requiredRoles.length > 0 && !requiredRoles.includes(user.role) && user.role !== "admin") {
      return { authorized: false, status: 403, error: "Forbidden" };
    }

    return { authorized: true, status: 200, user: { userUuid: userUuid, ...user } };

  } catch (err) {
    return { authorized: false, status: 500, error: "D1_AUTH_ERROR: " + err.message };
  }
}

// ==========================================
// 👤 3. ユーザー関連エンドポイント
// ==========================================
app.get('/api/me', async (c) => {
  const auth = await checkAuthorization(c, []); 
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);
  return c.json(auth.user);
})

app.post('/api/users/upgrade', async (c) => {
  const auth = await checkAuthorization(c, []); 
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);
  
  try {
    await c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE user_uuid = ?")
      .bind(auth.user.userUuid).run();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500);
  }
})

// ==========================================
// 📝 4. 記録 (Diaries) エンドポイント
// ==========================================
app.get('/api/diaries', async (c) => {
  const auth = await checkAuthorization(c, []);
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);

  try {
    // 自身の記録、または公開設定の記録を取得 (B2Cアプリの基本設計)
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM diaries WHERE user_uuid = ? OR is_public = 1 ORDER BY visited_at DESC, id DESC"
    ).bind(auth.user.userUuid).all();
    return c.json(results);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
})

app.post('/api/diaries', async (c) => {
  const auth = await checkAuthorization(c, []);
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);

  try {
    const body = await c.req.json();
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
    
    await c.env.DB.prepare(`
      INSERT INTO diaries (user_uuid, shop_id, shop_name, latitude, longitude, eat_type, visited_at, weather, temperature, comment, tags, is_bookmark, is_draft, is_public, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      auth.user.userUuid, body.shopId || "", body.shopName || "", body.latitude || 0, body.longitude || 0,
      body.eatType || "店内", body.visitedAt || now, body.weather || "❓", body.temperature || null, body.comment || "",
      body.tags || "", body.isBookmark ? 1 : 0, body.isDraft ? 1 : 0, body.isPublic ? 1 : 0, now, now
    ).run();
    
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500);
  }
})

app.delete('/api/diaries', async (c) => {
  const auth = await checkAuthorization(c, []);
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);

  try {
    const id = c.req.query("id");
    if (!id) throw new Error("IDが指定されていません");
    
    if (auth.user.role === "admin") {
      await c.env.DB.prepare("DELETE FROM diaries WHERE id = ?").bind(id).run();
    } else {
      await c.env.DB.prepare("DELETE FROM diaries WHERE id = ? AND user_uuid = ?").bind(id, auth.user.userUuid).run();
    }
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500);
  }
})

// ==========================================
// 🏢 5. マスターデータ & ステータス関連
// ==========================================
app.get('/api/master/all', async (c) => {
  const auth = await checkAuthorization(c, []);
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);

  try {
    const { results } = auth.user.role === "admin"
      ? await c.env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude, is_local FROM shops_master").all()
      : await c.env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude FROM shops_master WHERE is_local = 1").all();
    return c.json(results);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
})

app.get('/api/master/search', async (c) => {
  const auth = await checkAuthorization(c, []);
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);

  try {
    const query = c.req.query("query") || "";
    const { results } = await c.env.DB.prepare("SELECT shop_id, shop_name, latitude, longitude FROM shops_master WHERE shop_name LIKE ? LIMIT 10")
      .bind(`%${query}%`).all();
    return c.json(results);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
})

app.post('/api/shops/local-status', async (c) => {
  const auth = await checkAuthorization(c, ["admin"]); // 管理者専用機能
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);

  try {
    const body = await c.req.json();
    await c.env.DB.prepare("UPDATE shops_master SET is_local = ? WHERE shop_id = ?")
      .bind(body.isLocal ? 1 : 0, body.shopId).run();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500);
  }
})

// 🌟 ピン・ステータス関連 (UIの描画用モックとして安全に配列を返す)
app.get('/api/pins/ghost', async (c) => {
  return c.json([]); // TODO: 実運用時にゴーストピン抽出ロジックを実装
})

app.get('/api/statuses/active', async (c) => {
  return c.json([]); // TODO: 実運用時にリアルタイム混雑状況ロジックを実装
})

app.post('/api/statuses/report', async (c) => {
  return c.json({ success: true }); // TODO: ステータス登録ロジックの実装
})

// ==========================================
// 📊 6. 分析 (Analytics) エンドポイント
// ==========================================
app.get('/api/analytics/shop', async (c) => {
  const auth = await checkAuthorization(c, ["premium", "business", "admin"]);
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);
  
  try {
    const shopId = c.req.query("shop_id");
    const { results } = await c.env.DB.prepare("SELECT COUNT(*) as visit_count FROM diaries WHERE shop_id = ?")
      .bind(shopId).all();
    return c.json({ stats: results[0] });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
})

app.get('/api/analytics/b2b', async (c) => {
  const auth = await checkAuthorization(c, ["business", "admin"]);
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);
  
  try {
    const shopId = c.req.query("shop_id");
    // TODO: B2B向けの高度な集計SQLを実装
    return c.json({ shopId, message: "B2B Dashboard Data Ready" });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
})

// ==========================================
// 🏁 7. アプリケーションのエクスポート
// ==========================================
export default app