// ==========================================
// 🧠 main.js (全体の司令塔・UI制御・描画処理)
// ==========================================

const CLOUDFLARE_WORKER_URL = "https://cafe-pipeline.ryusei-doas-0823.workers.dev/"; // ★忘れずに！
const HOME_LAT = 43.0620958;
const HOME_LNG = 141.3543763;
const SAFE_DISTANCE_METERS = 20;

var activeTagFilter = ""; 
var viewMap;                  
var pickerMap;      
var pickerMarker;   
var selectedImageBase64 = null; 
var selectedImageUrl = null; 
var selectedDatetime = null;
var currentRecordMode = 'manual';
var selectedMasterShop = null; 
var searchTimeout = null;      
var globalDiaries = []; 
var charts = {};        
var draftIdToUpgrade = null; 
var currentCalYear = new Date().getFullYear();
var currentCalMonth = new Date().getMonth() + 1; 
var activeSubTab = 'list';

window.onload = function() {
  loadSettings();
  fetchAndStoreAllDiaries();
  setupHidePinsButtons();
};

function switchTab(tabId) {
  // コンテンツの切り替え
  document.querySelectorAll('.content').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  
  // ナビゲーション（ボトムナビ）のハイライト切り替え
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNav = document.getElementById('nav-' + tabId);
  if(activeNav) activeNav.classList.add('active');
  
  // 各タブ固有の描画・更新処理
  if(tabId === 'view' || tabId === 'mapTab') applyFilters(); 
  if(tabId === 'mapTab') { initViewMap(); updateViewMarkers(); }
  if(tabId === 'analytics') renderAnalytics(); 
  if(tabId === 'settings') loadSettings(); 
}

window.switchSubTab = function(subTabId) {
  activeSubTab = subTabId;
  const listBtn = document.getElementById('subTabListBtn');
  const calBtn = document.getElementById('subTabCalendarBtn');
  const listView = document.getElementById('subViewList');
  const calView = document.getElementById('subViewCalendar');
  
  if (subTabId === 'list') {
    listBtn.style.background = "#2c3e50"; listBtn.style.color = "white";
    calBtn.style.background = "none"; calBtn.style.color = "#7f8c8d";
    listView.style.display = "block"; calView.style.display = "none";
    applyFilters();
  } else {
    calBtn.style.background = "#2c3e50"; calBtn.style.color = "white";
    listBtn.style.background = "none"; listBtn.style.color = "#7f8c8d";
    listView.style.display = "none"; calView.style.display = "block";
    renderCalendar();
  }
};

function startNoPhotoRecord() {
  if (!localStorage.getItem('ezo_gender') || !localStorage.getItem('ezo_age')) {
    alert("📊 先に「設定」タブで登録してください。"); switchTab('settings'); return;
  }
  currentRecordMode = 'manual'; selectedDatetime = null; selectedImageBase64 = null; selectedImageUrl = null; draftIdToUpgrade = null;
  document.getElementById('previewImg').style.display = "none";
  document.getElementById('step1').style.display = "none";
  document.getElementById('step2').style.display = "block";
  document.getElementById('weatherSelectorDiv').style.display = "block";
  document.getElementById('manualMapArea').style.display = "block";
  initPickerMap();
  document.querySelector('input[name="weatherType"][value="❓"]').checked = true;
}

function startBookmarkRecord() {
  startNoPhotoRecord();
  document.querySelector('input[name="weatherType"][value="💭"]').checked = true;
  document.getElementById('weatherSelectorDiv').style.display = "none";
}

async function handleImageSelect(event, mode) {
  const file = event.target.files[0];
  if (!file) return;
  currentRecordMode = mode; selectedDatetime = null; draftIdToUpgrade = null; selectedImageUrl = null;
  
  try {
    const exifData = await exifr.parse(file, ['DateTimeOriginal', 'latitude', 'longitude']);
    if (exifData) {
      if (exifData.DateTimeOriginal) {
        const d = new Date(exifData.DateTimeOriginal);
        selectedDatetime = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      }
      if (exifData.latitude && exifData.longitude && pickerMap && pickerMarker) {
        setTimeout(() => {
          pickerMap.setView([exifData.latitude, exifData.longitude], 16);
          pickerMarker.setLatLng([exifData.latitude, exifData.longitude]);
          checkSmartSuggest(exifData.latitude, exifData.longitude); 
        }, 500);
      }
    }
  } catch(e) {}

  document.querySelector('input[name="weatherType"][value="❓"]').checked = true;
  const img = new Image();
  img.onload = function() {
    const canvas = document.getElementById('canvas'); const ctx = canvas.getContext('2d');
    const scaleSize = Math.min(800 / img.width, 1);
    canvas.width = img.width * scaleSize; canvas.height = img.height * scaleSize;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    selectedImageBase64 = canvas.toDataURL('image/jpeg', 0.6);
    document.getElementById('previewImg').src = selectedImageBase64;
    document.getElementById('previewImg').style.display = "block";
    document.getElementById('step1').style.display = "none";
    document.getElementById('step2').style.display = "block";
    document.getElementById('weatherSelectorDiv').style.display = "block";
    document.getElementById('manualMapArea').style.display = "block";
    initPickerMap();
    URL.revokeObjectURL(img.src); 
  }
  img.src = URL.createObjectURL(file);
}

async function handleBulkImagesSelect(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  document.getElementById('step1').style.display = "none";
  document.getElementById('step2').style.display = "block";
  document.getElementById('submitBtn').disabled = true;
  
  for (let i = 0; i < files.length; i++) {
     document.getElementById('status').innerText = `📦 写真を一括処理中... (${i+1}/${files.length}枚目)`;
     await processAndUploadDraft(files[i]);
  }
  
  alert("✨ すべての写真を未整理ボックスに一時保存しました！");
  resetRecordTab();
  fetchAndStoreAllDiaries();
}

async function processAndUploadDraft(file) {
  return new Promise(async (resolve) => {
     let lat = null, lng = null, datetime = null;
     try {
        const exifData = await exifr.parse(file, ['DateTimeOriginal', 'latitude', 'longitude']);
        if (exifData) {
           if (exifData.DateTimeOriginal) {
              const d = new Date(exifData.DateTimeOriginal);
              datetime = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
           }
           if (exifData.latitude && exifData.longitude) { lat = exifData.latitude; lng = exifData.longitude; }
        }
     } catch(e) {}

     const img = new Image();
     img.onload = function() {
        const canvas = document.getElementById('canvas'); const ctx = canvas.getContext('2d');
        const scaleSize = Math.min(800 / img.width, 1);
        canvas.width = img.width * scaleSize; canvas.height = img.height * scaleSize;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.6);
        URL.revokeObjectURL(img.src);

        fetch(CLOUDFLARE_WORKER_URL, {
           method: "POST", headers: { "Content-Type": "application/json" },
           body: JSON.stringify({
              shopId: null, shopName: "未整理の写真", comment: "", latitude: lat, longitude: lng, 
              imageBase64: base64, imageUrl: null, tags: "📦未整理", weatherIcon: "📦", 
              temperature: null, userGender: "未設定", userAge: "未設定", visitedAt: datetime
           })
        }).then(() => resolve()).catch(() => resolve());
     };
     img.onerror = () => resolve(); 
     img.src = URL.createObjectURL(file);
  });
}

async function submitDiary() {
  let finalShopName = document.getElementById('shopNameInput').value;
  if (!finalShopName) { alert("店名を入力してください！"); return; }
  
  const eatType = document.querySelector('input[name="eatType"]:checked').value;
  const shopCategory = document.getElementById('shopCategorySelect').value;
  const weatherIcon = document.querySelector('input[name="weatherType"]:checked').value;
  const submitBtn = document.getElementById('submitBtn'); submitBtn.disabled = true;

  const userTags = document.getElementById('tagsInput').value;
  const combinedTags = `${eatType}, ${shopCategory}` + (userTags ? `, ${userTags}` : "");

  const userGender = localStorage.getItem('ezo_gender') || "未設定";
  const userAge = localStorage.getItem('ezo_age') || "未設定";

  if (document.getElementById('noLocationCheck').checked) {
    sendDataToCloudflare(selectedMasterShop ? selectedMasterShop.shop_id : null, finalShopName, null, null, weatherIcon, null, userGender, userAge, combinedTags, submitBtn);
    return;
  }

  if (selectedMasterShop) {
    document.getElementById('status').innerText = "📍 公式座標を使用して天気を取得中...";
    let temperature = await fetchTemperature(selectedMasterShop.latitude, selectedMasterShop.longitude);
    sendDataToCloudflare(selectedMasterShop.shop_id, finalShopName, selectedMasterShop.latitude, selectedMasterShop.longitude, weatherIcon, temperature, userGender, userAge, combinedTags, submitBtn);
    return;
  }

  const pos = pickerMarker.getLatLng();
  if (getDistanceFromLatLonInM(pos.lat, pos.lng, HOME_LAT, HOME_LNG) < SAFE_DISTANCE_METERS) {
    alert(`🚨【自宅ガード発動】自宅周辺です。新規店舗の場合は「位置情報を送らない」をお使いください。`); submitBtn.disabled = false; return;
  }
  sendDataToCloudflare(null, finalShopName, pos.lat, pos.lng, weatherIcon, null, userGender, userAge, combinedTags, submitBtn);
}

window.deleteDiary = function(id) {
  if (!confirm("削除しますか？")) return;
  fetch(`${CLOUDFLARE_WORKER_URL}?id=${id}`, { method: 'DELETE' }).then(res => res.json()).then(data => { if (data.success) fetchAndStoreAllDiaries(); });
};

window.openEditModal = function(id, mode = 'full') {
  const diary = globalDiaries.find(d => String(d.id) === String(id));
  if (!diary) return;

  document.getElementById('editId').value = diary.id; 
  document.getElementById('editShopName').value = diary.shop_name; 
  document.getElementById('editComment').value = diary.comment || "";
  
  const currentTags = parseTags(diary.tags);
  const eatTypes = ['☕️店内', '🥡テイクアウト', '🛍️豆・グッズ購入']; 
  let foundEatType = '☕️店内';
  eatTypes.forEach(t => { if (currentTags.includes(t)) foundEatType = t; });
  document.querySelector(`input[name="editEatType"][value="${foundEatType}"]`).checked = true;

  const categories = ['🏢喫茶・カフェ', '🔥ロースター', '🎪無店舗・間借り', '🍸カフェバー', '🍰お菓子屋の喫茶室', '🍵和風喫茶']; 
  let foundCategory = '🏢喫茶・カフェ';
  categories.forEach(c => { if (currentTags.includes(c)) foundCategory = c; });
  document.getElementById('editShopCategorySelect').value = foundCategory;

  document.getElementById('editTags').value = currentTags.filter(t => !eatTypes.includes(t) && !categories.includes(t)).join(', ');

  const wRadios = document.getElementsByName('editWeather');
  for(let r of wRadios) { if(r.value === diary.weather_icon) r.checked = true; }

  document.getElementById('editNoLocationCheck').checked = (!diary.latitude || !diary.longitude);
  initEditMap(diary.latitude, diary.longitude);

  if (mode === 'location') {
    document.getElementById('editModalTitle').innerText = "📍 位置情報の修正";
    document.getElementById('editDiaryFields').style.display = "none";
  } else {
    document.getElementById('editModalTitle').innerText = "✏️ 記録の編集";
    document.getElementById('editDiaryFields').style.display = "block";
  }

  document.getElementById('editModal').style.display = "flex";
};

window.saveEditDiary = function() {
  const eatType = document.querySelector('input[name="editEatType"]:checked').value;
  const shopCategory = document.getElementById('editShopCategorySelect').value;
  const userTags = document.getElementById('editTags').value;
  const combinedTags = `${eatType}, ${shopCategory}` + (userTags ? `, ${userTags}` : "");

  let updatedLat = null;
  let updatedLng = null;
  if (!document.getElementById('editNoLocationCheck').checked && window.leafletEditMarker) {
     const pos = window.leafletEditMarker.getLatLng();
     updatedLat = pos.lat;
     updatedLng = pos.lng;
  }

  const targetId = document.getElementById('editId').value;
  const newShopName = document.getElementById('editShopName').value;
  const newComment = document.getElementById('editComment').value;

  fetch(CLOUDFLARE_WORKER_URL, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      id: targetId, shopName: newShopName, 
      tags: parseTags(combinedTags).join(', '), comment: newComment, 
      weatherIcon: document.querySelector('input[name="editWeather"]:checked').value,
      latitude: updatedLat, longitude: updatedLng 
    })
  }).then(res => res.json()).then(data => { 
    
    if(data.success) { 
      const targetDiary = globalDiaries.find(d => String(d.id) === String(targetId));
      if (targetDiary) {
        targetDiary.latitude = updatedLat;
        targetDiary.longitude = updatedLng;
        targetDiary.shop_name = newShopName;
        targetDiary.comment = newComment;
      }

      if (updatedLat !== null && updatedLng !== null) {
        globalDiaries.forEach(d => {
          if (d.shop_name === newShopName) {
            d.latitude = updatedLat;
            d.longitude = updatedLng;
          }
        });
      }

      document.getElementById('editModal').style.display = "none"; 
      applyFilters(); 

      setTimeout(() => { fetchAndStoreAllDiaries(); }, 2000);

    } else {
      alert("⚠️ サーバー側でエラーが発生しました。");
    }
  }).catch(err => {
    console.error("🕵️‍♂️ [通信エラー]", err);
  });
};

window.upgradeDraftToRecord = function(id) {
   const diary = globalDiaries.find(d => String(d.id) === String(id));
   if (!diary) return;
   switchTab('record');
   
   currentRecordMode = 'manual'; 
   selectedDatetime = diary.visited_at || diary.created_at; 
   selectedImageBase64 = diary.image_base64; 
   selectedImageUrl = diary.image_url; 
   draftIdToUpgrade = diary.id; 

   const previewSrc = diary.image_url || diary.image_base64;
   if (previewSrc) {
     document.getElementById('previewImg').src = previewSrc; document.getElementById('previewImg').style.display = "block";
   }
   document.getElementById('step1').style.display = "none"; document.getElementById('step2').style.display = "block";
   document.getElementById('weatherSelectorDiv').style.display = "block"; document.getElementById('manualMapArea').style.display = "block";
   initPickerMap();
   document.querySelector('input[name="weatherType"][value="❓"]').checked = true;

   if (diary.latitude && diary.longitude) {
      setTimeout(() => {
         pickerMap.setView([diary.latitude, diary.longitude], 16);
         pickerMarker.setLatLng([diary.latitude, diary.longitude]);
         checkSmartSuggest(diary.latitude, diary.longitude); 
      }, 500);
   }
};

window.upgradeToFootprint = function(shopName) {
  switchTab('record'); startNoPhotoRecord();
  document.getElementById('shopNameInput').value = shopName;
  searchMasterShop();
  alert(`「${shopName}」の訪問記録をつけます！`);
};

function checkSmartSuggest(lat, lng) {
  const areaDiv = document.getElementById('smartSuggestArea');
  areaDiv.style.display = "none"; areaDiv.innerHTML = "";
  const nearbyShops = new Set();
  
  globalDiaries.forEach(d => {
    if (d.latitude && d.longitude && d.weather_icon !== "📦") {
      const dist = getDistanceFromLatLonInM(lat, lng, d.latitude, d.longitude);
      if (dist <= 50) nearbyShops.add(d.shop_name);
    }
  });

  const shopsArray = Array.from(nearbyShops);
  if (shopsArray.length > 0 && shopsArray.length <= 2) {
     let html = `<p style="font-size: 0.85rem; color: #e67e22; margin: 0 0 5px; font-weight: bold;">📍 もしかして？</p><div style="display: flex; gap: 8px; flex-wrap: wrap;">`;
     shopsArray.forEach(shop => {
       html += `<button type="button" style="background: #fdf2e9; border: 1px solid #e67e22; color: #d35400; padding: 8px 12px; border-radius: 20px; font-size: 0.9rem; width: auto; margin: 0;" onclick="applySmartSuggest('${escapeHTML(shop)}')">💡 ${escapeHTML(shop)}</button>`;
     });
     html += `</div>`;
     areaDiv.innerHTML = html; areaDiv.style.display = "block";
  }
}

window.applySmartSuggest = function(shopName) { document.getElementById('shopNameInput').value = shopName; searchMasterShop(); };
function toggleTagFilter(tag) { activeTagFilter = (activeTagFilter === tag) ? "" : tag; applyFilters(); }

function resetRecordTab() {
  document.getElementById('step1').style.display = "block"; document.getElementById('step2').style.display = "none";
  document.getElementById('previewImg').style.display = "none"; document.getElementById('smartSuggestArea').style.display = "none";
  document.getElementById('galleryInput').value = ""; document.getElementById('bulkGalleryInput').value = "";
  document.getElementById('shopNameInput').value = ""; document.getElementById('commentInput').value = "";
  document.getElementById('tagsInput').value = ""; document.getElementById('noLocationCheck').checked = false;
  document.getElementById('status').innerText = "";
  selectedImageBase64 = null; selectedImageUrl = null; selectedDatetime = null; draftIdToUpgrade = null; 
  document.getElementById('submitBtn').disabled = false;
}

function applyFilters() {
  const query = document.getElementById('searchInput') ? document.getElementById('searchInput').value.toLowerCase() : "";
  const archiveMonth = document.getElementById('archiveMonthSelect') ? document.getElementById('archiveMonthSelect').value : "";
  
  const filtered = globalDiaries.filter(diary => {
    const safeShopName = diary.shop_name || ""; 
    const matchSearch = safeShopName.toLowerCase().includes(query) || (diary.comment && diary.comment.toLowerCase().includes(query));
    const matchTag = activeTagFilter === "" ? true : (diary.tags && diary.tags.includes(activeTagFilter));
    
    const targetDate = diary.visited_at || diary.created_at || "";
    const matchArchive = archiveMonth === "" ? true : targetDate.startsWith(archiveMonth);

    return matchSearch && matchTag && matchArchive;
  });
  
  updateArchiveMonthDropdown();
  renderTagClouds(); 
  renderDiariesList(filtered); 
  updateViewMarkers(filtered);
}

function renderDiariesList(diaries) {
  const listDiv = document.getElementById('diaryList');
  if (!listDiv) return;
  if (diaries.length === 0) { listDiv.innerHTML = "<p style='text-align:center;'>記録なし</p>"; return; }
  
  let html = "";
  diaries.forEach((diary) => {
    let tagsHTML = "";
    parseTags(diary.tags).forEach(tag => { tagsHTML += `<span class="tag-badge" style="background-color: ${getColorFromTag(tag)};">${escapeHTML(tag)}</span>`; });
    const isBookmark = diary.weather_icon === "💭"; const isDraft = diary.weather_icon === "📦"; 
    const cardBg = isDraft ? "background: #f4f6f7; border: 2px dashed #7f8c8d;" : (isBookmark ? "background: #fdf2e9; border: 2px dashed #e67e22;" : "background: white;");
    let weatherStr = (!isBookmark && !isDraft && diary.weather_icon && diary.weather_icon !== "❓") ? `${diary.weather_icon} ${diary.temperature ? diary.temperature+'℃' : ''}` : '';

    let mapLinkBtn = (diary.latitude && diary.longitude && !isDraft) ? `<a href="http://googleusercontent.com/maps.google.com/?q=${diary.latitude},${diary.longitude}" target="_blank" class="action-btn" style="text-decoration:none;">🗺️ 行き方</a>` : "";
    let imageTag = diary.image_url ? `<img src="${diary.image_url}" loading="lazy" alt="写真">` : (diary.image_base64 ? `<img src="${diary.image_base64}" loading="lazy" alt="写真">` : '');

    const displayDate = diary.visited_at || diary.created_at || "不明";

    html += `
      <div class="card" style="${cardBg}">
        <div class="card-title">${isDraft ? '📦 ' : (isBookmark ? '💭 ' : '')}${escapeHTML(diary.shop_name)}</div>
        <div class="card-meta">🕒 ${displayDate}   ${weatherStr}</div>
        <div style="margin-bottom:10px;">${tagsHTML}</div>
        ${imageTag}
        <div class="card-comment">${escapeHTML(diary.comment || "")}</div>
        <div class="card-actions">
          ${mapLinkBtn}
          ${isDraft ? `<button class="action-btn" onclick="upgradeDraftToRecord('${diary.id}')" style="background:#3498db; color:white;">✏️ 記録を完成させる</button>` : ''}
          ${isBookmark ? `<button class="action-btn" onclick="upgradeToFootprint('${escapeHTML(diary.shop_name)}')">👣 足跡にする</button>` : ''}
          <button class="action-btn" onclick="openEditModal('${diary.id}')">✏️ 編集</button>
          <button class="action-btn" onclick="deleteDiary('${diary.id}')">🗑️ 削除</button>
        </div>
      </div>`;
  });
  listDiv.innerHTML = html;
}

function renderTagClouds() {
  const allTags = new Set(); globalDiaries.forEach(d => { parseTags(d.tags).forEach(t => allTags.add(t)); });
  let html = "";
  if (allTags.size > 0) {
    html += `<span class="tag-btn ${activeTagFilter === '' ? 'active' : ''}" onclick="toggleTagFilter('')">すべて</span>`;
    allTags.forEach(tag => { html += `<span class="tag-btn ${activeTagFilter === tag ? 'active' : ''}" onclick="toggleTagFilter('${escapeHTML(tag)}')">${escapeHTML(tag)}</span>`; });
  }
  if(document.getElementById('tagCloudView')) document.getElementById('tagCloudView').innerHTML = html;
  if(document.getElementById('tagCloudMap')) document.getElementById('tagCloudMap').innerHTML = html;
}

function updateArchiveMonthDropdown() {
  const select = document.getElementById('archiveMonthSelect');
  if (!select) return;
  const currentSelection = select.value;
  select.innerHTML = '<option value="">⏳ 全ての月</option>';
  const months = new Set();
  globalDiaries.forEach(d => {
    const dateStr = d.visited_at || d.created_at;
    if (dateStr && dateStr.length >= 7) months.add(dateStr.substring(0, 7));
  });
  Array.from(months).sort().reverse().forEach(m => {
    const [y, mm] = m.split('-'); select.innerHTML += `<option value="${m}">${y}年${mm}月</option>`;
  });
  select.value = currentSelection;
}

window.changeCalendarMonth = function(offset) {
  currentCalMonth += offset;
  if (currentCalMonth > 12) { currentCalMonth = 1; currentCalYear++; }
  if (currentCalMonth < 1) { currentCalMonth = 12; currentCalYear--; }
  renderCalendar();
};

function renderCalendar() {
  document.getElementById('calendarMonthTitle').innerText = `${currentCalYear}年 ${currentCalMonth}月`;
  const grid = document.getElementById('calendarGrid'); grid.innerHTML = "";
  const weeks = ['日', '月', '火', '水', '木', '金', '土'];
  weeks.forEach(w => { grid.innerHTML += `<div class="calendar-header-cell">${w}</div>`; });

  const firstDayIndex = new Date(currentCalYear, currentCalMonth - 1, 1).getDay();
  const totalDays = new Date(currentCalYear, currentCalMonth, 0).getDate();
  const todayStr = new Date().toISOString().split('T')[0];

  const dateModeSelect = document.getElementById('calendarDateMode');
  const dateMode = dateModeSelect ? dateModeSelect.value : 'visited';

  for (let i = 0; i < firstDayIndex; i++) { grid.innerHTML += `<div class="calendar-day-cell calendar-day-empty"></div>`; }

  for (let day = 1; day <= totalDays; day++) {
    const currentFullDate = `${currentCalYear}-${String(currentCalMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    const dayDiaries = globalDiaries.filter(d => {
      const targetDateStr = dateMode === 'visited' ? (d.visited_at || d.created_at || "") : (d.created_at || "");
      return targetDateStr.startsWith(currentFullDate) && d.weather_icon !== "📦" && d.weather_icon !== "💭";
    });
    
    const isToday = currentFullDate === todayStr ? 'calendar-day-today' : '';
    const hasVisit = dayDiaries.length > 0 ? 'calendar-day-has-visit' : '';
    const cafeEmoji = dayDiaries.length > 0 ? `<div class="calendar-cafe-dot">☕️</div>` : '';

    grid.innerHTML += `
      <div class="calendar-day-cell ${isToday} ${hasVisit}" onclick="showCalendarDayDiaries('${currentFullDate}')">
        <div class="calendar-day-num">${day}</div>
        ${cafeEmoji}
      </div>`;
  }
  document.getElementById('calendarSelectionResult').innerHTML = "";
}

window.showCalendarDayDiaries = function(dateStr) {
  const dateModeSelect = document.getElementById('calendarDateMode');
  const dateMode = dateModeSelect ? dateModeSelect.value : 'visited';

  const dayDiaries = globalDiaries.filter(d => {
    const targetDateStr = dateMode === 'visited' ? (d.visited_at || d.created_at || "") : (d.created_at || "");
    return targetDateStr.startsWith(dateStr);
  });

  const resultDiv = document.getElementById('calendarSelectionResult');
  if (dayDiaries.length === 0) {
    resultDiv.innerHTML = `<p style="text-align:center; color:#7f8c8d; margin-top:15px;">📅 ${dateStr} の記録はありません</p>`; return;
  }
  let html = `<h4 style="color:#2c3e50; margin: 15px 0 10px; border-left: 4px solid #e74c3c; padding-left: 8px;">📋 ${dateStr} の記録</h4>`;
  dayDiaries.forEach(diary => {
    let tagsHTML = ""; parseTags(diary.tags).forEach(tag => { tagsHTML += `<span class="tag-badge" style="background-color: ${getColorFromTag(tag)};">${escapeHTML(tag)}</span>`; });
    const isBookmark = diary.weather_icon === "💭"; const isDraft = diary.weather_icon === "📦"; 
    const cardBg = isDraft ? "background: #f4f6f7; border: 2px dashed #7f8c8d;" : (isBookmark ? "background: #fdf2e9; border: 2px dashed #e67e22;" : "background: white;");
    let weatherStr = (!isBookmark && !isDraft && diary.weather_icon && diary.weather_icon !== "❓") ? `${diary.weather_icon} ${diary.temperature ? diary.temperature+'℃' : ''}` : '';
    let mapLinkBtn = (diary.latitude && diary.longitude && !isDraft) ? `<a href="http://googleusercontent.com/maps.google.com/?q=${diary.latitude},${diary.longitude}" target="_blank" class="action-btn" style="text-decoration:none;">🗺️ 行き方</a>` : "";
    let imageTag = diary.image_url ? `<img src="${diary.image_url}" loading="lazy" alt="写真">` : (diary.image_base64 ? `<img src="${diary.image_base64}" loading="lazy" alt="写真">` : '');

    const displayDate = diary.visited_at || diary.created_at || "不明";

    html += `
      <div class="card" style="${cardBg}">
        <div class="card-title">${isDraft ? '📦 ' : (isBookmark ? '💭 ' : '')}${escapeHTML(diary.shop_name)}</div>
        <div class="card-meta">🕒 ${displayDate}   ${weatherStr}</div>
        <div style="margin-bottom:10px;">${tagsHTML}</div>
        ${imageTag}
        <div class="card-comment">${escapeHTML(diary.comment || "")}</div>
        <div class="card-actions">
          ${mapLinkBtn}
          <button class="action-btn" onclick="openEditModal('${diary.id}')">✏️ 編集</button>
          <button class="action-btn" onclick="deleteDiary('${diary.id}')">🗑️ 削除</button>
        </div>
      </div>`;
  });
  resultDiv.innerHTML = html;
};

function renderAnalytics() {
  if (!globalDiaries || globalDiaries.length === 0) return;
  const actualVisits = globalDiaries.filter(d => d.weather_icon !== "💭" && d.weather_icon !== "📦");
  const bookmarks = globalDiaries.filter(d => d.weather_icon === "💭");

  document.getElementById('statTotal').innerText = actualVisits.length;
  document.getElementById('statUnique').innerText = new Set(actualVisits.map(d => d.shop_name || "")).size;

  let eatin = 0, takeout = 0, sweetsCount = 0, roasterCount = 0; 
  let weatherCounts = { '☀️':0, '☁️':0, '☔️':0, '❄️':0 }; 
  let timeCounts = { '朝(5-11)':0, '昼(11-15)':0, '夕(15-18)':0, '夜(18-5)':0 };
  
  actualVisits.forEach(d => {
    if(d.tags && d.tags.includes('☕️店内')) eatin++;
    if(d.tags && d.tags.includes('🥡テイクアウト')) takeout++;
    if(d.tags && d.tags.includes('🍰お菓子屋の喫茶室')) sweetsCount++;
    if(d.tags && d.tags.includes('🔥ロースター')) roasterCount++;
    if(d.weather_icon && weatherCounts[d.weather_icon] !== undefined) weatherCounts[d.weather_icon]++;
    if(d.created_at) {
      const hour = parseInt(d.created_at.substring(11, 13));
      if(hour >= 5 && hour < 11) timeCounts['朝(5-11)']++; else if(hour >= 11 && hour < 15) timeCounts['昼(11-15)']++; else if(hour >= 15 && hour < 18) timeCounts['夕(15-18)']++; else timeCounts['夜(18-5)']++;
    }
  });

  const badges = [
    { id: 'first_step', icon: '🔰', name: '初めの一歩', condition: actualVisits.length >= 1, color: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)' },
    { id: 'traveler', icon: '🥉', name: 'トラベラー', condition: actualVisits.length >= 10, color: 'linear-gradient(135deg, #d4a373 0%, #faedcd 100%)' },
    { id: 'eatin_master', icon: '☕️', name: '店内マスター', condition: eatin >= 5, color: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)' },
    { id: 'takeout_pro', icon: '🥡', name: '持帰りの達人', condition: takeout >= 5, color: 'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)' },
    { id: 'sweets_hunter', icon: '🍰', name: '甘党ハンター', condition: sweetsCount >= 3, color: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%)' },
    { id: 'roaster_mania', icon: '🔥', name: '焙煎マニア', condition: roasterCount >= 3, color: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
    { id: 'bookmark_craft', icon: '💭', name: '行きたい職人', condition: bookmarks.length >= 5, color: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)' }
  ];

  let badgeHtml = '';
  badges.forEach(b => {
    badgeHtml += b.condition 
      ? `<div class="badge-item" style="background: ${b.color};" title="${b.name}"><div class="badge-icon">${b.icon}</div><div class="badge-title">${b.name}</div></div>`
      : `<div class="badge-item badge-locked" title="未獲得"><div class="badge-icon">🔒</div><div class="badge-title">???</div></div>`;
  });
  document.getElementById('badgeContainer').innerHTML = badgeHtml;

  if(charts.eatType) charts.eatType.destroy(); if(charts.weather) charts.weather.destroy(); if(charts.time) charts.time.destroy();
  charts.eatType = new Chart(document.getElementById('chartEatType').getContext('2d'), { type: 'doughnut', data: { labels: ['☕️ 店内', '🥡 テイクアウト'], datasets: [{ data: [eatin, takeout], backgroundColor: ['#3498db', '#e67e22'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
  charts.weather = new Chart(document.getElementById('chartWeather').getContext('2d'), { type: 'bar', data: { labels: ['☀️ 晴れ', '☁️ 曇り', '☔️ 雨', '❄️ 雪'], datasets: [{ label: '記録数', data: [weatherCounts['☀️'], weatherCounts['☁️'], weatherCounts['☔️'], weatherCounts['❄️']], backgroundColor: ['#f1c40f', '#95a5a6', '#3498db', '#ecf0f1'], borderColor: '#bdc3c7', borderWidth: 1 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
  charts.time = new Chart(document.getElementById('chartTime').getContext('2d'), { type: 'line', data: { labels: Object.keys(timeCounts), datasets: [{ label: '訪問回数', data: Object.values(timeCounts), borderColor: '#9b59b6', backgroundColor: 'rgba(155, 89, 182, 0.2)', fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
}

function loadSettings() {
  const g = localStorage.getItem('ezo_gender'); const a = localStorage.getItem('ezo_age');
  if (g) document.getElementById('settingGender').value = g;
  if (a) document.getElementById('settingAge').value = a;
  document.getElementById('displayGender').innerText = g || "未設定";
  document.getElementById('displayAge').innerText = a || "未設定";
}

function saveSettings() {
  const g = document.getElementById('settingGender').value;
  const a = document.getElementById('settingAge').value;
  if (!g || !a) { alert("⚠️ 性別と年代を両方選択してください。"); return; }
  localStorage.setItem('ezo_gender', g); localStorage.setItem('ezo_age', a);
  loadSettings(); alert("✨ 設定を保存しました！");
}

function checkSettingsAndClick(inputId) {
  if (!localStorage.getItem('ezo_gender') || !localStorage.getItem('ezo_age')) {
    alert("📊 先に「設定」タブで登録してください。"); switchTab('settings'); return;
  }
  document.getElementById(inputId).click();
}

// ==========================================
// 👁️ マップのピン表示/非表示きりかえ機能
// ==========================================
window.setupHidePinsButtons = function() {
  const togglePins = (btnId, mapContainerId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.onclick = function(e) {
      e.preventDefault();
      const markerPane = document.querySelector(`#${mapContainerId} .leaflet-marker-pane`);
      const tooltipPane = document.querySelector(`#${mapContainerId} .leaflet-tooltip-pane`);
      const shadowPane = document.querySelector(`#${mapContainerId} .leaflet-shadow-pane`);
      
      if (markerPane) {
        const isHidden = markerPane.style.display === 'none';
        markerPane.style.display = isHidden ? 'block' : 'none';
        if (tooltipPane) tooltipPane.style.display = isHidden ? 'block' : 'none';
        if (shadowPane) shadowPane.style.display = isHidden ? 'block' : 'none';
        
        btn.innerText = isHidden ? '👁️ ピンを隠す' : '🙈 ピンを表示';
        btn.style.backgroundColor = isHidden ? 'white' : '#e74c3c';
        btn.style.color = isHidden ? '#2c3e50' : 'white';
      }
    };
  };

  togglePins('hidePinsBtnPicker', 'pickerMap');
  togglePins('hidePinsBtnView', 'mapView');
};