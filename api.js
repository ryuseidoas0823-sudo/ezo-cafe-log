// ==========================================
// 📡 api.js (バックエンドとの通信・データ管理)
// ==========================================
const API_URL = "https://cafe-pipeline.ryusei-doas-0823.workers.dev/";

let globalMasterShops = [];

// 🛡️ [DX機能] 認証用ヘッダーを生成するヘルパー関数
// LocalStorageからUUIDを取得し、すべてのリクエストのHTTPヘッダーに付与します
function getAuthHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Ezo-User-UUID": localStorage.getItem('ezo_user_uuid') || ""
  };
}

// 📥 GET: 全日記データの取得
async function fetchDiaries() {
  try {
    const response = await fetch(`${API_URL}?_t=${Date.now()}`, {
      method: "GET",
      headers: getAuthHeaders() // 🆕 門番に身分証を提示
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    globalDiaries = data;
    renderDiariesList(globalDiaries);
    renderTagClouds();
  } catch (error) {
    console.error("データ取得エラー:", error);
  }
}

// 🆕 📥 GET: マスタ全件取得
async function fetchMasterShopsApi() {
  try {
    const response = await fetch(`${API_URL}?action=get_all_master&_t=${Date.now()}`, {
      method: "GET",
      headers: getAuthHeaders() // 🆕 門番に身分証を提示
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    globalMasterShops = data;
  } catch (error) {
    console.error("マスタ全件取得エラー:", error);
  }
}

// 📤 POST: 日記の保存・更新
async function saveDiaryApi(payload) {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: getAuthHeaders(), // 🆕 門番に身分証を提示
      body: JSON.stringify(payload)
    });
    return await response.json();
  } catch (error) {
    console.error("通信エラー:", error);
    return { success: false, error: "通信に失敗しました" };
  }
}

// 🔍 GET: 店舗マスタの検索 (サジェスト機能用)
async function searchMasterApi(query) {
  try {
    const response = await fetch(`${API_URL}?action=search_master&query=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: getAuthHeaders() // 🆕 門番に身分証を提示
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (error) {
    console.error("マスタ検索エラー:", error);
    return [];
  }
}

// 🗑️ DELETE: 日記の削除
async function deleteDiaryApi(id) {
  try {
    const response = await fetch(`${API_URL}?id=${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders() // 🆕 門番に身分証を提示
    });
    return await response.json();
  } catch (error) {
    console.error("削除通信エラー:", error);
    return { success: false, error: "通信エラーが発生しました。" };
  }
}

// 🆕 👑 自分のユーザー情報（権限）を取得する関数
async function fetchMe() {
  try {
    const response = await fetch(`${API_URL}?action=get_me`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    const data = await response.json();
    return data.error ? null : data;
  } catch (error) {
    console.error("ユーザー情報取得エラー:", error);
    return null;
  }
}

// 🆕 👑 管理者用：ローカル店フラグを切り替えるバックドア通信
async function toggleLocalStatusApi(shopId, isLocal) {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ action: "toggle_local", shopId: shopId, isLocal: isLocal })
    });
    return await response.json();
  } catch (error) {
    console.error("ステータス更新エラー:", error);
    return { success: false, error: "通信に失敗しました" };
  }
}

// 🆕 👑 B2B用：店舗全体の客層アナリティクスを取得する
async function fetchShopAnalyticsApi(shopId, shopName) {
  try {
    const params = new URLSearchParams({ action: "get_shop_analytics" });
    if (shopId) params.append("shop_id", shopId);
    if (shopName) params.append("shop_name", shopName);
    
    const response = await fetch(`${API_URL}?${params.toString()}`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    const data = await response.json();
    return data.error ? null : data;
  } catch (error) {
    console.error("店舗アナリティクス取得エラー:", error);
    return null;
  }
}

// 👑 開発用：自身をAdminに昇格するAPI通信
async function upgradeToAdminApi() {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ action: "upgrade_admin" })
    });
    return await response.json();
  } catch (error) {
    return { success: false, error: "通信エラー" };
  }
}

// 👻 🆕 GET: プレミアム用 ゴーストピン（他者の足跡）の取得
async function fetchGhostPinsApi() {
  try {
    const response = await fetch(`${API_URL}?action=get_ghost_pins&_t=${Date.now()}`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    const data = await response.json();
    return data.error ? [] : data;
  } catch (error) {
    console.error("ゴーストピン取得エラー:", error);
    return [];
  }
}