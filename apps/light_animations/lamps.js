'use strict';

const BDC = 0x40;
const SIDES = { L: 0x43, R: 0x44 };
const { flashTicks } = require('./logic');

function ask(diag, target, sid, data) {
    return diag.physical(target, sid, data, 1500);
}

function refused(reply) {
    if (!reply) return 'keine Antwort';
    if (reply[0] === 0x7F) return 'abgelehnt ' + (reply[2] || 0).toString(16);
    return null;
}

async function flashHigh(diag, ms) {
    const ticks = flashTicks(ms);
    const session = await ask(diag, BDC, 0x10, [0x03]);
    if (!session || session[0] !== 0x50) return 'Sitzung abgelehnt';
    const reply = await ask(diag, BDC, 0x2E, [0xD5, 0x42, 0x00, 0x05, (ticks >> 8) & 0xFF, ticks & 0xFF]);
    return refused(reply) || (reply[0] === 0x6E ? null : 'keine Bestätigung');
}

async function flashOff(diag) {
    await ask(diag, BDC, 0x2E, [0xD5, 0x42, 0x00, 0x05, 0x00, 0x00]);
    await ask(diag, BDC, 0x10, [0x01]);
}

async function pulseChannel(diag, side, ch) {
    const addr = SIDES[side];
    if (!addr || ch < 1 || ch > 15) return 'Kanal';
    const session = await ask(diag, addr, 0x10, [0x03]);
    if (!session || session[0] !== 0x50) return 'Sitzung abgelehnt';
    const reply = await ask(diag, addr, 0x31, [0x01, 0xA5, 0x4B, ch, 60, 1]);
    await ask(diag, addr, 0x31, [0x02, 0xA5, 0x4B]);
    await ask(diag, addr, 0x10, [0x01]);
    return refused(reply) || (reply[0] === 0x71 ? null : 'keine Bestätigung');
}

async function recover(diag, open) {
    if (!open || !SIDES[open.side]) return;
    const addr = SIDES[open.side];
    await ask(diag, addr, 0x31, [0x02, 0xA5, 0x4B]);
    await ask(diag, addr, 0x10, [0x01]);
}

function plain(err) {
    const s = String(err && err.message || err || '');
    if (s.indexOf('no diagnostic link') >= 0) return 'keine Verbindung';
    if (s.indexOf('transport refused') >= 0) return 'Verbindung abgelehnt';
    return s;
}

/** Run a lamp job only after Diag.init() has a proxy. Otherwise the car never hears the request. */
function guard(diag, job) {
    if (!diag || !diag.p) return Promise.resolve('keine Verbindung');
    return Promise.resolve().then(job).then(function (err) { return err || null; }, plain);
}

module.exports = {
    flashHigh: flashHigh, flashOff: flashOff, pulseChannel: pulseChannel, recover: recover,
    guard: guard, plain: plain, BDC: BDC, SIDES: SIDES,
};
