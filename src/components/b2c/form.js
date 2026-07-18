// ==========================================
// 📦 src/components/b2c/form.js (完全統合版：複数画像・爆速マップ・マスタトグル対応)
// ==========================================
import { saveDiaryApi, searchMasterApi } from '../../api.js';
import { refreshHistoryList } from './list.js';
import { getters } from '../../state.js';
import { parseTags, escapeHTML } from '../../utils/text.js';

// 🌟 状態管理用の変数群
let currentImageBase64Array = [];
let editingDiaryId = null;
let suggestTimeout = null;
let pickerMap = null;

// 🌟 マップのマスタピン管理用
let masterLayerGroup = null;
let isMasterFetched = false;

export function initFormHandlers() {
    // フォームの送信
    const recordForm = document.getElementById('recordForm');
    if (recordForm) recordForm.addEventListener('submit', handleFormSubmit);
    
    // 画像の選択（単体入力UIを再利用しつつ multiple 化）
    const singleInput = document.getElementById('imageInputSingle');
    if (singleInput) {
        singleInput.setAttribute('multiple', 'multiple'); // HTMLを触らず複数選択を有効化
        singleInput.addEventListener('change', handlePhotoSelection);
    }
    
    // 一括ストック
    const bulkInput = document.getElementById('imageInputBulk');
    if (bulkInput) bulkInput.addEventListener('change', handleBulkUpload);

    // 写真なしスキップ
    const btnSkipPhoto = document.getElementById('btnSkipPhoto');
    if (btnSkipPhoto) btnSkipPhoto.addEventListener('click', handleSkipPhoto);

    // 店舗サジェストと手動マップピッカーの初期化
    setupShopSuggest();
    setupMapPicker();

    // 履歴タブからの「編集」イベントを受け取る
    window.addEventListener('edit-diary', (e) => {
        setEditingData(e.detail.id);
    });
}

function resetDateToToday() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateInput = document.getElementById('visitedAt');
    if (dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;
}

// 📸 画像リサイズ処理 (Promise化)
function resizeImageAsync(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const MAX_SIZE = 800; // R2用に800pxで統一
                let width = img.width; let height = img.height;
                if (width > height) {
                    if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
                } else {
                    if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
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

// ☁️ Exifと天気の自動取得
async function extractExifAndWeather(file) {
    let lat = null, lng = null, temp = null, weatherIcon = "❓";
    let targetDate = new Date();
    
    try {
        if (window.exifr) {
            const exifData = await window.exifr.parse(file);
            if (exifData) {
                if (exifData.latitude && exifData.longitude) { lat = exifData.latitude; lng = exifData.longitude; }
                if (exifData.DateTimeOriginal) { targetDate = new Date(exifData.DateTimeOriginal); }
            }
        }
    } catch (err) { console.log("Exif error:", err); }

    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const visitedAt = `${yyyy}-${mm}-${dd}`;
    const hour = targetDate.getHours();

    if (lat !== null && lng !== null) {
        function getWeatherEmoji(code) {
            if (code === 0) return "☀️"; if (code >= 1 && code <= 3) return "☁️";
            if (code >= 51 && code <= 67 || code >= 80 && code <= 82 || code >= 95 && code <= 99) return "☔️";
            if (code >= 71 && code <= 86) return "❄️";
            return "❓";
        }
        try {
            let url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&start_date=${visitedAt}&end_date=${visitedAt}&hourly=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
            let res = await fetch(url); let data = await res.json();
            if (data.error || !data.hourly) {
                url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${visitedAt}&end_date=${visitedAt}&hourly=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
                res = await fetch(url); data = await res.json();
            }
            if (data && data.hourly) {
                temp = Math.round(data.hourly.temperature_2m[hour]);
                weatherIcon = getWeatherEmoji(data.hourly.weather_code[hour]);
            }
        } catch (e) { console.log("Weather API error:", e); }
    }
    return { lat, lng, visitedAt, weatherIcon, temp };
}

// 📸 複数写真選択時の処理（配列化＆プレビュー生成）
async function handlePhotoSelection(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const statusEl = document.getElementById('gpsStatus');
    const dynamicForm = document.getElementById('dynamicFormFields');
    const submitBtn = document.getElementById('submitBtn');
    
    if(statusEl) { statusEl.innerText = "📸 写真を解析中..."; statusEl.style.color = "#3498db"; }
    if(submitBtn) submitBtn.disabled = true;

    // 配列とプレビュー領域の初期化
    currentImageBase64Array = [];
    let previewContainer = document.getElementById('photoPreviewContainer');
    
    // もしプレビューコンテナが無ければ、既存のimagePreviewの親要素に作成する
    if (!previewContainer) {
        const oldPreview = document.getElementById('imagePreview');
        if (oldPreview) {
            previewContainer = document.createElement('div');
            previewContainer.id = 'photoPreviewContainer';
            previewContainer.style.display = 'flex';
            previewContainer.style.gap = '8px';
            previewContainer.style.overflowX = 'auto';
            oldPreview.parentNode.insertBefore(previewContainer, oldPreview);
            oldPreview.style.display = 'none'; // 古い単体プレビューは隠す
        }
    } else {
        previewContainer.innerHTML = '';
    }

    try {
        // 🌟 Exifと天気は最初の1枚目からのみ抽出
        const { lat, lng, visitedAt, weatherIcon, temp } = await extractExifAndWeather(files[0]);
        
        document.getElementById('visitedAt').value = visitedAt;
        if (weatherIcon !== "❓") document.getElementById('weatherSelect').value = weatherIcon;
        document.getElementById('temperature').value = temp !== null ? temp : "";
        document.getElementById('latitude').value = lat !== null ? lat : "";
        document.getElementById('longitude').value = lng !== null ? lng : "";
        if (lat !== null) document.getElementById('locationSource').value = 'exif';

        if (dynamicForm) dynamicForm.classList.add('show');

        if(statusEl) {
            if (lat !== null) {
                statusEl.innerText = `✅ 写真から位置と天気を自動取得しました！\n${weatherIcon} ${temp !== null ? temp + '℃' : ''}`;
                statusEl.style.color = "#27ae60";
            } else {
                statusEl.innerText = "ℹ️ 写真に位置情報がありません。手動で位置を指定できます。";
                statusEl.style.color = "#f39c12";
            }
        }

        // 🌟 すべての画像をリサイズして配列に格納
        for (let i = 0; i < files.length; i++) {
            const base64 = await resizeImageAsync(files[i]);
            currentImageBase64Array.push(base64);

            if (previewContainer) {
                const img = document.createElement('img');
                img.src = base64;
                img.style.width = '80px';
                img.style.height = '80px';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '8px';
                previewContainer.appendChild(img);
            }
        }
    } catch (err) {
        console.error("画像処理エラー:", err);
    } finally {
        if(submitBtn) submitBtn.disabled = false;
    }
}

// 📦 一括アップロード
async function handleBulkUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!confirm(`${files.length}枚の写真が選択されました。\nすべて「未整理(📦)」として一括ストックしますか？`)) {
        e.target.value = ''; return;
    }

    const bulkStatusEl = document.getElementById('bulkStatus');
    e.target.disabled = true; 

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if(bulkStatusEl) { bulkStatusEl.innerText = `📦 一括登録中... (${i + 1} / ${files.length} 枚目)`; bulkStatusEl.style.color = "#8e44ad"; }

        const base64 = await resizeImageAsync(file);
        const { lat, lng, visitedAt, temp } = await extractExifAndWeather(file);

        const payload = {
            id: null, shopId: null, shopName: "未整理の写真", comment: "", visitedAt: visitedAt, tags: "", 
            imageBase64: [base64], // 🌟 配列化してバックエンドへ渡す
            lat: lat, lng: lng, temperature: temp, weatherIcon: "📦", 
            userGender: localStorage.getItem('ezo_gender') || "未設定", userAge: localStorage.getItem('ezo_age') || "未設定",
            userUuid: localStorage.getItem('ezo_user_uuid'), isPublic: 0 
        };
        await saveDiaryApi(payload);
    }

    if(bulkStatusEl) { bulkStatusEl.innerText = "✅ 全ての一括登録が完了しました！"; bulkStatusEl.style.color = "#27ae60"; }
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
    
    currentImageBase64Array = []; // 配列を空に
    document.getElementById('imageInputSingle').value = '';
    const previewContainer = document.getElementById('photoPreviewContainer');
    if (previewContainer) previewContainer.innerHTML = '';
    
    ['latitude', 'longitude', 'temperature', 'locationSource'].forEach(id => document.getElementById(id).value = "");
    document.getElementById('weatherSelect').value = "❓";
    
    if (dynamicForm) dynamicForm.classList.add('show');
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
}

// 📍 手動マップピッカー（爆速化 ＆ マスタピン切替機能搭載版）
function setupMapPicker() {
    document.getElementById('btnOpenMapPicker')?.addEventListener('click', () => {
        document.getElementById('mapPickerModal').classList.remove('hidden');
        
        if (!pickerMap) {
            // 🚀 改善案1: Canvasレンダリングを優先しスマホでの描画負荷を劇的に下げる
            pickerMap = L.map('pickerMap', {
                preferCanvas: true, 
                wheelPxPerZoomLevel: 120
            }).setView([43.0600, 141.3500], 15);
            
            // 🚀 改善案2: 軽量でお洒落なCARTOタイルに変更
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
                crossOrigin: true,
                attribution: '&copy; CARTO'
            }).addTo(pickerMap);

            // 🌟 追加機能: 店舗マスタ表示のトグルスイッチ（カスタムコントロール）
            const ToggleControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: function() {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
                    container.style.backgroundColor = 'white';
                    container.style.padding = '6px 10px';
                    container.style.borderRadius = '6px';
                    container.style.cursor = 'pointer';
                    container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
                    
                    container.innerHTML = `
                        <label style="cursor:pointer; display:flex; align-items:center; font-size:13px; font-weight:bold; margin:0; color:#2c3e50;">
                            <input type="checkbox" id="toggleMasterPins" style="margin-right:6px; cursor:pointer; width:16px; height:16px;">
                            🏪 マスタ店舗を表示
                        </label>
                    `;
                    
                    // スイッチ操作時に裏の地図が動かないようにするポカヨケ
                    L.DomEvent.disableClickPropagation(container);
                    return container;
                }
            });
            pickerMap.addControl(new ToggleControl());

            // マスタピンを格納する専用レイヤー
            masterLayerGroup = L.layerGroup();

            // トグル操作時のイベント処理
            document.getElementById('toggleMasterPins').addEventListener('change', async (e) => {
                if (e.target.checked) {
                    pickerMap.addLayer(masterLayerGroup);
                    
                    // 初回のみAPIからデータを取得する（通信量の節約）
                    if (!isMasterFetched) {
                        try {
                            const uuid = localStorage.getItem('ezo_user_uuid') || "";
                            // ※APIのURLに合わせて適宜修正してください
                            const res = await fetch('/api/diaries?action=get_all_master', {
                                headers: { "X-Ezo-User-UUID": uuid }
                            });
                            const data = await res.json();
                            
                            data.forEach(shop => {
                                if(shop.latitude && shop.longitude) {
                                    // 🚀 DOM(画像)マーカーではなく、超軽量なCircleMarkerを使用
                                    L.circleMarker([shop.latitude, shop.longitude], {
                                        radius: 6,
                                        color: '#d35400',
                                        fillColor: '#f39c12',
                                        fillOpacity: 0.9,
                                        weight: 2
                                    })
                                    .bindPopup(`<b>${escapeHTML(shop.shop_name)}</b><br><span style="font-size:10px; color:#7f8c8d;">店舗マスタ</span>`)
                                    .addTo(masterLayerGroup);
                                }
                            });
                            isMasterFetched = true;
                        } catch (err) {
                            console.error("店舗マスタの取得に失敗しました", err);
                        }
                    }
                } else {
                    pickerMap.removeLayer(masterLayerGroup); // チェックが外れたら隠す
                }
            });
        }
        
        const currentLat = document.getElementById('latitude').value;
        const currentLng = document.getElementById('longitude').value;
        if (currentLat && currentLng && currentLat !== "null" && currentLng !== "null") {
            pickerMap.setView([parseFloat(currentLat), parseFloat(currentLng)], 17);
        }
        // モーダル表示時のマップの崩れを防ぐ
        setTimeout(() => { pickerMap.invalidateSize(); }, 200);
    });

    window.closeMapPicker = function() {
        document.getElementById('mapPickerModal').classList.add('hidden');
    };

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
        window.closeMapPicker();
    });
}

// 🚀 記録送信
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
    submitBtn.disabled = true; submitBtn.innerHTML = "🤖 通信中...";

    const userTags = document.getElementById('tags').value;
    const combinedTags = userTags ? `${eatType}, ${userTags}` : eatType;

    // 🌟 テイクアウト等のポカヨケ（位置情報破棄）
    let finalLat = (latVal === "" || latVal === "null" || eatType === '🎪間借り・無店舗' || combinedTags.includes('🥡テイクアウト') || combinedTags.includes('🛍️豆・グッズ')) ? null : parseFloat(latVal);
    let finalLng = (lngVal === "" || lngVal === "null" || eatType === '🎪間借り・無店舗' || combinedTags.includes('🥡テイクアウト') || combinedTags.includes('🛍️豆・グッズ')) ? null : parseFloat(lngVal);

    let finalStatusIcon = document.getElementById('weatherSelect').value;
    if (document.getElementById('isBookmark')?.checked) finalStatusIcon = "💭";
    if (document.getElementById('isDraft')?.checked) finalStatusIcon = "📦";

    const payload = {
        id: editingDiaryId, shopId: shopId, shopName: document.getElementById('shopName').value,
        comment: document.getElementById('comment').value, visitedAt: document.getElementById('visitedAt').value,
        tags: combinedTags, 
        imageBase64: currentImageBase64Array.length > 0 ? currentImageBase64Array : null, // 🌟 配列で送信
        lat: finalLat, lng: finalLng,
        temperature: document.getElementById('temperature')?.value || null, weatherIcon: finalStatusIcon,
        userGender: localStorage.getItem('ezo_gender') || "未設定", userAge: localStorage.getItem('ezo_age') || "未設定",
        userUuid: localStorage.getItem('ezo_user_uuid'), isPublic: document.getElementById('isPublicCheckbox')?.checked ? 1 : 0 
    };

    const result = await saveDiaryApi(payload); 
    if (result.success) {
        document.getElementById('recordForm').reset();
        const previewContainer = document.getElementById('photoPreviewContainer');
        if(previewContainer) previewContainer.innerHTML = '';
        if(document.getElementById('gpsStatus')) document.getElementById('gpsStatus').innerText = ""; 
        document.getElementById('dynamicFormFields')?.classList.remove('show');
        
        currentImageBase64Array = []; editingDiaryId = null;
        document.getElementById('submitBtn').innerHTML = "🚀 記録する";
        alert("✨ 記録が保存されました！");
        refreshHistoryList();
        window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'history' } }));
    } else { alert("エラー: " + result.error); }
    submitBtn.disabled = false; submitBtn.innerHTML = originalBtnText;
}

// ✏️ 編集データをセット（履歴からの呼び出し）
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

    if (diary.weather_icon === "💭" || diary.weather_icon === "📦" || diary.weather_icon === "🚫") {
        if (document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = "❓";
    } else if (diary.weather_icon) {
        if (document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = diary.weather_icon;
    } else {
        if (document.getElementById('weatherSelect')) document.getElementById('weatherSelect').value = "❓";
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

    const manualTags = allTags.filter(t => !t.startsWith("🤖") && !t.startsWith("🚨") && t !== '🥡テイクアウト' && t !== '☕️店内' && t !== '🛍️豆・グッズ' && t !== '🎪間借り・無店舗').join(', ');
    document.getElementById('tags').value = manualTags;

    // 🌟 画像プレビューの復元（配列データ・旧データの両方に対応）
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
    currentImageBase64Array = []; // 既存画像の配列

    let imageUrls = [];
    if (diary.image_base64) {
        try {
            imageUrls = JSON.parse(diary.image_base64);
            if (!Array.isArray(imageUrls)) imageUrls = [diary.image_base64];
        } catch (e) {
            imageUrls = [diary.image_base64]; // パースできなければ単一文字列
        }
    } else if (diary.image_url) {
        imageUrls = [diary.image_url];
    }

    if (imageUrls.length > 0) {
        imageUrls.forEach(url => {
            currentImageBase64Array.push(url); // 再保存用に配列に保持
            if (previewContainer) {
                const img = document.createElement('img');
                img.src = url;
                img.style.width = '80px';
                img.style.height = '80px';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '8px';
                previewContainer.appendChild(img);
            }
        });
    }
    
    document.getElementById('dynamicFormFields')?.classList.add('show');
    editingDiaryId = diary.id;
    document.getElementById('submitBtn').innerHTML = "🔄 この内容で更新する";
    window.scrollTo(0, 0); 
}