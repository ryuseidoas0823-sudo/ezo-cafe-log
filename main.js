// ==========================================
// 📱 main.js (UI制御・イベント管理)
// ==========================================
let globalDiaries = []; 
let editingDiaryId = null;
let currentBase64 = null;

document.addEventListener('DOMContentLoaded', () => {
  resetDateToToday();
  loadSettings(); 
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

// 📸 ✨機能統合: 写真を選択した瞬間に、画像プレビュー、日時取得、過去の天気割り出しをすべて自動で実行
document.getElementById('imageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // 1. プレビューの表示
  const reader = new FileReader();
  reader.onload = function(event) {
    const imgPreview = document.getElementById('imagePreview');
    imgPreview.src = event.target.result;
    imgPreview.style.display = 'block';
    currentBase64 = event.target.result;
  };
  reader.readAsDataURL(file);

  const statusEl = document.getElementById('gpsStatus');
  if(statusEl) {
    statusEl.innerText = "📸 写真を解析中...";
    statusEl.style.color = "#3498db";
  }

  let lat = null;
  let lng = null;
  let targetDate = new Date();

  // 2. Exifから日時と位置情報を抽出
  try {
    const exifData = await exifr.parse(file);
    if (exifData) {
      if (exifData.latitude && exifData.longitude) {
        lat = exifData.latitude;
        lng = exifData.longitude;
      }
      if (exifData.DateTimeOriginal) {
        targetDate = new Date(exifData.DateTimeOriginal);
        const yyyy = targetDate.getFullYear();
        const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dd = String(targetDate.getDate()).padStart(2, '0');
        document.getElementById('visitedAt').value = `${yyyy}-${mm}-${dd}`;
      }
    }
  } catch (err) { console.log("Exif error:", err); }

  // 3. 緯度経度がない場合（スクショ等）はスキップ
  if (lat === null || lng === null) {
      if(statusEl) {
        statusEl.innerText = "ℹ️ 写真に位置情報が含まれていないため、天気の自動取得をスキップしました。";
        statusEl.style.color = "#f39c12";
      }
      return;
  }

  if(statusEl) statusEl.innerText = "⛅️ 当時の天気データを割り出し中...";

  // 4. 当時の天気をOpen-Meteo APIから取得
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const hour = targetDate.getHours();

  let temp = null;
  let weatherIcon = "❓";

  function getWeatherEmoji(code) {
    if (code === 0) return "☀️";
    if (code >= 1 && code <= 3) return "☁️";
    if (code >= 51 && code <= 67) return "☔️";
    if (code >= 71 && code <= 86) return "❄️";
    if (code >= 80 && code <= 82) return "☔️";
    if (code >= 95 && code <= 99) return "☔️";
    return "❓";
  }

  try {
    let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
    let res = await fetch(url);
    let data = await res.json();

    if (data.error || !data.hourly) {
        url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
        res = await fetch(url);
        data = await res.json();
    }

    if (data && data.hourly) {
        temp = Math.round(data.hourly.temperature_2m[hour]);
        const code = data.hourly.weather_code[hour];
        weatherIcon = getWeatherEmoji(code);
    }
  } catch (e) { console.log("Weather API error:", e); }

  // 5. 天気と気温、位置情報をフォームの裏側にセット
  if (weatherIcon !== "❓") {
    const radio = document.querySelector(`input[name="weatherType"][value="${weatherIcon}"]`);
    if (radio) radio.checked = true;
  }
  document.getElementById('temperature').value = temp !== null ? temp : "";
  document.getElementById('latitude').value = lat;
  document.getElementById('longitude').value = lng;

  if(statusEl) {
    statusEl.innerText = `✅ 写真から当時の天気を割り出しました！\n${weatherIcon} ${temp !== null ? temp + '℃' : ''}`;
    statusEl.style.color = "#27ae60";
  }
});

// 🔍 店舗マスタサジェスト機能
let suggestTimeout = null;
document.getElementById('shopName').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  const suggestList = document.getElementById('shopSuggestList');
  document.getElementById('shopId').value = ""; 
  
  if (suggestTimeout) clearTimeout(suggestTimeout); 
  
  if (query.length === 0) {
    suggestList.style.display = 'none';
    return;
  }

  suggestTimeout = setTimeout(async () => {
    const results = await searchMasterApi(query); 
    if (results.length > 0) {
      suggestList.innerHTML = results.map(shop => 
        `<li class="suggest-item" data-id="${shop.shop_id || ''}">${escapeHTML(shop.shop_name)}</li>`
      ).join('');
      suggestList.style.display = 'block';
      
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

document.addEventListener('click', (e) => {
  if (!e.target.closest('.form-group.relative')) {
    const suggestList = document.getElementById('shopSuggestList');
    if (suggestList) suggestList.style.display = 'none';
  }
});


// 📤 フォーム送信 (保存・更新)
document.getElementById('recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submitBtn');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = "🤖 通信中...";

  const eatType = document.querySelector('input[name="eatType"]:checked').value;
  const userTags = document.getElementById('tags').value;
  const combinedTags = userTags ? `${eatType}, ${userTags}` : eatType;

  // 🛡️ 【自衛のDX】最終安全装置：送信直前に利用タイプを確認し、位置情報を強制破棄
  let finalLat = document.getElementById('latitude') ? document.getElementById('latitude').value : null;
  let finalLng = document.getElementById('longitude') ? document.getElementById('longitude').value : null;
  
  if (eatType === '🥡テイクアウト' || eatType === '🛍️豆・グッズ') {
      finalLat = null;
      finalLng = null;
      if(document.getElementById('latitude')) document.getElementById('latitude').value = "";
      if(document.getElementById('longitude')) document.getElementById('longitude').value = "";
  }

  const payload = {
    id: editingDiaryId,
    shopId: document.getElementById('shopId') ? document.getElementById('shopId').value : null,
    shopName: document.getElementById('shopName').value,
    comment: document.getElementById('comment').value,
    visitedAt: document.getElementById('visitedAt').value,
    tags: combinedTags, 
    imageBase64: currentBase64,
    lat: finalLat,
    lng: finalLng,
    temperature: document.getElementById('temperature') ? document.getElementById('temperature').value : null,
    weatherIcon: document.querySelector('input[name="weatherType"]:checked') ? document.querySelector('input[name="weatherType"]:checked').value : "❓"
  };

  const result = await saveDiaryApi(payload); 
  
  if (result.success) {
    document.getElementById('recordForm').reset();
    document.getElementById('imagePreview').style.display = 'none';
    if(document.getElementById('gpsStatus')) document.getElementById('gpsStatus').innerText = ""; 
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

    const allTags = parseTags(diary.tags);
    if (allTags.includes('🛍️豆・グッズ')) {
        document.querySelector('input[name="eatType"][value="🛍️豆・グッズ"]').checked = true;
    } else if (allTags.includes('🥡テイクアウト')) {
        document.querySelector('input[name="eatType"][value="🥡テイクアウト"]').checked = true;
    } else {
        document.querySelector('input[name="eatType"][value="☕️店内"]').checked = true;
    }

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
    const result = await deleteDiaryApi(id);
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