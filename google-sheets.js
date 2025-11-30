// --- Google Sheets Configuration ---
// !! هام: يجب عليك الحصول على هذه القيم من Google Cloud Console !!
const SPREADSHEET_ID = '1N2l2Ko1zzZOXLySTJHXylEX3UY_TATZB3nnpF0NHMf0';
const API_KEY = 'YOUR_API_KEY'; 
const CLIENT_ID = 'YOUR_CLIENT_ID'; 
const DISCOVERY_DOCS = ['https://sheets.googleapis.com/$discovery/rest?version=v4'];
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

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
        callback: '', // سيتم تعريفه لاحقًا
    });
    gisInited = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        console.log('Google APIs loaded successfully');
        // إعلام التطبيق بأن واجهات برمجة التطبيقات جاهزة
        document.dispatchEvent(new Event('googleApisReady'));
    }
}

// --- Authentication ---
function handleAuthClick() {
    tokenClient.callback = (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        console.log('Signed in successfully');
        document.getElementById('signin-button').innerText = 'تسجيل الخروج';
        // بعد تسجيل الدخول بنجاح، قم بمزامنة البيانات
        if (window.syncManager) {
            window.syncManager.syncWithGoogleSheets();
        }
    };
    
    if (gapi.client.getToken() === null) {
        // طلب رمز المصادقة
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        // المستخدم مسجل دخوله بالفعل، قم بتسجيل الخروج
        google.accounts.oauth2.revoke(gapi.client.getToken().access_token);
        gapi.client.setToken('');
        document.getElementById('signin-button').innerText = 'تسجيل الدخول لحفظ البيانات';
        console.log('Signed out');
        // بعد تسجيل الخروج، قم بتحميل البيانات من localStorage
        if (window.syncManager) {
            window.syncManager.loadFromLocalStorage();
        }
    }
}

// --- Data Sync Functions ---
function loadDataFromGoogleSheets() {
    return gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Data!A:Z', // استخدم ورقة عمل اسمها 'Data'
    }).then(response => {
        const values = response.result.values;
        if (values && values.length > 0 && values.length > 1) {
            const headers = values[0];
            const dataRows = values.slice(1);
            const db = {};

            // تهيئة كائن قاعدة البيانات
            headers.forEach(header => {
                if (header.includes('.')) { // مثل pendingOwnerAccounts
                    const key = header.split('.')[1];
                    db[key] = [];
                }
            });

            // تحويل الصفوف إلى كائنات
            dataRows.forEach(row => {
                const obj = {};
                headers.forEach((header, index) => {
                    const key = header.includes('.') ? header.split('.')[1] : header;
                    const value = row[index];
                    if (value) {
                        try {
                            obj[key] = JSON.parse(value);
                        } catch (e) {
                            obj[key] = value;
                        }
                    }
                });

                // إضافة الكائن إلى المصفوفة الصحيحة
                if (obj.type && db[obj.type]) {
                    db[obj.type].push(obj);
                }
            });
            
            console.log('Data loaded from Google Sheets:', db);
            return db;
        } else {
            console.log('No data found in Google Sheets.');
            return null;
        }
    }, response => {
        console.error('Error loading data from Google Sheets:', response.result.error.message);
        return null;
    });
}

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
        const row = [];
        headers.forEach(header => {
            let value = obj[header];
            if (value === undefined || value === null) value = '';
            if (typeof value === 'object') value = JSON.stringify(value);
            else value = String(value);
            row.push(value);
        });
        values.push(row);
    });

    const body = {
        values: values
    };

    return gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Data!A:Z', // استخدم ورقة عمل اسمها 'Data'
        valueInputOption: 'RAW',
        resource: body
    }).then(response => {
        console.log(`${response.result.updatedCells} cells updated in Google Sheets.`);
        return response;
    }, response => {
        console.error('Error updating Google Sheets:', response.result.error.message);
        return null;
    });
}