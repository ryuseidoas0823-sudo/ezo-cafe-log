// ==========================================
// 1. 初期設定・グローバル変数
// ==========================================
// ★ Cloudflare WorkerのURLを貼り直してください！
const CLOUDFLARE_WORKER_URL = "https://cafe-pipeline.ryusei-doas-0823.workers.dev/"; 
const HOME_LAT = 43.0620958;
const HOME_LNG = 141.3543763;
const SAFE_DISTANCE_METERS = 20;

let activeTagFilter = ""; 
let viewMap;                  
let pickerMap;      
let pickerMarker;   
let selectedImageBase64 = null; 
let selectedImageUrl = null; // ★ConoHa連携時のURL保管用
let selectedDatetime = null;
let currentRecordMode = 'manual';
let selectedMasterShop = null; 
let searchTimeout = null;      
let globalDiaries = []; 
let charts = {};        
let draftIdToUpgrade = null; 

window.onload = function() {
  loadSettings();
  fetchAndStoreAllDiaries();
  setupHidePinsButtons();
}

// ==========================================
// 2. UI・タブ制御・設定関連
// ==========================================
function setupHidePinsButtons() {
  const hideFunc = (mapObj) => { if(mapObj) mapObj.eachLayer(l => { if(l instanceof L.Marker && l.setOpacity) l.setOpacity(0); }); };
  const showFunc = (mapObj) => { if(mapObj) mapObj.eachLayer(l => { if(l instanceof L.Marker && l.setOpacity) l.setOpacity(1); }); };

  const btnPicker = document.getElementById('hidePinsBtnPicker');
  if(btnPicker) {
    btnPicker.addEventListener('mousedown', () => hideFunc(pickerMap));
    btnPicker.addEventListener('touchstart', () => hideFunc(pickerMap), {passive: true});
    ['mouseup','mouseleave','touchend'].forEach(e => btnPicker.addEventListener(e, () => showFunc(pickerMap)));
  }

  const btnView = document.getElementById('hidePinsBtnView');
  if(btnView) {
    btnView.addEventListener('mousedown', () => hideFunc(viewMap));
    btnView.addEventListener('touchstart', () => hideFunc(viewMap), {passive: true});
    ['mouseup','mouseleave','touchend'].forEach(e => btnView.addEventListener(e, () => showFunc(viewMap)));
  }
}

function loadSettings() {
  const g = localStorage.getItem('ezo_gender');
  const a = localStorage.getItem('ezo_age');
  if (g) document.getElementById('settingGender').value = g;
  if (a) document.getElementById('settingAge').value = a;
  document.getElementById('displayGender').innerText = g || "未設定";
  document.getElementById('displayAge').innerText = a || "未設定";
}

function saveSettings() {
  const g = document.getElementById('settingGender').value;
  const a = document.getElementById('settingAge').value;
  if (!g || !a) { alert("⚠️ 性別と年代を両方選択してください。"); return; }
  localStorage.setItem('ezo_gender', g);
  localStorage.setItem('ezo_age', a);
  loadSettings();
  alert("✨ 設定を保存しました！");
}

function checkSettingsAndClick(inputId) {
  if (!localStorage.getItem('ezo_gender') || !localStorage.getItem('ezo_age')) {
    alert("📊 アナリティクス機能を利用するため、先に「設定」タブで登録してください。");
    switchTab('settings');
    return;
  }
  document.getElementById(inputId).click();
}

function switchTab(tabId) {
  document.querySelectorAll('.content, .tab').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  const tabs = document.querySelectorAll('.tab');
  for(let t of tabs){ if(t.getAttribute('onclick').includes(tabId)) t.classList.add('active'); }
  
  if(tabId === 'view' || tabId === 'mapTab') applyFilters(); 
  if(tabId === 'mapTab') { initViewMap(); updateViewMarkers(); }
  if(tabId === 'analytics') renderAnalytics(); 
  if(tabId === 'settings') loadSettings(); 
}

// ==========================================
// 3. データ記録・未整理ボックス処理
// ==========================================
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

window.upgradeToFootprint = function(shopName) {
  switchTab('record'); startNoPhotoRecord();
  document.getElementById('shopNameInput').value = shopName;
  searchMasterShop();
  alert(`「${shopName}」の訪問記録をつけます！\n（※写真がある場合は一度『やり直す』を押して写真を選んでください）`);
};

// 📦 一括画像セレクト
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
  
  alert("✨ すべての写真を未整理ボックスに一時保存しました！\n履歴やマップの📦ピンから後でゆっくり記録を完成させられます。");
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

// 📦 昇格処理（URL対応版）
window.upgradeDraftToRecord = function(id) {
   const diary = globalDiaries.find(d => String(d.id) === String(id));
   if (!diary) return;

   switchTab('record');
   
   currentRecordMode = 'manual';
   selectedDatetime = diary.created_at; 
   selectedImageBase64 = diary.image_base64; 
   selectedImageUrl = diary.image_url;
   draftIdToUpgrade = diary.id; 

   const previewSrc = diary.image_url || diary.image_base64;
   if (previewSrc) {
     document.getElementById('previewImg').src = previewSrc;
     document.getElementById('previewImg').style.display = "block";
   }
   
   document.getElementById('step1').style.display = "none";
   document.getElementById('step2').style.display = "block";
   document.getElementById('weatherSelectorDiv').style.display = "block";
   document.getElementById('manualMapArea').style.display = "block";
   
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

function resetRecordTab() {
  document.getElementById('step1').style.display = "block";
  document.getElementById('step2').style.display = "none";
  document.getElementById('previewImg').style.display = "none";
  document.getElementById('weatherSelectorDiv').style.display = "block";
  document.getElementById('smartSuggestArea').style.display = "none";
  document.getElementById('galleryInput').value = ""; document.getElementById('bulkGalleryInput').value = "";
  document.getElementById('shopNameInput').value = ""; document.getElementById('commentInput').value = "";
  document.getElementById('tagsInput').value = ""; document.getElementById('noLocationCheck').checked = false;
  document.getElementById('status').innerText = "";
  
  // 状態の完全リセット
  selectedImageBase64 = null; selectedImageUrl = null; selectedDatetime = null; draftIdToUpgrade = null; 
  document.getElementById('submitBtn').disabled = false;
}

// ==========================================
// 4. API通信・保存処理
// ==========================================
async function fetchTemperature(lat, lng) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
    const data = await res.json();
    return data.current_weather.temperature;
  } catch (e) { return null; }
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
    document.getElementById('status').innerText = temperature ? `🌡 気温 ${temperature}℃ 取得完了！` : "🌡 気温取得スキップ";
    sendDataToCloudflare(selectedMasterShop.shop_id, finalShopName, selectedMasterShop.latitude, selectedMasterShop.longitude, weatherIcon, temperature, userGender, userAge, combinedTags, submitBtn);
    return;
  }

  const pos = pickerMarker.getLatLng();
  if (getDistanceFromLatLonInM(pos.lat, pos.lng, HOME_LAT, HOME_LNG) < SAFE_DISTANCE_METERS) {
    alert(`🚨【自宅ガード発動】自宅周辺です。新規店舗の場合は「位置情報を送らない」をお使いください。`); submitBtn.disabled = false; return;
  }
  sendDataToCloudflare(null, finalShopName, pos.lat, pos.lng, weatherIcon, null, userGender, userAge, combinedTags, submitBtn);
}

function sendDataToCloudflare(shopId, shopName, lat, lng, weather, temp, gender, age, tagsString, btnElement) {
  document.getElementById('status').innerText = "☁️ データを保存中...";
  fetch(CLOUDFLARE_WORKER_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      shopId: shopId, shopName: shopName, comment: document.getElementById('commentInput').value, 
      latitude: lat, longitude: lng, 
      imageBase64: selectedImageBase64, imageUrl: selectedImageUrl, // ★URLデータも送信
      tags: parseTags(tagsString).join(','),
      weatherIcon: weather, temperature: temp, userGender: gender, userAge: age, visitedAt: selectedDatetime 
    })
  }).then(res => res.json()).then(data => {
    if (!data.success) throw new Error(data.error);
    
    if (draftIdToUpgrade) {
       fetch(`${CLOUDFLARE_WORKER_URL}?id=${draftIdToUpgrade}`, { method: 'DELETE' }).then(() => {
          draftIdToUpgrade = null; selectedImageUrl = null;
          alert("✨ 未整理データを正式な足跡に昇格しました！"); 
          resetRecordTab(); fetchAndStoreAllDiaries();
       });
    } else {
       selectedImageUrl = null;
       alert("✨ 記録が完了しました！"); 
       resetRecordTab(); fetchAndStoreAllDiaries();
    }
  }).catch(err => { document.getElementById('status').innerText = `❌ エラー: ${err.message}`; btnElement.disabled = false; });
}

// ==========================================
// 5. データ取得・リスト表示
// ==========================================
function fetchAndStoreAllDiaries() {
  fetch(`${CLOUDFLARE_WORKER_URL}?query=`).then(res => res.json()).then(data => {
    if (data.success) {
      globalDiaries = data.data.map(diary => {
        let name = diary.shop_name || ""; let currentTags = parseTags(diary.tags);
        if (name.includes('[店内]')) { name = name.replace('[店内]', '').trim(); if (!currentTags.includes('☕️店内')) currentTags.unshift('☕️店内'); }
        if (name.includes('[持帰]')) { name = name.replace('[持帰]', '').trim(); if (!currentTags.includes('🥡テイクアウト')) currentTags.unshift('🥡テイクアウト'); }
        
        const hasCategory = currentTags.some(t => t.includes('🏢') || t.includes('🔥') || t.includes('🎪') || t.includes('🍸') || t.includes('🍰') || t.includes('🍵'));
        if (!hasCategory && !currentTags.includes('💭') && !currentTags.includes('📦未整理')) currentTags.splice(1, 0, '🏢喫茶・カフェ'); 

        diary.shop_name = name; diary.tags = currentTags.join(', ');
        return diary;
      });
      applyFilters();
    }
  });
}

function applyFilters() {
  const query = document.getElementById('searchInput') ? document.getElementById('searchInput').value.toLowerCase() : "";
  const filtered = globalDiaries.filter(diary => {
    const safeShopName = diary.shop_name || ""; 
    const matchSearch = safeShopName.toLowerCase().includes(query) || (diary.comment && diary.comment.toLowerCase().includes(query));
    const matchTag = activeTagFilter === "" ? true : (diary.tags && diary.tags.includes(activeTagFilter));
    return matchSearch && matchTag;
  });
  renderTagClouds(); renderDiariesList(filtered); updateViewMarkers(filtered);
}

// Lazy Loading & フッターボタン対応
function renderDiariesList(diaries) {
  const listDiv = document.getElementById('diaryList');
  if (!listDiv) return;
  if (diaries.length === 0) { listDiv.innerHTML = "<p style='text-align:center;'>記録なし</p>"; return; }
  
  let html = "";
  diaries.forEach((diary) => {
    let tagsHTML = "";
    parseTags(diary.tags).forEach(tag => { tagsHTML += `<span class="tag-badge" style="background-color: ${getColorFromTag(tag)};">${escapeHTML(tag)}</span>`; });
    const isBookmark = diary.weather_icon === "💭";
    const isDraft = diary.weather_icon === "📦"; 
    
    const cardBg = isDraft ? "background: #f4f6f7; border: 2px dashed #7f8c8d;" : (isBookmark ? "background: #fdf2e9; border: 2px dashed #e67e22;" : "background: white;");
    let tempStr = diary.temperature ? `${diary.temperature}℃` : '';
    let weatherStr = (!isBookmark && !isDraft && diary.weather_icon && diary.weather_icon !== "❓") ? `${diary.weather_icon} ${tempStr}` : '';

    let mapLinkBtn = "";
    if (diary.latitude && diary.longitude && !isDraft) {
      mapLinkBtn = `<a href="http://googleusercontent.com/maps.google.com/?q=${diary.latitude},${diary.longitude}" target="_blank" class="action-btn" style="text-decoration:none;">🗺️ 行き方</a>`;
    }

    let imageTag = '';
    if (diary.image_url) {
      imageTag = `<img src="${diary.image_url}" loading="lazy" alt="カフェ写真">`;
    } else if (diary.image_base64) {
      imageTag = `<img src="${diary.image_base64}" loading="lazy" alt="カフェ写真">`;
    }

    html += `
      <div class="card" style="${cardBg}">
        <div class="card-title">${isDraft ? '📦 ' : (isBookmark ? '💭 ' : '')}${escapeHTML(diary.shop_name)}</div>
        <div class="card-meta">🕒 ${diary.created_at}   ${weatherStr}</div>
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

window.deleteDiary = function(id) {
  if (!confirm("削除しますか？")) return;
  fetch(`${CLOUDFLARE_WORKER_URL}?id=${id}`, { method: 'DELETE' }).then(res => res.json()).then(data => { if (data.success) fetchAndStoreAllDiaries(); });
};

// ==========================================
// 6. 編集・サジェスト・その他UIヘルパー
// ==========================================
window.openEditModal = function(id) {
  const diary = globalDiaries.find(d => String(d.id) === String(id));
  if (!diary) return;

  document.getElementById('editId').value = diary.id; 
  document.getElementById('editShopName').value = diary.shop_name; 
  document.getElementById('editComment').value = diary.comment || "";
  
  const currentTags = parseTags(diary.tags);
  const eatTypes = ['☕️店内', '🥡テイクアウト', '🛍️豆・グッズ購入']; 
  let foundEatType = '☕️店内';
  eatTypes.forEach(t => { if (currentTags.includes(t)) foundEatType = t; });
  const eatTypeRadio = document.querySelector(`input[name="editEatType"][value="${foundEatType}"]`);
  if (eatTypeRadio) eatTypeRadio.checked = true;

  const categories = ['🏢喫茶・カフェ', '🔥ロースター', '🎪無店舗・間借り', '🍸カフェバー', '🍰お菓子屋の喫茶室', '🍵和風喫茶']; 
  let foundCategory = '🏢喫茶・カフェ';
  categories.forEach(c => { if (currentTags.includes(c)) foundCategory = c; });
  document.getElementById('editShopCategorySelect').value = foundCategory;

  document.getElementById('editTags').value = currentTags.filter(t => !eatTypes.includes(t) && !categories.includes(t)).join(', ');

  const wRadios = document.getElementsByName('editWeather');
  for(let r of wRadios) { if(r.value === diary.weather_icon) r.checked = true; }

  document.getElementById('editModal').style.display = "flex";
};

window.saveEditDiary = function() {
  const eatType = document.querySelector('input[name="editEatType"]:checked').value;
  const shopCategory = document.getElementById('editShopCategorySelect').value;
  const userTags = document.getElementById('editTags').value;
  const combinedTags = `${eatType}, ${shopCategory}` + (userTags ? `, ${userTags}` : "");

  fetch(CLOUDFLARE_WORKER_URL, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      id: document.getElementById('editId').value, shopName: document.getElementById('editShopName').value, 
      tags: parseTags(combinedTags).join(', '), comment: document.getElementById('editComment').value, 
      weatherIcon: document.querySelector('input[name="editWeather"]:checked').value 
    })
  }).then(res => res.json()).then(data => { if(data.success) { document.getElementById('editModal').style.display = "none"; fetchAndStoreAllDiaries(); } });
};

function checkSmartSuggest(lat, lng) {
  const areaDiv = document.getElementById('smartSuggestArea');
  areaDiv.style.display = "none";
  areaDiv.innerHTML = "";

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
     areaDiv.innerHTML = html;
     areaDiv.style.display = "block";
  }
}

window.applySmartSuggest = function(shopName) { document.getElementById('shopNameInput').value = shopName; searchMasterShop(); };
function toggleTagFilter(tag) { activeTagFilter = (activeTagFilter === tag) ? "" : tag; applyFilters(); };

function searchMasterShop() {
  const q = document.getElementById('shopNameInput').value;
  const list = document.getElementById('autocompleteList');
  selectedMasterShop = null; 
  if (q.length < 1) { list.style.display = "none"; return; }
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    fetch(`${CLOUDFLARE_WORKER_URL}?action=search_master&query=${encodeURIComponent(q)}`)
      .then(res => res.json()).then(data => {
        list.innerHTML = "";
        if (data.success && data.data.length > 0) {
          data.data.forEach(shop => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="badge-master">公式</span>${escapeHTML(shop.shop_name)}`;
            li.onclick = () => {
              document.getElementById('shopNameInput').value = shop.shop_name;
              selectedMasterShop = shop; list.style.display = "none";
              if(pickerMap && pickerMarker && shop.latitude) {
                pickerMap.setView([shop.latitude, shop.longitude], 16);
                pickerMarker.setLatLng([shop.latitude, shop.longitude]);
              }
            };
            list.appendChild(li);
          });
        }
        const newLi = document.createElement('li');
        newLi.innerHTML = `<span class="badge-new">新規</span>「${escapeHTML(q)}」を手動で登録する`;
        newLi.onclick = () => { selectedMasterShop = null; list.style.display = "none"; };
        list.appendChild(newLi);
        list.style.display = "block";
      });
  }, 300);
}

// ==========================================
// 7. マップ・ロケーション関数
// ==========================================
function initPickerMap() {
  if (!pickerMap) {
    pickerMap = L.map('pickerMap', { doubleClickZoom: false }).setView([43.0686, 141.3508], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(pickerMap);
    pickerMarker = L.marker([43.0686, 141.3508], { draggable: true }).addTo(pickerMap);
    pickerMap.on('dblclick', function(e) { pickerMarker.setLatLng(e.latlng); checkSmartSuggest(e.latlng.lat, e.latlng.lng); });
    pickerMarker.on('dragend', function(e) { const pos = pickerMarker.getLatLng(); checkSmartSuggest(pos.lat, pos.lng); });
  }
  setTimeout(() => pickerMap.invalidateSize(), 100);
}

function initViewMap() {
  if (!viewMap) { 
    viewMap = L.map('mapView').setView([43.064, 141.35], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(viewMap);
  }
  setTimeout(() => { viewMap.invalidateSize(); }, 100); 
}

function updateViewMarkers(filteredDiaries = globalDiaries) {
  if (!viewMap) return;
  viewMap.eachLayer((layer) => { if (layer instanceof L.Marker) viewMap.removeLayer(layer); });
  
  const bounds = L.latLngBounds(); const uniqueShops = {};
  
  filteredDiaries.forEach(diary => {
    if (diary.latitude && diary.longitude) {
      const s = diary.shop_name; 
      const isBookmark = diary.weather_icon === "💭";
      const isDraft = diary.weather_icon === "📦";
      
      const uniqueKey = isDraft ? `draft_${diary.id}` : s;

      if (!uniqueShops[uniqueKey]) {
        uniqueShops[uniqueKey] = { 
          lat: diary.latitude, lng: diary.longitude, 
          isTakeout: diary.tags && diary.tags.includes('🥡テイクアウト'), 
          shopName: isDraft ? '📦 未整理の写真' : s, 
          mainTag: parseTags(diary.tags)[2]||"", 
          visitCount: (isBookmark || isDraft) ? 0 : 1, 
          isBookmarkOnly: isBookmark,
          isDraftOnly: isDraft
        };
      } else {
        if (!isBookmark && !isDraft) { uniqueShops[uniqueKey].visitCount++; uniqueShops[uniqueKey].isBookmarkOnly = false; }
      }
    }
  });

  Object.values(uniqueShops).forEach(shop => {
    const emoji = shop.isDraftOnly ? '📦' : (shop.isBookmarkOnly ? '💭' : (shop.isTakeout ? '🥡' : '☕️'));
    const bgColor = shop.isDraftOnly ? '#95a5a6' : getColorFromTag(shop.mainTag);
    
    const badgeHtml = shop.visitCount > 0 ? `<div style="position:absolute; bottom:-5px; right:-5px; background:#e74c3c; color:white; border-radius:50%; width:18px; height:18px; font-size:11px; font-weight:bold; line-height:18px; text-align:center;">${shop.visitCount}</div>` : '';
    const customIcon = L.divIcon({ html: `<div class="emoji-pin" style="background-color: ${bgColor}; position:relative;">${emoji}${badgeHtml}</div>`, className: 'custom-div-icon', iconSize: [36, 36], iconAnchor: [18, 18] });
    L.marker([shop.lat, shop.lng], {icon: customIcon}).addTo(viewMap).bindTooltip(escapeHTML(shop.shopName), { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
    bounds.extend([shop.lat, shop.lng]);
  });
  if (Object.keys(uniqueShops).length > 0) viewMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}

function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371e3; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// ==========================================
// 8. ユーティリティ・アナリティクス
// ==========================================
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

function getColorFromTag(tag) {
  if (!tag) return "#34495e";
  let hash = 0; for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 70%, 45%)`; 
}
function parseTags(tagsString) { return (!tagsString) ? [] : tagsString.split(',').map(t => t.trim()).filter(t => t !== ""); }

// 🔒 安全なエスケープ処理（文字化け・バグ防止版）
function escapeHTML(str) {
  if (!str) return "";
  const escapeMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
  return str.replace(/[&<>'"]/g, match => escapeMap[match] || match);
}

// 📊 アナリティクスとバッジ判定
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
    if (b.condition) {
      badgeHtml += `<div class="badge-item" style="background: ${b.color};" title="${b.name}"><div class="badge-icon">${b.icon}</div><div class="badge-title">${b.name}</div></div>`;
    } else {
      badgeHtml += `<div class="badge-item badge-locked" title="未獲得"><div class="badge-icon">🔒</div><div class="badge-title">???</div></div>`;
    }
  });
  document.getElementById('badgeContainer').innerHTML = badgeHtml;

  if(charts.eatType) charts.eatType.destroy(); if(charts.weather) charts.weather.destroy(); if(charts.time) charts.time.destroy();

  charts.eatType = new Chart(document.getElementById('chartEatType').getContext('2d'), { type: 'doughnut', data: { labels: ['☕️ 店内', '🥡 テイクアウト'], datasets: [{ data: [eatin, takeout], backgroundColor: ['#3498db', '#e67e22'] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
  charts.weather = new Chart(document.getElementById('chartWeather').getContext('2d'), { type: 'bar', data: { labels: ['☀️ 晴れ', '☁️ 曇り', '☔️ 雨', '❄️ 雪'], datasets: [{ label: '記録数', data: [weatherCounts['☀️'], weatherCounts['☁️'], weatherCounts['☔️'], weatherCounts['❄️']], backgroundColor: ['#f1c40f', '#95a5a6', '#3498db', '#ecf0f1'], borderColor: '#bdc3c7', borderWidth: 1 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
  charts.time = new Chart(document.getElementById('chartTime').getContext('2d'), { type: 'line', data: { labels: Object.keys(timeCounts), datasets: [{ label: '訪問回数', data: Object.values(timeCounts), borderColor: '#9b59b6', backgroundColor: 'rgba(155, 89, 182, 0.2)', fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } });
}