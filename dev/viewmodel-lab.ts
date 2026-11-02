// @ts-nocheck: dev-only lab, not part of the typechecked build.
// Dev-only page for tuning the first-person guns + hands in isolation: /dev/viewmodel.html
// window.lab.step(seconds) advances time manually (handy when the tab is hidden and rAF is paused).
import * as THREE from 'three';
import { ViewModel } from '../src/gambol/client/viewmodel.ts';
import { WEAPONS, WEAPON_IDS, gunStats } from '../src/gambol/shared/weapons.ts';
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.toneMapping = THREE.NeutralToneMapping;
r.setClearColor(0x3d4a6a);
r.setPixelRatio(Math.min(devicePixelRatio, 2));
r.setSize(innerWidth, innerHeight);
document.body.prepend(r.domElement);
const vm = new ViewModel(0xe0614f);
vm.setAspect(innerWidth / innerHeight);
const render = () => { r.clear(); r.render(vm.scene, vm.camera); };
const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) vm.update(1 / 60, 0, true, 0, 0, 0); render(); };
let cur = 'awp', up = false;
const pick = (id, punched = up) => { cur = id; up = punched; vm.equip(id, punched, false); };
const reload = (empty = false) => vm.reload(gunStats(cur, up).reloadTime, empty);
window.lab = { vm, step, render, pick, reload, paused: false, ids: WEAPON_IDS }; // set lab.paused to freeze a frame
const ui = document.getElementById('ui');
const sel = document.createElement('select');
for (const id of WEAPON_IDS) sel.add(new Option(WEAPONS[id].name, id));
sel.value = cur;
sel.onchange = () => pick(sel.value);
ui.prepend(sel);
const punched = document.createElement('input');
punched.type = 'checkbox';
punched.onchange = () => pick(cur, punched.checked);
ui.append(punched, 'punched');
document.getElementById('fire').onclick = () => vm.fire(false);
document.getElementById('last').onclick = () => vm.fire(true);
document.getElementById('reload').onclick = () => reload(false);
document.getElementById('draw').onclick = () => vm.draw();
window.addEventListener('mousedown', (e) => vm.setAim(e.button === 2));
window.addEventListener('mouseup', () => vm.setAim(false));
window.addEventListener('contextmenu', (e) => e.preventDefault());
let last = performance.now();
const loop = (t) => { requestAnimationFrame(loop); if (window.lab.paused) { last = t; return; } vm.update(Math.min(0.05, (t - last) / 1000), 0, true, 0, 0, 0); last = t; render(); };
requestAnimationFrame(loop);
