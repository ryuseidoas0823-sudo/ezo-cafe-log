// ==========================================
// ⚙️ 初期設定・グローバル変数
// ==========================================
// 👇 ご自身のCloudflare WorkersのURLに書き換えてください
const API_URL = "https://cafe-pipeline.ryusei-doas-0823.workers.dev/";

let allDiaries = []; // 取得した全データを保持する配列

// ==========================================
// 🚀 アプリ起動時の処理
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // 日付入力欄の初期値を「今日」に設定
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('visitedAt').value = `${yyyy}-${mm}-${dd}`;

  // サーバーからデータを取得して表示
  fetchDiaries();
});

// ==========================================
// 📸 画像選択 ＆ Exif（撮影日時）自動取得
// ==========================================
let currentBase64 = null;

document.getElementById('imageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // 1. 画像プレビューとBase64変換
  const reader = new FileReader();
  reader.onload = function(event) {
    const imgPreview = document.getElementById('imagePreview');
    imgPreview.src = event.target.result;
    imgPreview.style.display = 'block';
    currentBase64 = event.target.result;
  };
  reader.readAsDataURL(file);

  // 2. Exifデータ（撮影日時）の自動取得
  try {
    // exifrライブラリを使って画像からデータを抽出
    const exifData = await exifr.parse(file);
    
    if (exifData && exifData.DateTimeOriginal) {
      const dateObj = new Date(exifData.DateTimeOriginal);
      
      const ex_yyyy = dateObj.getFullYear();
      const ex_mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const ex_dd = String(dateObj.getDate()).padStart(2, '0');
      
      const formattedDate = `${ex_yyyy}-${ex_mm}-${ex_dd}`;
      
      // 日付入力欄に自動セット
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

  // 送信ボタンを無効化して連打防止
  const submitBtn = document.getElementById('submitBtn');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = "🤖 AIが日記からタグを抽出・記録中...";

  // フォームからデータを取得
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
    // その他、天気や気温などのデータがあればここに追加
  };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.success) {
      // 成功したらフォームをリセットして再取得
      document.getElementById('recordForm').reset();
      document.getElementById('imagePreview').style.display = 'none';
      currentBase64 = null;
      
      // 日付を今日に戻す
      document.getElementById('visitedAt').value = `${yyyy}-${mm}-${dd}`;
      
      alert("記録が完了しました！");
      fetchDiaries(); // リストを更新
    } else {
      // 🚨 モデレーションブロックなどのエラー時
      alert("エラー: " + result.error);
    }
  } catch (error) {
    console.error("通信エラー:", error);
    alert("通信に失敗しました。");
  } finally {
    // ボタンを元に戻す
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
      // 🔒 [自衛のDX] 画面にはAIタグ(🤖)も非公開マーク(🚨)も描画しない
      if (!tag.startsWith("🤖") && !tag.startsWith("🚨")) {
        tagsHTML += `<span class="tag-badge" style="background-color: ${getColorFromTag(tag)};">${escapeHTML(tag)}</span>`; 
      }
    });

    let imageHTML = "";
    if (diary.image_base64 || diary.image_url) {
      const src = diary.image_base64 ? diary.image_base64 : diary.image_url;
      imageHTML = `<img src="${src}" class="diary-image" alt="カフェの写真">`;
    }

    // 訪問日時のフォーマット（YYYY-MM-DDのみ抽出）
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
// 🎨 UI描画：タグクラウドの表示
// ==========================================
function renderTagClouds(diaries) {
  const container = document.getElementById('tagCloud');
  if (!container) return;
  
  const allTags = new Set();
  
  diaries.forEach(d => {
    parseTags(d.tags).forEach(t => {
      // 🔒 [自衛のDX] タグクラウドにもAIタグや非公開マークを出さない
      if (!t.startsWith("🤖") && !t.startsWith("🚨")) {
        allTags.add(t);
      }
    }); 
  });

  container.innerHTML = "";
  allTags.forEach(tag => {
    const span = document.createElement('span');
    span.className = "cloud-tag";
    span.textContent = tag;
    span.style.backgroundColor = getColorFromTag(tag);
    container.appendChild(span);
  });
}

// ==========================================
// 🛠️ 補助関数（ヘルパー）
// ==========================================

// タグ文字列を配列に分割する
function parseTags(tagString) {
  if (!tagString) return [];
  return tagString.split(',').map(t => t.trim()).filter(t => t);
}

// タグの色をランダム（または固定）で生成する
function getColorFromTag(tag) {
  // シンプルに文字コードから色を生成する例（お好みの色設定に変更可能）
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
// 📱 タブ切り替え機能
// ==========================================
function switchTab(tabName, element) {
    // 1. 全てのタブの中身を隠す
    document.getElementById('tab-record').classList.add('hidden');
    document.getElementById('tab-history').classList.add('hidden');
    
    // 2. 選ばれたタブの中身だけを表示する
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');

    // 3. ナビゲーションのアイコンの色（active）をリセットして、押したやつだけ色をつける
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
    });
    element.classList.add('active');

    // もし履歴タブが開かれたら、最新のデータを取得して描画し直す
    if (tabName === 'history') {
        fetchDiaries();
    }
}