const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8765;
const WEB_DIR = path.join(__dirname, '..', 'SkyTaxi-Web');
const DATA_FILE = path.join(__dirname, 'data.json');

const destinations = [
    { id: 'tun', name: 'Aéroport de Tunis-Carthage', code: 'TUN', city: 'Tunis', country: 'Tunisie', basePrice: 320, pricePerKm: 4.2 },
    { id: 'dje', name: 'Aéroport de Djerba-Zarzis', code: 'DJE', city: 'Djerba', country: 'Tunisie', basePrice: 340, pricePerKm: 4.4 },
    { id: 'sfa', name: 'Aéroport de Sfax-Thyna', code: 'SFA', city: 'Sfax', country: 'Tunisie', basePrice: 330, pricePerKm: 4.3 },
    { id: 'nbe', name: 'Aéroport Enfidha-Hammamet', code: 'NBE', city: 'Enfidha', country: 'Tunisie', basePrice: 310, pricePerKm: 4.1 },
    { id: 'mir', name: 'Aéroport de Monastir', code: 'MIR', city: 'Monastir', country: 'Tunisie', basePrice: 315, pricePerKm: 4.15 },
    { id: 'toe', name: 'Aéroport de Tozeur-Nefta', code: 'TOE', city: 'Tozeur', country: 'Tunisie', basePrice: 350, pricePerKm: 4.6 },
    { id: 'gaf', name: 'Aéroport de Gafsa-Ksar', code: 'GAF', city: 'Gafsa', country: 'Tunisie', basePrice: 345, pricePerKm: 4.5 },
    { id: 'tbj', name: 'Aéroport de Tabarka', code: 'TBJ', city: 'Tabarka', country: 'Tunisie', basePrice: 335, pricePerKm: 4.35 }
];

const knownDistances = {
    'TUN-DJE': 335, 'TUN-SFA': 230, 'TUN-NBE': 90, 'TUN-MIR': 130, 'TUN-TOE': 370, 'TUN-GAF': 300, 'TUN-TBJ': 135,
    'DJE-SFA': 130, 'DJE-NBE': 260, 'DJE-MIR': 230, 'DJE-TOE': 280, 'DJE-GAF': 180, 'DJE-TBJ': 360,
    'SFA-NBE': 140, 'SFA-MIR': 120, 'SFA-TOE': 210, 'SFA-GAF': 100, 'SFA-TBJ': 240,
    'NBE-MIR': 70, 'NBE-TOE': 300, 'NBE-GAF': 230, 'NBE-TBJ': 220,
    'MIR-TOE': 280, 'MIR-GAF': 200, 'MIR-TBJ': 190,
    'TOE-GAF': 120, 'TOE-TBJ': 310,
    'GAF-TBJ': 220
};

function distanceBetween(a, b) {
    const key1 = `${a.code}-${b.code}`;
    const key2 = `${b.code}-${a.code}`;
    return knownDistances[key1] || knownDistances[key2] || 250;
}

function estimatePrice(departureId, arrivalId, passengers) {
    const departure = destinations.find(d => d.id === departureId);
    const arrival = destinations.find(d => d.id === arrivalId);
    if (!departure || !arrival) return null;

    const distance = distanceBetween(departure, arrival);
    const avgPricePerKm = (departure.pricePerKm + arrival.pricePerKm) / 2;
    const base = (departure.basePrice + arrival.basePrice) / 2;
    const distanceCost = distance * avgPricePerKm;
    const passengerMultiplier = 1 + ((passengers - 1) * 0.15);
    return (base + distanceCost) * passengerMultiplier;
}

function loadBookings() {
    if (!fs.existsSync(DATA_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function saveBookings(bookings) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2));
}

function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
    sendJson(res, status, { error: message });
}

function serveStatic(req, res) {
    let filePath;
    if (req.url === '/' || req.url === '/index.html') {
        filePath = path.join(WEB_DIR, 'index.html');
    } else if (req.url === '/admin') {
        filePath = path.join(__dirname, 'admin.html');
    } else {
        filePath = path.join(WEB_DIR, req.url);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
    };

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
    });
}

function parseBody(req, callback) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            callback(JSON.parse(body || '{}'));
        } catch {
            callback(null);
        }
    });
}

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // API routes
    if (pathname === '/api/destinations' && req.method === 'GET') {
        sendJson(res, 200, destinations);
        return;
    }

    if (pathname === '/api/estimate' && req.method === 'GET') {
        const departure = url.searchParams.get('departure');
        const arrival = url.searchParams.get('arrival');
        const passengers = parseInt(url.searchParams.get('passengers') || '1', 10);
        const price = estimatePrice(departure, arrival, passengers);
        if (price === null) {
            sendError(res, 400, 'Destinations invalides');
            return;
        }
        sendJson(res, 200, { price, distance: distanceBetween(
            destinations.find(d => d.id === departure),
            destinations.find(d => d.id === arrival)
        )});
        return;
    }

    if (pathname === '/api/stats' && req.method === 'GET') {
        const bookings = loadBookings();
        const confirmed = bookings.filter(b => b.status === 'confirmed');
        const cancelled = bookings.filter(b => b.status === 'cancelled');
        const revenue = confirmed.reduce((sum, b) => sum + b.estimatedPrice, 0);
        sendJson(res, 200, {
            total: bookings.length,
            confirmed: confirmed.length,
            cancelled: cancelled.length,
            revenue
        });
        return;
    }

    if (pathname === '/api/bookings' && req.method === 'GET') {
        sendJson(res, 200, loadBookings());
        return;
    }

    if (pathname === '/api/bookings' && req.method === 'POST') {
        parseBody(req, (body) => {
            if (!body || !body.departure || !body.arrival || !body.date || !body.passengers) {
                sendError(res, 400, 'Données incomplètes');
                return;
            }
            const price = estimatePrice(body.departure, body.arrival, parseInt(body.passengers, 10));
            if (price === null) {
                sendError(res, 400, 'Destinations invalides');
                return;
            }

            const departure = destinations.find(d => d.id === body.departure);
            const arrival = destinations.find(d => d.id === body.arrival);

            const booking = {
                id: crypto.randomUUID(),
                departure,
                arrival,
                date: body.date,
                passengers: parseInt(body.passengers, 10),
                estimatedPrice: price,
                status: 'confirmed',
                createdAt: new Date().toISOString()
            };

            const bookings = loadBookings();
            bookings.unshift(booking);
            saveBookings(bookings);
            sendJson(res, 201, booking);
        });
        return;
    }

    if (pathname.startsWith('/api/bookings/') && pathname.endsWith('/cancel') && req.method === 'PATCH') {
        const id = pathname.split('/')[3];
        const bookings = loadBookings();
        const booking = bookings.find(b => b.id === id);
        if (!booking) {
            sendError(res, 404, 'Réservation non trouvée');
            return;
        }
        booking.status = 'cancelled';
        saveBookings(bookings);
        sendJson(res, 200, booking);
        return;
    }

    if (pathname.startsWith('/api/bookings/') && req.method === 'DELETE') {
        const id = pathname.split('/')[3];
        let bookings = loadBookings();
        const before = bookings.length;
        bookings = bookings.filter(b => b.id !== id);
        if (bookings.length === before) {
            sendError(res, 404, 'Réservation non trouvée');
            return;
        }
        saveBookings(bookings);
        sendJson(res, 200, { deleted: true });
        return;
    }

    // Static files
    serveStatic(req, res);
});

server.listen(PORT, () => {
    console.log(`SkyTaxi server running at http://localhost:${PORT}`);
});
