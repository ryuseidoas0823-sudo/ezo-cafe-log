// ==========================================
// ☁️ api.js (API通信・データ送受信の処理まとめ)
// ==========================================

// 気温データを外部APIから取得する
async function fetchTemperature(lat, lng) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
    const data = await res.json();
    return data.current_weather.temperature;
  } catch (e) { return null; }
}

// 全ての日記データをWorkerから取得して整頓する
function fetchAndStoreAllDiaries() {
  fetch(`${CLOUDFLARE_WORKER_URL}?query=`).then(res => res.json()).then(data => {
    if (data.success) {
      globalDiaries = data.data.map(diary => {
        let name = diary.shop_name || ""; 
        let currentTags = parseTags(diary.tags);
        
        if (name.includes('[店内]')) { 
          name = name.replace('[店内]', '').trim(); 
          if (!currentTags.includes('☕️店内')) currentTags.unshift('☕️店内'); 
        }
        if (name.includes('[持帰]')) { 
          name = name.replace('[持帰]', '').trim(); 
          if (!currentTags.includes('🥡テイクアウト')) currentTags.unshift('🥡テイクアウト'); 
        }
        
        const hasCategory = currentTags.some(t => t.includes('🏢') || t.includes('🔥') || t.includes('🎪') || t.includes('🍸') || t.includes('🍰') || t.includes('🍵'));
        if (!hasCategory && !currentTags.includes('💭') && !currentTags.includes('📦未整理')) {
          currentTags.splice(1, 0, '🏢喫茶・カフェ'); 
        }

        diary.shop_name = name; 
        diary.tags = currentTags.join(', ');
        return diary;
      });
      applyFilters();
    }
  });
}

// データをCloudflare Workerへ送信して保存する
function sendDataToCloudflare(shopId, shopName, lat, lng, weather, temp, gender, age, tagsString, btnElement) {
  document.getElementById('status').innerText = "☁️ データを保存中...";
  fetch(CLOUDFLARE_WORKER_URL, {
    method: "POST", 
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      shopId: shopId, shopName: shopName, comment: document.getElementById('commentInput').value, 
      latitude: lat, longitude: lng, 
      imageBase64: selectedImageBase64, imageUrl: selectedImageUrl, 
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
  }).catch(err => { 
    document.getElementById('status').innerText = `❌ エラー: ${err.message}`; 
    btnElement.disabled = false; 
  });
}

// 店名入力時の公式マスター検索（サジェスト）
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
              selectedMasterShop = shop; 
              list.style.display = "none";
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