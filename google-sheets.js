// --- Google Sheets Configuration ---
const SPREADSHEET_ID = '1N2l2Ko1zzZOXLySTJHXylEX3UY_TATZB3nnpF0NHMf0';
const API_KEY = 'AIzaSyAr9is4xy1PrwApMUse2n81sDEIolX2sGg'; 
const CLIENT_ID = '599190856853-amagititt48kn4jj4v13d7vv4em9dn2h.apps.googleusercontent.com';

const DISCOVERY_DOCS = [
    'https://sheets.googleapis.com/$discovery/rest?version=v4'
];

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';

// -----------------------------------------------------

let tokenClient;
let gapiInited = false;
let gisInited = false;

// --- Callback functions for Google API loading ---
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

function initializeGapiClient() {
    gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: DISCOVERY_DOCS,
    }).then(() => {
        gapiInited = true;
        maybeEnableButtons();
    });
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '', 
    });

    gisInited = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        console.log('Google APIs loaded successfully');
        document.dispatchEvent(new Event('googleApisReady'));
    }
}

// --- Authentication ---
function handleAuthClick() {
    tokenClient.callback = (resp) => {
        if (resp.error !== undefined) throw resp;

        console.log('Signed in successfully');
        document.getElementById('signin-button').innerText = 'تسجيل الخروج';

        if (window.syncManager) {
            window.syncManager.syncWithGoogleSheets();
        }
    };
    
    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
function handleAuthClick() {
    tokenClient.callback = (resp) => {
        if (resp.error !== undefined) throw resp;

        console.log('Signed in successfully');
        document.getElementById('signin-button').innerText = 'تسجيل الخروج';
    };

    if (gapi.client.getToken() === null) {
        // تسجيل الدخول
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {

        document.getElementById('signin-button').innerText = 'تسجيل الدخول لحفظ البيانات';

        if (window.syncManager) {
            window.syncManager.loadFromLocalStorage();
        }
    }
}

// --- Data Sync Functions ---
function loadDataFromGoogleSheets() {
    return gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,

        // ⚠️ تصحيح مهم: الورقة عندك اسمها Sheet1 وليس Data
        range: 'Sheet1!A:Z',
    }).then(response => {

        const values = response.result.values;
        if (values && values.length > 1) {
            const headers = values[0];
            const dataRows = values.slice(1);

            const db = {
                pendingOwnerAccounts: [],
                approvedOwners: [],
                publishedVenues: [],
                allBookings: [],
                tournaments: [],
                reviews: [],
                discountCodes: [],
                notifications: [],
                chatMessages: [],
                products: []
            };

            // تحويل الصفوف إلى كائنات
            dataRows.forEach(row => {
                const obj = {};
                headers.forEach((header, index) => {
                    let value = row[index];
                    if (value) {
                        try { value = JSON.parse(value); } 
                        catch { /* keep string */ }
                    }
                    obj[header] = value;
                });

                if (obj.type && db[obj.type]) {
                    db[obj.type].push(obj);
                }
            });
            
            console.log('Data loaded:', db);
            return db;
        } else {
            console.log('No data in sheet.');
            return null;
        }
    });
}

// --- Save Data ---
function saveDataToGoogleSheets(db) {
    const headers = [
        'type', 'id', 'name', 'email', 'password', 'phone', 'sport', 
        'city', 'contact', 'location', 'lat', 'lng', 'surface', 'size', 
        'lights', 'priceOffPeak', 'pricePeak', 'details', 'openingHour', 
        'closingHour', 'slotDuration', 'equipmentCount', 'availableGames', 
        'ownerId', 'ownerName', 'playerName', 'date', 'time', 'finalPrice', 
        'finalPriceUSD', 'paymentMethod', 'paymentStatus', 'paypalTransactionId', 
        'fee', 'registeredPlayers', 'rating', 'comment', 'code', 'percent', 
        'text', 'read', 'bookingId', 'sender', 'timestamp', 'imageUrl', 
        'category', 'stock', 'image', 'description', 'features', 'inStock', 
        'createdAt', 'updatedAt'
    ];

    const allObjects = [
        ...db.pendingOwnerAccounts.map(o => ({...o, type: 'pendingOwnerAccounts'})),
        ...db.approvedOwners.map(o => ({...o, type: 'approvedOwners'})),
        ...db.publishedVenues.map(v => ({...v, type: 'publishedVenues'})),
        ...db.allBookings.map(b => ({...b, type: 'allBookings'})),
        ...db.tournaments.map(t => ({...t, type: 'tournaments'})),
        ...db.reviews.map(r => ({...r, type: 'reviews'})),
        ...db.discountCodes.map(d => ({...d, type: 'discountCodes'})),
        ...db.notifications.map(n => ({...n, type: 'notifications'})),
        ...db.chatMessages.map(m => ({...m, type: 'chatMessages'})),
        ...db.products.map(p => ({...p, type: 'products'}))
    ];

    const values = [headers];

    allObjects.forEach(obj => {
        const row = headers.map(h => {
            let v = obj[h];
            if (v === undefined || v === null) return '';
            if (typeof v === 'object') return JSON.stringify(v);
            return String(v);
        });
        values.push(row);
    });

    return gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,

        // ⚠️ نفس التصحيح
        range: 'Sheet1!A:Z',

        valueInputOption: 'RAW',
        resource: { values }
    }).then(r => {
        console.log(`${r.result.updatedCells} cells updated.`);
        return r;
    });
}

// -----------------------------------------------------
// 🔥 دالة حذف المنتج — أهم جزء
// -----------------------------------------------------
function deleteProduct(productId) {
    if (!window.db || !window.db.products) {
        console.error("DB not loaded yet.");
        return;
    }

    // حذف المنتج من المصفوفة
    window.db.products = window.db.products.filter(
        p => String(p.id) !== String(productId)
    );

    // تحديث Google Sheets مباشرة
    saveDataToGoogleSheets(window.db).then(() => {
        console.log("Product deleted and saved successfully.");
    });
}
