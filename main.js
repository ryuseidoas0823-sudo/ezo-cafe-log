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

// 📍 ② 写真データまたは現在地から過去・現在の天気を割り出す処理
document.getElementById('getGpsWeatherBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('gpsStatus');
  statusEl.innerText = "📍 データを解析中...";
  statusEl.style.color = "#3498db";

  let lat = null;
  let lng = null;
  let targetDate = new Date(); // デフォルトは現在時刻
  let fromPhoto = false;

  // 1. 写真からExif情報（位置と撮影日時）の取得を試みる
  const fileInput = document.getElementById('imageInput');
  if (fileInput.files.length > 0) {
    try {
      const exifData = await exifr.parse(fileInput.files[0]);
      if (exifData) {
        if (exifData.latitude && exifData.longitude) {
          lat = exifData.latitude;
          lng = exifData.longitude;
          fromPhoto = true;
        }
        if (exifData.DateTimeOriginal) {
          targetDate = new Date(exifData.DateTimeOriginal);
        }
      }
    } catch (e) { console.log("Exif parse error:", e); }
  }

  // 2. 写真に位置情報がない場合は、GPSで現在地を取得
  if (lat === null || lng === null) {
    statusEl.innerText = "📍 GPSで現在地を取得中...";
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000 });
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch (e) {
      statusEl.innerText = "❌ 位置情報の取得に失敗しました。";
      statusEl.style.color = "#e74c3c";
      return;
    }
  }

  statusEl.innerText = "⛅️ 当時の天気データを割り出し中...";

  // 3. Open-Meteo APIで指定日時（または現在）の天気を取得
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const hour = targetDate.getHours();

  let temp = null;
  let weatherIcon = "❓";

  // WMOの天気コードを絵文字に変換する関数
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
    // まずはForecast API（現在〜直近の過去）を叩く
    let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
    let res = await fetch(url);
    let data = await res.json();

    // 取れなかった場合（古い写真など）はArchive（過去天気）APIへフォールバック
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

  // 4. 天気アイコンと気温をフォームに反映
  if (weatherIcon !== "❓") {
    const radio = document.querySelector(`input[name="weatherType"][value="${weatherIcon}"]`);
    if (radio) radio.checked = true;
  }
  document.getElementById('temperature').value = temp !== null ? temp : "";

  // 5. 【自衛のDX】テイクアウト・物販の場合は自宅バレを防ぐため位置情報を破棄
  const eatType = document.querySelector('input[name="eatType"]:checked').value;
  if (eatType === '🥡テイクアウト' || eatType === '🛍️豆・グッズ') {
      document.getElementById('latitude').value = "";
      document.getElementById('longitude').value = "";
      statusEl.innerText = `✅ 天気を割り出しました！（※自宅を考慮し位置情報を破棄）\n${weatherIcon} ${temp !== null ? temp + '℃' : ''}`;
      statusEl.style.color = "#27ae60";
  } else {
      document.getElementById('latitude').value = lat;
      document.getElementById('longitude').value = lng;
      const srcText = fromPhoto ? "写真の位置" : "現在地";
      statusEl.innerText = `✅ ${srcText}と天気を割り出しました！\n${weatherIcon} ${temp !== null ? temp + '℃' : ''}`;
      statusEl.style.color = "#27ae60";
  }
});

// 📤 フォーム送信 (保存・更新)
document.getElementById('recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submitBtn');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = "🤖 通信中...";

  // ☕️🥡🛍️ ラジオボタンの値を手動タグと結合して裏で送る
  const eatType = document.querySelector('input[name="eatType"]:checked').value;
  const userTags = document.getElementById('tags').value;
  const combinedTags = userTags ? `${eatType}, ${userTags}` : eatType;

  // 🛡️ 【自衛のDX】最終安全装置：送信直前に利用タイプを確認し、位置情報を強制破棄
  let finalLat = document.getElementById('latitude') ? document.getElementById('latitude').value : null;
  let finalLng = document.getElementById('longitude') ? document.getElementById('longitude').value : null;
  
  if (eatType === '🥡テイクアウト' || eatType === '🛍️豆・グッズ') {
      finalLat = null;
      finalLng = null;
      // 念のためHTML側の隠し項目も空にしておく
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
    // ⛅️ 最終チェックを通過した安全なGPSデータのみを送信する
    lat: finalLat,
    lng: finalLng,
    temperature: document.getElementById('temperature') ? document.getElementById('temperature').value : null,
    weatherIcon: document.querySelector('input[name="weatherType"]:checked') ? document.querySelector('input[name="weatherType"]:checked').value : "❓"
  };

  const result = await saveDiaryApi(payload); 
  
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