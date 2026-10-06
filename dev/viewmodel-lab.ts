// @ts-nocheck: dev-only lab, not part of the typechecked build.
// Dev-only page for tuning the first-person rifle + hands in isolation: /dev/viewmodel.html
// window.lab.step(seconds) advances time manually (handy when the tab is hidden and rAF is paused).
import * as THREE from 'three';
import { ViewModel, GUN_POS, GUN_ROT } from '../src/client/viewmodel.ts';
const r = new THREE.WebGLRenderer({ antialias: true });
r.toneMapping = THREE.NeutralToneMapping;
r.setClearColor(0x9fd0f0);
r.setPixelRatio(Math.min(devicePixelRatio, 2));
r.setSize(innerWidth, innerHeight);
document.body.prepend(r.domElement);
const vm = new ViewModel(0xe0614f);
vm.setAspect(innerWidth / innerHeight);
const render = () => { r.clear(); r.render(vm.scene, vm.camera); };
const step = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) vm.update(1 / 60, 0, true, 0, 0, 0); render(); };
window.lab = { vm, step, render, GUN_POS, GUN_ROT, paused: false }; // set lab.paused to freeze a frame
document.getElementById('fire').onclick = () => vm.fire(true);
document.getElementById('last').onclick = () => vm.fire(false);
document.getElementById('reload').onclick = () => vm.reload(true);
document.getElementById('draw').onclick = () => vm.draw();
let last = performance.now();
const loop = (t) => { requestAnimationFrame(loop); if (window.lab.paused) { last = t; return; } vm.update(Math.min(0.05, (t - last) / 1000), 0, true, 0, 0, 0); last = t; render(); };
requestAnimationFrame(loop);
