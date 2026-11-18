'use strict';
/**
 * Light Animations - high-beam flash and named front lamps for the test track.
 * Simulated until Lichtsteuerung is Wagen.
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const parked = require('./kit/parked');
const signals = require('./kit/signals');
const { Diag } = require('./kit/diag');
const logic = require('./logic');
const lamps = require('./lamps');
const run = require('./run');
const pictures = require('./pictures');
const report = require('./report');

const ROLES = ['laser', 'kurve', 'tag', 'abblend', 'anderes', 'kein'];
const ROLE_NAME = { laser: 'Laser', kurve: 'Kurve', tag: 'Tag', abblend: 'Abblend', anderes: 'Anderes', kein: 'Kein' };
const PAGES = ['Live', 'Benennen', 'Einstellungen'];

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function seen(v) {
    try { const s = JSON.stringify(v); return s.length > 180 ? s.slice(0, 180) : s; } catch (e) { return String(v); }
}

mgu.run({
    async start(ctx) {
        const { settings, log } = ctx;
        const trace = [];
        function hear(level, msg) {
            trace.push(level + ' ' + String(msg).replace(/\s+/g, ' ').slice(0, 90));
            if (trace.length > 8) trace.shift();
        }
        function tap(method, level) {
            const orig = log[method];
            if (typeof orig !== 'function') return;
            log[method] = function () {
                const parts = [];
                for (let i = 0; i < arguments.length; i++) parts.push(arguments[i]);
                hear(level, parts.join(' '));
                return orig.apply(log, arguments);
            };
        }
        tap('info', 'I');
        tap('warn', 'W');
        const diag = new Diag(ctx.signals, log);
        await Promise.race([
            diag.init(),
            new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
        log.info(diag.p ? 'Diagnose verbunden' : 'Diagnose fehlt');
        const speed = parked.watch(ctx, log);
        const duty = new logic.Duty(Date.now);
        const ids = pictures.load(path.join(__dirname, 'pix'));
        const version = (readJson(path.join(__dirname, 'app.json')) || {}).version || '';
        const chFile = path.join(ctx.dataDir, 'channels.json');
        const openFile = path.join(ctx.dataDir, 'open.json');
        const pick = { side: 'L', ch: 1, role: 'laser' };
        const view = { page: 0, picture: 'off', note: 'bereit', confirmed: false, running: false, report: 0 };
        let cond = null;
        let heardRaw = false;

        function channels() {
            const list = readJson(chFile);
            return Array.isArray(list) ? list : [];
        }
        function saveChannels(list) {
            try { fs.writeFileSync(chFile, JSON.stringify(list)); } catch (e) { log.warn('Kanäle: ' + e); }
        }
        function remember(side, ch, role, ok) {
            const list = channels().filter((c) => !(c.side === side && c.ch === ch));
            if (role !== 'kein') list.push({ side: side, ch: ch, role: role, ok: !!ok });
            saveChannels(list);
        }
        function mark(ch) {
            if (!ch) { try { fs.unlinkSync(openFile); } catch (e) { /* none */ } return; }
            try { fs.writeFileSync(openFile, JSON.stringify({ side: ch.side, ch: ch.ch, at: Date.now() })); } catch (e) { log.warn('Journal: ' + e); }
        }
        function roleSel() {
            return {
                laser: settings.get('laser') !== false,
                kurve: !!settings.get('kurve'),
                tag: !!settings.get('tag'),
                abblend: !!settings.get('abblend'),
                anderes: !!settings.get('anderes'),
            };
        }
        function onFrame(state) {
            view.picture = state.picture;
            view.note = state.note;
            view.confirmed = state.confirmed;
            view.running = state.running;
        }
        const shared = {
            now: Date.now,
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            light: () => settings.get('light'),
            writeWhy: () => logic.writeWhy({
                light: 'wagen', absent: logic.absent(cond), resting: null,
            }),
            capMs: () => logic.capMs((+settings.get('limit') || 30) * 1000),
            gesture: () => settings.get('gesture') || 'toggle',
            burst: () => +settings.get('burst') || 3,
            flashMs: () => +settings.get('flash') || 80,
            gapMs: () => 40,
            duty: duty,
            mark: mark,
            onFrame: onFrame,
            channels: channels,
            roles: () => logic.allowedRoles(roleSel(), speed.moving()),
            lamps: {
                flashHigh: (ms) => lamps.guard(diag, () => lamps.flashHigh(diag, ms)),
                flashOff: () => lamps.guard(diag, () => lamps.flashOff(diag)),
                pulseChannel: (side, ch) => lamps.guard(diag, () => lamps.pulseChannel(diag, side, ch)),
            },
        };
        const lichthupe = run.createRun(shared);
        const muster = run.createMuster(shared);

        const open = readJson(openFile);
        if (open && open.side) {
            lamps.recover(diag, open).then(() => { mark(null); log.info('offener Kanal zurück'); }).catch((e) => log.warn('Recover: ' + e));
        }
        const noteCond = (v) => {
            let n = null;
            try { n = logic.codeOf(v); } catch (e) { n = null; }
            if (n === null) {
                if (!heardRaw) { heardRaw = true; log.warn('Fahrzeugzustand ungelesen ' + seen(v)); }
                return;
            }
            if (n === cond) return;
            cond = n;
            log.info('Fahrzeugzustand ' + n + ' ' + (logic.stateName[n] || ''));
        };
        if (signals.hasNative()) {
            signals.watch('de.bmw.infrastructure.VehicleCondition', '1', {
                VehicleCondition: noteCond,
            }, log).then((sub) => {
                if (sub && sub.proxy) signals.readField(sub.proxy, 'VehicleCondition', 3000).then(noteCond).catch((e) => log.warn('Zustand lesen: ' + e));
            }).catch((e) => log.warn('Fahrzeugzustand: ' + e));
        }

        function busy() { return lichthupe.state.running || muster.state.running; }
        function goLichthupe() {
            if (muster.state.running) { view.note = 'erst stoppen'; return; }
            lichthupe.press();
        }
        function goMuster() {
            if (lichthupe.state.running) { view.note = 'erst stoppen'; return; }
            muster.press();
        }
        function stopAll() { lichthupe.stop(); muster.stop(); }
        async function testChannel() {
            if (busy()) { view.note = 'erst stoppen'; return; }
            if (pick.role === 'kein') {
                remember(pick.side, pick.ch, 'kein', false);
                view.note = 'entfernt';
                return;
            }
            if (speed.moving()) { view.note = 'nur im Stand'; return; }
            if (settings.get('light') !== 'wagen') {
                remember(pick.side, pick.ch, pick.role, true);
                view.note = 'simuliert gespeichert';
                return;
            }
            const why = logic.writeWhy({
                light: 'wagen', absent: logic.absent(cond), resting: duty.why(),
            });
            if (why && why !== 'simuliert') { view.note = why; return; }
            mark(pick);
            let err = null;
            try { err = await lamps.guard(diag, () => lamps.pulseChannel(diag, pick.side, pick.ch)); }
            catch (e) { err = String(e && e.message || e); }
            mark(null);
            if (err) { view.note = err; return; }
            remember(pick.side, pick.ch, pick.role, true);
            view.note = pick.side + ' ' + pick.ch + ' ' + ROLE_NAME[pick.role];
        }

        if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => {
            stopAll();
            if (settings.get('light') === 'wagen' && diag.p) lamps.flashOff(diag).catch(() => {});
        });

        ctx.hideButton('BTN_GO');
        ctx.hideButton('BTN_MUSTER');
        ctx.hideButton('BTN_STOP');
        ctx.onTab((i) => { view.page = i; });
        ctx.ui.onClick('BTN_PAGE', () => { view.page = (view.page + 1) % PAGES.length; });
        ctx.ui.onClick('BTN_GO', goLichthupe);
        ctx.ui.onClick('BTN_MUSTER', goMuster);
        ctx.ui.onClick('BTN_STOP', stopAll);

        const draw = () => {
            const t = ctx.theme();
            const cv = ctx.canvas(1600, 520).clear(t.bg);
            const moving = speed.moving();
            const wagen = settings.get('light') === 'wagen';
            const heard = cond === null ? '' : ' · ' + (logic.stateName[cond] || cond);
            const mode = (moving ? 'Fahrt' : 'Stand') + ' · ' + (wagen ? 'Wagen' : 'Simuliert') + heard;
            if (view.page === 0) drawLive(cv, t, moving);
            else if (view.page === 1) drawName(cv, t, moving);
            else if (view.page === 2) drawSettings(cv, t);
            else drawReport(cv, t);
            const line = view.running ? (view.note + (view.confirmed ? ' · bestätigt' : ' · gesendet')) : view.note;
            const short = line.length > 42 ? line.slice(0, 40) + '…' : line;
            G.frame(cv, t, PAGES, view.page > 2 ? 2 : view.page, [
                { text: mode, color: view.running ? 'ok' : (wagen ? 'warn' : 'cold') },
                { text: short, color: view.running ? (view.confirmed ? 'ok' : 'warn') : 'cold' },
            ]);
            return ctx.ui.image('MAIN_GFX', cv);
        };

        function drawLive(cv, t, moving) {
            const id = ids[view.picture] || ids.off;
            cv.image(id, 460, G.TOP + 6, 680, 312);
            const y = 408;
            G.button(cv, t, 40, y, 220, 52, view.running && lichthupe.state.running ? 'Stopp' : 'Lichthupe', goLichthupe, { primary: true, key: 'go' });
            G.button(cv, t, 276, y, 200, 52, 'Muster', goMuster, { key: 'muster' });
            G.button(cv, t, 492, y, 160, 52, 'Stopp', stopAll, { key: 'stop', color: t.crit });
            if (settings.get('gesture') === 'hold') {
                cv.roundRect(668, y, 200, 52, 26, t.sel);
                cv.text('HALTEN', 768, y + 34, 20, '#ffffff', { align: 'center', font: 'bold' });
                cv.target(668, y, 200, 52, () => {
                    if (lichthupe.state.running) lichthupe.setHeld(false);
                    else { lichthupe.setHeld(true); goLichthupe(); }
                }, 'hold', null, {
                    drag: (phase) => {
                        if (phase === 1) { lichthupe.setHeld(true); if (!lichthupe.state.running) goLichthupe(); }
                        if (phase === 3) lichthupe.setHeld(false);
                    },
                });
            }
            let x = 40;
            const names = ['laser', 'kurve', 'tag', 'abblend', 'anderes'];
            for (let i = 0; i < names.length; i++) {
                const name = names[i];
                const on = !!roleSel()[name];
                const allowed = !moving || name === 'laser' || name === 'kurve';
                x += G.button(cv, t, x, 466, 0, 36, ROLE_NAME[name], () => settings.set(name, !settings.get(name)), {
                    primary: on, busy: !allowed && !on, key: 'role-' + name,
                }) + 10;
            }
        }

        function drawName(cv, t, moving) {
            cv.text(pick.side + '  Kanal ' + pick.ch + '  ' + ROLE_NAME[pick.role], 40, 120, 36, t.text);
            G.button(cv, t, 40, 150, 120, 52, pick.side === 'L' ? 'Links' : 'Rechts', () => { pick.side = pick.side === 'L' ? 'R' : 'L'; }, { key: 'side' });
            G.button(cv, t, 176, 150, 80, 52, '−', () => { pick.ch = Math.max(1, pick.ch - 1); }, { key: 'chm' });
            G.button(cv, t, 268, 150, 80, 52, '+', () => { pick.ch = Math.min(15, pick.ch + 1); }, { key: 'chp' });
            G.button(cv, t, 364, 150, 220, 52, ROLE_NAME[pick.role], () => {
                pick.role = ROLES[(ROLES.indexOf(pick.role) + 1) % ROLES.length];
            }, { key: 'role' });
            G.button(cv, t, 600, 150, 200, 52, 'Test', testChannel, { primary: true, busy: moving || busy(), key: 'test' });
            cv.text(moving ? 'Test nur im Stand, ein Kanal' : 'Ein Kanal, 60 %, eine Sekunde', 40, 230, 22, t.dim);
            const list = channels();
            for (let i = 0; i < list.length && i < 6; i++) {
                const c = list[i];
                cv.text(c.side + ' ' + c.ch + '  ' + (ROLE_NAME[c.role] || c.role) + (c.ok ? '' : '  ?'), 40, 280 + i * 28, 22, t.text);
            }
            if (!list.length) cv.text('Noch keine Leuchte benannt', 40, 280, 22, t.dim);
        }

        function drawSettings(cv, t) {
            const rows = [
                ['light', 'Licht'], ['gesture', 'Bedienung'], ['burst', 'Stoß'], ['flash', 'Blitz'], ['limit', 'Grenze'],
            ];
            for (let i = 0; i < rows.length; i++) {
                const key = rows[i][0];
                const y = 70 + i * 64;
                cv.text(rows[i][1], 40, y + 34, 24, t.dim);
                G.button(cv, t, 220, y, 420, 52, settings.display(key), () => settings.cycle(key), { key: 'set-' + key });
            }
            cv.text('Über 3 km/h nur Laser und Kurve. Pause mindestens so lang wie der Lauf, höchstens 2 Minuten in 10.', 40, 420, 20, t.dim);
            G.button(cv, t, 1100, 78, 280, 52, 'Bericht', () => { view.page = 3; view.report = 0; }, { key: 'report' });
        }

        function drawReport(cv, t) {
            const linked = !!diag.p;
            const kmh = speed.speed();
            const body = report.text({
                version: version,
                light: settings.get('light'),
                cond: cond,
                speed: kmh,
                linked: linked,
                note: view.note,
                logs: trace.slice(),
            });
            const parts = report.chunks(body);
            const i = Math.max(0, Math.min(view.report || 0, parts.length - 1));
            view.report = i;
            const lines = [
                'Light Animations ' + version,
                'Licht: ' + (settings.get('light') === 'wagen' ? 'Wagen' : 'Simuliert'),
                'Zustand: ' + (cond == null ? 'noch keiner' : (logic.stateName[cond] || cond)),
                'Tempo: ' + (kmh == null ? '-' : Math.round(kmh) + ' km/h'),
                'Verbindung: ' + (linked ? 'da' : 'fehlt'),
                'Meldung: ' + (view.note || '-'),
            ];
            for (let n = 0; n < lines.length; n++) cv.text(lines[n], 40, 90 + n * 36, 26, t.text);
            const logs = trace.slice(-4);
            for (let n = 0; n < logs.length; n++) cv.text(logs[n].slice(0, 52), 40, 320 + n * 24, 18, t.dim);
            try { report.draw(cv, parts[i], 1080, 70, 400); }
            catch (e) { cv.text('Code passt nicht', 1120, 260, 22, t.crit); }
            G.button(cv, t, 40, 450, 180, 52, 'Zurück', () => { view.page = 2; }, { key: 'back' });
            if (parts.length > 1) {
                G.button(cv, t, 240, 450, 220, 52, 'Code ' + (i + 1) + '/' + parts.length, () => {
                    view.report = (i + 1) % parts.length;
                }, { key: 'more' });
            }
        }

        ctx.loop('MAIN', 8, draw);
        draw().catch((e) => log.warn('first render: ' + e));
    },
});
