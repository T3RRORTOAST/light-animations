'use strict';

const fs = require('fs');
const path = require('path');
const { setImage } = require('./kit/record');
const { open } = require('./kit/pack');

const NAMES = ['off', 'tag', 'abblend', 'laser', 'laserL', 'laserR', 'kurve'];

function fromJson(obj) {
    const raw = Buffer.from(obj.b64, 'base64');
    const data = new Uint8Array(raw.length);
    data.set(raw);
    return { w: obj.w, h: obj.h, data: data };
}

function readAll(dir) {
    const out = {};
    for (let i = 0; i < NAMES.length; i++) {
        const name = NAMES[i];
        out[name] = fromJson(JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8')));
    }
    return out;
}

function load(dir) {
    const db = open(dir);
    const ids = {};
    for (let i = 0; i < NAMES.length; i++) {
        const name = NAMES[i];
        const pic = fromJson(db.json(name + '.json'));
        setImage(i + 1, pic.w, pic.h, pic.data);
        ids[name] = i + 1;
    }
    return ids;
}

module.exports = { load: load, readAll: readAll, NAMES: NAMES };
