// ==========================================
// 📱 main.js (UI制御・イベント管理)
// ==========================================
let globalDiaries = []; // api.js で取得したデータが入る
let editingDiaryId = null;
let currentBase64 = null;

document.addEventListener('DOMContentLoaded', () => {
  resetDateToToday();
  loadSettings(); // ④ 設定の読み込みを追加
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

// ⚙️ ④ 設定の読み書き処理を追加
function loadSettings() {
  const g = localStorage.getItem('ezo_gender');
  const a = localStorage.getItem('ezo_age');
  if (g && document.getElementById('settingGender')) document.getElementById('settingGender').value = g;
  if (a && document.getElementById('settingAge')) document.getElementById('settingAge').value = a;
}

function saveSettings() {
  const g = document.getElementById('settingGender').value;
  const a = document.getElementById('settingAge').value;
  if (!g || !a) { alert("性別と年代を両方選択してください。"); return; }
  localStorage.setItem('ezo_gender', g);
  localStorage.setItem('ezo_age', a);
  alert("✨ 設定を保存しました！");
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

// 🔍 ① 店舗マスタサジェスト機能の追加
let suggestTimeout = null;
document.getElementById('shopName').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  const suggestList = document.getElementById('shopSuggestList');
  document.getElementById('shopId').value = ""; // 文字が変更されたら一旦店舗IDをリセット
  
  if (suggestTimeout) clearTimeout(suggestTimeout); // APIの連打防止
  
  if (query.length === 0) {
    suggestList.style.display = 'none';
    return;
  }

  // ユーザーがタイピングを終えてから0.3秒後にAPIを叩く（エコ設計）
  suggestTimeout = setTimeout(async () => {
    const results = await searchMasterApi(query); // api.jsの関数を呼ぶ
    if (results.length > 0) {
      suggestList.innerHTML = results.map(shop => 
        `<li class="suggest-item" data-id="${shop.shop_id || ''}">${escapeHTML(shop.shop_name)}</li>`
      ).join('');
      suggestList.style.display = 'block';
      
      // 候補をクリックした時の処理
      document.querySelectorAll('.suggest-item').forEach(item => {
        item.addEventListener('click', (ev) => {
          document.getElementById('shopName').value = ev.target.innerText;
          document.getElementById('shopId').value = ev.target.dataset.id;
          suggestList.style.display = 'none';
        });
      });
    } else {
      suggestList.style.display = 'none';
    }
  }, 300);
});

// 外側の画面をクリックした時にサジェストを閉じる処理
document.addEventListener('click', (e) => {
  if (!e.target.closest('.form-group.relative')) {
    const suggestList = document.getElementById('shopSuggestList');
    if (suggestList) suggestList.style.display = 'none';
  }
});

// 📍 ② 現在地と気温の自動取得処理を追加
document.getElementById('getGpsWeatherBtn').addEventListener('click', () => {
  const statusEl = document.getElementById('gpsStatus');
  statusEl.innerText = "📍 位置情報と天気を取得中...";
  statusEl.style.color = "#3498db";

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      document.getElementById('latitude').value = lat;
      document.getElementById('longitude').value = lng;
      
      // ⛅️ 完全無料のOpen-Meteo APIを叩いて気温を取得
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
        const data = await res.json();
        if (data && data.current_weather) {
            const temp = data.current_weather.temperature;
            document.getElementById('temperature').value = temp;
            statusEl.innerText = `✅ 気温 ${temp}℃ と位置情報を取得しました！`;
            statusEl.style.color = "#27ae60";
        } else {
            statusEl.innerText = "✅ 位置情報のみ取得しました（気温は不明）";
            statusEl.style.color = "#27ae60";
        }
      } catch (e) {
        statusEl.innerText = "✅ 位置情報のみ取得しました（天気APIエラー）";
        statusEl.style.color = "#27ae60";
      }
    },
    (err) => {
      statusEl.innerText = "❌ 位置情報の取得に失敗しました。";
      statusEl.style.color = "#e74c3c";
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
});

// 📤 フォーム送信 (保存・更新)
document.getElementById('recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submitBtn');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = "🤖 通信中...";

  // ☕️🥡 ③ ラジオボタンの値を手動タグと結合して裏で送る
  const eatType = document.querySelector('input[name="eatType"]:checked').value;
  const userTags = document.getElementById('tags').value;
  const combinedTags = userTags ? `${eatType}, ${userTags}` : eatType;

  const payload = {
    id: editingDiaryId,
    shopId: document.getElementById('shopId') ? document.getElementById('shopId').value : null, // ① 追加
    shopName: document.getElementById('shopName').value,
    comment: document.getElementById('comment').value,
    visitedAt: document.getElementById('visitedAt').value,
    tags: combinedTags, // ③ 修正
    imageBase64: currentBase64,
    // ⛅️ ② GPSと天気のデータを送信
    lat: document.getElementById('latitude') ? document.getElementById('latitude').value : null,
    lng: document.getElementById('longitude') ? document.getElementById('longitude').value : null,
    temperature: document.getElementById('temperature') ? document.getElementById('temperature').value : null,
    weatherIcon: document.querySelector('input[name="weatherType"]:checked') ? document.querySelector('input[name="weatherType"]:checked').value : "❓"
  };

  const result = await saveDiaryApi(payload); // api.jsの関数を呼ぶ
  
  if (result.success) {
    document.getElementById('recordForm').reset();
    document.getElementById('imagePreview').style.display = 'none';
    if(document.getElementById('gpsStatus')) document.getElementById('gpsStatus').innerText = ""; // ステータスクリア
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

    // ⛅️ ② 履歴カードに天気と気温を表示
    let tempStr = diary.temperature ? `${diary.temperature}℃` : '';
    let weatherStr = diary.weather_icon && diary.weather_icon !== "❓" ? `${diary.weather_icon} ${tempStr}` : '';

    card.innerHTML = `
      <div class="diary-header">
        <span class="diary-date">${escapeHTML(displayDate)} <span style="margin-left: 8px;">${escapeHTML(weatherStr)}</span></span>
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
    if (document.getElementById('shopId')) document.getElementById('shopId').value = diary.shop_id || "";
    document.getElementById('visitedAt').value = diary.visited_at ? diary.visited_at.split(' ')[0] : "";
    document.getElementById('comment').value = diary.comment || "";
    
    // ⛅️ ② 編集時に天気・気温情報をフォームに復元
    if (diary.weather_icon) {
        const radio = document.querySelector(`input[name="weatherType"][value="${diary.weather_icon}"]`);
        if (radio) radio.checked = true;
    } else {
        document.querySelector('input[name="weatherType"][value="❓"]').checked = true;
    }
    if (document.getElementById('latitude')) document.getElementById('latitude').value = diary.latitude || "";
    if (document.getElementById('longitude')) document.getElementById('longitude').value = diary.longitude || "";
    if (document.getElementById('temperature')) document.getElementById('temperature').value = diary.temperature || "";
    if (document.getElementById('gpsStatus')) document.getElementById('gpsStatus').innerText = "";

    // ☕️🥡🛍️ ③ 編集時に店内/テイクアウト/物販のラジオボタンを復元
    const allTags = parseTags(diary.tags);
    if (allTags.includes('🛍️豆・グッズ')) {
        document.querySelector('input[name="eatType"][value="🛍️豆・グッズ"]').checked = true;
    } else if (allTags.includes('🥡テイクアウト')) {
        document.querySelector('input[name="eatType"][value="🥡テイクアウト"]').checked = true;
    } else {
        document.querySelector('input[name="eatType"][value="☕️店内"]').checked = true;
    }

    // ☕️🥡🛍️ ③ 利用タイプのタグはラジオボタンで選ぶため、手動入力欄からは隠す
    const manualTags = allTags.filter(t => !t.startsWith("🤖") && !t.startsWith("🚨") && t !== '🥡テイクアウト' && t !== '☕️店内' && t !== '🛍️豆・グッズ').join(', ');
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
    const tabs = ['record', 'history', 'map', 'analytics', 'settings'];
    tabs.forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        if(el) el.classList.add('hidden');
    });

    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    element.classList.add('active');

    if (tabName === 'history') fetchDiaries();
    if (tabName === 'map' && typeof initViewMap === 'function') {
        initViewMap(); updateViewMarkers(globalDiaries);
    }
    if (tabName === 'analytics' && typeof renderAnalytics === 'function') {
        renderAnalytics();
    }
}