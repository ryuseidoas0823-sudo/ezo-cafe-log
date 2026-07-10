// ==========================================
// 📡 api.js (バックエンドとの通信・データ管理)
// ==========================================
const API_URL = "https://cafe-pipeline.ryusei-doas-0823.workers.dev/";

// 📥 GET: 全日記データの取得
async function fetchDiaries() {
  try {
    const response = await fetch(`${API_URL}?_t=${Date.now()}`);
    const data = await response.json();
    globalDiaries = data; // 他のファイル（map, main）で共有する大元のデータ
    
    renderDiariesList(globalDiaries);
    renderTagClouds(globalDiaries);
  } catch (error) {
    console.error("データ取得エラー:", error);
  }
}

// 📤 POST: 日記の保存・更新
async function saveDiaryApi(payload) {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    const response = await fetch(`${API_URL}?action=search_master&query=${encodeURIComponent(query)}`);
    return await response.json();
  } catch (error) {
    console.error("マスタ検索エラー:", error);
    return [];
  }
}

// 🗑️ DELETE: 日記の削除
async function deleteDiaryApi(id) {
  try {
    const response = await fetch(`${API_URL}?id=${id}`, { method: 'DELETE' });
    return await response.json();
  } catch (error) {
    console.error("削除通信エラー:", error);
    return { success: false, error: "通信エラーが発生しました。" };
  }
}