import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

// ==========================================
// 🌐 1. CORSミドルウェア
// ==========================================
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Ezo-User-UUID']
}))

// ==========================================
// 🟢 2. ヘルスチェック（404対策）を追加！
// ==========================================
app.get('/', (c) => {
  return c.text('Ezo Cafe Log API Server is Running! (Hono化成功)')
})

// ==========================================
// 🛡️ 3. 権限チェック関数
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
// 🚀 4. エンドポイントの定義
// ==========================================
app.get('/api/me', async (c) => {
  const auth = await checkAuthorization(c, []); 
  if (!auth.authorized) return c.json({ error: auth.error }, auth.status);
  
  return c.json(auth.user);
})

export default app