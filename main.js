// ==========================================
// ⚙️ 初期設定・グローバル変数
// ==========================================
const API_URL = "https://cafe-pipeline.ryusei-doas-0823.workers.dev/";

let allDiaries = [];
let editingDiaryId = null; // ✏️ 編集中の日記IDを保持する変数

const HOME_LAT = 43.0600;
const HOME_LNG = 141.3500;
let viewMap = null; 
window.globalDiaries = []; 

document.addEventListener('DOMContentLoaded', () => {
  resetDateToToday();
  fetchDiaries();
  document.getElementById('tagFilter').addEventListener('change', filterDiaries);
});

function resetDateToToday() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('visitedAt').value = `${yyyy}-${mm}-${dd}`;
}

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
      document.getElementById('visitedAt').value = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    }
  } catch (err) { console.log("Exif error:", err); }
});

// ==========================================
// 📤 データの送信 (POST/PUT リクエスト)
// ==========================================
document.getElementById('recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submitBtn');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = "🤖 通信中...";

  const payload = {
    id: editingDiaryId, // ✏️ 編集中の場合はIDを送信
    shopName: document.getElementById('shopName').value,
    comment: document.getElementById('comment').value,
    visitedAt: document.getElementById('visitedAt').value,
    tags: document.getElementById('tags').value,
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
      resetDateToToday();
      
      alert(editingDiaryId ? "✨ 記録を更新しました！" : "✨ 記録が完了しました！");
      
      editingDiaryId = null; // リセット
      fetchDiaries();
      switchTab('history', document.querySelector('.bottom-nav .nav-item:nth-child(2)'));
    } else {
      alert("エラー: " + result.error);
    }
  } catch (error) {
    alert("通信に失敗しました。");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = "🚀 記録する";
  }
});

// ==========================================
// 📥 データの取得と描画
// ==========================================
async function fetchDiaries() {
  try {
    const response = await fetch(API_URL);
    allDiaries = await response.json();
    window.globalDiaries = allDiaries; 
    renderDiariesList(allDiaries);
    renderTagClouds(allDiaries);
  } catch (error) { console.error("データ取得エラー:", error); }
}

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

    let imageHTML = diary.image_base64 || diary.image_url ? `<img src="${diary.image_base64 || diary.image_url}" class="diary-image" alt="カフェの写真">` : "";
    const displayDate = diary.visited_at ? diary.visited_at.split(' ')[0] : '日付不明';

    // ✏️ 編集・削除ボタンを追加
    card.innerHTML = `
      <div class="diary-header">
        <span class="diary-date">${escapeHTML(displayDate)}</span>
        <h3 class="diary-shop">${escapeHTML(diary.shop_name)}</h3>
      </div>
      ${imageHTML}
      <p class="diary-comment">${escapeHTML(diary.comment)}</p>
      <div class="diary-tags">${tagsHTML}</div>
      <div class="card-actions">
        <button class="action-btn" onclick="editDiary(${diary.id})">✏️ 編集</button>
        <button class="action-btn" onclick="deleteDiary(${diary.id})">🗑️ 削除</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ==========================================
// ✏️ 編集 ＆ 🗑️ 削除機能
// ==========================================
function editDiary(id) {
    const diary = allDiaries.find(d => d.id === id);
    if (!diary) return;

    // 「記録する」タブへ切り替え
    switchTab('record', document.querySelector('.bottom-nav .nav-item:nth-child(1)'));

    // 既存データをフォームに流し込む
    document.getElementById('shopName').value = diary.shop_name || "";
    document.getElementById('visitedAt').value = diary.visited_at ? diary.visited_at.split(' ')[0] : "";
    document.getElementById('comment').value = diary.comment || "";
    
    // AIタグを取り除いて純粋な手動タグだけを抽出して表示
    const manualTags = parseTags(diary.tags).filter(t => !t.startsWith("🤖") && !t.startsWith("🚨")).join(', ');
    document.getElementById('tags').value = manualTags;
    
    document.getElementById('imagePreview').style.display = 'none';
    currentBase64 = null; // 画像は新たに選択しない限り変更されない

    editingDiaryId = diary.id;
    document.getElementById('submitBtn').innerHTML = "🔄 この内容で更新する";
    window.scrollTo(0, 0); // 画面トップへ移動
}

async function deleteDiary(id) {
    if (!confirm("本当にこの記録を削除しますか？\n(削除後は元に戻せません)")) return;
    try {
        const res = await fetch(`${API_URL}?id=${id}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            alert("削除しました。");
            fetchDiaries();
        } else {
            alert("エラー: " + result.error);
        }
    } catch (e) { alert("通信エラーが発生しました。"); }
}

// ==========================================
// 🔍 フィルター・タブ切替・補助ツール
// ==========================================
function renderTagClouds(diaries) {
  const select = document.getElementById('tagFilter');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">すべてのタグ（全件表示）</option>';

  const allTags = new Set();
  allDiaries.forEach(d => parseTags(d.tags).forEach(t => {
    if (!t.startsWith("🤖") && !t.startsWith("🚨")) allTags.add(t);
  }));

  Array.from(allTags).sort().forEach(tag => {
    const option = document.createElement('option');
    option.value = tag; option.textContent = tag;
    if (tag === currentValue) option.selected = true;
    select.appendChild(option);
  });
}

function filterDiaries() {
  const selectedTag = document.getElementById('tagFilter').value;
  if (selectedTag === "") renderDiariesList(allDiaries);
  else renderDiariesList(allDiaries.filter(diary => parseTags(diary.tags).includes(selectedTag)));
}

function parseTags(tagString) { return (!tagString) ? [] : tagString.split(',').map(t => t.trim()).filter(t => t); }
function getColorFromTag(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
  return '#' + "00000".substring(0, 6 - c.length) + c;
}
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, tag => ({'&': '&amp;','<': '&lt;','>': '&gt;',"'": '&#39;','"': '&quot;'}[tag] || tag));
}

function switchTab(tabName, element) {
    document.getElementById('tab-record').classList.add('hidden');
    document.getElementById('tab-history').classList.add('hidden');
    document.getElementById('tab-map').classList.add('hidden');
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    element.classList.add('active');

    if (tabName === 'history') fetchDiaries();
    if (tabName === 'map' && typeof initViewMap === 'function') {
        initViewMap(); updateViewMarkers(allDiaries);
    }
}