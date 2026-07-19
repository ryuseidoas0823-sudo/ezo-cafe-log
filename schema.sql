-- 1. カフェ日記用テーブルの作成
CREATE TABLE IF NOT EXISTS diaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_name TEXT,
    comment TEXT,
    latitude REAL,
    longitude REAL,
    image_base64 TEXT,
    created_at TEXT,
    tags TEXT,
    weather_icon TEXT,
    temperature REAL,
    user_gender TEXT,
    user_age TEXT,
    shop_id TEXT,
    image_url TEXT,
    visited_at TEXT,
    user_uuid TEXT,
    is_public INTEGER DEFAULT 0
);

-- 2. B2Bダッシュボード用のアナリティクス検索を高速化する複合インデックス
CREATE INDEX IF NOT EXISTS idx_diaries_b2b_analytics 
ON diaries (shop_id, weather_icon, created_at);

-- 3. リアルタイムな混雑状況を保持するステータステーブル
CREATE TABLE IF NOT EXISTS shop_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id TEXT,
    shop_name TEXT,
    status_type TEXT,
    user_uuid TEXT,
    reported_at TEXT,
    expires_at TEXT
);

-- 4. ユーザー管理用テーブルの作成 (新規追加)
CREATE TABLE IF NOT EXISTS users (
    user_uuid TEXT PRIMARY KEY,
    role TEXT DEFAULT 'free', -- 権限ロール: free, premium, business, admin
    created_at TEXT,
    updated_at TEXT
);

-- 5. テストユーザーの初期データ投入 (新規追加)
-- 実務標準の「冪等性（何度実行しても同じ結果になる性質）」を担保するため、
-- 既にデータが存在する場合はエラーにならずスキップする INSERT OR IGNORE を採用しています。
INSERT OR IGNORE INTO users (user_uuid, role, created_at, updated_at) VALUES 
('test-user-free-001', 'free', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('test-user-premium-001', 'premium', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('test-user-business-001', 'business', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);