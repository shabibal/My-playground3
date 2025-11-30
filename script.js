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
            products: JSON.parse(localStorage.getItem('products')) || []
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
    else if (currentPage.id === 'adminDashboard') showAdminSection('overview');
    else if (currentPage.id === 'ownerDashboard') showOwnerSection('overview');
    renderNotifications();
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
    venueMarkers.forEach(marker => map.removeLayer(marker));
    venueMarkers = [];
    window.db.publishedVenues.forEach(venue => {
        if (venue.sport === currentSport && venue.lat && venue.lng) {
            const marker = L.marker([venue.lat, venue.lng]).addTo(map).bindPopup(`
                <div style="text-align: right; direction: rtl;">
                    <h4>${venue.name}</h4>
                    <p><i class="fas fa-map-marker-alt"></i> ${venue.location}</p>
                    <p><i class="fas fa-phone"></i> ${venue.contact}</p>
                    <button class="btn btn-primary btn-sm" onclick="showVenueDetails(${venue.id})"><i class="fas fa-info-circle"></i> التفاصيل</button>
                </div>
            `);
            venueMarkers.push(marker);
        }
    });
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
    const pages = document.querySelectorAll('body > div'); pages.forEach(page => page.classList.add('hidden'));
    document.getElementById(pageId).classList.remove('hidden');
    const header = document.getElementById('appHeader');
    if (['playerInterface', 'venueDetailPage', 'paymentPage', 'tournamentsPage', 'chatPage', 'adminChatPage', 'sportsSelectionPage', 'productsPage', 'productDetailPage'].includes(pageId)) {
        header.classList.remove('hidden'); document.getElementById('headerUserName').textContent = 'ضيف';
    } else { header.classList.add('hidden'); }
    if (pageId === 'playerInterface') { displayVenuesForPlayer(); setTimeout(() => initializeMap(), 100); }
    if (pageId === 'venueDetailPage') { setTimeout(() => initializeVenueMap(), 100); }
    if (pageId === 'paymentPage') { renderPayPalButton(); }
    if (pageId === 'ownerDashboard') { showOwnerSection('overview'); }
    if (pageId === 'adminDashboard') { showAdminSection('overview'); }
    if (pageId === 'tournamentsPage') displayAllTournaments();
    if (pageId === 'createTournamentPage') populateVenueSelect();
    if (pageId === 'chatPage') loadChatMessages(currentPendingBookingId, 'user');
    if (pageId === 'adminChatPage') loadChatMessages(currentPendingBookingId, 'admin');
    if (pageId === 'productsPage') displayProducts();
}

// --- Sport Selection ---
function selectSport(sport) { currentSport = sport; showPage('playerInterface'); updatePlayerInterfaceHeader(); updateFiltersForSport(); displayVenuesForPlayer(); updateVenueMarkers(); }
function updatePlayerInterfaceHeader() { /* Update header text based on selected sport */ }
function updateFiltersForSport() { /* Populate filter dropdowns based on sport */ }

// --- Player Interface (Guest) ---
function displayVenuesForPlayer() { const venues = window.db.publishedVenues.filter(v => v.sport === currentSport); renderVenues(venues); }
function applyFilters() { /* Apply filters to venues list */ }
function renderVenues(venuesToRender) { /* Render venue cards in a grid */ }
function getSportIcon(sport) { /* Return appropriate icon for sport */ }

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

// --- Products Functions ---
function displayProducts() {
    const container = document.getElementById('productsGrid'); container.innerHTML = '';
    if (window.db.products.length === 0) { container.innerHTML = '<p class="text-center">لا توجد منتجات متاحة حالياً.</p>'; return; }
    window.db.products.forEach(product => {
        const productCard = document.createElement('div'); productCard.className = 'product-card'; productCard.onclick = () => showProductDetail(product.id);
        productCard.innerHTML = `<div class="product-image"><img src="${product.image || 'https://picsum.photos/seed/product' + product.id + '/300/200.jpg'}" alt="${product.name}"></div><div class="product-info"><h3>${product.name}</h3><p class="product-category">${getCategoryName(product.category)}</p><p class="product-price">${product.price} ريال عماني</p><p class="product-description">${product.description.substring(0, 80)}...</p></div>`;
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
    detailContent.innerHTML = `<div class="product-detail"><div class="product-detail-image"><img src="${product.image || 'https://picsum.photos/seed/product' + product.id + '/500/400.jpg'}" alt="${product.name}"></div><div class="product-detail-info"><h2>${product.name}</h2><p class="product-category">${getCategoryName(product.category)}</p><p class="product-price">${product.price} ريال عماني</p><div class="product-description"><h4>الوصف:</h4><p>${product.description}</p></div>${product.features ? `<div class="product-features"><h4>المميزات:</h4><ul>${product.features.map(f => `<li>${f}</li>`).join('')}</ul></div>` : ''}<div class="product-actions"><button class="btn btn-primary btn-lg"><i class="fas fa-shopping-cart"></i> أضف للسلة</button><button class="btn btn-secondary"><i class="fas fa-heart"></i> أضف للمفضلة</button></div></div></div>`;
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
document.getElementById('ownerRegistrationForm').addEventListener('submit', function(e) { e.preventDefault(); /* Handle owner registration */ });
document.getElementById('ownerLoginForm').addEventListener('submit', function(e) { e.preventDefault(); /* Handle owner login */ });
document.getElementById('adminLoginForm').addEventListener('submit', function(e) { e.preventDefault(); /* Handle admin login */ });
function logout() { window.syncManager.stopPolling(); currentLoggedInUser = null; showPage('mainMenuPage'); }

// --- Admin Dashboard Logic ---
function showAdminSection(section) { /* Show admin dashboard section */ }
function renderAdminStats() { /* Render admin statistics */ }
function renderPendingOwners() { /* Render pending owner accounts */ }
function renderAllUsers() { /* Render all users */ }
function deleteUser(userId, userType) { /* Delete a user */ }
function renderAllVenues() { /* Render all venues for admin */ }
function getSportName(sportKey) { /* Get sport name in Arabic */ }
function deleteVenue(venueId) { /* Delete a venue */ }
function renderAddVenueForm(role) { /* Render form to add venue */ }
function toggleVenueSpecificFields() { /* Toggle fields for esports venues */ }
function handleAddVenue(event, role) { /* Handle adding a new venue */ }
function renderAllBookings() { /* Render all bookings */ }
function deleteBooking(bookingId) { /* Delete a booking */ }
function renderAllTournaments() { /* Render all tournaments */ }
function renderProductsManagement() { /* Render products management page */ }
function showAddProductForm() { /* Show form to add product */ }
function hideAddProductForm() { /* Hide add product form */ }
function handleAddProduct(event) { /* Handle adding a new product */ }
function editProduct(productId) { /* Show form to edit product */ }
function handleEditProduct(event, productId) { /* Handle editing a product */ }
function deleteProduct(productId) { /* Delete a product */ }
function renderDiscountManagement() { /* Render discount codes management */ }
function createAdminDiscount(event) { /* Create a new discount code */ }
function deleteDiscount(discountId) { /* Delete a discount code */ }
function approveOwner(ownerId) { /* Approve an owner account */ }

// --- Owner Dashboard Logic ---
function showOwnerSection(section) { /* Show owner dashboard section */ }
function renderOwnerStats() { /* Render owner statistics */ }
function renderOwnerVenues() { /* Render owner's venues */ }
function deleteOwnerVenue(venueId) { /* Delete owner's venue */ }
function renderOwnerBookings() { /* Render owner's bookings */ }
function renderOwnerTournaments() { /* Render owner's tournaments */ }
function deleteTournament(tournamentId) { /* Delete a tournament */ }
function editTournament(tournamentId) { alert('سيتم تطوير هذه الميزة قريباً'); }

// --- Tournaments ---
document.getElementById('createTournamentForm').addEventListener('submit', function(e) { e.preventDefault(); /* Handle tournament creation */ });
function populateVenueSelect() { /* Populate venue select dropdown */ }
function displayAllTournaments() { /* Display all tournaments */ }

// --- Reviews ---
function getAverageRating(venueId) { /* Calculate average rating for a venue */ }
function generateStars(rating) { /* Generate star rating display */ }
function renderReviews(venueId) { /* Render reviews for a venue */ }

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    showPage('mainMenuPage');
    window.db = loadData();
    renderNotifications();
    // Add dummy data only if database is completely empty
    if (window.db.approvedOwners.length === 0 && window.db.publishedVenues.length === 0 && window.db.products.length === 0) {
        window.db.approvedOwners.push({ id:1, name:'أحمد العماني', email:'owner@test.com', password:'123', type:'owner' });
        window.db.publishedVenues.push(/* ... dummy venues ... */);
        window.db.products.push(/* ... dummy products ... */);
        window.db.discountCodes.push({ id:1, code:'WELCOME10', percent:10 });
        addNotification('مرحباً بك في منصة ملعبي!');
        saveData(window.db);
    }
});

// --- Google API Ready Listener ---
document.addEventListener('googleApisReady', () => {
    window.syncManager.isGoogleReady = true;
    if (window.syncManager.isSignedIn()) {
        console.log('User is already signed in. Starting polling.');
        window.syncManager.startPolling();
    }
});

// --- Stop Polling on Page Unload ---
window.addEventListener('beforeunload', () => {
    window.syncManager.stopPolling();
});