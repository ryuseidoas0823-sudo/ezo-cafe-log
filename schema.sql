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

-- リアルタイムな混雑状況を保持するステータステーブル
CREATE TABLE IF NOT EXISTS shop_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id TEXT,
    shop_name TEXT,
    status_type TEXT,
    user_uuid TEXT,
    reported_at TEXT,
    expires_at TEXT
);