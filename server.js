const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8765;
const WEB_DIR = path.join(__dirname, '..', 'SkyTaxi-Web');
const DATA_FILE = path.join(__dirname, 'data.json');

const destinations = [
    { id: 'tun', name: 'Aéroport de Tunis-Carthage', code: 'TUN', city: 'Tunis', country: 'Tunisie' },
    { id: 'dje', name: 'Aéroport de Djerba-Zarzis', code: 'DJE', city: 'Djerba', country: 'Tunisie' },
    { id: 'sfa', name: 'Aéroport de Sfax-Thyna', code: 'SFA', city: 'Sfax', country: 'Tunisie' },
    { id: 'nbe', name: 'Aéroport Enfidha-Hammamet', code: 'NBE', city: 'Enfidha', country: 'Tunisie' },
    { id: 'mir', name: 'Aéroport de Monastir', code: 'MIR', city: 'Monastir', country: 'Tunisie' },
    { id: 'toe', name: 'Aéroport de Tozeur-Nefta', code: 'TOE', city: 'Tozeur', country: 'Tunisie' },
    { id: 'gaf', name: 'Aéroport de Gafsa-Ksar', code: 'GAF', city: 'Gafsa', country: 'Tunisie' },
    { id: 'tbj', name: 'Aéroport de Tabarka', code: 'TBJ', city: 'Tabarka', country: 'Tunisie' }
];

// Tecnam P2012 Traveller — caractéristiques techniques
const aircraft = {
    model: 'Tecnam P2012 Traveller',
    cruiseSpeedKmh: 315,      // 170 kts
    fuelConsumptionLph: 151,  // ~40 US gal/h pour les 2 moteurs Lycoming TEO-540
    fuelType: 'Avgas 100LL',
    mtowKg: 3680              // < 5,7 t
};

// Paramètres économiques — À AJUSTER AVEC VOS TARIFS RÉELS
const economics = {
    avgasPricePerLiter: 4.5,  // DT/litre (prix indicatif en Tunisie)
    hourlyRate: 1500          // DT/heure de vol (pilote, maintenance, assurance, amortissement)
};

// Barème indicatif des charges aéroportuaires tunisiennes pour appareil < 5,7 t
// À remplacer par les tarifs exacts de l'AIP Tunisie
const airportCharges = {
    landing: {
        base: 50,        // DT par mouvement
        perTon: 20,      // DT par tonne de MTOW
        min: 80,         // DT minimum par mouvement
        max: 300         // DT maximum par mouvement
    },
    handling: {
        perMovement: 120 // DT par mouvement (départ ou arrivée)
    }
};

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

function calculateAirportCharges() {
    const mtowTons = aircraft.mtowKg / 1000;
    const landing = Math.min(
        airportCharges.landing.max,
        Math.max(
            airportCharges.landing.min,
            airportCharges.landing.base + (mtowTons * airportCharges.landing.perTon)
        )
    );
    return {
        landing: Math.round(landing * 100) / 100,
        handling: airportCharges.handling.perMovement,
        total: Math.round((landing + airportCharges.handling.perMovement) * 100) / 100
    };
}

function estimatePriceDetail(departureId, arrivalId, passengers) {
    const departure = destinations.find(d => d.id === departureId);
    const arrival = destinations.find(d => d.id === arrivalId);
    if (!departure || !arrival) return null;

    const distance = distanceBetween(departure, arrival);
    const flightHours = distance / aircraft.cruiseSpeedKmh;

    const fuelCost = flightHours * aircraft.fuelConsumptionLph * economics.avgasPricePerLiter;
    const aircraftCost = flightHours * economics.hourlyRate;
    const departureCharges = calculateAirportCharges();
    const arrivalCharges = calculateAirportCharges();
    const totalAirportCharges = departureCharges.total + arrivalCharges.total;

    const total = fuelCost + aircraftCost + totalAirportCharges;

    return {
        departure,
        arrival,
        passengers,
        distance,
        flightHours: Math.round(flightHours * 100) / 100,
        aircraft,
        economics,
        fuelCost: Math.round(fuelCost * 100) / 100,
        aircraftCost: Math.round(aircraftCost * 100) / 100,
        departureCharges,
        arrivalCharges,
        airportChargesTotal: Math.round(totalAirportCharges * 100) / 100,
        total: Math.round(total * 100) / 100
    };
}

function estimatePrice(departureId, arrivalId, passengers) {
    const detail = estimatePriceDetail(departureId, arrivalId, passengers);
    return detail ? detail.total : null;
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
        const detail = estimatePriceDetail(departure, arrival, passengers);
        if (detail === null) {
            sendError(res, 400, 'Destinations invalides');
            return;
        }
        sendJson(res, 200, {
            price: detail.total,
            distance: detail.distance,
            detail
        });
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
