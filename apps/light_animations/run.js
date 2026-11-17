'use strict';

function pictureFor(ch) {
    if (ch.role === 'laser') return ch.side === 'R' ? 'laserR' : 'laserL';
    if (ch.role === 'tag' || ch.role === 'abblend' || ch.role === 'kurve') return ch.role === 'kurve' ? 'kurve' : ch.role;
    return 'off';
}

function createRun(o) {
    const state = { running: false, picture: 'off', note: '', confirmed: false };
    let stop = false;
    let held = true;
    let done = Promise.resolve();

    function frame() { if (o.onFrame) o.onFrame(state); }

    async function flashes() {
        const t0 = o.now();
        let n = 0;
        const writing = o.light() === 'wagen';
        try {
            while (!stop) {
                const rest = o.duty.why();
                if (rest) { state.note = rest; break; }
                if (o.now() - t0 >= o.capMs()) { state.note = 'fertig'; break; }
                if (writing) {
                    const why = o.writeWhy();
                    if (why) { state.note = why; break; }
                }
                state.picture = 'laser';
                state.confirmed = false;
                frame();
                if (writing) {
                    if (o.hold) o.hold(true);
                    let err = null;
                    try { err = await o.lamps.flashHigh(o.flashMs()); }
                    catch (e) { err = String(e && e.message || e); }
                    state.confirmed = !err;
                    frame();
                    if (err) { state.note = err; break; }
                } else {
                    await o.sleep(220);
                    state.confirmed = true;
                }
                state.picture = 'off';
                frame();
                n += 1;
                if (o.gesture() === 'burst' && n >= o.burst()) { state.note = 'Stoß fertig'; break; }
                if (o.gesture() === 'hold' && !held) { state.note = 'losgelassen'; break; }
                const gap = o.gapMs ? o.gapMs() : 40;
                if (gap) await o.sleep(gap);
            }
        } finally {
            state.picture = 'off';
            state.running = false;
            stop = false;
            if (writing) {
                try { await o.lamps.flashOff(); } catch (e) { state.note = String(e && e.message || e); }
                if (o.hold) o.hold(false);
            }
            if (n > 0) o.duty.note(t0, o.now());
            frame();
        }
    }

    return {
        state: state,
        setHeld: function (v) { held = !!v; if (!v) stop = true; },
        stop: function () { stop = true; },
        press: function () {
            if (state.running) { stop = true; return done; }
            const writing = o.light() === 'wagen';
            const rest = o.duty.why();
            if (rest) { state.note = rest; frame(); return Promise.resolve(); }
            if (writing) {
                const why = o.writeWhy();
                if (why) { state.note = why; frame(); return Promise.resolve(); }
            }
            stop = false;
            held = true;
            state.running = true;
            state.note = writing ? 'Lichthupe' : 'simuliert';
            done = flashes();
            return done;
        },
    };
}

function createMuster(o) {
    const state = { running: false, picture: 'off', note: '', confirmed: false };
    let stop = false;
    let done = Promise.resolve();

    function frame() { if (o.onFrame) o.onFrame(state); }

    function list() {
        const roles = o.roles();
        return o.channels().filter((ch) => roles.indexOf(ch.role) >= 0 && ch.ok !== false && ch.role !== 'kein');
    }

    async function pass() {
        const t0 = o.now();
        let n = 0;
        const writing = o.light() === 'wagen';
        try {
            const chosen = list();
            if (!chosen.length) { state.note = 'keine freigegebene Leuchte'; return; }
            let i = 0;
            while (!stop) {
                const rest = o.duty.why();
                if (rest) { state.note = rest; break; }
                if (o.now() - t0 >= o.capMs()) { state.note = 'fertig'; break; }
                if (writing) {
                    const why = o.writeWhy();
                    if (why) { state.note = why; break; }
                }
                const ch = chosen[i % chosen.length];
                state.picture = pictureFor(ch);
                state.confirmed = false;
                frame();
                if (writing) {
                    if (o.hold) o.hold(true);
                    if (o.mark) o.mark(ch);
                    let err = null;
                    try { err = await o.lamps.pulseChannel(ch.side, ch.ch); }
                    catch (e) { err = String(e && e.message || e); }
                    if (o.mark) o.mark(null);
                    state.confirmed = !err;
                    frame();
                    if (err) { state.note = err; break; }
                } else {
                    await o.sleep(280);
                    state.confirmed = true;
                }
                n += 1;
                i += 1;
                if (stop) break;
                if (o.once && o.once()) break;
                const gap = 80;
                await o.sleep(gap);
            }
        } finally {
            state.picture = 'off';
            state.running = false;
            stop = false;
            if (o.mark) o.mark(null);
            if (writing && o.hold) o.hold(false);
            if (n > 0) o.duty.note(t0, o.now());
            frame();
        }
    }

    return {
        state: state,
        stop: function () { stop = true; },
        press: function () {
            if (state.running) { stop = true; return done; }
            const rest = o.duty.why();
            if (rest) { state.note = rest; frame(); return Promise.resolve(); }
            if (o.light() === 'wagen') {
                const why = o.writeWhy();
                if (why) { state.note = why; frame(); return Promise.resolve(); }
            }
            if (!list().length) { state.note = 'keine freigegebene Leuchte'; frame(); return Promise.resolve(); }
            stop = false;
            state.running = true;
            state.note = o.light() === 'wagen' ? 'Muster' : 'simuliert';
            done = pass();
            return done;
        },
    };
}

module.exports = { createRun: createRun, createMuster: createMuster, pictureFor: pictureFor };
