// ==========================================
// 📡 api.js (バックエンドとの通信・データ管理)
// ==========================================
const API_URL = "https://cafe-pipeline.ryusei-doas-0823.workers.dev/";

let globalMasterShops = [];

function getAuthHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Ezo-User-UUID": localStorage.getItem('ezo_user_uuid') || ""
  };
}

async function fetchDiaries() {
  try {
    const response = await fetch(`${API_URL}?_t=${Date.now()}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    globalDiaries = data;
    renderDiariesList(globalDiaries);
    renderTagClouds();
  } catch (error) { console.error("データ取得エラー:", error); }
}

async function fetchMasterShopsApi() {
  try {
    const response = await fetch(`${API_URL}?action=get_all_master&_t=${Date.now()}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    globalMasterShops = data;
  } catch (error) { console.error("マスタ全件取得エラー:", error); }
}

async function saveDiaryApi(payload) {
  try {
    const response = await fetch(API_URL, { method: "POST", headers: getAuthHeaders(), body: JSON.stringify(payload) });
    return await response.json();
  } catch (error) { return { success: false, error: "通信に失敗しました" }; }
}

async function searchMasterApi(query) {
  try {
    const response = await fetch(`${API_URL}?action=search_master&query=${encodeURIComponent(query)}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (error) { return []; }
}

async function deleteDiaryApi(id) {
  try {
    const response = await fetch(`${API_URL}?id=${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    return await response.json();
  } catch (error) { return { success: false, error: "通信エラーが発生しました。" }; }
}

async function fetchMe() {
  try {
    const response = await fetch(`${API_URL}?action=get_me`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    return data.error ? null : data;
  } catch (error) { return null; }
}

async function toggleLocalStatusApi(shopId, isLocal) {
  try {
    const response = await fetch(API_URL, { method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ action: "toggle_local", shopId: shopId, isLocal: isLocal }) });
    return await response.json();
  } catch (error) { return { success: false, error: "通信に失敗しました" }; }
}

async function fetchShopAnalyticsApi(shopId, shopName) {
  try {
    const params = new URLSearchParams({ action: "get_shop_analytics" });
    if (shopId) params.append("shop_id", shopId);
    if (shopName) params.append("shop_name", shopName);
    const response = await fetch(`${API_URL}?${params.toString()}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    return data.error ? null : data;
  } catch (error) { return null; }
}

async function upgradeToAdminApi() {
  try {
    const response = await fetch(API_URL, { method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ action: "upgrade_admin" }) });
    return await response.json();
  } catch (error) { return { success: false, error: "通信エラー" }; }
}

async function fetchGhostPinsApi() {
  try {
    const response = await fetch(`${API_URL}?action=get_ghost_pins&_t=${Date.now()}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    return data.error ? [] : data;
  } catch (error) { return []; }
}

// ==========================================
// 🚨 🆕 リアルタイムステータスの報告（POST）
// ==========================================
async function reportStatusApi(shopId, shopName, statusType = "crowded") {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ action: "report_status", shopId, shopName, statusType })
    });
    return await response.json();
  } catch (error) {
    console.error("ステータス報告エラー:", error);
    return { success: false, error: "通信エラー" };
  }
}

// ==========================================
// 🚨 🆕 有効なリアルタイムステータスの取得（GET）
// ==========================================
async function fetchActiveStatusesApi() {
  try {
    const response = await fetch(`${API_URL}?action=get_active_statuses&_t=${Date.now()}`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    const data = await response.json();
    return data.error ? [] : data;
  } catch (error) {
    console.error("アクティブステータス取得エラー:", error);
    return [];
  }
}