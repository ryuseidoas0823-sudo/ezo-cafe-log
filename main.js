// ==========================================
// 📱 main.js (UI制御・イベント管理)
// ==========================================
let globalDiaries = []; 
let editingDiaryId = null;
let currentBase64 = null;
let currentUser = null; // 👑 🆕 ユーザー権限の保持用

document.addEventListener('DOMContentLoaded', async () => {
  resetDateToToday();
  loadSettings(); 
  initUserUuid(); 
  
  // 👑 🆕 初期化時に自分の権限情報を取得して保持
  currentUser = await fetchMe(); 
  
  await Promise.all([
    fetchDiaries(),
    fetchMasterShopsApi()
  ]);
  
  document.getElementById('tagFilter').addEventListener('change', filterDiaries);

  // 🆕 マップのタグフィルターが変更されたら、ズームを維持したままピンを再描画！
  const mapTagFilterEl = document.getElementById('mapTagFilter');
  if (mapTagFilterEl) {
      mapTagFilterEl.addEventListener('change', () => {
          if (typeof updateViewMarkers === 'function') {
              updateViewMarkers(globalDiaries, false);
          }
      });
  }
});

function initUserUuid() {
  let uuid = localStorage.getItem('ezo_user_uuid');
  if (!uuid) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      uuid = crypto.randomUUID();
    } else {
      uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    localStorage.setItem('ezo_user_uuid', uuid);
  }
}

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

function resizeImageAsync(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const MAX_SIZE = 800;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
        } else {
          if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractExifAndWeather(file) {
  let lat = null, lng = null, temp = null, weatherIcon = "❓";
  let targetDate = new Date();
  
  try {
    const exifData = await exifr.parse(file);
    if (exifData) {
      if (exifData.latitude && exifData.longitude) {
        lat = exifData.latitude;
        lng = exifData.longitude;
      }
      if (exifData.DateTimeOriginal) {
        targetDate = new Date(exifData.DateTimeOriginal);
      }
    }
  } catch (err) { console.log("Exif error:", err); }

  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const visitedAt = `${yyyy}-${mm}-${dd}`;
  const dateStr = visitedAt;
  const hour = targetDate.getHours();

  if (lat !== null && lng !== null) {
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
  }
  return { lat, lng, visitedAt, weatherIcon, temp };
}

// 📸 写真選択アクション
document.getElementById('imageInput').addEventListener('change', async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const statusEl = document.getElementById('gpsStatus');
  const dynamicForm = document.getElementById('dynamicFormFields');

  if (files.length === 1) {
    const file = files[0];
    if(statusEl) {
      statusEl.innerText = "📸 写真を解析＆最適化中...";
      statusEl.style.color = "#3498db";
    }

    currentBase64 = await resizeImageAsync(file);
    const imgPreview = document.getElementById('imagePreview');
    imgPreview.src = currentBase64;
    imgPreview.style.display = 'block';

    const { lat, lng, visitedAt, weatherIcon, temp } = await extractExifAndWeather(file);
    
    document.getElementById('visitedAt').value = visitedAt;
    if (weatherIcon !== "❓") {
      const weatherSelect = document.getElementById('weatherSelect');
      if (weatherSelect) weatherSelect.value = weatherIcon;
    }
    document.getElementById('temperature').value = temp !== null ? temp : "";
    document.getElementById('latitude').value = lat;
    document.getElementById('longitude').value = lng;

    if (dynamicForm) dynamicForm.classList.add('show');

    if(statusEl) {
      if (lat !== null) {
        statusEl.innerText = `✅ 写真から位置と天気を自動取得しました！\n${weatherIcon} ${temp !== null ? temp + '℃' : ''}`;
        statusEl.style.color = "#27ae60";
      } else {
        statusEl.innerText = "ℹ️ 写真に位置情報がないため、天気の自動取得をスキップしました。";
        statusEl.style.color = "#f39c12";
      }
    }
  } 
  else {
    if (!confirm(`${files.length}枚の写真が選択されました。\nすべて「未整理(📦)」として一括ストックしますか？`)) {
      e.target.value = ''; return;
    }

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if(statusEl) {
        statusEl.innerText = `📦 一括登録中... (${i + 1} / ${files.length} 枚目)`;
        statusEl.style.color = "#8e44ad";
      }

      const base64 = await resizeImageAsync(file);
      const { lat, lng, visitedAt, weatherIcon, temp } = await extractExifAndWeather(file);

      const payload = {
        id: null, shopId: null, shopName: "未整理の写真", comment: "", visitedAt: visitedAt, tags: "", 
        imageBase64: base64, lat: lat, lng: lng, temperature: temp, weatherIcon: "📦", 
        userGender: localStorage.getItem('ezo_gender') || "未設定",
        userAge: localStorage.getItem('ezo_age') || "未設定",
        userUuid: localStorage.getItem('ezo_user_uuid')
      };
      await saveDiaryApi(payload);
    }

    if(statusEl) { statusEl.innerText = "✅ 全ての一括登録が完了しました！"; statusEl.style.color = "#27ae60"; }

    document.getElementById('recordForm').reset();
    document.getElementById('imagePreview').style.display = 'none';
    if (dynamicForm) dynamicForm.classList.remove('show'); 
    currentBase64 = null;
    resetDateToToday();
    submitBtn.disabled = false;
    e.target.value = '';

    fetchDiaries();
    switchTab('history', document.querySelector('.bottom-nav .nav-item:nth-child(2)'));
  }
});

// ✍️ 写真なし記録ボタンのアクション
const btnSkipPhoto = document.getElementById('btnSkipPhoto');
if (btnSkipPhoto) {
    btnSkipPhoto.addEventListener('click', () => {
        const dynamicForm = document.getElementById('dynamicFormFields');
        const statusEl = document.getElementById('gpsStatus');
        
        currentBase64 = null;
        document.getElementById('imageInput').value = '';
        document.getElementById('imagePreview').style.display = 'none';
        
        document.getElementById('latitude').value = "";
        document.getElementById('longitude').value = "";
        document.getElementById('temperature').value = "";
        document.getElementById('weatherSelect').value = "❓";
        
        if (dynamicForm) dynamicForm.classList.add('show');
        
        if (statusEl) {
            statusEl.innerText = "ℹ️ 写真なしで記録します。\n店舗名で検索して選択すると、自動で位置情報がセットされます！";
            statusEl.style.color = "#3498db";
        }
    });
}

let suggestTimeout = null;
document.getElementById('shopName').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  const suggestList = document.getElementById('shopSuggestList');
  document.getElementById('shopId').value = ""; 
  if (suggestTimeout) clearTimeout(suggestTimeout); 
  if (query.length === 0) { suggestList.style.display = 'none'; return; }

  suggestTimeout = setTimeout(async () => {
    const results = await searchMasterApi(query); 
    if (results.length > 0) {
      suggestList.innerHTML = results.map(shop => 
        `<li class="suggest-item" data-id="${shop.shop_id || ''}" data-lat="${shop.latitude || ''}" data-lng="${shop.longitude || ''}">${escapeHTML(shop.shop_name)}</li>`
      ).join('');
      suggestList.style.display = 'block';
      
      document.querySelectorAll('.suggest-item').forEach(item => {
        item.addEventListener('click', (ev) => {
          document.getElementById('shopName').value = ev.target.innerText;
          document.getElementById('shopId').value = ev.target.dataset.id;
          
          if (ev.target.dataset.lat && ev.target.dataset.lng) {
              document.getElementById('latitude').value = ev.target.dataset.lat;
              document.getElementById('longitude').value = ev.target.dataset.lng;
              const statusEl = document.getElementById('gpsStatus');
              if (statusEl) { statusEl.innerText = "📍 店舗マスタから位置情報をセットしました"; statusEl.style.color = "#27ae60"; }
          }
          suggestList.style.display = 'none';
        });
      });
    } else { suggestList.style.display = 'none'; }
  }, 300);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.form-group.relative')) {
    const suggestList = document.getElementById('shopSuggestList');
    if (suggestList) suggestList.style.display = 'none';
  }
});

document.getElementById('recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submitBtn');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = "🤖 通信中...";

  const eatType = document.querySelector('input[name="eatType"]:checked').value;
  const userTags = document.getElementById('tags').value;
  const combinedTags = userTags ? `${eatType}, ${userTags}` : eatType;

  let finalLat = document.getElementById('latitude') ? document.getElementById('latitude').value : null;
  let finalLng = document.getElementById('longitude') ? document.getElementById('longitude').value : null;
  
  if (eatType === '🥡テイクアウト' || eatType === '🛍️豆・グッズ') {
      finalLat = null; finalLng = null;
      if(document.getElementById('latitude')) document.getElementById('latitude').value = "";
      if(document.getElementById('longitude')) document.getElementById('longitude').value = "";
  }

  let finalStatusIcon = document.getElementById('weatherSelect').value;
  if (document.getElementById('isBookmark') && document.getElementById('isBookmark').checked) finalStatusIcon = "💭";
  if (document.getElementById('isDraft') && document.getElementById('isDraft').checked) finalStatusIcon = "📦";

  const payload = {
    id: editingDiaryId,
    shopId: document.getElementById('shopId') ? document.getElementById('shopId').value : null,
    shopName: document.getElementById('shopName').value,
    comment: document.getElementById('comment').value,
    visitedAt: document.getElementById('visitedAt').value,
    tags: combinedTags, 
    imageBase64: currentBase64,
    lat: finalLat, lng: finalLng,
    temperature: document.getElementById('temperature') ? document.getElementById('temperature').value : null,
    weatherIcon: finalStatusIcon,
    userGender: localStorage.getItem('ezo_gender') || "未設定",
    userAge: localStorage.getItem('ezo_age') || "未設定",
    userUuid: localStorage.getItem('ezo_user_uuid')
  };

  const result = await saveDiaryApi(payload); 
  
  if (result.success) {
    document.getElementById('recordForm').reset();
    document.getElementById('imagePreview').style.display = 'none';
    if(document.getElementById('gpsStatus')) document.getElementById('gpsStatus').innerText = ""; 
    const dynamicForm = document.getElementById('dynamicFormFields');
    if (dynamicForm) dynamicForm.classList.remove('show');
    currentBase64 = null;
    resetDateToToday();
    
    alert(editingDiaryId ? "✨ 記録を更新しました！" : "✨ 記録が完了しました！");
    editingDiaryId = null; 
    
    fetchDiaries();
    switchTab('history', document.querySelector('.bottom-nav .nav-item:nth-child(2)'));
  } else { alert("エラー: " + result.error); }
  
  submitBtn.disabled = false;
  submitBtn.innerHTML = originalBtnText;
});

// 🎨 タイポグラフィカードの自動生成ジェネレーター（Canvas API）
function generateTypographyBase64(shopName, tags, weatherIcon) {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');

    const tagList = parseTags(tags);
    const manualTags = tagList.filter(t => !t.startsWith('🤖') && !t.startsWith('🚨') && t !== '🥡テイクアウト' && t !== '☕️店内' && t !== '🛍️豆・グッズ');
    const mainTag = manualTags.length > 0 ? manualTags[0] : (tagList[0] || "カフェ");
    const baseColor = getColorFromTag(mainTag);

    // 背景塗りつぶし
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 800, 450);

    // エレガントなグラデーションのオーバーレイ
    const gradient = ctx.createLinearGradient(0, 0, 800, 450);
    gradient.addColorStop(0, 'rgba(255,255,255,0.25)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 450);

    // 中央の透かし絵文字（ウォーターマーク）
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.font = "200px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(weatherIcon && weatherIcon !== "❓" ? weatherIcon : "☕️", 400, 225);

    // テキスト用の丸角背景ボックス
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    const rectX = 100, rectY = 125, rectW = 600, rectH = 200, r = 20;
    ctx.beginPath();
    ctx.moveTo(rectX + r, rectY);
    ctx.lineTo(rectX + rectW - r, rectY);
    ctx.quadraticCurveTo(rectX + rectW, rectY, rectX + rectW, rectY + r);
    ctx.lineTo(rectX + rectW, rectY + rectH - r);
    ctx.quadraticCurveTo(rectX + rectW, rectY + rectH, rectX + rectW - r, rectY + rectH);
    ctx.lineTo(rectX + r, rectY + rectH);
    ctx.quadraticCurveTo(rectX, rectY + rectH, rectX, rectY + rectH - r);
    ctx.lineTo(rectX, rectY + r);
    ctx.quadraticCurveTo(rectX, rectY, rectX + r, rectY);
    ctx.closePath();
    ctx.fill();

    // 店舗名
    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(shopName || '名前なし', 400, 200);

    // タグ一覧（サブタイトル）
    ctx.fillStyle = '#7f8c8d';
    ctx.font = '22px sans-serif';
    const displayTags = manualTags.length > 0 ? manualTags.join(' / ') : '日常の記録';
    ctx.fillText(displayTags, 400, 260);

    return canvas.toDataURL('image/jpeg', 0.8);
}

function renderDiariesList(diaries) {
  const container = document.getElementById('diariesList');
  if (!container) return;
  container.innerHTML = "";

  diaries.forEach(diary => {
    const isClosed = diary.weather_icon === "🚫";
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
        imageHTML = `<img src="${diary.image_base64 || diary.image_url}" class="diary-image" alt="カフェの写真">`;
    } else {
        const typoBase64 = generateTypographyBase64(diary.shop_name, diary.tags, diary.weather_icon);
        imageHTML = `<img src="${typoBase64}" class="diary-image" alt="タイポグラフィカード" style="box-shadow: 0 4px 6px rgba(0,0,0,0.1);">`;
    }

    const displayDate = diary.visited_at ? diary.visited_at.split(' ')[0] : '日付不明';

    let weatherStr = "";
    if (isClosed) weatherStr = "🚫 閉店・移転報告済み";
    else if (diary.weather_icon === "💭") weatherStr = "💭 行きたい";
    else if (diary.weather_icon === "📦") weatherStr = "📦 未整理";
    else {
      let tempStr = diary.temperature ? `${diary.temperature}℃` : '';
      weatherStr = diary.weather_icon && diary.weather_icon !== "❓" ? `${diary.weather_icon} ${tempStr}` : '';
    }

    card.innerHTML = `
      <div class="diary-header">
        <span class="diary-date">${escapeHTML(displayDate)} <span style="margin-left: 8px; color: ${isClosed ? '#e74c3c' : 'inherit'};">${escapeHTML(weatherStr)}</span></span>
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

function editDiary(id) {
    const diary = globalDiaries.find(d => d.id === id);
    if (!diary) return;

    switchTab('record', document.querySelector('.bottom-nav .nav-item:nth-child(1)'));
    
    document.getElementById('shopName').value = diary.shop_name === "未整理の写真" ? "" : (diary.shop_name || "");
    if (document.getElementById('shopId')) document.getElementById('shopId').value = diary.shop_id || "";
    document.getElementById('visitedAt').value = diary.visited_at ? diary.visited_at.split(' ')[0] : "";
    document.getElementById('comment').value = diary.comment || "";
    
    if (document.getElementById('isBookmark')) document.getElementById('isBookmark').checked = (diary.weather_icon === "💭");
    if (document.getElementById('isDraft')) document.getElementById('isDraft').checked = false; 

    if (diary.weather_icon === "💭" || diary.weather_icon === "📦" || diary.weather_icon === "🚫") {
        if (document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = "❓";
    } else if (diary.weather_icon) {
        if (document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = diary.weather_icon;
    } else {
        if (document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = "❓";
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

    const imgPreview = document.getElementById('imagePreview');
    if (diary.image_base64 || diary.image_url) {
        imgPreview.src = diary.image_base64 || diary.image_url;
        imgPreview.style.display = 'block';
    } else { 
        imgPreview.style.display = 'none'; 
    }
    
    const dynamicForm = document.getElementById('dynamicFormFields');
    if (dynamicForm) dynamicForm.classList.add('show');

    currentBase64 = null; 
    editingDiaryId = diary.id;
    document.getElementById('submitBtn').innerHTML = "🔄 この内容で更新する";
    window.scrollTo(0, 0); 
}

async function deleteDiary(id) {
    if (!confirm("本当にこの記録を削除しますか？\n(削除後は元に戻せません)")) return;
    const result = await deleteDiaryApi(id);
    if (result.success) { alert("削除しました。"); fetchDiaries(); }
    else { alert("エラー: " + result.error); }
}

function renderTagClouds() {
  const selectHistory = document.getElementById('tagFilter');
  const selectMap = document.getElementById('mapTagFilter');
  
  const currentHistoryVal = selectHistory ? selectHistory.value : "";
  const currentMapVal = selectMap ? selectMap.value : "";

  if (selectHistory) selectHistory.innerHTML = '<option value="">すべてのタグ（全件表示）</option>';
  if (selectMap) selectMap.innerHTML = '<option value="">🏷️ すべての気分・目的・タグ</option>';

  const allTags = new Set();
  
  globalDiaries.forEach(d => parseTags(d.tags).forEach(t => {
    if (!t.startsWith("🚨") && t !== '🥡テイクアウト' && t !== '☕️店内' && t !== '🛍️豆・グッズ') {
        allTags.add(t);
    }
  }));

  Array.from(allTags).sort().forEach(tag => {
    if (selectHistory) {
        const option = document.createElement('option');
        option.value = tag; option.textContent = tag;
        if (tag === currentHistoryVal) option.selected = true;
        selectHistory.appendChild(option);
    }
    if (selectMap) {
        const option = document.createElement('option');
        option.value = tag; 
        option.textContent = tag.replace(/🤖[☕️🍰🛋️]/, '🤖 ');
        if (tag === currentMapVal) option.selected = true;
        selectMap.appendChild(option);
    }
  });
}

function filterDiaries() {
  const selectedTag = document.getElementById('tagFilter').value;
  if (selectedTag === "") renderDiariesList(globalDiaries);
  else renderDiariesList(globalDiaries.filter(diary => parseTags(diary.tags).includes(selectedTag)));
}

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
        initViewMap(); 
        updateViewMarkers(globalDiaries, true); 
    }
    if (tabName === 'analytics' && typeof renderAnalytics === 'function') { renderAnalytics(); }
}

window.reportClosed = async function(shopId, shopName, lat, lng) {
    if (!confirm(`「${shopName}」を閉店・移転として報告しますか？\n(2週間はマップ上で半透明になり、その後完全に消去されます)`)) return;
    document.body.style.cursor = 'wait'; 
    const payload = {
        id: null, shopId: shopId && shopId !== 'null' ? shopId : null, shopName: shopName, comment: "",
        visitedAt: new Date().toISOString().split('T')[0], tags: "", imageBase64: null, lat: lat, lng: lng, temperature: null, weatherIcon: "🚫",
        userGender: localStorage.getItem('ezo_gender') || "未設定", userAge: localStorage.getItem('ezo_age') || "未設定",
        userUuid: localStorage.getItem('ezo_user_uuid')
    };
    await saveDiaryApi(payload);
    await fetchDiaries(); 
    if (typeof updateViewMarkers === 'function') updateViewMarkers(globalDiaries);
    document.body.style.cursor = 'default';
    alert("閉店・移転を報告しました。ご協力ありがとうございます！");
};

window.cancelCloseReport = async function(diaryId) {
    if (!confirm(`この閉店報告を取り消しますか？`)) return;
    document.body.style.cursor = 'wait';
    await deleteDiaryApi(diaryId); 
    await fetchDiaries();
    if (typeof updateViewMarkers === 'function') updateViewMarkers(globalDiaries);
    document.body.style.cursor = 'default';
    alert("報告を取り消しました。マップを元に戻しました。");
};

let mapSuggestTimeout = null;
const mapSearchInput = document.getElementById('mapSearchInput');
if (mapSearchInput) {
    mapSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        const suggestList = document.getElementById('mapSearchSuggestList');
        if (mapSuggestTimeout) clearTimeout(mapSuggestTimeout); 
        if (query.length === 0) { suggestList.style.display = 'none'; return; }

        mapSuggestTimeout = setTimeout(() => {
            const results = globalMasterShops.filter(s => s.shop_name.includes(query)).slice(0, 10);
            if (results.length > 0) {
                suggestList.innerHTML = results.map(shop => `<li class="suggest-item" data-lat="${shop.latitude}" data-lng="${shop.longitude}">${escapeHTML(shop.shop_name)}</li>`).join('');
                suggestList.style.display = 'block';
                document.querySelectorAll('#mapSearchSuggestList .suggest-item').forEach(item => {
                    item.addEventListener('click', (ev) => {
                        mapSearchInput.value = ev.target.innerText;
                        const lat = parseFloat(ev.target.dataset.lat); const lng = parseFloat(ev.target.dataset.lng);
                        suggestList.style.display = 'none';
                        if (typeof flyToShop === 'function') flyToShop(lat, lng);
                    });
                });
            } else { suggestList.style.display = 'none'; }
        }, 100); 
    });
}