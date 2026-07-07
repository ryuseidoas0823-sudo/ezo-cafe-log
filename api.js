// ==========================================
// 📡 api.js (バックエンドとの通信・データ管理)
// ==========================================

function fetchAndStoreAllDiaries() {
  // ★_t=${Date.now()} でCloudflareの強力なキャッシュを毎回確実にぶち破る
  fetch(`${CLOUDFLARE_WORKER_URL}?query=&_t=${Date.now()}`)
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        globalDiaries = data.data.map(diary => {
          let currentTags = parseTags(diary.tags);
          const hasCategory = currentTags.some(t => t.includes('🏢') || t.includes('🔥') || t.includes('🎪') || t.includes('🍸') || t.includes('🍰') || t.includes('🍵'));
          if (!hasCategory && !currentTags.includes('💭') && !currentTags.includes('📦未整理')) {
            currentTags.splice(1, 0, '🏢喫茶・カフェ'); 
          }
          diary.tags = currentTags.join(', ');
          return diary;
        });
        applyFilters(); 
      }
    })
    .catch(err => console.error("データ取得エラー:", err));
}

function sendDataToCloudflare(shopId, shopName, lat, lng, weather, temp, gender, age, tags, submitBtn) {
  fetch(CLOUDFLARE_WORKER_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      shopId: shopId, shopName: shopName, comment: document.getElementById('commentInput').value, 
      latitude: lat, longitude: lng, imageBase64: selectedImageBase64, imageUrl: selectedImageUrl, 
      tags: tags, weatherIcon: weather, temperature: temp, userGender: gender, userAge: age, 
      visitedAt: selectedDatetime 
    })
  }).then(res => res.json()).then(data => {
    if (data.success) {
      if (draftIdToUpgrade) {
        fetch(`${CLOUDFLARE_WORKER_URL}?id=${draftIdToUpgrade}`, { method: 'DELETE' }).then(() => {
          alert("✨ 記録を完成させました！"); resetRecordTab(); fetchAndStoreAllDiaries(); submitBtn.disabled = false;
        });
      } else {
        alert("✨ 記録しました！"); resetRecordTab(); fetchAndStoreAllDiaries(); submitBtn.disabled = false;
      }
    } else {
      alert("⚠️ サーバーエラーが発生しました。"); submitBtn.disabled = false;
    }
  }).catch(err => {
    alert("⚠️ 通信エラーが発生しました。"); submitBtn.disabled = false;
  });
}

async function fetchTemperature(lat, lng) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
    const data = await res.json();
    return data.current_weather ? Math.round(data.current_weather.temperature) : null;
  } catch(e) { return null; }
}

function searchMasterShop() {
  const query = document.getElementById('shopNameInput').value;
  const list = document.getElementById('autocompleteList');
  list.innerHTML = ''; selectedMasterShop = null;
  if (query.length < 1) { list.style.display = 'none'; return; }

  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    fetch(`${CLOUDFLARE_WORKER_URL}?action=search_master&query=${encodeURIComponent(query)}`)
      .then(res => res.json()).then(data => {
        if (data.success && data.data.length > 0) {
          data.data.forEach(shop => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>${escapeHTML(shop.shop_name)}</strong><br><span style="font-size:0.8rem; color:#7f8c8d;">${escapeHTML(shop.address || '')}</span>`;
            li.onclick = () => {
              document.getElementById('shopNameInput').value = shop.shop_name;
              selectedMasterShop = shop; list.style.display = 'none';
              if(shop.latitude && shop.longitude && pickerMap && pickerMarker) {
                 pickerMap.setView([shop.latitude, shop.longitude], 16);
                 pickerMarker.setLatLng([shop.latitude, shop.longitude]);
              }
            };
            list.appendChild(li);
          });
          list.style.display = 'block';
        } else { list.style.display = 'none'; }
      });
  }, 300);
}