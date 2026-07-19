// ==========================================
// 📦 src/components/b2c/form.js (DX強化・堅牢化版)
// 責務: 日記入力UI、Exif解析、外部API連携、マップ選択
// ==========================================
import { saveDiaryApi, searchMasterApi } from '../../api.js';
import { refreshHistoryList } from './list.js';
import { getters } from '../../state.js';
import { parseTags, escapeHTML } from '../../utils/text.js';

// ⚠️ 将来的なReact移行を見据え、状態管理は慎重に行う
let currentImageBase64Array = [];
let editingDiaryId = null;
let suggestTimeout = null;
let pickerMap = null;
let pickerMarker = null;

export function initFormHandlers() {
    const recordForm = document.getElementById('recordForm');
    if (recordForm) recordForm.addEventListener('submit', handleFormSubmit);
    
    const singleInput = document.getElementById('imageInputSingle');
    if (singleInput) {
        singleInput.setAttribute('multiple', 'multiple');
        singleInput.addEventListener('change', handlePhotoSelection);
    }
    
    const bulkInput = document.getElementById('imageInputBulk');
    if (bulkInput) bulkInput.addEventListener('change', handleBulkUpload);

    const btnSkipPhoto = document.getElementById('btnSkipPhoto');
    if (btnSkipPhoto) btnSkipPhoto.addEventListener('click', handleSkipPhoto);

    setupShopSuggest();
    setupMapPicker();

    window.addEventListener('edit-diary', (e) => {
        setEditingData(e.detail.id);
    });

    resetDateToToday();
}

function resetDateToToday() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateInput = document.getElementById('visitedAt');
    if (dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;
}

// 📸 画像リサイズ処理 (メモリリーク防止のため明示的に破棄)
function resizeImageAsync(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const MAX_SIZE = 800;
                let { width, height } = img;
                
                if (width > height && width > MAX_SIZE) { 
                    height *= MAX_SIZE / width; width = MAX_SIZE; 
                } else if (height > MAX_SIZE) { 
                    width *= MAX_SIZE / height; height = MAX_SIZE; 
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                resolve(canvas.toDataURL('image/jpeg', 0.8));
                
                // メモリ解放
                img.src = ''; 
                canvas.width = 0; canvas.height = 0;
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ☁️ Exifと天気の自動取得 (フォールバック強化版)
async function extractExifAndWeather(file) {
    let lat = null, lng = null, temp = null, weatherIcon = "❓";
    let targetDate = new Date();
    let hasExifDate = false;
    
    try {
        if (window.exifr) {
            const exifData = await window.exifr.parse(file);
            if (exifData) {
                if (exifData.latitude && exifData.longitude) { 
                    lat = exifData.latitude; 
                    lng = exifData.longitude; 
                }
                if (exifData.DateTimeOriginal) { 
                    targetDate = new Date(exifData.DateTimeOriginal); 
                    hasExifDate = true;
                }
            }
        }
    } catch (err) { 
        console.warn("[DX Alert] Exif解析に失敗しました（無視して続行します）:", err); 
    }

    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const visitedAt = `${yyyy}-${mm}-${dd}`;
    const hour = targetDate.getHours();

    if (lat !== null && lng !== null) {
        function getWeatherEmoji(code) {
            if (code === 0) return "☀️"; 
            if (code >= 1 && code <= 3) return "☁️";
            if (code >= 51 && code <= 67 || code >= 80 && code <= 82 || code >= 95 && code <= 99) return "☔️";
            if (code >= 71 && code <= 86) return "❄️";
            return "❓";
        }
        
        try {
            // API呼び出しにAbortControllerを追加してタイムアウト(5秒)を設定（業務遅延防止）
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&start_date=${visitedAt}&end_date=${visitedAt}&hourly=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
            let res = await fetch(url, { signal: controller.signal }); 
            let data = await res.json();
            
            if (data.error || !data.hourly) {
                url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${visitedAt}&end_date=${visitedAt}&hourly=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
                res = await fetch(url, { signal: controller.signal }); 
                data = await res.json();
            }
            clearTimeout(timeoutId);

            if (data && data.hourly) {
                temp = Math.round(data.hourly.temperature_2m[hour]);
                weatherIcon = getWeatherEmoji(data.hourly.weather_code[hour]);
            }
        } catch (e) { 
            console.warn("[DX Alert] 天候APIの取得に失敗しました（デフォルト値を使用します）:", e); 
        }
    }
    return { lat, lng, visitedAt, weatherIcon, temp, hasExifDate };
}

// 📸 複数写真選択時の処理
async function handlePhotoSelection(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const statusEl = document.getElementById('gpsStatus');
    const dynamicForm = document.getElementById('dynamicFormFields');
    const submitBtn = document.getElementById('submitBtn');
    
    if(statusEl) { 
        statusEl.innerText = "📸 写真を解析中...少々お待ちください"; 
        statusEl.style.color = "#3498db"; 
    }
    if(submitBtn) submitBtn.disabled = true;

    currentImageBase64Array = [];
    let previewContainer = document.getElementById('photoPreviewContainer');
    
    if (!previewContainer) {
        const oldPreview = document.getElementById('imagePreview');
        if (oldPreview) {
            previewContainer = document.createElement('div');
            previewContainer.id = 'photoPreviewContainer';
            previewContainer.style.display = 'flex';
            previewContainer.style.gap = '8px';
            previewContainer.style.overflowX = 'auto';
            oldPreview.parentNode.insertBefore(previewContainer, oldPreview);
            oldPreview.style.display = 'none';
        }
    } else {
        previewContainer.innerHTML = '';
    }

    try {
        const { lat, lng, visitedAt, weatherIcon, temp, hasExifDate } = await extractExifAndWeather(files[0]);
        
        if (hasExifDate) document.getElementById('visitedAt').value = visitedAt;
        if (weatherIcon !== "❓") document.getElementById('weatherSelect').value = weatherIcon;
        
        document.getElementById('temperature').value = temp !== null ? temp : "";
        document.getElementById('latitude').value = lat !== null ? lat : "";
        document.getElementById('longitude').value = lng !== null ? lng : "";
        if (lat !== null) document.getElementById('locationSource').value = 'exif';

        if (dynamicForm) {
            dynamicForm.classList.remove('hidden');
            dynamicForm.classList.add('show');
        }

        if(statusEl) {
            if (lat !== null) {
                statusEl.innerText = `✅ 写真から位置と天気を自動取得しました！\n${weatherIcon} ${temp !== null ? temp + '℃' : ''}`;
                statusEl.style.color = "#27ae60";
            } else {
                statusEl.innerText = "ℹ️ 写真に位置情報がありません。手動で位置を指定してください。";
                statusEl.style.color = "#f39c12";
            }
        }

        // 並列処理(Promise.all)に変更し、UIのブロック時間を大幅短縮
        const resizePromises = Array.from(files).map(file => resizeImageAsync(file));
        const base64Images = await Promise.all(resizePromises);
        
        base64Images.forEach(base64 => {
            currentImageBase64Array.push(base64);
            if (previewContainer) {
                const img = document.createElement('img');
                img.src = base64;
                img.style.width = '80px'; img.style.height = '80px';
                img.style.objectFit = 'cover'; img.style.borderRadius = '8px';
                previewContainer.appendChild(img);
            }
        });

    } catch (err) {
        console.error("[DX Alert] 画像処理エラー:", err);
        if (statusEl) {
            statusEl.innerText = "❌ 画像の処理中にエラーが発生しました。";
            statusEl.style.color = "#e74c3c";
        }
    } finally {
        if(submitBtn) submitBtn.disabled = false;
    }
}

// 📦 一括アップロード (バックオフィス作業用)
async function handleBulkUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!confirm(`${files.length}枚の写真が選択されました。\nすべて「未整理(📦)」として一括ストックしますか？`)) {
        e.target.value = ''; return;
    }

    const bulkStatusEl = document.getElementById('bulkStatus');
    e.target.disabled = true; 

    // 直列処理を維持（複数画像の一括処理によるブラウザ/Workerのメモリオーバーフローを防ぐため）
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if(bulkStatusEl) { 
            bulkStatusEl.innerText = `📦 一括登録中... (${i + 1} / ${files.length} 枚目)`; 
            bulkStatusEl.style.color = "#8e44ad"; 
        }

        const base64 = await resizeImageAsync(file);
        const { lat, lng, visitedAt, temp } = await extractExifAndWeather(file);

        const payload = {
            id: null, shopId: null, shopName: "未整理の写真", comment: "", visitedAt: visitedAt, tags: "", 
            imageBase64: [base64], 
            lat: lat, lng: lng, temperature: temp, weatherIcon: "📦", 
            userGender: localStorage.getItem('ezo_gender') || "未設定", userAge: localStorage.getItem('ezo_age') || "未設定",
            userUuid: localStorage.getItem('ezo_user_uuid'), isPublic: 0 
        };
        await saveDiaryApi(payload);
    }

    if(bulkStatusEl) { 
        bulkStatusEl.innerText = "✅ 全ての一括登録が完了しました！"; 
        bulkStatusEl.style.color = "#27ae60"; 
    }
    e.target.value = ''; e.target.disabled = false;
    
    setTimeout(() => {
        if (bulkStatusEl) bulkStatusEl.innerText = "";
        refreshHistoryList();
        window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'history' } }));
    }, 1200);
}

// ✍️ 写真スキップ処理
function handleSkipPhoto() {
    const dynamicForm = document.getElementById('dynamicFormFields');
    const statusEl = document.getElementById('gpsStatus');
    
    currentImageBase64Array = []; 
    document.getElementById('imageInputSingle').value = '';
    const previewContainer = document.getElementById('photoPreviewContainer');
    if (previewContainer) previewContainer.innerHTML = '';
    
    ['latitude', 'longitude', 'temperature', 'locationSource'].forEach(id => {
        if(document.getElementById(id)) document.getElementById(id).value = "";
    });
    if(document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = "❓";
    resetDateToToday(); 
    
    if (dynamicForm) {
        dynamicForm.classList.remove('hidden');
        dynamicForm.classList.add('show');
    }
    
    if (statusEl) {
        statusEl.innerText = "ℹ️ 写真なしで記録します。\n店舗名で検索、またはマップから手動で位置を指定できます！";
        statusEl.style.color = "#3498db";
    }
}

// 🔍 店舗サジェスト機能
function setupShopSuggest() {
    const shopInput = document.getElementById('shopName');
    if (!shopInput) return;

    shopInput.addEventListener('input', (e) => {
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
                            document.getElementById('locationSource').value = 'master'; 
                            const statusEl = document.getElementById('gpsStatus');
                            if (statusEl) { 
                                statusEl.innerText = "📍 店舗マスタから位置情報をセットしました"; 
                                statusEl.style.color = "#27ae60"; 
                            }
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
}

// 📍 手動マップピッカーと住所検索機能
function setupMapPicker() {
    document.getElementById('btnOpenMapPicker')?.addEventListener('click', () => {
        document.getElementById('mapPickerModal').classList.remove('hidden');
        
        if (!pickerMap) {
            pickerMap = L.map('pickerMap').setView([43.0600, 141.3500], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true }).addTo(pickerMap);
            
            pickerMarker = L.marker(pickerMap.getCenter()).addTo(pickerMap);
            pickerMap.on('move', () => {
                pickerMarker.setLatLng(pickerMap.getCenter());
            });
        }

        const currentLat = document.getElementById('latitude').value;
        const currentLng = document.getElementById('longitude').value;
        if (currentLat && currentLng && currentLat !== "null" && currentLng !== "null") {
            const latlng = [parseFloat(currentLat), parseFloat(currentLng)];
            pickerMap.setView(latlng, 17);
            if (pickerMarker) pickerMarker.setLatLng(latlng);
        }
        
        setTimeout(() => { pickerMap.invalidateSize(); }, 200);
    });

    document.getElementById('closeMapPicker')?.addEventListener('click', () => {
        document.getElementById('mapPickerModal').classList.add('hidden');
    });

    document.getElementById('btnConfirmLocation')?.addEventListener('click', () => {
        const center = pickerMap.getCenter();
        document.getElementById('latitude').value = center.lat;
        document.getElementById('longitude').value = center.lng;
        document.getElementById('locationSource').value = 'manual'; 
        const statusEl = document.getElementById('gpsStatus');
        if (statusEl) { 
            statusEl.innerText = "📍 マップから手動で店舗の位置を決定しました"; 
            statusEl.style.color = "#27ae60"; 
        }
        document.getElementById('mapPickerModal').classList.add('hidden');
    });

    const btnSearch = document.getElementById('btnMapPickerSearch');
    const inputSearch = document.getElementById('mapPickerSearchInput');

    if (btnSearch && inputSearch) {
        btnSearch.addEventListener('click', async () => {
            const query = inputSearch.value.trim();
            if (!query) return;
            
            btnSearch.textContent = "検索中...";
            btnSearch.disabled = true;

            try {
                // 🛡️ DX実践: API仕様の遵守。Accept-Languageを明示的に付与して日本語データを確実にとる
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=jp`, {
                    headers: { 'Accept-Language': 'ja' }
                });
                
                if (!res.ok) throw new Error("API Limit Reached");
                const data = await res.json();
                
                if (data.length > 0) {
                    const lat = parseFloat(data[0].lat);
                    const lon = parseFloat(data[0].lon);
                    
                    if (pickerMap) {
                        pickerMap.flyTo([lat, lon], 17, { duration: 1.5 });
                    }
                } else {
                    alert("指定された場所が見つかりませんでした。別のキーワードでお試しください。");
                }
            } catch (e) {
                console.error("[DX Alert] Nominatim Search Error:", e);
                alert("通信エラー、または検索リクエストの上限に達しました。少し待ってからお試しください。");
            } finally {
                btnSearch.textContent = "検索";
                btnSearch.disabled = false;
            }
        });
        
        inputSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                btnSearch.click();
            }
        });
    }
}

// 🚀 記録送信 (データクレンジング処理を整理)
async function handleFormSubmit(e) {
    e.preventDefault();
    const eatTypeEl = document.querySelector('input[name="eatType"]:checked');
    const eatType = eatTypeEl ? eatTypeEl.value : '☕️店内';
    
    let latVal = document.getElementById('latitude')?.value || "";
    let lngVal = document.getElementById('longitude')?.value || "";
    const shopId = document.getElementById('shopId')?.value || null;

    if (eatType !== '🎪間借り・無店舗') {
        if (latVal === "" || lngVal === "" || latVal === "null" || lngVal === "null") {
            alert("⚠️ 店舗の位置情報が設定されていません！\n新規店舗を登録する場合は、手動で位置を指定してください。");
            return; 
        }
    }

    const submitBtn = document.getElementById('submitBtn');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true; 
    submitBtn.innerHTML = "🔄 データを送信中...";

    const userTags = document.getElementById('tags').value;
    const combinedTags = userTags ? `${eatType}, ${userTags}` : eatType;

    const shouldClearGps = (eatType === '🎪間借り・無店舗' || combinedTags.includes('🥡テイクアウト') || combinedTags.includes('🛍️豆・グッズ'));
    let finalLat = (latVal === "" || latVal === "null" || shouldClearGps) ? null : parseFloat(latVal);
    let finalLng = (lngVal === "" || lngVal === "null" || shouldClearGps) ? null : parseFloat(lngVal);

    let finalStatusIcon = document.getElementById('weatherSelect').value;
    if (document.getElementById('isBookmark')?.checked) finalStatusIcon = "💭";
    if (document.getElementById('isDraft')?.checked) finalStatusIcon = "📦";

    const payload = {
        id: editingDiaryId, shopId: shopId, shopName: document.getElementById('shopName').value,
        comment: document.getElementById('comment').value, visitedAt: document.getElementById('visitedAt').value,
        tags: combinedTags, 
        imageBase64: currentImageBase64Array.length > 0 ? currentImageBase64Array : null,
        lat: finalLat, lng: finalLng,
        temperature: document.getElementById('temperature')?.value || null, weatherIcon: finalStatusIcon,
        userGender: localStorage.getItem('ezo_gender') || "未設定", userAge: localStorage.getItem('ezo_age') || "未設定",
        userUuid: localStorage.getItem('ezo_user_uuid'), isPublic: document.getElementById('isPublicCheckbox')?.checked ? 1 : 0 
    };

    const result = await saveDiaryApi(payload); 
    if (result.success) {
        resetFormState(); // UIリセット処理を別関数に切り出し
        alert("✨ 記録が保存されました！");
        refreshHistoryList();
        window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'history' } }));
    } else { 
        alert("エラー: " + result.error); 
    }
    submitBtn.disabled = false; 
    submitBtn.innerHTML = originalBtnText;
}

// UIと状態のリセット (カプセル化)
function resetFormState() {
    document.getElementById('recordForm').reset();
    const previewContainer = document.getElementById('photoPreviewContainer');
    if(previewContainer) previewContainer.innerHTML = '';
    if(document.getElementById('gpsStatus')) document.getElementById('gpsStatus').innerText = ""; 
    
    resetDateToToday();
    
    document.getElementById('dynamicFormFields')?.classList.remove('show');
    document.getElementById('dynamicFormFields')?.classList.add('hidden'); 
    
    currentImageBase64Array = []; 
    editingDiaryId = null;
    document.getElementById('submitBtn').innerHTML = "🚀 記録する";
}

// ✏️ 編集データをセット
function setEditingData(id) {
    const diaries = getters.getAllDiaries();
    const diary = diaries.find(d => d.id === id);
    if (!diary) return;

    window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'record' } }));
    
    document.getElementById('shopName').value = diary.shop_name === "未整理の写真" ? "" : (diary.shop_name || "");
    if (document.getElementById('shopId')) document.getElementById('shopId').value = diary.shop_id || "";
    document.getElementById('visitedAt').value = diary.visited_at ? diary.visited_at.split(' ')[0] : "";
    document.getElementById('comment').value = diary.comment || "";
    
    if (document.getElementById('isBookmark')) document.getElementById('isBookmark').checked = (diary.weather_icon === "💭");
    if (document.getElementById('isDraft')) document.getElementById('isDraft').checked = false; 
    if (document.getElementById('isPublicCheckbox')) document.getElementById('isPublicCheckbox').checked = (diary.is_public === 1);

    if (document.getElementById('weatherSelect')) {
        document.getElementById('weatherSelect').value = (diary.weather_icon === "💭" || diary.weather_icon === "📦" || diary.weather_icon === "🚫" || !diary.weather_icon) ? "❓" : diary.weather_icon;
    }

    document.getElementById('latitude').value = (diary.latitude !== null && diary.latitude !== "null") ? diary.latitude : "";
    document.getElementById('longitude').value = (diary.longitude !== null && diary.longitude !== "null") ? diary.longitude : "";
    document.getElementById('temperature').value = (diary.temperature !== null && diary.temperature !== "null") ? diary.temperature : "";
    document.getElementById('locationSource').value = "manual"; 
    
    if (document.getElementById('gpsStatus')) document.getElementById('gpsStatus').innerText = "";

    const allTags = parseTags(diary.tags);
    if (allTags.includes('🛍️豆・グッズ')) document.querySelector('input[name="eatType"][value="🛍️豆・グッズ"]').checked = true;
    else if (allTags.includes('🥡テイクアウト')) document.querySelector('input[name="eatType"][value="🥡テイクアウト"]').checked = true;
    else if (allTags.includes('🎪間借り・無店舗')) document.querySelector('input[name="eatType"][value="🎪間借り・無店舗"]').checked = true;
    else document.querySelector('input[name="eatType"][value="☕️店内"]').checked = true;

    const manualTags = allTags.filter(t => !t.startsWith("🤖") && !t.startsWith("🚨") && !['🥡テイクアウト', '☕️店内', '🛍️豆・グッズ', '🎪間借り・無店舗'].includes(t)).join(', ');
    document.getElementById('tags').value = manualTags;

    let previewContainer = document.getElementById('photoPreviewContainer');
    if (!previewContainer) {
        const oldPreview = document.getElementById('imagePreview');
        if (oldPreview) {
            previewContainer = document.createElement('div');
            previewContainer.id = 'photoPreviewContainer';
            previewContainer.style.display = 'flex';
            previewContainer.style.gap = '8px';
            previewContainer.style.overflowX = 'auto';
            oldPreview.parentNode.insertBefore(previewContainer, oldPreview);
            oldPreview.style.display = 'none';
        }
    }
    if (previewContainer) previewContainer.innerHTML = '';
    currentImageBase64Array = []; 

    let imageUrls = [];
    if (diary.image_base64) {
        try {
            imageUrls = JSON.parse(diary.image_base64);
            if (!Array.isArray(imageUrls)) imageUrls = [diary.image_base64];
        } catch (e) {
            imageUrls = [diary.image_base64];
        }
    } else if (diary.image_url) {
        imageUrls = [diary.image_url];
    }

    if (imageUrls.length > 0) {
        imageUrls.forEach(url => {
            currentImageBase64Array.push(url);
            if (previewContainer) {
                const img = document.createElement('img');
                img.src = url;
                img.style.width = '80px'; img.style.height = '80px';
                img.style.objectFit = 'cover'; img.style.borderRadius = '8px';
                previewContainer.appendChild(img);
            }
        });
    }
    
    document.getElementById('dynamicFormFields')?.classList.remove('hidden');
    document.getElementById('dynamicFormFields')?.classList.add('show');
    editingDiaryId = diary.id;
    document.getElementById('submitBtn').innerHTML = "🔄 この内容で更新する";
    window.scrollTo(0, 0); 
}