// ==========================================
// ⚙️ 初期設定・グローバル変数
// ==========================================
const API_URL = "https://cafe-pipeline.ryusei-doas-0823.workers.dev/";

let allDiaries = []; // 取得した全データを保持する配列

// 🗺️ map.js で必要なグローバル変数を定義
const HOME_LAT = 43.0600; // 札幌大通周辺の中心緯度
const HOME_LNG = 141.3500; // 札幌大通周辺の中心経度
let viewMap = null; // 閲覧用Leafletマップインスタンス

// map.js の内部処理で `globalDiaries` を参照しているため同期させる
window.globalDiaries = []; 

// ==========================================
// 🚀 アプリ起動時の処理
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('visitedAt').value = `${yyyy}-${mm}-${dd}`;

  fetchDiaries();
  
  // 🔍 プルダウン変更時のフィルターイベントを設定
  document.getElementById('tagFilter').addEventListener('change', filterDiaries);
});

// ==========================================
// 📸 画像選択 ＆ Exif（撮影日時）自動取得
// ==========================================
let currentBase64 = null;

document.getElementById('imageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    const imgPreview = document.getElementById('imagePreview');
    imgPreview.src = event.target.result;
    imgPreview.style.display = 'block';
    currentBase64 = event.target.result;
  };
  reader.readAsDataURL(file);

  try {
    const exifData = await exifr.parse(file);
    if (exifData && exifData.DateTimeOriginal) {
      const dateObj = new Date(exifData.DateTimeOriginal);
      const ex_yyyy = dateObj.getFullYear();
      const ex_mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const ex_dd = String(dateObj.getDate()).padStart(2, '0');
      const formattedDate = `${ex_yyyy}-${ex_mm}-${ex_dd}`;
      
      document.getElementById('visitedAt').value = formattedDate;
      console.log("📸 撮影日時を自動セットしました:", formattedDate);
    }
  } catch (err) {
    console.log("Exifデータの読み込みに失敗したか、データが存在しません:", err);
  }
});

// ==========================================
// 📤 データの送信 (POSTリクエスト)
// ==========================================
document.getElementById('recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = document.getElementById('submitBtn');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = "🤖 AIが日記からタグを抽出・記録中...";

  const shopName = document.getElementById('shopName').value;
  const comment = document.getElementById('comment').value;
  const visitedAt = document.getElementById('visitedAt').value;
  const tags = document.getElementById('tags').value;

  const payload = {
    shopName: shopName,
    comment: comment,
    visitedAt: visitedAt,
    tags: tags,
    imageBase64: currentBase64,
  };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.success) {
      document.getElementById('recordForm').reset();
      document.getElementById('imagePreview').style.display = 'none';
      currentBase64 = null;
      
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      document.getElementById('visitedAt').value = `${yyyy}-${mm}-${dd}`;
      
      alert("記録が完了しました！");
      fetchDiaries();
    } else {
      alert("エラー: " + result.error);
    }
  } catch (error) {
    console.error("通信エラー:", error);
    alert("通信に失敗しました。");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnText;
  }
});

// ==========================================
// 📥 データの取得 (GETリクエスト)
// ==========================================
async function fetchDiaries() {
  try {
    const response = await fetch(API_URL);
    allDiaries = await response.json();
    
    // map.js用のグローバル配列にも同期
    window.globalDiaries = allDiaries; 
    
    renderDiariesList(allDiaries);
    renderTagClouds(allDiaries);
  } catch (error) {
    console.error("データ取得エラー:", error);
  }
}

// ==========================================
// 🎨 UI描画：履歴リストの表示
// ==========================================
function renderDiariesList(diaries) {
  const container = document.getElementById('diariesList');
  if (!container) return;
  container.innerHTML = "";

  diaries.forEach(diary => {
    const card = document.createElement('div');
    card.className = "diary-card";

    let tagsHTML = "";
    parseTags(diary.tags).forEach(tag => { 
      if (!tag.startsWith("🤖") && !tag.startsWith("🚨")) {
        tagsHTML += `<span class="tag-badge" style="background-color: ${getColorFromTag(tag)};">${escapeHTML(tag)}</span>`; 
      }
    });

    let imageHTML = "";
    if (diary.image_base64 || diary.image_url) {
      const src = diary.image_base64 ? diary.image_base64 : diary.image_url;
      imageHTML = `<img src="${src}" class="diary-image" alt="カフェの写真">`;
    }

    const displayDate = diary.visited_at ? diary.visited_at.split(' ')[0] : '日付不明';

    card.innerHTML = `
      <div class="diary-header">
        <span class="diary-date">${escapeHTML(displayDate)}</span>
        <h3 class="diary-shop">${escapeHTML(diary.shop_name)}</h3>
      </div>
      ${imageHTML}
      <p class="diary-comment">${escapeHTML(diary.comment)}</p>
      <div class="diary-tags">${tagsHTML}</div>
    `;
    container.appendChild(card);
  });
}

// ==========================================
// 🎨 UI描画：タグ選択プルダウンの更新
// ==========================================
function renderTagClouds(diaries) {
  const select = document.getElementById('tagFilter');
  if (!select) return;

  // 現在ユーザーが選択しているタグを一時キープ（更新時に選択が外れないようにする対策）
  const currentValue = select.value;

  // プルダウンを一旦初期化
  select.innerHTML = '<option value="">すべてのタグ（全件表示）</option>';

  const allTags = new Set();
  
  // 常に「全日記データ（allDiaries）」からタグを収集してリストを作成
  allDiaries.forEach(d => {
    parseTags(d.tags).forEach(t => {
      // 🔒 [自衛のDX] 画面の選択肢にはAIタグや非公開マークを出さない
      if (!t.startsWith("🤖") && !t.startsWith("🚨")) {
        allTags.add(t);
      }
    }); 
  });

  // タグを五十音・アルファベット順にソートしてプルダウンに追加
  Array.from(allTags).sort().forEach(tag => {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    if (tag === currentValue) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

// ==========================================
// 🔍 プルダウン選択による日記のフィルタリング処理
// ==========================================
function filterDiaries() {
  const selectedTag = document.getElementById('tagFilter').value;

  if (selectedTag === "") {
    // 「すべてのタグ」が選ばれたら全件表示
    renderDiariesList(allDiaries);
  } else {
    // 選択されたタグが含まれている日記だけを抽出して表示
    const filtered = allDiaries.filter(diary => {
      const tagsArray = parseTags(diary.tags);
      return tagsArray.includes(selectedTag);
    });
    renderDiariesList(filtered);
  }
}

// ==========================================
// 🛠️ 補助関数（ヘルパー）
// ==========================================

// タグ文字列を配列に分割する
function parseTags(tagString) {
  if (!tagString) return [];
  return tagString.split(',').map(t => t.trim()).filter(t => t);
}

// タグの色を文字コードベースで生成する
function getColorFromTag(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return '#' + "00000".substring(0, 6 - c.length) + c;
}

// HTMLエスケープ（XSS対策）
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// ==========================================
// 📱 タブ切り替え機能（マップ対応拡張）
// ==========================================
function switchTab(tabName, element) {
    // 1. 全てのタブの中身を隠す
    document.getElementById('tab-record').classList.add('hidden');
    document.getElementById('tab-history').classList.add('hidden');
    document.getElementById('tab-map').classList.add('hidden'); // マップを追加
    
    // 2. 選ばれたタブの中身だけを表示する
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');

    // 3. ナビゲーションのアイコンの色（active）を更新
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
    });
    element.classList.add('active');

    // 履歴タブが開かれたら
    if (tabName === 'history') {
        fetchDiaries();
    }
    
    // 🗺️ マップタブが開かれたら、初期化とピン描画を行う
    if (tabName === 'map') {
        if (typeof initViewMap === 'function') {
            initViewMap(); // map.jsから呼び出し
            updateViewMarkers(allDiaries); // マーカーを配置
        }
    }
}