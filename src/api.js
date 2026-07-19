// ==========================================
// 📡 src/api.js (バックエンド・業務統合通信モジュール)
// ==========================================
import { getOrGenerateUserUuid } from './utils/crypto.js';

// 🌟 本番環境Worker URL (業務基盤)
const API_URL = "https://cafe-pipeline.ryusei-doas-0823.workers.dev/"; 

// 🛡️ 内部向けヘッダー生成関数 (ゼロトラストベースの認証・UUID付与)
function getAuthHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Ezo-User-UUID": getOrGenerateUserUuid() 
  };
}

// ==========================================
// 📥 データ取得系 (GET)
// ==========================================

export async function fetchDiariesApi() {
  try {
    const response = await fetch(`${API_URL}?_t=${Date.now()}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data; 
  } catch (error) { 
    console.error("[DX Alert] データ取得エラー:", error); 
    return [];
  }
}

export async function fetchMasterShopsApi() {
  try {
    const response = await fetch(`${API_URL}?action=get_all_master&_t=${Date.now()}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data; 
  } catch (error) { 
    console.error("[DX Alert] マスタ全件取得エラー:", error); 
    return [];
  }
}

export async function searchMasterApi(query) {
  try {
    const response = await fetch(`${API_URL}?action=search_master&query=${encodeURIComponent(query)}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (error) { 
    return []; 
  }
}

export async function fetchMeApi() {
  try {
    const response = await fetch(`${API_URL}?action=get_me`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    return data.error ? null : data;
  } catch (error) { 
    return null; 
  }
}

export async function fetchShopAnalyticsApi(shopId, shopName) {
  try {
    const params = new URLSearchParams({ action: "get_shop_analytics" });
    if (shopId) params.append("shop_id", shopId);
    if (shopName) params.append("shop_name", shopName);
    const response = await fetch(`${API_URL}?${params.toString()}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    return data.error ? null : data;
  } catch (error) { 
    return null; 
  }
}

export async function fetchGhostPinsApi() {
  try {
    const response = await fetch(`${API_URL}?action=get_ghost_pins&_t=${Date.now()}`, { method: "GET", headers: getAuthHeaders() });
    const data = await response.json();
    return data.error ? [] : data;
  } catch (error) { 
    return []; 
  }
}

export async function fetchActiveStatusesApi() {
  try {
    const response = await fetch(`${API_URL}?action=get_active_statuses&_t=${Date.now()}`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    const data = await response.json();
    return data.error ? [] : data;
  } catch (error) {
    console.error("[DX Alert] アクティブステータス取得エラー:", error);
    return [];
  }
}

// ==========================================
// 📊 B2Bダッシュボード用API (高度分析データ層)
// ==========================================

export async function fetchB2bAnalyticsApi(shopId) {
  try {
    if (!shopId) throw new Error("shopIdが指定されていません");
    
    const response = await fetch(`${API_URL}?action=get_b2b_analytics&shop_id=${shopId}&_t=${Date.now()}`, {
      method: "GET",
      headers: getAuthHeaders()
    });
    const data = await response.json();
    
    if (data.error) throw new Error(data.error);
    return data;
  } catch (error) {
    console.error("[DX Alert] B2Bアナリティクス取得エラー:", error);
    return null;
  }
}

// ==========================================
// 📤 データ操作系 (POST / DELETE)
// ==========================================

export async function saveDiaryApi(payload) {
  try {
    const response = await fetch(API_URL, { method: "POST", headers: getAuthHeaders(), body: JSON.stringify(payload) });
    return await response.json();
  } catch (error) { 
    console.error("[DX Alert] データ保存エラー:", error);
    return { success: false, error: "通信に失敗しました" }; 
  }
}

export async function deleteDiaryApi(id) {
  try {
    const response = await fetch(`${API_URL}?id=${id}`, { method: 'DELETE', headers: getAuthHeaders() });
    return await response.json();
  } catch (error) { 
    return { success: false, error: "通信エラーが発生しました。" }; 
  }
}

export async function toggleLocalStatusApi(shopId, isLocal) {
  try {
    const response = await fetch(API_URL, { method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ action: "toggle_local", shopId: shopId, isLocal: isLocal }) });
    return await response.json();
  } catch (error) { 
    return { success: false, error: "通信に失敗しました" }; 
  }
}

export async function upgradeToAdminApi() {
  try {
    const response = await fetch(API_URL, { method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ action: "upgrade_admin" }) });
    return await response.json();
  } catch (error) { 
    return { success: false, error: "通信エラー" }; 
  }
}

export async function reportStatusApi(shopId, shopName, statusType = "crowded") {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ action: "report_status", shopId, shopName, statusType })
    });
    return await response.json();
  } catch (error) {
    console.error("[DX Alert] ステータス報告エラー:", error);
    return { success: false, error: "通信エラー" };
  }
}