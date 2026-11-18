'use strict';

const IN_CAR = [5, 7, 8, 10, 12];
const MAX_MS = 30000;
const BUDGET_MS = 120000;
const WINDOW_MS = 600000;
const MOVE_KMH = 3;
const ORDER = ['laser', 'kurve', 'tag', 'abblend', 'anderes'];
const ADD = { laser: true, kurve: true };

function flashTicks(ms) {
    return Math.max(5, Math.min(15, Math.round((+ms || 80) / 10)));
}

function capMs(ms) {
    const n = +ms;
    if (!(n > 0)) return MAX_MS;
    return Math.min(MAX_MS, n);
}

function moving(kmh) {
    return typeof kmh === 'number' && kmh > MOVE_KMH;
}

const STATE = {
    PARKEN_BN_NIO: 1, PARKEN_BN_IO: 2, STANDFUNKTIONEN_KUNDE_NICHT_IM_FZG: 3, WOHNEN: 5,
    PRUEFEN_ANALYSE_DIAGNOSE: 7, FAHRBEREITSCHAFT_HERSTELLEN: 8, FAHREN: 10, FAHRBEREITSCHAFT_BEENDEN: 12,
};
const STATE_NAME = { 1: 'Parken', 2: 'Parken', 3: 'Leer', 5: 'Wohnen', 7: 'Zündung', 8: 'Start', 10: 'Fahren', 12: 'Aus' };

function personInCar(code) {
    return IN_CAR.indexOf(code) >= 0;
}

/** Parked with the bus off, or the car saying the customer is not in it. A woken parked car is not that. */
function absent(code) {
    return code === 1 || code === 3;
}

function codeOf(v) {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) v = Array.prototype.slice.call(v);
    if (typeof v === 'number' && isFinite(v)) return v >= 1 && v <= 12 ? v : null;
    if (typeof v === 'string') {
        if (String(parseInt(v, 10)) === v) return codeOf(parseInt(v, 10));
        const s = v.toUpperCase();
        if (STATE[s]) return STATE[s];
        if (s.indexOf('WOHN') >= 0 || s.indexOf('RESID') >= 0) return 5;
        if (s.indexOf('PRUEF') >= 0 || s.indexOf('PRÜF') >= 0) return 7;
        if (s.indexOf('BEEND') >= 0) return 12;
        if (s.indexOf('FAHRBEREIT') >= 0 || s.indexOf('HERSTELL') >= 0 || s.indexOf('READY') >= 0) return 8;
        if (s.indexOf('FAHR') >= 0 || s.indexOf('DRIV') >= 0) return 10;
        if (s.indexOf('NICHT_IM') >= 0 || s.indexOf('STAND') >= 0) return 3;
        if (s.indexOf('NIO') >= 0) return 1;
        if (s.indexOf('PARK') >= 0) return 2;
        return null;
    }
    if (Array.isArray(v)) {
        if (v.length > 5) { const n = codeOf(v[5]); if (n !== null) return n; }
        for (let i = 0; i < v.length; i++) { const n = codeOf(v[i]); if (n !== null) return n; }
        return null;
    }
    if (v && typeof v === 'object') {
        const keys = ['statusConditionVehicle', 'conditionVehicle', 'value', 'state', 'VehicleCondition'];
        for (let i = 0; i < keys.length; i++) {
            if (v[keys[i]] !== undefined && v[keys[i]] !== v) {
                const n = codeOf(v[keys[i]]);
                if (n !== null) return n;
            }
        }
    }
    return null;
}

function writeWhy(o) {
    if (o.light !== 'wagen') return 'simuliert';
    if (o.absent) return 'niemand im Auto';
    if (o.resting) return o.resting;
    return null;
}

function allowedRoles(selected, isMoving) {
    const out = [];
    for (let i = 0; i < ORDER.length; i++) {
        const name = ORDER[i];
        if (!selected || !selected[name]) continue;
        if (isMoving && !ADD[name]) continue;
        out.push(name);
    }
    return out;
}

function Duty(now) {
    this.now = now || Date.now;
    this.runs = [];
    this.restUntil = 0;
}

Duty.prototype.note = function (t0, t1) {
    this.runs.push([t0, t1]);
    const from = t1 - WINDOW_MS;
    this.runs = this.runs.filter((r) => r[1] > from);
    this.restUntil = t1 + Math.max(10000, t1 - t0);
};

Duty.prototype.flashed = function () {
    const now = this.now();
    const from = now - WINDOW_MS;
    return this.runs.reduce((n, r) => n + Math.max(0, r[1] - Math.max(r[0], from)), 0);
};

Duty.prototype.why = function () {
    const now = this.now();
    if (now < this.restUntil) return 'Pause ' + Math.ceil((this.restUntil - now) / 1000) + ' s';
    if (this.flashed() >= BUDGET_MS) return '2 Minuten in 10 erreicht';
    return null;
};

module.exports = {
    IN_CAR: IN_CAR, MAX_MS: MAX_MS, BUDGET_MS: BUDGET_MS, WINDOW_MS: WINDOW_MS, MOVE_KMH: MOVE_KMH,
    flashTicks: flashTicks, capMs: capMs, moving: moving, personInCar: personInCar,
    absent: absent, codeOf: codeOf, stateName: STATE_NAME,
    writeWhy: writeWhy, allowedRoles: allowedRoles, Duty: Duty,
};
