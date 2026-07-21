// ==========================================
// 📡 frontend/api.js (バックエンド・業務統合通信モジュール)
// 責務: API通信の統合、認証ヘッダーの付与、エラーハンドリング
// ==========================================
import { getOrGenerateUserUuid } from './utils/crypto.js';

// 🌟 本番環境Worker URL (業務基盤: Hono REST API対応)
// ※ URL末尾の「/」は外し、エンドポイント側で「/api/...」と繋ぐ設計に統一
const API_BASE = "https://cafe-pipeline.ryusei-doas-0823.workers.dev"; 

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
        const response = await fetch(`${API_BASE}/api/diaries?_t=${Date.now()}`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
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
        const response = await fetch(`${API_BASE}/api/master/all?_t=${Date.now()}`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
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
        const response = await fetch(`${API_BASE}/api/master/search?query=${encodeURIComponent(query)}`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data;
    } catch (error) { 
        console.error("[DX Alert] マスタ検索エラー:", error); 
        return []; 
    }
}

export async function fetchMeApi() {
    try {
        const response = await fetch(`${API_BASE}/api/me`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
        const data = await response.json();
        return data.error ? null : data;
    } catch (error) { 
        console.error("[DX Alert] ユーザー情報取得エラー:", error); 
        return null; 
    }
}

export async function fetchShopAnalyticsApi(shopId, shopName) {
    try {
        const params = new URLSearchParams();
        if (shopId) params.append("shop_id", shopId);
        if (shopName) params.append("shop_name", shopName);
        
        // 旧: ?action=get_shop_analytics -> 新: /api/analytics/shop
        const response = await fetch(`${API_BASE}/api/analytics/shop?${params.toString()}`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
        const data = await response.json();
        return data.error ? null : data;
    } catch (error) { 
        console.error("[DX Alert] 店舗分析データ取得エラー:", error); 
        return null; 
    }
}

export async function fetchGhostPinsApi() {
    try {
        // 旧: ?action=get_ghost_pins -> 新: /api/pins/ghost
        const response = await fetch(`${API_BASE}/api/pins/ghost?_t=${Date.now()}`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
        const data = await response.json();
        return data.error ? [] : data;
    } catch (error) { 
        console.error("[DX Alert] ゴーストピン取得エラー:", error); 
        return []; 
    }
}

export async function fetchActiveStatusesApi() {
    try {
        // 旧: ?action=get_active_statuses -> 新: /api/statuses/active
        const response = await fetch(`${API_BASE}/api/statuses/active?_t=${Date.now()}`, {
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
        
        // 旧: ?action=get_b2b_analytics -> 新: /api/analytics/b2b
        const response = await fetch(`${API_BASE}/api/analytics/b2b?shop_id=${shopId}&_t=${Date.now()}`, {
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
        // 旧: API_URL (action payload) -> 新: /api/diaries (POST)
        const response = await fetch(`${API_BASE}/api/diaries`, { 
            method: "POST", 
            headers: getAuthHeaders(), 
            body: JSON.stringify(payload) 
        });
        return await response.json();
    } catch (error) { 
        console.error("[DX Alert] データ保存エラー:", error);
        return { success: false, error: "通信に失敗しました" }; 
    }
}

export async function deleteDiaryApi(id) {
    try {
        const response = await fetch(`${API_BASE}/api/diaries?id=${id}`, { 
            method: "DELETE", 
            headers: getAuthHeaders() 
        });
        return await response.json();
    } catch (error) { 
        console.error("[DX Alert] データ削除エラー:", error);
        return { success: false, error: "通信エラーが発生しました。" }; 
    }
}

export async function toggleLocalStatusApi(shopId, isLocal) {
    try {
        // 旧: action="toggle_local" -> 新: /api/shops/local-status (POST)
        // ※ payloadから不要になった action キーを削除
        const response = await fetch(`${API_BASE}/api/shops/local-status`, { 
            method: "POST", 
            headers: getAuthHeaders(), 
            body: JSON.stringify({ shopId: shopId, isLocal: isLocal }) 
        });
        return await response.json();
    } catch (error) { 
        console.error("[DX Alert] ローカルステータス更新エラー:", error);
        return { success: false, error: "通信に失敗しました" }; 
    }
}

export async function upgradeToAdminApi() {
    try {
        // 旧: action="upgrade_admin" -> 新: /api/users/upgrade (POST)
        const response = await fetch(`${API_BASE}/api/users/upgrade`, { 
            method: "POST", 
            headers: getAuthHeaders() 
        });
        return await response.json();
    } catch (error) { 
        console.error("[DX Alert] 権限昇格エラー:", error);
        return { success: false, error: "通信エラー" }; 
    }
}

export async function reportStatusApi(shopId, shopName, statusType = "crowded") {
    try {
        // 旧: action="report_status" -> 新: /api/statuses/report (POST)
        const response = await fetch(`${API_BASE}/api/statuses/report`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ shopId, shopName, statusType })
        });
        return await response.json();
    } catch (error) {
        console.error("[DX Alert] ステータス報告エラー:", error);
        return { success: false, error: "通信エラー" };
    }
}