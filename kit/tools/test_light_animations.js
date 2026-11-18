'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'apps', 'light_animations');
const KIT = path.join(ROOT, 'kit', 'runtime');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
    if (parent && parent.filename && path.dirname(parent.filename) === APP && request.indexOf('./kit/') === 0) {
        request = path.join(KIT, request.slice(6));
    }
    return resolve.apply(this, [request].concat(Array.prototype.slice.call(arguments, 1)));
};
const app = (name) => require(path.join(APP, name));
const logic = app('logic');
const lamps = app('lamps');
const run = app('run');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('Blitzlänge wird zu 10-ms-Schritten zwischen 50 und 150', () => {
    assert.strictEqual(logic.flashTicks(80), 8);
    assert.strictEqual(logic.flashTicks(50), 5);
    assert.strictEqual(logic.flashTicks(150), 15);
    assert.strictEqual(logic.flashTicks(10), 5);
    assert.strictEqual(logic.flashTicks(400), 15);
});

test('Obergrenze ist höchstens 30 Sekunden', () => {
    assert.strictEqual(logic.capMs(10000), 10000);
    assert.strictEqual(logic.capMs(60000), 30000);
    assert.strictEqual(logic.capMs(0), 30000);
});

test('Fahrt lässt nur Laser und Kurvenlicht', () => {
    const sel = { laser: true, kurve: true, tag: true, abblend: true, anderes: true };
    assert.deepStrictEqual(logic.allowedRoles(sel, true), ['laser', 'kurve']);
    assert.deepStrictEqual(logic.allowedRoles(sel, false), ['laser', 'kurve', 'tag', 'abblend', 'anderes']);
    assert.deepStrictEqual(logic.allowedRoles({ laser: false, kurve: true }, true), ['kurve']);
});

test('Schreiben nur im Wagen, und nur nicht wenn das Auto leer gemeldet ist', () => {
    assert.strictEqual(logic.writeWhy({ light: 'sim', absent: false, resting: null }), 'simuliert');
    assert.strictEqual(logic.writeWhy({ light: 'wagen', absent: true, resting: null }), 'niemand im Auto');
    assert.strictEqual(logic.writeWhy({ light: 'wagen', absent: false, resting: 'Pause 9 s' }), 'Pause 9 s');
    assert.strictEqual(logic.writeWhy({ light: 'wagen', absent: false, resting: null }), null);
    assert.strictEqual(logic.absent(null), false);
    assert.strictEqual(logic.absent(2), false);
    assert.strictEqual(logic.absent(5), false);
    assert.strictEqual(logic.absent(1), true);
    assert.strictEqual(logic.absent(3), true);
    assert.strictEqual(logic.codeOf({ statusConditionVehicle: 'WOHNEN' }), 5);
    assert.strictEqual(logic.codeOf({ statusConditionVehicle: 2 }), 2);
    assert.strictEqual(logic.codeOf('PARKEN_BN_IO'), 2);
});

test('nach einem Lauf ruht das Licht mindestens so lang', () => {
    let now = 1000;
    const duty = new logic.Duty(() => now);
    duty.note(1000, 4000);
    now = 5000;
    assert.ok(duty.why());
    now = 4000 + 9999;
    assert.ok(duty.why());
    now = 4000 + 10000;
    assert.strictEqual(duty.why(), null);
});

test('zwei Minuten in zehn Minuten stoppen den nächsten Lauf', () => {
    let now = 0;
    const duty = new logic.Duty(() => now);
    duty.note(0, 70000);
    duty.note(80000, 140000);
    now = 200000;
    assert.strictEqual(duty.why(), '2 Minuten in 10 erreicht');
    now = 800000;
    assert.strictEqual(duty.flashed(), 0);
});

function fakeDiag(replies) {
    return {
        sent: [],
        physical(target, sid, data) {
            this.sent.push([target, sid].concat(data));
            const next = replies.shift();
            return Promise.resolve(next || [sid + 0x40]);
        },
    };
}

test('Fernlicht-Funktion: Sitzung, Zeit, am Ende aus', async () => {
    const diag = fakeDiag([[0x50, 0x03], [0x6E]]);
    assert.strictEqual(await lamps.flashHigh(diag, 80), null);
    assert.deepStrictEqual(diag.sent[0], [0x40, 0x10, 0x03]);
    assert.deepStrictEqual(diag.sent[1], [0x40, 0x2E, 0xD5, 0x42, 0x00, 0x05, 0x00, 0x08]);
    await lamps.flashOff(diag);
    assert.deepStrictEqual(diag.sent[2], [0x40, 0x2E, 0xD5, 0x42, 0x00, 0x05, 0x00, 0x00]);
    assert.deepStrictEqual(diag.sent[3], [0x40, 0x10, 0x01]);
});

test('ein Kanal: 60 Prozent, eine Sekunde, dann Stopp', async () => {
    const diag = fakeDiag([[0x50, 0x03], [0x71], [0x71], [0x50, 0x01]]);
    assert.strictEqual(await lamps.pulseChannel(diag, 'L', 8), null);
    assert.deepStrictEqual(diag.sent[1], [0x43, 0x31, 0x01, 0xA5, 0x4B, 8, 60, 1]);
    assert.deepStrictEqual(diag.sent[2], [0x43, 0x31, 0x02, 0xA5, 0x4B]);
    assert.strictEqual(await lamps.pulseChannel(diag, 'R', 0), 'Kanal');
});

test('Ablehnung beendet den Blitz', async () => {
    const diag = fakeDiag([[0x50, 0x03], [0x7F, 0x2E, 0x22]]);
    assert.ok(await lamps.flashHigh(diag, 80));
});

test('ein abgelehnter Schritt beendet den Lauf und macht das Licht aus', async () => {
    const calls = [];
    let now = 0;
    const session = run.createRun({
        now: () => now,
        sleep: () => Promise.resolve(),
        light: () => 'wagen',
        writeWhy: () => null,
        capMs: () => 30000,
        gesture: () => 'toggle',
        burst: () => 3,
        flashMs: () => 80,
        gapMs: () => 0,
        duty: new logic.Duty(() => now),
        lamps: {
            flashHigh: () => { calls.push('on'); return Promise.resolve('abgelehnt 22'); },
            flashOff: () => { calls.push('off'); return Promise.resolve(); },
        },
    });
    await session.press();
    assert.deepStrictEqual(calls, ['on', 'off']);
    assert.strictEqual(session.state.running, false);
    assert.strictEqual(session.state.picture, 'off');
    assert.strictEqual(session.state.note, 'abgelehnt 22');
});

test('Stoß macht drei Blitze und gibt das Licht zurück', async () => {
    const calls = [];
    let now = 0;
    const duty = new logic.Duty(() => now);
    const session = run.createRun({
        now: () => now,
        sleep: (ms) => { now += ms; return Promise.resolve(); },
        light: () => 'wagen',
        writeWhy: () => null,
        capMs: () => 30000,
        gesture: () => 'burst',
        burst: () => 3,
        flashMs: () => 80,
        gapMs: () => 0,
        duty: duty,
        lamps: {
            flashHigh: () => { calls.push('on'); return Promise.resolve(null); },
            flashOff: () => { calls.push('off'); return Promise.resolve(); },
        },
    });
    await session.press();
    assert.deepStrictEqual(calls, ['on', 'on', 'on', 'off']);
    assert.strictEqual(session.state.running, false);
    assert.strictEqual(session.state.picture, 'off');
});

test('zweiter Druck stoppt', async () => {
    let now = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    let n = 0;
    const session = run.createRun({
        now: () => now,
        sleep: () => Promise.resolve(),
        light: () => 'wagen',
        writeWhy: () => null,
        capMs: () => 30000,
        gesture: () => 'toggle',
        burst: () => 3,
        flashMs: () => 80,
        gapMs: () => 0,
        duty: new logic.Duty(() => now),
        lamps: {
            flashHigh: () => {
                n += 1;
                if (n === 1) return gate;
                return Promise.resolve(null);
            },
            flashOff: () => Promise.resolve(),
        },
    });
    const going = session.press();
    session.stop();
    release(null);
    await going;
    assert.ok(n >= 1);
    assert.strictEqual(session.state.running, false);
});

test('Simuliert ruft die Diagnose nicht', async () => {
    let called = false;
    let now = 0;
    const session = run.createRun({
        now: () => now,
        sleep: (ms) => { now += ms; return Promise.resolve(); },
        light: () => 'sim',
        writeWhy: () => 'simuliert',
        capMs: () => 30000,
        gesture: () => 'burst',
        burst: () => 2,
        flashMs: () => 80,
        gapMs: () => 0,
        duty: new logic.Duty(() => now),
        lamps: { flashHigh: () => { called = true; return Promise.resolve(null); }, flashOff: () => Promise.resolve() },
    });
    await session.press();
    assert.strictEqual(called, false);
    assert.strictEqual(session.state.picture, 'off');
});

test('Muster nimmt nur erlaubte Kanäle und einen nach dem anderen', async () => {
    const calls = [];
    let now = 0;
    let release;
    const session = run.createMuster({
        now: () => now,
        sleep: (ms) => { now += ms; return Promise.resolve(); },
        light: () => 'wagen',
        writeWhy: () => null,
        capMs: () => 30000,
        duty: new logic.Duty(() => now),
        channels: () => [{ side: 'L', ch: 1, role: 'laser' }, { side: 'R', ch: 2, role: 'abblend' }],
        roles: () => ['laser'],
        lamps: {
            pulseChannel: (side, ch) => {
                calls.push(side + ch);
                if (calls.length === 1) return new Promise((r) => { release = r; });
                return Promise.resolve(null);
            },
            flashOff: () => Promise.resolve(),
        },
    });
    const going = session.press();
    assert.deepStrictEqual(calls, ['L1']);
    session.stop();
    release(null);
    await going;
    assert.strictEqual(session.state.picture, 'off');
});

test('Bilder haben eine gemeinsame Größe', () => {
    const pics = app('pictures').readAll(path.join(APP, 'pix'));
    const names = ['off', 'tag', 'abblend', 'laser', 'laserL', 'laserR', 'kurve'];
    names.forEach((name) => {
        assert.strictEqual(pics[name].w, 480);
        assert.strictEqual(pics[name].h, 220);
        assert.strictEqual(pics[name].data.length, 480 * 220 * 4);
    });
});

test('der native Renderer bekommt das Bild als x y w h r id', () => {
    const { nativeFrame } = require(path.join(ROOT, 'kit', 'runtime', 'renderd'));
    const u = new Uint32Array(9);
    const f = new Float32Array(u.buffer);
    u[0] = 1; u[1] = 0xff;
    u[2] = 18; u[3] = 4; u[4] = 2; f[5] = 12; f[6] = 24; f[7] = 48; f[8] = 36;
    const out = nativeFrame(u);
    const o = new Uint32Array(out.buffer, out.byteOffset, out.length / 4);
    const fo = new Float32Array(o.buffer, o.byteOffset, o.length);
    assert.strictEqual(o[0], 1);
    assert.strictEqual(o[2], 18);
    assert.strictEqual(fo[3], 12);
    assert.strictEqual(fo[4], 24);
    assert.strictEqual(fo[5], 48);
    assert.strictEqual(fo[6], 36);
    assert.strictEqual(fo[7], 0);
    assert.strictEqual(o[8], 4);
});

(async () => {
    let failed = 0;
    for (let i = 0; i < tests.length; i++) {
        try {
            await tests[i][1]();
            console.log('ok  ' + tests[i][0]);
        } catch (e) {
            failed += 1;
            console.error('FAIL ' + tests[i][0]);
            console.error(e && e.stack || e);
        }
    }
    if (failed) process.exit(1);
})();
