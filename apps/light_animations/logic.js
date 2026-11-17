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

function personInCar(code) {
    return IN_CAR.indexOf(code) >= 0;
}

function writeWhy(o) {
    if (o.light !== 'wagen') return 'simuliert';
    if (!o.inCar) return 'niemand im Auto';
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
    writeWhy: writeWhy, allowedRoles: allowedRoles, Duty: Duty,
};
