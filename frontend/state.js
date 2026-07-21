// ==========================================
// 🏦 src/state.js (アプリケーションの一元的な状態管理)
// ==========================================

// 外部からは直接書き換えられないプライベートな金庫
const state = {
    currentUser: null,
    diaries: [],
    masterShops: [],
    activeStatuses: [],
    ghostPins: [],
    currentFilters: {
        tag: "",
        mapDining: false,
        mapTakeout: false,
        mapGoods: false
    }
};

// データを安全に「取得」するための関数群
export const getters = {
    getCurrentUser: () => state.currentUser,
    
    // UI表示用：行きたい(💭)と未整理(📦)を除外した有効な記録のみを取得
    getValidDiaries: () => state.diaries.filter(d => d.weather_icon !== "💭" && d.weather_icon !== "📦"),
    
    // 全データ取得用
    getAllDiaries: () => state.diaries,
    getMasterShops: () => state.masterShops,
    getActiveStatuses: () => state.activeStatuses,
    getGhostPins: () => state.ghostPins,
    getFilters: () => state.currentFilters
};

// データを安全に「上書き・更新」するための関数群
export const mutators = {
    setCurrentUser: (user) => { state.currentUser = user; },
    setDiaries: (diaries) => { state.diaries = diaries; },
    setMasterShops: (shops) => { state.masterShops = shops; },
    setActiveStatuses: (statuses) => { state.activeStatuses = statuses; },
    setGhostPins: (ghosts) => { state.ghostPins = ghosts; },
    
    setTagFilter: (tag) => { state.currentFilters.tag = tag; },
    toggleMapFilter: (type) => {
        if (type in state.currentFilters) {
            state.currentFilters[type] = !state.currentFilters[type];
        }
    }
};