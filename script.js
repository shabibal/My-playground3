// --- Location & Map Variables ---
let map;
let userMarker;
let venueMarkers = [];
let userLocation = null;
let currentMapStyle = 'street';
let venueMap;

// --- State Management ---
let currentLoggedInUser = null;
let currentVenueId = null;
let pendingBooking = null;
let currentPendingBookingId = null;
let currentSport = 'football';
let currentProductId = null;
// *** متغير جديد لإدارة طلب المنتجات ***
let pendingProductOrder = null;

// --- Sync Manager ---
window.syncManager = {
    isGoogleReady: false,
    isSignedIn: () => gapi && gapi.client && gapi.client.getToken() !== null,
    pollingInterval: null,
    lastSyncHash: '',

    loadFromLocalStorage() {
        console.log('Loading data from localStorage...');
        window.db = {
            pendingOwnerAccounts: JSON.parse(localStorage.getItem('pendingOwnerAccounts')) || [],
            approvedOwners: JSON.parse(localStorage.getItem('approvedOwners')) || [],
            publishedVenues: JSON.parse(localStorage.getItem('publishedVenues')) || [],
            allBookings: JSON.parse(localStorage.getItem('allBookings')) || [],
            tournaments: JSON.parse(localStorage.getItem('tournaments')) || [],
            reviews: JSON.parse(localStorage.getItem('reviews')) || [],
            discountCodes: JSON.parse(localStorage.getItem('discountCodes')) || [],
            notifications: JSON.parse(localStorage.getItem('notifications')) || [],
            chatMessages: JSON.parse(localStorage.getItem('chatMessages')) || [],
            products: JSON.parse(localStorage.getItem('products')) || [],
            // *** إضافة السلة إلى قاعدة البيانات المحلية ***
            cart: JSON.parse(localStorage.getItem('cart')) || []
        };
        this.lastSyncHash = this.getDataHash(window.db);
        if (typeof updateUI === 'function') updateUI();
    },

    async syncWithGoogleSheets() {
        if (!this.isSignedIn()) { console.warn('Cannot sync with Google Sheets: Not signed in.'); return; }
        console.log('Syncing with Google Sheets...');
        const googleData = await loadDataFromGoogleSheets();
        if (googleData) {
            window.db = googleData; this.lastSyncHash = this.getDataHash(window.db); this.saveToLocalStorage();
        } else { console.log('Failed to load from Google Sheets, pushing local data up.'); this.saveToGoogleSheets(); }
        if (typeof updateUI === 'function') updateUI();
    },

    saveToLocalStorage() {
        localStorage.setItem('pendingOwnerAccounts', JSON.stringify(window.db.pendingOwnerAccounts));
        localStorage.setItem('approvedOwners', JSON.stringify(window.db.approvedOwners));
        localStorage.setItem('publishedVenues', JSON.stringify(window.db.publishedVenues));
        localStorage.setItem('allBookings', JSON.stringify(window.db.allBookings));
        localStorage.setItem('tournaments', JSON.stringify(window.db.tournaments));
        localStorage.setItem('reviews', JSON.stringify(window.db.reviews));
        localStorage.setItem('discountCodes', JSON.stringify(window.db.discountCodes));
        localStorage.setItem('notifications', JSON.stringify(window.db.notifications));
        localStorage.setItem('chatMessages', JSON.stringify(window.db.chatMessages));
        localStorage.setItem('products', JSON.stringify(window.db.products));
        // *** حفظ السلة ***
        localStorage.setItem('cart', JSON.stringify(window.db.cart));
    },

    async saveToGoogleSheets() {
        if (!this.isSignedIn()) { console.warn('Cannot save to Google Sheets: Not signed in.'); return; }
        await saveDataToGoogleSheets(window.db);
    },
    
    getDataHash(data) { return JSON.stringify(data); },

    startPolling() {
        if (!this.isSignedIn() || this.pollingInterval) return;
        console.log('Starting automatic data sync...');
        this.pollingInterval = setInterval(async () => {
            try {
                const latestData = await loadDataFromGoogleSheets();
                if (latestData) {
                    const newHash = this.getDataHash(latestData);
                    if (newHash !== this.lastSyncHash) {
                        console.log('New data detected! Updating UI...');
                        window.db = latestData; this.lastSyncHash = newHash; this.saveToLocalStorage();
                        if (typeof updateUI === 'function') updateUI();
                    }
                }
            } catch (error) { console.error('Error during polling sync:', error); }
        }, 30000);
    },

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            console.log('Stopped automatic data sync.');
        }
    }
};

// --- Modified saveData Function ---
function saveData(data) {
    window.db = data;
    window.syncManager.saveToLocalStorage();
    if (window.syncManager.isSignedIn()) {
        window.syncManager.saveToGoogleSheets();
    }
}

// --- Modified loadData Function ---
function loadData() {
    if (window.syncManager.isGoogleReady && window.syncManager.isSignedIn()) {
        window.syncManager.syncWithGoogleSheets();
    } else {
        window.syncManager.loadFromLocalStorage();
    }
    return window.db;
}

// --- Update UI Function ---
function updateUI() {
    const currentPage = document.querySelector('body > div:not(.hidden)');
    if (!currentPage) return;
    if (currentPage.id === 'playerInterface') displayVenuesForPlayer();
    else if (currentPage.id === 'productsPage') displayProducts();
    else if (currentPage.id === 'cartPage') renderCart();
    else if (currentPage.id === 'adminDashboard') showAdminSection('overview');
    else if (currentPage.id === 'ownerDashboard') showOwnerSection('overview');
    renderNotifications();
    updateCartBadge(); // *** تحديث شارة السلة عند أي تغيير ***
}

// --- Google Sheets API Ready Listener ---
document.addEventListener('googleApisReady', () => {
    window.syncManager.isGoogleReady = true;
    const signinButton = document.getElementById('signin-button');
    if (signinButton) {
        signinButton.innerText = window.syncManager.isSignedIn() ? 'تسجيل الخروج' : 'تسجيل الدخول لحفظ البيانات';
    }
});

// --- Location Functions ---
function initializeMap() {
    if (!map) {
        map = L.map('mapContainer').setView([23.5859, 58.4059], 11); // Default: Muscat
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);
        map.on('click', function(e) { console.log('Clicked at: ' + e.latlng); });
    }
    updateVenueMarkers();
}

function updateVenueMarkers() {
    if (!map) return;
    
    venueMarkers.forEach(marker => map.removeLayer(marker));
    venueMarkers = [];
    
    window.db.publishedVenues.forEach(venue => {
        if (venue.sport === currentSport && venue.lat && venue.lng) {
            const marker = L.marker([venue.lat, venue.lng]).addTo(map);
            
            const popupContent = `
                <div style="text-align: right; direction: rtl;">
                    <h4>${venue.name}</h4>
                    <p><i class="fas fa-map-marker-alt"></i> ${venue.location}</p>
                    <p><i class="fas fa-phone"></i> ${venue.contact}</p>
                    <p><i class="fas fa-money-bill"></i> ${venue.priceOffPeak} - ${venue.pricePeak} ريال عماني</p>
                    <button class="btn btn-primary btn-sm" onclick="showVenueDetails(${venue.id})">
                        <i class="fas fa-info-circle"></i> التفاصيل
                    </button>
                </div>
            `;
            
            marker.bindPopup(popupContent);
            venueMarkers.push(marker);
        }
    });
    
    if (venueMarkers.length > 0) {
        const group = new L.featureGroup(venueMarkers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                if (userMarker) map.removeLayer(userMarker);
                userMarker = L.marker([userLocation.lat, userLocation.lng], {
                    icon: L.divIcon({ html: '<i class="fas fa-user-circle" style="color: #3498db; font-size: 24px;"></i>', iconSize: [24, 24], className: 'user-location-marker' })
                }).addTo(map).bindPopup('موقعك الحالي');
                map.setView([userLocation.lat, userLocation.lng], 12);
                updateNearbyVenues(); calculateDistances();
                showNotification('تم تحديد موقعك بنجاح!', 'success');
            },
            error => { console.error('Error getting location:', error); showNotification('لم نتمكن من تحديد موقعك.', 'error'); }
        );
    } else { showNotification('المتصفح لا يدعم تحديد الموقع', 'error'); }
}

function updateNearbyVenues() {
    if (!userLocation) return;
    const nearbyList = document.getElementById('nearbyList'); nearbyList.innerHTML = '';
    const maxDistance = parseFloat(document.getElementById('distanceSlider').value);
    const nearbyVenues = window.db.publishedVenues
        .filter(venue => venue.sport === currentSport)
        .map(venue => { const distance = calculateDistance(userLocation, venue); return { ...venue, distance }; })
        .filter(venue => venue.distance <= maxDistance).sort((a, b) => a.distance - b.distance).slice(0, 5);
    if (nearbyVenues.length === 0) { nearbyList.innerHTML = '<p class="text-center">لا توجد منشآت قريبة</p>'; return; }
    nearbyVenues.forEach(venue => {
        const item = document.createElement('div'); item.className = 'nearby-item'; item.onclick = () => showVenueDetails(venue.id);
        item.innerHTML = `
            <div class="nearby-venue-info">
                <div class="nearby-venue-name">${venue.name}</div>
                <div class="nearby-venue-distance"><i class="fas fa-route"></i> ${venue.distance.toFixed(1)} كم</div>
                <div class="nearby-venue-rating">${generateStars(getAverageRating(venue.id))}</div>
            </div>
            <button class="btn btn-primary btn-sm"><i class="fas fa-arrow-left"></i> عرض</button>
        `;
        nearbyList.appendChild(item);
    });
}

function calculateDistance(point1, point2) {
    if (!point1.lat || !point1.lng || !point2.lat || !point2.lng) return Infinity;
    const R = 6371; const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLng = (point2.lng - point1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) * Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return R * c;
}

function calculateDistances() {
    if (!userLocation) return;
    window.db.publishedVenues.forEach(venue => { if (venue.sport === currentSport) venue.distance = calculateDistance(userLocation, venue); });
}

function updateDistanceFilter(value) {
    document.getElementById('distanceValue').textContent = value + ' كم';
    if (userLocation) updateNearbyVenues();
}

function filterByDistance() {
    if (!userLocation) { showNotification('يرجى تحديد موقعك أولاً', 'error'); return; }
    const maxDistance = parseFloat(document.getElementById('distanceSlider').value);
    const filtered = window.db.publishedVenues.filter(venue => venue.sport === currentSport && venue.distance && venue.distance <= maxDistance);
    renderVenues(filtered); showNotification(`تم عرض ${filtered.length} منشأة`, 'success');
}

function clearLocationFilter() {
    document.getElementById('distanceSlider').value = 10; document.getElementById('distanceValue').textContent = '10 كم';
    displayVenuesForPlayer();
}

function centerMapOnUser() { if (userLocation) map.setView([userLocation.lat, userLocation.lng], 14); else getUserLocation(); }
function toggleMapStyle() { /* Toggle between map tile layers */ }
function toggleFullscreen() { /* Toggle map fullscreen */ }
function getDirections() { /* Open Google Maps directions */ }
function initializeVenueMap() { /* Initialize map for a specific venue */ }

// --- Page Navigation ---
function showPage(pageId) {
    const pages = document.querySelectorAll('body > div');
    pages.forEach(page => page.classList.add('hidden'));
    document.getElementById(pageId).classList.remove('hidden');
    
    const header = document.getElementById('appHeader');
    if (['playerInterface', 'venueDetailPage', 'paymentPage', 'tournamentsPage', 'chatPage', 'adminChatPage', 'sportsSelectionPage', 'productsPage', 'productDetailPage', 'cartPage', 'checkoutPage'].includes(pageId)) {
        header.classList.remove('hidden');
        document.getElementById('headerUserName').textContent = 'ضيف';
    } else {
        header.classList.add('hidden');
    }
    
    if (pageId === 'playerInterface') {
        displayVenuesForPlayer();
        setTimeout(() => {
            initializeMap();
            updateVenueMarkers();
        }, 100);
    }
    
    if (pageId === 'venueDetailPage') {
        setTimeout(() => initializeVenueMap(), 100);
    }
    
    if (pageId === 'paymentPage') {
        renderPayPalButton();
    }
    
    if (pageId === 'ownerDashboard') {
        showOwnerSection('overview');
    }
    
    if (pageId === 'adminDashboard') {
        showAdminSection('overview');
    }
    
    if (pageId === 'tournamentsPage') {
        displayAllTournaments();
    }
    
    if (pageId === 'createTournamentPage') {
        populateVenueSelect();
    }
    
    if (pageId === 'chatPage') {
        loadChatMessages(currentPendingBookingId, 'user');
    }
    
    if (pageId === 'adminChatPage') {
        loadChatMessages(currentPendingBookingId, 'admin');
    }
    
    if (pageId === 'productsPage') {
        displayProducts();
    }

    // *** عرض السلة عند فتح الصفحة ***
    if (pageId === 'cartPage') {
        renderCart();
    }

    // *** عرض ملخص الدفع عند فتح الصفحة ***
    if (pageId === 'checkoutPage') {
        renderCheckoutSummary();
    }
}

// --- Sport Selection ---
function selectSport(sport) {
    currentSport = sport;
    showPage('playerInterface');
    updatePlayerInterfaceHeader();
    updateFiltersForSport();
    displayVenuesForPlayer();
    updateVenueMarkers();
}

function updatePlayerInterfaceHeader() { /* Update header text based on selected sport */ }
function updateFiltersForSport() { /* Populate filter dropdowns based on sport */ }

// --- Player Interface (Guest) ---
function displayVenuesForPlayer() {
    const venues = window.db.publishedVenues.filter(v => v.sport === currentSport);
    renderVenues(venues);
}

function applyFilters() { /* Apply filters to venues list */ }

function renderVenues(venuesToRender) {
    const container = document.getElementById('venuesListForPlayer');
    container.innerHTML = '';
    
    if (venuesToRender.length === 0) {
        container.innerHTML = '<p class="text-center">لا توجد منشآت متاحة لهذه الرياضة حالياً.</p>';
        return;
    }
    
    venuesToRender.forEach(venue => {
        const venueCard = document.createElement('li');
        venueCard.className = 'venue-card';
        venueCard.onclick = () => showVenueDetails(venue.id);
        
        let distanceInfo = '';
        if (userLocation && venue.lat && venue.lng) {
            const distance = calculateDistance(userLocation, venue);
            venue.distance = distance;
            distanceInfo = `<div class="venue-distance"><i class="fas fa-route"></i> ${distance.toFixed(1)} كم</div>`;
        }
        
        const avgRating = getAverageRating(venue.id);
        const ratingStars = generateStars(avgRating);
        
        venueCard.innerHTML = `
            <div class="venue-image-placeholder">
                <i class="fas fa-${getSportIcon(venue.sport)}"></i>
            </div>
            <div class="venue-card-body">
                <h3>${venue.name}</h3>
                <p><i class="fas fa-map-marker-alt"></i> ${venue.location}, ${venue.city}</p>
                <p><i class="fas fa-phone"></i> ${venue.contact}</p>
                ${distanceInfo}
                <div class="venue-rating">${ratingStars}</div>
                <div class="venue-price">
                    <span class="price-tag">${venue.priceOffPeak} - ${venue.pricePeak} ريال عماني</span>
                </div>
                <div class="venue-features">
                    ${venue.lights ? '<span class="venue-feature"><i class="fas fa-lightbulb"></i> إضاءة</span>' : ''}
                    ${venue.surface ? `<span class="venue-feature">${venue.surface}</span>` : ''}
                    ${venue.size ? `<span class="venue-feature">${venue.size}</span>` : ''}
                </div>
            </div>
        `;
        
        container.appendChild(venueCard);
    });
}

function getSportIcon(sport) {
    const icons = {
        football: 'futbol',
        volleyball: 'volleyball-ball',
        basketball: 'basketball-ball',
        tennis: 'table-tennis',
        swimming: 'swimmer',
        esports: 'gamepad'
    };
    return icons[sport] || 'running';
}

// --- Venue Detail & Booking (Guest) ---
function showVenueDetails(venueId) {
    currentVenueId = venueId; const venue = window.db.publishedVenues.find(v => v.id === venueId); if (!venue) return;
    document.getElementById('detailVenueName').textContent = venue.name;
    let infoHtml = `<p><strong>المدينة:</strong> ${venue.city}</p><p><strong>الموقع:</strong> ${venue.location}</p><p><strong>التواصل:</strong> ${venue.contact}</p><p><strong>التفاصيل:</strong> ${venue.details || 'لا توجد تفاصيل إضافية'}</p><p><strong>السطح:</strong> ${venue.surface}</p><p><strong>الحجم:</strong> ${venue.size}</p><p><strong>الإضاءة:</strong> ${venue.lights ? 'متوفرة' : 'غير متوفرة'}</p>`;
    if (venue.sport === 'esports') { infoHtml += `<p><strong>عدد الأجهزة:</strong> ${venue.equipmentCount || 'N/A'}</p><p><strong>الألعاب المتوفرة:</strong> ${venue.availableGames ? venue.availableGames.join(', ') : 'N/A'}</p>`; }
    document.getElementById('detailVenueInfo').innerHTML = infoHtml; document.getElementById('reviewsContainer').innerHTML = renderReviews(venueId);
    const today = new Date().toISOString().split('T')[0]; document.getElementById('bookingDate').setAttribute('min', today); document.getElementById('bookingDate').value = today;
    generateTimeSlots(); showPage('venueDetailPage');
}

function generateTimeSlots() {
    const venue = window.db.publishedVenues.find(v => v.id === currentVenueId); const selectedDate = document.getElementById('bookingDate').value; const container = document.getElementById('timeSlotsContainer'); container.innerHTML = '';
    for (let hour = venue.openingHour; hour < venue.closingHour; hour++) {
        const timeString = `${hour.toString().padStart(2, '0')}:00`;
        const isBooked = window.db.allBookings.some(b => b.venueId === currentVenueId && b.date === selectedDate && b.time === timeString && b.paymentStatus === 'confirmed');
        const isPeak = hour >= 18 && hour <= 21; const price = isPeak ? venue.pricePeak : venue.priceOffPeak;
        const slotDiv = document.createElement('div'); slotDiv.className = `time-slot ${isBooked ? 'booked' : 'available'}`;
        slotDiv.innerHTML = `${timeString}<br><span class="price-tag">${price} ريال عماني</span>`;
        if (isBooked) { slotDiv.innerHTML += `<br><small>محجوز</small>`; } else { slotDiv.onclick = () => initiateBooking(selectedDate, timeString, price); }
        container.appendChild(slotDiv);
    }
}

function initiateBooking(date, time, price) {
    const playerName = prompt("ادخل رقم الهاتف و أدخل اسمك الكامل لتأكيد الحجز:"); if (!playerName) return;
    pendingBooking = { date, time, basePrice: price };
    const discountCode = document.getElementById('discountCodeInput').value;
    const discount = window.db.discountCodes.find(d => d.code === discountCode);
    const finalPrice = discount ? price * (1 - discount.percent / 100) : price;
    pendingBooking.finalPrice = finalPrice; pendingBooking.discountCode = discount ? discount.code : null; pendingBooking.playerName = playerName;
    const conversionRate = 0.3845; const finalPriceUSD = (finalPrice * conversionRate).toFixed(2);
    const venue = window.db.publishedVenues.find(v => v.id === currentVenueId);
    document.getElementById('paymentSummary').innerHTML = `<p><strong>المنشأة:</strong> ${venue.name}</p><p><strong>اللاعب:</strong> ${playerName}</p><p><strong>التاريخ:</strong> ${date}</p><p><strong>الوقت:</strong> ${time}</p><p><strong>السعر الأساسي:</strong> ${price} ريال عماني</p>${discount ? `<p><strong>الخصم (${discount.code}):</strong> ${discount.percent}%</p>` : ''}<h3>المبلغ الإجمالي: <span class="price-tag">${finalPrice} ريال عماني</span> (${finalPriceUSD} دولار)</h3>`;
    showPage('paymentPage');
}

// --- Render PayPal Button ---
function renderPayPalButton() {
    if (!pendingBooking) { showNotification('لا يوجد حجز نشط للدفع.', 'error'); showPage('playerInterface'); return; }
    const container = document.getElementById('paypal-button-container'); container.innerHTML = '';
    const conversionRate = 0.3845; const amountInUSD = (pendingBooking.finalPrice * conversionRate).toFixed(2);
    paypal.Buttons({
        createOrder: function(data, actions) { return actions.order.create({ purchase_units: [{ amount: { value: amountInUSD } }] }); },
        onApprove: function(data, actions) {
            return actions.order.capture().then(function(orderData) {
                const transaction = orderData.purchase_units[0].payments.captures[0]; console.log('Payment successful:', transaction);
                const newBooking = { id: Date.now(), venueId: currentVenueId, venue: window.db.publishedVenues.find(v => v.id === currentVenueId), playerName: pendingBooking.playerName, date: pendingBooking.date, time: pendingBooking.time, finalPrice: pendingBooking.finalPrice, finalPriceUSD: amountInUSD, paymentMethod: 'paypal', paymentStatus: 'confirmed', paypalTransactionId: transaction.id };
                window.db.allBookings.push(newBooking); saveData(window.db);
                addNotification(`تم تأكيد حجز جديد: ${newBooking.venue.name} بواسطة ${newBooking.playerName}`);
                document.getElementById('paymentMessage').textContent = 'تم الدفع بنجاح! تم تأكيد حجزك.'; document.getElementById('paymentMessage').className = 'message success'; document.getElementById('paymentMessage').classList.remove('hidden');
                pendingBooking = null; setTimeout(() => { showPage('playerInterface'); }, 2500);
            });
        },
        onError: function (err) { console.error('PayPal error:', err); showNotification('حدث خطأ أثناء معالجة الدفع.', 'error'); },
        onCancel: function (data) { console.log('Payment cancelled by user'); showNotification('تم إلغاء عملية الدفع.', 'error'); }
    }).render('#paypal-button-container');
}

// --- *** وظائف عربة التسوق الجديدة *** ---

// تحديث شارة السلة
function updateCartBadge() {
    const badge = document.getElementById('cartBadge');
    if (!badge) return;
    const totalItems = window.db.cart.reduce((sum, item) => sum + item.quantity, 0);
    badge.textContent = totalItems;
    badge.style.display = totalItems > 0 ? 'flex' : 'none';
}

// إضافة منتج للسلة
function addToCart(productId) {
    const product = window.db.products.find(p => p.id === productId);
    if (!product) return;

    const existingItem = window.db.cart.find(item => item.id === productId);
    if (existingItem) {
        existingItem.quantity++;
    } else {
        window.db.cart.push({ ...product, quantity: 1 });
    }

    saveData(window.db);
    updateCartBadge();
    showNotification(`تمت إضافة "${product.name}" إلى السلة`, 'success');
}

// عرض محتويات السلة
function renderCart() {
    const container = document.getElementById('cartItemsContainer');
    const summaryContainer = document.getElementById('cartSummary');
    const checkoutBtn = document.getElementById('proceedToCheckoutBtn');

    if (window.db.cart.length === 0) {
        container.innerHTML = '<p class="text-center">عربة التسوق فارغة.</p>';
        summaryContainer.innerHTML = '';
        checkoutBtn.disabled = true;
        return;
    }

    checkoutBtn.disabled = false;
    let html = '<div class="cart-items">';
    let total = 0;

    window.db.cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        html += `
            <div class="cart-item">
                <img src="${item.image || 'https://picsum.photos/seed/product' + item.id + '/80/80.jpg'}" alt="${item.name}" class="cart-item-image">
                <div class="cart-item-details">
                    <h4>${item.name}</h4>
                    <p>${item.price} ريال عماني</p>
                </div>
                <div class="cart-item-quantity">
                    <button onclick="updateQuantity(${item.id}, ${item.quantity - 1})">-</button>
                    <span>${item.quantity}</span>
                    <button onclick="updateQuantity(${item.id}, ${item.quantity + 1})">+</button>
                </div>
                <button class="btn btn-danger btn-sm" onclick="removeFromCart(${item.id})"><i class="fas fa-trash"></i></button>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;

    summaryContainer.innerHTML = `
        <h3>ملخص الطلب</h3>
        <p>المجموع الفرعي: <span>${total.toFixed(2)} ريال عماني</span></p>
        <p>رسوم التوصيل: <span>2.0 ريال عماني</span></p>
        <p class="total">الإجمالي: <span>${(total + 2).toFixed(2)} ريال عماني</span></p>
    `;
}

// تحديث كمية المنتج في السلة
function updateQuantity(productId, newQuantity) {
    if (newQuantity <= 0) {
        removeFromCart(productId);
        return;
    }

    const item = window.db.cart.find(item => item.id === productId);
    if (item) {
        item.quantity = newQuantity;
        saveData(window.db);
        renderCart();
        updateCartBadge();
    }
}

// إزالة منتج من السلة
function removeFromCart(productId) {
    window.db.cart = window.db.cart.filter(item => item.id !== productId);
    saveData(window.db);
    renderCart();
    updateCartBadge();
    showNotification('تم إزالة المنتج من السلة', 'info');
}

// عرض ملخص الدفع في صفحة الدفع
function renderCheckoutSummary() {
    const summaryContainer = document.getElementById('checkoutSummary');
    let total = window.db.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const finalTotal = total + 2; // مع رسوم التوصيل

    let itemsHtml = '<ul>';
    window.db.cart.forEach(item => {
        itemsHtml += `<li>${item.name} (الكمية: ${item.quantity}) - ${item.price} ريال عماني</li>`;
    });
    itemsHtml += '</ul>';

    summaryContainer.innerHTML = `
        <h3>تفاصيل الطلب</h3>
        ${itemsHtml}
        <p><strong>المجموع الفرعي:</strong> ${total.toFixed(2)} ريال عماني</p>
        <p><strong>رسوم التوصيل:</strong> 2.00 ريال عماني</p>
        <h3><strong>المبلغ الإجمالي:</strong> ${finalTotal.toFixed(2)} ريال عماني</h3>
    `;

    // إعداد طلب المنتجات للدفع
    pendingProductOrder = {
        items: [...window.db.cart],
        total: finalTotal,
        // سيتم إضافة بيانات العميل لاحقًا
    };
    
    // عرض زر الدفع
    renderPayPalButtonForProducts();
}

// عرض زر باي بال للمنتجات
function renderPayPalButtonForProducts() {
    if (!pendingProductOrder || pendingProductOrder.items.length === 0) {
        showNotification('لا يوجد طلب نشط للدفع.', 'error');
        showPage('cartPage');
        return;
    }
    const container = document.getElementById('paypal-button-container-products');
    container.innerHTML = '';
    const conversionRate = 0.3845;
    const amountInUSD = (pendingProductOrder.total * conversionRate).toFixed(2);

    paypal.Buttons({
        createOrder: function(data, actions) {
            return actions.order.create({
                purchase_units: [{
                    amount: { value: amountInUSD }
                }]
            });
        },
        onApprove: function(data, actions) {
            return actions.order.capture().then(function(orderData) {
                const transaction = orderData.purchase_units[0].payments.captures[0];
                console.log('Product Payment successful:', transaction);

                // إنشاء سجل الطلب
                const newOrder = {
                    id: Date.now(),
                    customerName: document.getElementById('checkoutName').value,
                    customerPhone: document.getElementById('checkoutPhone').value,
                    customerAddress: document.getElementById('checkoutAddress').value,
                    items: pendingProductOrder.items,
                    total: pendingProductOrder.total,
                    totalUSD: amountInUSD,
                    paymentMethod: 'paypal',
                    paymentStatus: 'confirmed',
                    paypalTransactionId: transaction.id,
                    orderDate: new Date().toISOString()
                };

                // هنا يمكنك حفظ الطلب في قاعدة البيانات إذا أردت
                // window.db.productOrders.push(newOrder);
                // saveData(window.db);

                // تفريغ السلة
                window.db.cart = [];
                saveData(window.db);
                updateCartBadge();

                document.getElementById('checkoutMessage').textContent = 'تم الدفع بنجاح! جاري إعداد طلبك.';
                document.getElementById('checkoutMessage').className = 'message success';
                document.getElementById('checkoutMessage').classList.remove('hidden');
                
                pendingProductOrder = null;

                setTimeout(() => {
                    showPage('mainMenuPage');
                    showNotification('شكراً لك! تم استلام طلبك بنجاح.', 'success');
                }, 3000);
            });
        },
        onError: function (err) {
            console.error('PayPal error:', err);
            showNotification('حدث خطأ أثناء معالجة الدفع.', 'error');
        },
        onCancel: function (data) {
            console.log('Payment cancelled by user');
            showNotification('تم إلغاء عملية الدفع.', 'error');
        }
    }).render('#paypal-button-container-products');
}


// --- Products Functions ---
function displayProducts() {
    const container = document.getElementById('productsGrid'); container.innerHTML = '';
    if (window.db.products.length === 0) { container.innerHTML = '<p class="text-center">لا توجد منتجات متاحة حالياً.</p>'; return; }
    window.db.products.forEach(product => {
        const productCard = document.createElement('div'); productCard.className = 'product-card';
        productCard.innerHTML = `
            <div class="product-image"><img src="${product.image || 'https://picsum.photos/seed/product' + product.id + '/300/200.jpg'}" alt="${product.name}"></div>
            <div class="product-info">
                <h3>${product.name}</h3>
                <p class="product-category">${getCategoryName(product.category)}</p>
                <p class="product-price">${product.price} ريال عماني</p>
                <p class="product-description">${product.description.substring(0, 80)}...</p>
                <div class="product-actions">
                    <button class="btn btn-primary" onclick="addToCart(${product.id})"><i class="fas fa-shopping-cart"></i> أضف للسلة</button>
                    <button class="btn btn-secondary" onclick="showProductDetail(${product.id})"><i class="fas fa-info-circle"></i> التفاصيل</button>
                </div>
            </div>
        `;
        container.appendChild(productCard);
    });
}

function filterProducts() {
    const category = document.getElementById('productCategoryFilter').value;
    const priceRange = document.getElementById('priceRangeFilter').value;
    const searchTerm = document.getElementById('productSearchInput').value.toLowerCase();
    let filtered = window.db.products;
    if (category) filtered = filtered.filter(p => p.category === category);
    if (priceRange) { /* Apply price range filter logic */ }
    if (searchTerm) filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm) || p.description.toLowerCase().includes(searchTerm));
    const container = document.getElementById('productsGrid'); container.innerHTML = '';
    if (filtered.length === 0) { container.innerHTML = '<p class="text-center">لا توجد منتجات مطابقة للبحث.</p>'; return; }
    filtered.forEach(product => { /* Render filtered product cards */ });
}

function getCategoryName(category) {
    const categories = { clothing: 'ملابس رياضية', shoes: 'أحذية رياضية', equipment: 'معدات رياضية', accessories: 'إكسسوارات' };
    return categories[category] || category;
}

function showProductDetail(productId) {
    currentProductId = productId; const product = window.db.products.find(p => p.id === productId); if (!product) return;
    const detailContent = document.getElementById('productDetailContent');
    detailContent.innerHTML = `
        <div class="product-detail">
            <div class="product-detail-image"><img src="${product.image || 'https://picsum.photos/seed/product' + product.id + '/500/400.jpg'}" alt="${product.name}"></div>
            <div class="product-detail-info">
                <h2>${product.name}</h2>
                <p class="product-category">${getCategoryName(product.category)}</p>
                <p class="product-price">${product.price} ريال عماني</p>
                <div class="product-description"><h4>الوصف:</h4><p>${product.description}</p></div>
                ${product.features ? `<div class="product-features"><h4>المميزات:</h4><ul>${product.features.map(f => `<li>${f}</li>`).join('')}</ul></div>` : ''}
                <div class="product-actions">
                    <button class="btn btn-primary btn-lg" onclick="addToCart(${product.id})"><i class="fas fa-shopping-cart"></i> أضف للسلة</button>
                    <button class="btn btn-secondary" onclick="showPage('productsPage')"><i class="fas fa-arrow-left"></i> العودة</button>
                </div>
            </div>
        </div>
    `;
    showPage('productDetailPage');
}

// --- Chat Functions ---
function loadChatMessages(bookingId, userType) { /* Load chat messages for a booking */ }
function displayMessage(msg, container) { /* Display a single chat message */ }
function sendMessage() { /* Send a text message */ }
function sendImage(event) { /* Send an image message */ }
function showAdminChat(bookingId) { /* Show admin chat for a booking */ }
function confirmBookingFromChat() { /* Confirm a booking from chat */ }

// --- Notification System ---
function addNotification(text) { window.db.notifications.unshift({ id: Date.now(), text, read: false }); saveData(window.db); renderNotifications(); }
function showNotification(text, type) { /* Show a temporary notification popup */ }
function renderNotifications() { /* Render notifications in dropdown */ }
function toggleNotifications() { /* Toggle notification dropdown */ }

// --- Authentication ---
function handleOwnerRegistration(event) {
    event.preventDefault();
    const name = document.getElementById('ownerName').value;
    const email = document.getElementById('ownerEmail').value;
    const password = document.getElementById('ownerPassword').value;
    const phone = document.getElementById('ownerPhone').value;

    const newOwner = {
        id: Date.now(),
        name,
        email,
        password,
        phone,
        role: 'owner'
    };

    window.db.pendingOwnerAccounts.push(newOwner);
    saveData(window.db);

    const messageEl = document.getElementById('registrationMessage');
    messageEl.textContent = 'تم إنشاء حسابك بنجاح وهو في انتظار موافقة الإدارة.';
    messageEl.className = 'message success';
    messageEl.classList.remove('hidden');
    
    event.target.reset();
    setTimeout(() => { showPage('ownerLoginPage'); }, 2000);
}

function handleOwnerLogin(event) {
    event.preventDefault();
    const email = document.getElementById('ownerLoginEmail').value;
    const password = document.getElementById('ownerLoginPassword').value;

    const ownerUser = window.db.approvedOwners.find(user => user.email === email && user.password === password);

    if (ownerUser) {
        currentLoggedInUser = ownerUser;
        console.log('Owner logged in successfully:', currentLoggedInUser);
        document.getElementById('ownerLoginMessage').classList.add('hidden');
        showPage('ownerDashboard');
        showOwnerSection('overview');
    } else {
        const messageEl = document.getElementById('ownerLoginMessage');
        messageEl.textContent = 'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو لم تتم الموافقة على حسابك بعد.';
        messageEl.className = 'message error';
        messageEl.classList.remove('hidden');
    }
}

function handleAdminLogin(event) {
    event.preventDefault();
    const email = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;

    const adminUser = window.db.approvedOwners.find(user => 
        user.email === email && 
        user.password === password && 
        user.role === 'admin'
    );

    if (adminUser) {
        currentLoggedInUser = adminUser;
        console.log('Admin logged in successfully:', currentLoggedInUser);
        document.getElementById('loginMessage').classList.add('hidden');
        showPage('adminDashboard');
        showAdminSection('overview');
    } else {
        const messageEl = document.getElementById('loginMessage');
        messageEl.textContent = 'بيانات تسجيل دخول الإدارة غير صحيحة.';
        messageEl.className = 'message error';
        messageEl.classList.remove('hidden');
    }
}

function logout() {
    window.syncManager.stopPolling();
    currentLoggedInUser = null;
    showPage('mainMenuPage');
}

// --- Admin Dashboard Logic ---
function showAdminSection(section) {
    const content = document.getElementById('adminContent');
    content.innerHTML = '';

    switch(section) {
        case 'overview': content.innerHTML = '<h2>نظرة عامة</h2>' + renderAdminStats(); break;
        case 'approvals': content.innerHTML = '<h2>الموافقة على الحسابات</h2>'; content.innerHTML += renderPendingOwners(); break;
        case 'users': content.innerHTML = '<h2>إدارة الحسابات</h2>'; content.innerHTML += renderAllUsers(); break;
        case 'venues': content.innerHTML = '<h2>إدارة المنشآت</h2>'; content.innerHTML += renderAllVenues(); break;
        case 'add-venue': content.innerHTML = '<h2>إضافة منشأة جديدة</h2>'; content.innerHTML += renderAddVenueForm('admin'); break;
        case 'bookings': content.innerHTML = '<h2>إدارة الحجوزات</h2>'; content.innerHTML += renderAllBookings(); break;
        case 'tournaments': content.innerHTML = '<h2>إدارة البطولات</h2>'; content.innerHTML += renderAllTournaments(); break;
        case 'products': content.innerHTML = '<h2>إدارة المنتجات</h2>'; content.innerHTML += renderProductsManagement(); break;
        case 'discounts': content.innerHTML = '<h2>إدارة الخصومات</h2>'; content.innerHTML += renderDiscountManagement(); break;
    }
    document.querySelectorAll('.admin-sidebar a').forEach(link => link.classList.remove('active'));
    document.querySelector(`.admin-sidebar a[onclick="showAdminSection('${section}')"]`).classList.add('active');
}

function renderAdminStats() {
    const stats = [
        { label: 'المنشآت', value: window.db.publishedVenues.length },
        { label: 'الحجوزات', value: window.db.allBookings.length },
        { label: 'المالكون الموافق عليهم', value: window.db.approvedOwners.length },
        { label: 'حسابات تنتظر الموافقة', value: window.db.pendingOwnerAccounts.length }
    ];
    let html = '<div class="stats-grid">';
    stats.forEach(stat => { html += `<div class="stat-card"><h3>${stat.value}</h3><p>${stat.label}</p></div>`; });
    html += '</div>';
    return html;
}

function renderPendingOwners() {
    let html = '<div class="table-container"><table class="admin-table"><thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الهاتف</th><th>الإجراءات</th></tr></thead><tbody>';
    if (window.db.pendingOwnerAccounts.length === 0) {
        html += '<tr><td colspan="4" class="text-center">لا توجد حسابات تنتظر الموافقة حالياً.</td></tr>';
    } else {
        window.db.pendingOwnerAccounts.forEach(owner => {
            html += `
                <tr>
                    <td>${owner.name}</td>
                    <td>${owner.email}</td>
                    <td>${owner.phone}</td>
                    <td class="actions">
                        <button class="btn btn-success btn-sm" onclick="approveOwner(${owner.id})">
                            <i class="fas fa-check"></i> موافقة
                        </button>
                    </td>
                </tr>
            `;
        });
    }
    html += '</tbody></table></div>';
    return html;
}

function approveOwner(ownerId) {
    const ownerIndex = window.db.pendingOwnerAccounts.findIndex(o => o.id === ownerId);
    if (ownerIndex > -1) {
        const ownerToApprove = window.db.pendingOwnerAccounts.splice(ownerIndex, 1)[0];
        window.db.approvedOwners.push(ownerToApprove);
        saveData(window.db);
        addNotification(`تمت الموافقة على حساب المالك الجديد: ${ownerToApprove.name}`);
        showAdminSection('approvals');
        showNotification('تمت الموافقة على الحساب بنجاح.', 'success');
    }
}

function renderAllUsers() {
    let html = '<div class="table-container"><table class="admin-table"><thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الدور</th><th>الإجراءات</th></tr></thead><tbody>';
    window.db.approvedOwners.forEach(user => {
        html += `
            <tr>
                <td>${user.name}</td>
                <td>${user.email}</td>
                <td>${user.role === 'admin' ? 'مدير' : 'مالك'}</td>
                <td class="actions">
                    ${user.role !== 'admin' ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${user.id}, 'owner')"><i class="fas fa-trash"></i> حذف</button>` : '-'}
                </td>
            </tr>
        `;
    });
    html += '</tbody></table></div>';
    return html;
}

function deleteUser(userId, userType) {
    if (confirm('هل أنت متأكد أنك تريد حذف هذا المستخدم؟')) {
        if (userType === 'owner') {
            window.db.approvedOwners = window.db.approvedOwners.filter(u => u.id !== userId);
        }
        saveData(window.db);
        showAdminSection('users');
        showNotification('تم حذف المستخدم بنجاح.', 'success');
    }
}

function renderAllVenues() {
    let html = '<div class="table-container"><table class="admin-table"><thead><tr><th>اسم المنشأة</th><th>الرياضة</th><th>المالك</th><th>الإجراءات</th></tr></thead><tbody>';
    window.db.publishedVenues.forEach(venue => {
        const owner = window.db.approvedOwners.find(o => o.id === venue.ownerId);
        html += `
            <tr>
                <td>${venue.name}</td>
                <td>${getSportName(venue.sport)}</td>
                <td>${owner ? owner.name : 'N/A'}</td>
                <td class="actions">
                    <button class="btn btn-danger btn-sm" onclick="deleteVenue(${venue.id})"><i class="fas fa-trash"></i> حذف</button>
                </td>
            </tr>
        `;
    });
    html += '</tbody></table></div>';
    return html;
}

function getSportName(sportKey) {
    const sports = {
        football: 'كرة القدم',
        volleyball: 'كرة الطائرة',
        basketball: 'كرة السلة',
        tennis: 'تنس الطاولة',
        swimming: 'السباحة',
        esports: 'الرياضات الإلكترونية'
    };
    return sports[sportKey] || sportKey;
}

function deleteVenue(venueId) {
    if (confirm('هل أنت متأكد أنك تريد حذف هذه المنشأة؟')) {
        window.db.publishedVenues = window.db.publishedVenues.filter(v => v.id !== venueId);
        saveData(window.db);
        showAdminSection('venues');
        showNotification('تم حذف المنشأة بنجاح.', 'success');
    }
}

function renderAddVenueForm(role) {
    return `
        <form id="addVenueForm" onsubmit="handleAddVenue(event, '${role}')">
            <div class="form-group"><label for="venueName">اسم المنشأة</label><input type="text" id="venueName" required></div>
            <div class="form-group"><label for="venueSport">الرياضة</label><select id="venueSport" required onchange="toggleVenueSpecificFields()"><option value="football">كرة القدم</option><option value="volleyball">كرة الطائرة</option><option value="basketball">كرة السلة</option><option value="tennis">تنس الطاولة</option><option value="swimming">السباحة</option><option value="esports">الرياضات الإلكترونية</option></select></div>
            <div class="form-group"><label for="venueCity">المدينة</label><input type="text" id="venueCity" required></div>
            <div class="form-group"><label for="venueLocation">الموقع (عنوان تفصيلي)</label><input type="text" id="venueLocation" required></div>
            <div class="form-group"><label for="venueContact">معلومات التواصل</label><input type="text" id="venueContact" required></div>
            <div class="form-group"><label for="venueLat">خط العرض (Latitude)</label><input type="number" step="any" id="venueLat" required></div>
            <div class="form-group"><label for="venueLng">خط الطول (Longitude)</label><input type="number" step="any" id="venueLng" required></div>
            <div class="form-group"><label for="venueDetails">تفاصيل إضافية</label><textarea id="venueDetails"></textarea></div>
            <div id="venueSpecificFields">
                <div class="form-group"><label for="venueSurface">نوع السطح</label><select id="venueSurface"><option value="عشب طبيعي">عشب طبيعي</option><option value="عشب صناعي">عشب صناعي</option><option value="باركيه">باركيه</option></select></div>
                <div class="form-group"><label for="venueSize">الحجم</label><select id="venueSize"><option value="5vs5">5 ضد 5</option><option value="7vs7">7 ضد 7</option><option value="11vs11">11 ضد 11</option></select></div>
                <div class="form-group"><label for="venueLights">إضاءة ليلية</label><select id="venueLights"><option value="true">متوفرة</option><option value="false">غير متوفرة</option></select></div>
            </div>
            <div id="esportsSpecificFields" class="hidden">
                <div class="form-group"><label for="venueEquipmentCount">عدد الأجهزة</label><input type="number" id="venueEquipmentCount"></div>
                <div class="form-group"><label>الألعاب المتوفرة</label>
                    <div class="checkbox-group">
                        <label><input type="checkbox" value="FIFA"> FIFA</label>
                        <label><input type="checkbox" value="PES"> PES</label>
                        <label><input type="checkbox" value="Call of Duty"> Call of Duty</label>
                        <label><input type="checkbox" value="Fortnite"> Fortnite</label>
                    </div>
                </div>
            </div>
            <div class="form-group"><label for="venueOpeningHour">ساعة الافتتاح</label><input type="number" id="venueOpeningHour" min="0" max="23" value="8" required></div>
            <div class="form-group"><label for="venueClosingHour">ساعة الإغلاق</label><input type="number" id="venueClosingHour" min="0" max="23" value="23" required></div>
            <div class="form-group"><label for="venueSlotDuration">مدة الحجز (بالدقائق)</label><input type="number" id="venueSlotDuration" value="60" required></div>
            <div class="form-group"><label for="venuePriceOffPeak">السعر (خارج أوقات الذروة) ريال عماني</label><input type="number" id="venuePriceOffPeak" step="0.1" required></div>
            <div class="form-group"><label for="venuePricePeak">السعر (أوقات الذروة) ريال عماني</label><input type="number" id="venuePricePeak" step="0.1" required></div>
            <div class="btn-group">
                <button type="submit" class="btn btn-primary"><i class="fas fa-plus-circle"></i> إضافة المنشأة</button>
            </div>
        </form>
    `;
}

function toggleVenueSpecificFields() {
    const sport = document.getElementById('venueSport').value;
    const venueFields = document.getElementById('venueSpecificFields');
    const esportsFields = document.getElementById('esportsSpecificFields');
    if (sport === 'esports') {
        venueFields.classList.add('hidden');
        esportsFields.classList.remove('hidden');
    } else {
        venueFields.classList.remove('hidden');
        esportsFields.classList.add('hidden');
    }
}

function handleAddVenue(event, role) {
    event.preventDefault();
    const newVenue = {
        id: Date.now(),
        name: document.getElementById('venueName').value,
        sport: document.getElementById('venueSport').value,
        city: document.getElementById('venueCity').value,
        location: document.getElementById('venueLocation').value,
        contact: document.getElementById('venueContact').value,
        lat: parseFloat(document.getElementById('venueLat').value),
        lng: parseFloat(document.getElementById('venueLng').value),
        details: document.getElementById('venueDetails').value,
        openingHour: parseInt(document.getElementById('venueOpeningHour').value),
        closingHour: parseInt(document.getElementById('venueClosingHour').value),
        slotDuration: parseInt(document.getElementById('venueSlotDuration').value),
        priceOffPeak: parseFloat(document.getElementById('venuePriceOffPeak').value),
        pricePeak: parseFloat(document.getElementById('venuePricePeak').value),
    };
    
    if (newVenue.sport === 'esports') {
        newVenue.equipmentCount = document.getElementById('venueEquipmentCount').value;
        const checkboxes = document.querySelectorAll('#esportsSpecificFields input[type="checkbox"]:checked');
        newVenue.availableGames = Array.from(checkboxes).map(cb => cb.value);
    } else {
        newVenue.surface = document.getElementById('venueSurface').value;
        newVenue.size = document.getElementById('venueSize').value;
        newVenue.lights = document.getElementById('venueLights').value === 'true';
    }
    
    newVenue.ownerId = currentLoggedInUser.id;
    window.db.publishedVenues.push(newVenue);
    saveData(window.db);
    showNotification('تمت إضافة المنشأة بنجاح.', 'success');
    
    if (role === 'admin') {
        showAdminSection('venues');
    } else {
        showOwnerSection('venues');
    }
    
    const currentPage = document.querySelector('body > div:not(.hidden)');
    if (currentPage && currentPage.id === 'playerInterface') {
        displayVenuesForPlayer();
        updateVenueMarkers();
    }
}

function renderAllBookings() {
    let html = '<div class="table-container"><table class="admin-table"><thead><tr><th>اللاعب</th><th>المنشأة</th><th>التاريخ</th><th>الوقت</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>';
    window.db.allBookings.forEach(booking => {
        html += `
            <tr>
                <td>${booking.playerName}</td>
                <td>${booking.venue.name}</td>
                <td>${booking.date}</td>
                <td>${booking.time}</td>
                <td><span class="status-badge ${booking.paymentStatus === 'confirmed' ? 'success' : 'pending'}">${booking.paymentStatus === 'confirmed' ? 'مؤكد' : 'في الانتظار'}</span></td>
                <td class="actions">
                    <button class="btn btn-danger btn-sm" onclick="deleteBooking(${booking.id})"><i class="fas fa-trash"></i> حذف</button>
                </td>
            </tr>
        `;
    });
    html += '</tbody></table></div>';
    return html;
}

function deleteBooking(bookingId) {
    if (confirm('هل أنت متأكد أنك تريد حذف هذا الحجز؟')) {
        window.db.allBookings = window.db.allBookings.filter(b => b.id !== bookingId);
        saveData(window.db);
        showAdminSection('bookings');
        showNotification('تم حذف الحجز بنجاح.', 'success');
    }
}

function renderAllTournaments() {
    let html = '<div class="table-container"><table class="admin-table"><thead><tr><th>اسم البطولة</th><th>الرياضة</th><th>المنشأة</th><th>التاريخ</th><th>الإجراءات</th></tr></thead><tbody>';
    window.db.tournaments.forEach(tournament => {
        const venue = window.db.publishedVenues.find(v => v.id === tournament.venueId);
        html += `
            <tr>
                <td>${tournament.name}</td>
                <td>${getSportName(tournament.sport)}</td>
                <td>${venue ? venue.name : 'N/A'}</td>
                <td>${tournament.date}</td>
                <td class="actions">
                    <button class="btn btn-danger btn-sm" onclick="deleteTournament(${tournament.id})"><i class="fas fa-trash"></i> حذف</button>
                </td>
            </tr>
        `;
    });
    html += '</tbody></table></div>';
    return html;
}

function deleteTournament(tournamentId) {
    if (confirm('هل أنت متأكد أنك تريد حذف هذه البطولة؟')) {
        window.db.tournaments = window.db.tournaments.filter(t => t.id !== tournamentId);
        saveData(window.db);
        showAdminSection('tournaments');
        showNotification('تم حذف البطولة بنجاح.', 'success');
    }
}

function renderProductsManagement() {
    let html = `
        <div class="management-header">
            <h3>المنتجات الحالية</h3>
            <button class="btn btn-primary" onclick="showAddProductForm()"><i class="fas fa-plus"></i> إضافة منتج جديد</button>
        </div>
        <div class="products-table-container">
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>الصورة</th>
                        <th>الاسم</th>
                        <th>الفئة</th>
                        <th>السعر</th>
                        <th>الحالة</th>
                        <th>الإجراءات</th>
                    </tr>
                </thead>
                <tbody>
    `;
    if (window.db.products.length === 0) {
        html += '<tr><td colspan="6" class="text-center">لا توجد منتجات حالياً.</td></tr>';
    } else {
        window.db.products.forEach(product => {
            html += `
                <tr>
                    <td><img src="${product.image || 'https://via.placeholder.com/50'}" alt="${product.name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px;"></td>
                    <td>${product.name}</td>
                    <td>${getCategoryName(product.category)}</td>
                    <td>${product.price} ريال عماني</td>
                    <td><span class="status-badge ${product.inStock ? 'in-stock' : 'out-of-stock'}">${product.inStock ? 'متوفر' : 'نفد المخزون'}</span></td>
                    <td class="actions">
                        <button class="btn btn-secondary btn-sm" onclick="editProduct(${product.id})"><i class="fas fa-edit"></i> تعديل</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteProduct(${product.id})"><i class="fas fa-trash"></i> حذف</button>
                    </td>
                </tr>
            `;
        });
    }
    html += `</tbody></table></div><div id="addProductFormContainer" class="hidden"></div>`;
    return html;
}

function handleAddProduct(event) {
    event.preventDefault();

    if (!window.db || !window.db.products) {
        console.error("Database not loaded yet.");
        return;
    }

    const name = document.getElementById('productName').value.trim();
    const category = document.getElementById('productCategory').value;
    const price = parseFloat(document.getElementById('productPrice').value);
    const description = document.getElementById('productDescription').value.trim();
    const image = document.getElementById('productImage').value.trim();
    const stock = parseInt(document.getElementById('productStock').value);

    const newProduct = {
        id: Date.now(),
        name,
        category,
        price,
        description,
        image,
        stock,
        inStock: stock > 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        type: "products"
    };

    // إضافة المنتج إلى قاعدة البيانات
    window.db.products.push(newProduct);

    // الحفظ في Google Sheets
    saveDataToGoogleSheets(window.db).then(() => {
        showNotification('تمت إضافة المنتج بنجاح.', 'success');
        hideAddProductForm();
        showAdminSection('products');
    });
}

function hideAddProductForm() {
    document.getElementById('addProductFormContainer').classList.add('hidden');
}

function handleAddProduct(event) {
    event.preventDefault();

    // إنشاء المنتج الجديد
    const newProduct = {
        id: Date.now(),
        name: document.getElementById('productName').value,
        category: document.getElementById('productCategory').value,
        price: parseFloat(document.getElementById('productPrice').value),
        description: document.getElementById('productDescription').value,
        image: document.getElementById('productImage').value,
        stock: parseInt(document.getElementById('productStock').value),
        inStock: parseInt(document.getElementById('productStock').value) > 0,
        createdAt: new Date().toISOString(),

        // 🔥 مهم جداً لإظهار المنتج فقط لصاحبه عند الحذف:
        ownerId: currentLoggedInUser.id
    };

    // إضافة المنتج إلى قاعدة البيانات العامة
    window.db.products.push(newProduct);

    // حفظ البيانات حتى تظهر عند الجميع
    saveData(window.db);

    // إشعار النجاح
    showNotification('تم إضافة المنتج بنجاح.', 'success');

    // إعادة ضبط الفورم
    hideAddProductForm();

    // تحديث قائمة المنتجات مباشرة
    showAdminSection('products');
}


function editProduct(productId) {
    alert('سيتم تطوير هذه الميزة قريباً');
}

function deleteProduct(productId) {
    // العثور على المنتج
    const product = window.db.products.find(p => p.id === productId);

    // إذا المنتج غير موجود
    if (!product) {
        showNotification('خطأ: المنتج غير موجود.', 'error');
        return;
    }

    // منع أي شخص من حذف منتج ليس ملكه
    if (product.ownerId !== currentLoggedInUser.id && currentLoggedInUser.role !== 'admin') {
        showNotification('لا يمكنك حذف منتج لم تقم بإنشائه.', 'error');
        return;
    }

    if (confirm('هل أنت متأكد أنك تريد حذف هذا المنتج؟')) {

        // حذف المنتج من قاعدة البيانات
        window.db.products = window.db.products.filter(p => p.id !== productId);

        // تحديث البيانات للجميع
        saveData(window.db);

        // تحديث صفحة الإدارة
        showAdminSection('products');

        showNotification('تم حذف المنتج بنجاح.', 'success');
    }
}

function renderDiscountManagement() {
    let html = `
        <div class="management-header">
            <h3>أكواد الخصم الحالية</h3>
            <button class="btn btn-primary" onclick="document.getElementById('createDiscountForm').classList.toggle('hidden')"><i class="fas fa-plus"></i> إنشاء كود جديد</button>
        </div>
        <div class="table-container">
            <table class="admin-table">
                <thead><tr><th>الكود</th><th>نسبة الخصم (%)</th><th>الإجراءات</th></tr></thead>
                <tbody>
    `;
    if (window.db.discountCodes.length === 0) {
        html += '<tr><td colspan="3" class="text-center">لا توجد أكواد خصم حالياً.</td></tr>';
    } else {
        window.db.discountCodes.forEach(discount => {
            html += `
                <tr>
                    <td>${discount.code}</td>
                    <td>${discount.percent}</td>
                    <td class="actions">
                        <button class="btn btn-danger btn-sm" onclick="deleteDiscount(${discount.id})"><i class="fas fa-trash"></i> حذف</button>
                    </td>
                </tr>
            `;
        });
    }
    html += `</tbody></table></div><div id="createDiscountForm" class="hidden"><h3>إنشاء كود خصم جديد</h3><form onsubmit="createAdminDiscount(event)"><div class="form-group"><label for="discountCode">الكود</label><input type="text" id="discountCode" required></div><div class="form-group"><label for="discountPercent">نسبة الخصم (%)</label><input type="number" id="discountPercent" min="1" max="100" required></div><button type="submit" class="btn btn-primary">إنشاء</button></form></div>`;
    return html;
}

function createAdminDiscount(event) {
    event.preventDefault();
    const newDiscount = {
        id: Date.now(),
        code: document.getElementById('discountCode').value,
        percent: parseInt(document.getElementById('discountPercent').value)
    };
    window.db.discountCodes.push(newDiscount);
    saveData(window.db);
    showNotification('تم إنشاء كود الخصم بنجاح.', 'success');
    showAdminSection('discounts');
}

function deleteDiscount(discountId) {
    if (confirm('هل أنت متأكد أنك تريد حذف هذا الكود؟')) {
        window.db.discountCodes = window.db.discountCodes.filter(d => d.id !== discountId);
        saveData(window.db);
        showAdminSection('discounts');
        showNotification('تم حذف كود الخصم بنجاح.', 'success');
    }
}

// --- Owner Dashboard Logic ---
function showOwnerSection(section) {
    const content = document.getElementById('ownerContent');
    content.innerHTML = '';
    switch(section) {
        case 'overview': content.innerHTML = '<h2>نظرة عامة</h2>' + renderOwnerStats(); break;
        case 'venues': content.innerHTML = '<h2>المنشآت الخاصة بي</h2>'; content.innerHTML += renderOwnerVenues(); break;
        case 'add-venue': content.innerHTML = '<h2>إضافة منشأة جديدة</h2>'; content.innerHTML += renderAddVenueForm('owner'); break;
        case 'bookings': content.innerHTML = '<h2>إدارة الحجوزات</h2>'; content.innerHTML += renderOwnerBookings(); break;
        case 'tournaments': content.innerHTML = '<h2>إدارة البطولات</h2>'; content.innerHTML += renderOwnerTournaments(); break;
    }
    document.querySelectorAll('.owner-sidebar a').forEach(link => link.classList.remove('active'));
    document.querySelector(`.owner-sidebar a[onclick="showOwnerSection('${section}')"]`).classList.add('active');
}

function renderOwnerStats() {
    const ownerVenues = window.db.publishedVenues.filter(v => v.ownerId === currentLoggedInUser.id);
    const ownerBookings = window.db.allBookings.filter(b => b.venue && b.venue.ownerId === currentLoggedInUser.id);
    const stats = [
        { label: 'منشآتي', value: ownerVenues.length },
        { label: 'حجوزاتي', value: ownerBookings.length },
        { label: 'إجمالي الإيرادات', value: ownerBookings.reduce((sum, b) => sum + (b.finalPrice || 0), 0).toFixed(2) + ' ريال عماني' }
    ];
    let html = '<div class="stats-grid">';
    stats.forEach(stat => { html += `<div class="stat-card"><h3>${stat.value}</h3><p>${stat.label}</p></div>`; });
    html += '</div>';
    return html;
}

function renderOwnerVenues() {
    const ownerVenues = window.db.publishedVenues.filter(v => v.ownerId === currentLoggedInUser.id);
    let html = '<div class="venues-grid">';
    if (ownerVenues.length === 0) {
        html += '<p class="text-center">لم تقم بإضافة أي منشآت بعد.</p>';
    } else {
        ownerVenues.forEach(venue => {
            html += `
                <div class="venue-card">
                    <div class="venue-image-placeholder"><i class="fas fa-building"></i></div>
                    <div class="venue-card-body">
                        <h3>${venue.name}</h3>
                        <p><i class="fas fa-map-marker-alt"></i> ${venue.location}</p>
                        <p><i class="fas fa-running"></i> ${getSportName(venue.sport)}</p>
                        <div class="actions">
                            <button class="btn btn-danger btn-sm" onclick="deleteOwnerVenue(${venue.id})"><i class="fas fa-trash"></i> حذف</button>
                        </div>
                    </div>
                </div>
            `;
        });
    }
    html += '</div>';
    return html;
}

function deleteOwnerVenue(venueId) {
    if (confirm('هل أنت متأكد أنك تريد حذف هذه المنشأة؟')) {
        window.db.publishedVenues = window.db.publishedVenues.filter(v => v.id !== venueId);
        saveData(window.db);
        showOwnerSection('venues');
        showNotification('تم حذف المنشأة بنجاح.', 'success');
    }
}

function renderOwnerBookings() {
    const ownerBookings = window.db.allBookings.filter(b => b.venue && b.venue.ownerId === currentLoggedInUser.id);
    let html = '<div class="table-container"><table class="admin-table"><thead><tr><th>اللاعب</th><th>المنشأة</th><th>التاريخ</th><th>الوقت</th><th>الحالة</th></tr></thead><tbody>';
    if (ownerBookings.length === 0) {
        html += '<tr><td colspan="5" class="text-center">لا توجد حجوزات على منشآتك.</td></tr>';
    } else {
        ownerBookings.forEach(booking => {
            html += `
                <tr>
                    <td>${booking.playerName}</td>
                    <td>${booking.venue.name}</td>
                    <td>${booking.date}</td>
                    <td>${booking.time}</td>
                    <td><span class="status-badge ${booking.paymentStatus === 'confirmed' ? 'success' : 'pending'}">${booking.paymentStatus === 'confirmed' ? 'مؤكد' : 'في الانتظار'}</span></td>
                </tr>
            `;
        });
    }
    html += '</tbody></table></div>';
    return html;
}

function renderOwnerTournaments() {
    const ownerTournaments = window.db.tournaments.filter(t => t.ownerId === currentLoggedInUser.id);
    let html = '<div class="tournaments-list">';
    if (ownerTournaments.length === 0) {
        html += '<p class="text-center">لم تقم بإنشاء أي بطولات بعد.</p>';
    } else {
        ownerTournaments.forEach(tournament => {
            const venue = window.db.publishedVenues.find(v => v.id === tournament.venueId);
            html += `
                <div class="tournament-card">
                    <h4>${tournament.name}</h4>
                    <p><i class="fas fa-running"></i> ${getSportName(tournament.sport)}</p>
                    <p><i class="fas fa-map-marker-alt"></i> ${venue ? venue.name : 'N/A'}</p>
                    <p><i class="fas fa-calendar"></i> ${tournament.date}</p>
                    <div class="actions">
                        <button class="btn btn-danger btn-sm" onclick="deleteTournament(${tournament.id})"><i class="fas fa-trash"></i> حذف</button>
                    </div>
                </div>
            `;
        });
    }
    html += '</div>';
    return html;
}

// --- Tournaments ---
function populateVenueSelect() {
    const select = document.getElementById('tournamentVenue');
    select.innerHTML = '';
    const ownerVenues = window.db.publishedVenues.filter(v => v.ownerId === currentLoggedInUser.id && v.sport === document.getElementById('tournamentSport').value);
    ownerVenues.forEach(venue => {
        const option = document.createElement('option');
        option.value = venue.id;
        option.textContent = venue.name;
        select.appendChild(option);
    });
}

function displayAllTournaments() {
    const container = document.getElementById('tournamentsListContainer');
    container.innerHTML = '';
    if (window.db.tournaments.length === 0) {
        container.innerHTML = '<p class="text-center">لا توجد بطولات متاحة حالياً.</p>';
        return;
    }
    window.db.tournaments.forEach(tournament => {
        const venue = window.db.publishedVenues.find(v => v.id === tournament.venueId);
        const card = document.createElement('div');
        card.className = 'tournament-card';
        card.innerHTML = `
            <h3>${tournament.name}</h3>
            <p><strong>الرياضة:</strong> ${getSportName(tournament.sport)}</p>
            <p><strong>المنشأة:</strong> ${venue ? venue.name : 'N/A'}</p>
            <p><strong>التاريخ:</strong> ${tournament.date}</p>
            <p><strong>رسوم التسجيل:</strong> ${tournament.fee} ريال عماني</p>
            <p>${tournament.details}</p>
        `;
        container.appendChild(card);
    });
}

// --- Initial Load & Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    showPage('mainMenuPage');
    window.db = loadData();
    renderNotifications();

    // **تغيير جديد: التأكد من وجود حساب مدير**
    const adminExists = window.db.approvedOwners.some(user => user.role === 'admin');
    if (!adminExists) {
        console.log("Admin user not found. Creating default admin...");
        window.db.approvedOwners.push({
            id: 1,
            name: 'مدير النظام',
            email: 'admin@mal3abi.com',
            password: 'admin123',
            role: 'admin'
        });
        // لا نحفظ هنا فوراً، بل ننتظر حتى نهاية الدالة
    }

    // ربط مستمعي الأحداث هنا لضمان تحميل الصفحة بالكامل أولاً
    document.getElementById('ownerRegistrationForm').addEventListener('submit', handleOwnerRegistration);
    document.getElementById('ownerLoginForm').addEventListener('submit', handleOwnerLogin);
    document.getElementById('adminLoginForm').addEventListener('submit', handleAdminLogin);
    document.getElementById('createTournamentForm').addEventListener('submit', function(e) { 
        e.preventDefault(); 
        const newTournament = {
            id: Date.now(),
            name: document.getElementById('tournamentName').value,
            sport: document.getElementById('tournamentSport').value,
            venueId: parseInt(document.getElementById('tournamentVenue').value),
            date: document.getElementById('tournamentDate').value,
            fee: parseFloat(document.getElementById('tournamentFee').value),
            details: document.getElementById('tournamentDetails').value,
            ownerId: currentLoggedInUser.id
        };
        window.db.tournaments.push(newTournament);
        saveData(window.db);
        showNotification('تم إنشاء البطولة بنجاح.', 'success');
        showPage('ownerDashboard');
        showOwnerSection('tournaments');
    });

    // إضافة البيانات التجريبية فقط إذا كانت القوائم فارغة
    if (window.db.publishedVenues.length === 0) {
        console.log("Adding dummy venues...");
        window.db.publishedVenues.push(
            { id: 101, name: 'ملعب الصقر', sport: 'football', city: 'مسقط', location: 'السيب', contact: '91234567', lat: 23.5859, lng: 58.4059, surface: 'عشب صناعي', size: '7vs7', lights: true, openingHour: 8, closingHour: 23, slotDuration: 60, priceOffPeak: 5, pricePeak: 8, ownerId: 1 },
            { id: 102, name: 'نادي الأبطال', sport: 'basketball', city: 'صحار', location: 'المنطقة الصناعية', contact: '98765432', lat: 22.9564, lng: 57.5321, surface: 'باركيه', size: '5vs5', lights: true, openingHour: 10, closingHour: 22, slotDuration: 60, priceOffPeak: 7, pricePeak: 10, ownerId: 1 }
        );
    }

    if (window.db.products.length === 0) {
        console.log("Adding dummy products...");
        window.db.products.push(
            { id: 201, name: 'كرة قدم احترافية', category: 'equipment', price: 25, description: 'كرة عالية الجودة من الجلد الطبيعي.', image: 'https://picsum.photos/seed/product201/300/200.jpg', stock: 10, inStock: true, createdAt: new Date().toISOString() },
            { id: 202, name: 'حذاء رياضي للجري', category: 'shoes', price: 40, description: 'مصمم للراحة والأداء العالي.', image: 'https://picsum.photos/seed/product202/300/200.jpg', stock: 5, inStock: true, createdAt: new Date().toISOString() },
            { id: 203, name: 'قميص رياضي', category: 'clothing', price: 15, description: 'قميص رياضي مريح ومناسب لكل التمارين.', image: 'https://picsum.photos/seed/product203/300/200.jpg', stock: 20, inStock: true, createdAt: new Date().toISOString() },
            { id: 204, name: 'حقيبة رياضية', category: 'accessories', price: 20, description: 'حقيبة متينة لحمل أغراضك الرياضية.', image: 'https://picsum.photos/seed/product204/300/200.jpg', stock: 15, inStock: true, createdAt: new Date().toISOString() }
        );
    }

    if (window.db.discountCodes.length === 0) {
        console.log("Adding dummy discount code...");
        window.db.discountCodes.push({ id: 1, code: 'WELCOME10', percent: 10 });
    }

    // إضافة إشعار الترحيب فقط إذا كانت قائمة الإشعارات فارغة
    if (window.db.notifications.length === 0) {
        console.log("Adding welcome notification...");
        addNotification('مرحباً بك في منصة ملعبي!');
    }

    // *** هذا هو السطر النهائي والمهم ***
    // Save all initial data to localStorage
    saveData(window.db);
});