// ==========================================
// 📡 frontend/api.js (バックエンド・業務統合通信モジュール)
// 責務: API通信の統合、認証ヘッダーの付与、エラーハンドリング
// ==========================================
import { getOrGenerateUserUuid } from './utils/crypto.js';

// 🌟 本番環境Worker URL (業務基盤: Hono REST API対応)
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
        if (!response.ok) {
            console.warn(`[DX Alert] 履歴取得エラー (HTTP ${response.status})`);
            return [];
        }
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
        if (!response.ok) {
            console.warn(`[DX Alert] マスタ全件取得エラー (HTTP ${response.status})`);
            return [];
        }
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data; 
    } catch (error) { 
        console.error("[DX Alert] マスタ全件取得例外:", error); 
        return [];
    }
}

export async function searchMasterApi(query) {
    try {
        const response = await fetch(`${API_BASE}/api/master/search?query=${encodeURIComponent(query)}`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
        if (!response.ok) {
            console.warn(`[DX Alert] マスタ検索エラー (HTTP ${response.status})`);
            return [];
        }
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data;
    } catch (error) { 
        console.error("[DX Alert] マスタ検索例外:", error); 
        return []; 
    }
}

export async function fetchMeApi() {
    try {
        const response = await fetch(`${API_BASE}/api/me`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
        if (!response.ok) {
            console.warn(`[DX Alert] ユーザー情報取得エラー (HTTP ${response.status})`);
            return null;
        }
        const data = await response.json();
        return data.error ? null : data;
    } catch (error) { 
        console.error("[DX Alert] ユーザー情報取得例外:", error); 
        return null; 
    }
}

export async function fetchShopAnalyticsApi(shopId, shopName) {
    try {
        const params = new URLSearchParams();
        if (shopId) params.append("shop_id", shopId);
        if (shopName) params.append("shop_name", shopName);
        
        const response = await fetch(`${API_BASE}/api/analytics/shop?${params.toString()}`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
        if (!response.ok) {
            console.warn(`[DX Alert] 店舗分析データ取得エラー (HTTP ${response.status})`);
            return null;
        }
        const data = await response.json();
        return data.error ? null : data;
    } catch (error) { 
        console.error("[DX Alert] 店舗分析データ取得例外:", error); 
        return null; 
    }
}

export async function fetchGhostPinsApi() {
    try {
        const response = await fetch(`${API_BASE}/api/pins/ghost?_t=${Date.now()}`, { 
            method: "GET", 
            headers: getAuthHeaders() 
        });
        if (!response.ok) {
            console.warn(`[DX Alert] ゴーストピン取得エラー (HTTP ${response.status})`);
            return [];
        }
        const data = await response.json();
        return data.error ? [] : data;
    } catch (error) { 
        console.error("[DX Alert] ゴーストピン取得例外:", error); 
        return []; 
    }
}

export async function fetchActiveStatusesApi() {
    try {
        const response = await fetch(`${API_BASE}/api/statuses/active?_t=${Date.now()}`, {
            method: "GET",
            headers: getAuthHeaders()
        });
        if (!response.ok) {
            console.warn(`[DX Alert] アクティブステータス取得エラー (HTTP ${response.status})`);
            return [];
        }
        const data = await response.json();
        return data.error ? [] : data;
    } catch (error) {
        console.error("[DX Alert] アクティブステータス取得例外:", error);
        return [];
    }
}

// ==========================================
// 📊 B2Bダッシュボード用API (高度分析データ層)
// ==========================================

export async function fetchB2bAnalyticsApi(shopId) {
    try {
        if (!shopId) throw new Error("shopIdが指定されていません");
        
        const response = await fetch(`${API_BASE}/api/analytics/b2b?shop_id=${shopId}&_t=${Date.now()}`, {
            method: "GET",
            headers: getAuthHeaders()
        });
        if (!response.ok) {
            console.warn(`[DX Alert] B2Bアナリティクス取得エラー (HTTP ${response.status})`);
            return null;
        }
        const data = await response.json();
        
        if (data.error) throw new Error(data.error);
        return data;
    } catch (error) {
        console.error("[DX Alert] B2Bアナリティクス取得例外:", error);
        return null;
    }
}

// ==========================================
// 📤 データ操作系 (POST / DELETE)
// ==========================================

export async function saveDiaryApi(payload) {
    try {
        const response = await fetch(`${API_BASE}/api/diaries`, { 
            method: "POST", 
            headers: getAuthHeaders(), 
            body: JSON.stringify(payload) 
        });
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        return await response.json();
    } catch (error) { 
        console.error("[DX Alert] データ保存例外:", error);
        return { success: false, error: "通信に失敗しました" }; 
    }
}

export async function deleteDiaryApi(id) {
    try {
        const response = await fetch(`${API_BASE}/api/diaries?id=${id}`, { 
            method: "DELETE", 
            headers: getAuthHeaders() 
        });
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        return await response.json();
    } catch (error) { 
        console.error("[DX Alert] データ削除例外:", error);
        return { success: false, error: "通信エラーが発生しました。" }; 
    }
}

export async function toggleLocalStatusApi(shopId, isLocal) {
    try {
        const response = await fetch(`${API_BASE}/api/shops/local-status`, { 
            method: "POST", 
            headers: getAuthHeaders(), 
            body: JSON.stringify({ shopId: shopId, isLocal: isLocal }) 
        });
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        return await response.json();
    } catch (error) { 
        console.error("[DX Alert] ローカルステータス更新例外:", error);
        return { success: false, error: "通信に失敗しました" }; 
    }
}

export async function upgradeToAdminApi() {
    try {
        const response = await fetch(`${API_BASE}/api/users/upgrade`, { 
            method: "POST", 
            headers: getAuthHeaders() 
        });
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        return await response.json();
    } catch (error) { 
        console.error("[DX Alert] 権限昇格例外:", error);
        return { success: false, error: "通信エラー" }; 
    }
}

export async function reportStatusApi(shopId, shopName, statusType = "crowded") {
    try {
        const response = await fetch(`${API_BASE}/api/statuses/report`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ shopId, shopName, statusType })
        });
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error("[DX Alert] ステータス報告例外:", error);
        return { success: false, error: "通信エラー" };
    }
}