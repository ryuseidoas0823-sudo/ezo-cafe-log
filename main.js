// ==========================================
// 📱 main.js (UI制御・イベント管理)
// ==========================================
let globalDiaries = []; // api.js で取得したデータが入る
let editingDiaryId = null;
let currentBase64 = null;

document.addEventListener('DOMContentLoaded', () => {
  resetDateToToday();
  fetchDiaries(); // api.jsの関数を呼ぶ
  document.getElementById('tagFilter').addEventListener('change', filterDiaries);
});

function resetDateToToday() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('visitedAt').value = `${yyyy}-${mm}-${dd}`;
}

// 📸 写真選択とExif取得
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

// 📤 フォーム送信 (保存・更新)
document.getElementById('recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submitBtn');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = "🤖 通信中...";

  const payload = {
    id: editingDiaryId,
    shopName: document.getElementById('shopName').value,
    comment: document.getElementById('comment').value,
    visitedAt: document.getElementById('visitedAt').value,
    tags: document.getElementById('tags').value,
    imageBase64: currentBase64,
  };

  const result = await saveDiaryApi(payload); // api.jsの関数を呼ぶ
  
  if (result.success) {
    document.getElementById('recordForm').reset();
    document.getElementById('imagePreview').style.display = 'none';
    currentBase64 = null;
    resetDateToToday();
    
    alert(editingDiaryId ? "✨ 記録を更新しました！" : "✨ 記録が完了しました！");
    editingDiaryId = null; 
    
    fetchDiaries();
    switchTab('history', document.querySelector('.bottom-nav .nav-item:nth-child(2)'));
  } else {
    alert("エラー: " + result.error);
  }
  
  submitBtn.disabled = false;
  submitBtn.innerHTML = originalBtnText;
});

// 🎨 リストの描画
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

// ✏️ 編集処理
function editDiary(id) {
    const diary = globalDiaries.find(d => d.id === id);
    if (!diary) return;

    switchTab('record', document.querySelector('.bottom-nav .nav-item:nth-child(1)'));
    document.getElementById('shopName').value = diary.shop_name || "";
    document.getElementById('visitedAt').value = diary.visited_at ? diary.visited_at.split(' ')[0] : "";
    document.getElementById('comment').value = diary.comment || "";
    
    const manualTags = parseTags(diary.tags).filter(t => !t.startsWith("🤖") && !t.startsWith("🚨")).join(', ');
    document.getElementById('tags').value = manualTags;
    document.getElementById('imagePreview').style.display = 'none';
    currentBase64 = null; 

    editingDiaryId = diary.id;
    document.getElementById('submitBtn').innerHTML = "🔄 この内容で更新する";
    window.scrollTo(0, 0); 
}

// 🗑️ 削除処理
async function deleteDiary(id) {
    if (!confirm("本当にこの記録を削除しますか？\n(削除後は元に戻せません)")) return;
    const result = await deleteDiaryApi(id); // api.jsの関数を呼ぶ
    if (result.success) {
        alert("削除しました。");
        fetchDiaries();
    } else {
        alert("エラー: " + result.error);
    }
}

// 🔍 フィルタープルダウンの描画
function renderTagClouds(diaries) {
  const select = document.getElementById('tagFilter');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">すべてのタグ（全件表示）</option>';

  const allTags = new Set();
  globalDiaries.forEach(d => parseTags(d.tags).forEach(t => {
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
  if (selectedTag === "") renderDiariesList(globalDiaries);
  else renderDiariesList(globalDiaries.filter(diary => parseTags(diary.tags).includes(selectedTag)));
}

// 📱 タブ切り替え
function switchTab(tabName, element) {
    document.getElementById('tab-record').classList.add('hidden');
    document.getElementById('tab-history').classList.add('hidden');
    document.getElementById('tab-map').classList.add('hidden');
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    element.classList.add('active');

    if (tabName === 'history') fetchDiaries();
    if (tabName === 'map' && typeof initViewMap === 'function') {
        initViewMap(); updateViewMarkers(globalDiaries);
    }
}