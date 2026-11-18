'use strict';

const qrcode = require('./qrcode');

const LIMIT = 140;

function clean(s) {
    return String(s == null ? '' : s)
        .toUpperCase()
        .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ẞ/g, 'SS').replace(/ß/g, 'SS')
        .replace(/[^0-9A-Z $%*+\-./:]/g, ' ')
        .replace(/ +/g, ' ')
        .trim();
}

function field(s, n) {
    return clean(s).slice(0, n || 40) || '-';
}

/** One alphanumeric line a phone can read out of a photo of the screen. */
function text(o) {
    const bits = [
        'MGU1',
        'LA',
        field(o.version, 12),
        field(o.light === 'wagen' ? 'WAGEN' : 'SIM', 8),
        o.cond == null ? 'X' : String(o.cond),
        o.speed == null ? 'X' : String(Math.round(o.speed)),
        o.linked ? 'JA' : 'NEIN',
        field(o.note, 40),
    ];
    const logs = o.logs || [];
    for (let i = 0; i < logs.length && i < 6; i++) bits.push(field(logs[i], 48));
    return bits.join('*');
}

function chunks(value, limit) {
    const max = limit || LIMIT;
    const out = [];
    let rest = value || '';
    let first = true;
    while (rest.length) {
        const room = first ? max : max - 5;
        if (rest.length <= room) {
            out.push(first ? rest : 'MGU1*' + rest);
            break;
        }
        let cut = rest.lastIndexOf('*', room);
        if (cut < 8) cut = room;
        const piece = rest.slice(0, cut);
        out.push(first ? piece : 'MGU1*' + piece);
        rest = rest.slice(rest.charAt(cut) === '*' ? cut + 1 : cut);
        first = false;
    }
    return out.length ? out : ['MGU1'];
}

function draw(cv, value, x, y, size) {
    const qr = qrcode(0, 'Q');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const total = n + quiet * 2;
    const cell = Math.max(2, Math.floor(size / total));
    const side = cell * total;
    const ox = x + Math.floor((size - side) / 2);
    const oy = y + Math.floor((size - side) / 2);
    cv.fillRect(ox, oy, side, side, '#ffffff');
    for (let r = 0; r < n; r++) {
        let c = 0;
        while (c < n) {
            if (!qr.isDark(r, c)) { c += 1; continue; }
            let c2 = c + 1;
            while (c2 < n && qr.isDark(r, c2)) c2 += 1;
            cv.fillRect(ox + (quiet + c) * cell, oy + (quiet + r) * cell, (c2 - c) * cell, cell, '#000000');
            c = c2;
        }
    }
    return n;
}

module.exports = { clean: clean, text: text, chunks: chunks, draw: draw, LIMIT: LIMIT };
