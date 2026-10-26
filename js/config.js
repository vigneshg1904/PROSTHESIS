// config.js - all project settings in one place.
// The Firebase web config below is the one from your Firebase console (it is meant to be public in a web app:
// what protects your data are the Realtime Database RULES in database.rules.json, not this key).

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDya_gTZLtgBTc3RdasaflujWPNO__H4Ok',
  authDomain: 'irumbu-kai-maayavi.firebaseapp.com',
  databaseURL: 'https://irumbu-kai-maayavi-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'irumbu-kai-maayavi',
  storageBucket: 'irumbu-kai-maayavi.firebasestorage.app',
  messagingSenderId: '1053653863718',
  appId: '1:1053653863718:web:5780e9563f3e89fb4e85e7',
  measurementId: 'G-3KHJ5HHNRG',
};

const q = new URLSearchParams(location.search);
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
let savedDevice = null;
try { savedDevice = localStorage.getItem('ikm_device'); } catch (e) { /* storage blocked */ }

export const CONFIG = {
  appName: 'Irumbu Kai Maayavi',
  tamilName: 'இரும்புக்கை மாயாவி',
  // The website talks to the database over plain HTTPS (REST + live stream), no SDK needed.
  dbUrl: (isLocal && q.get('db')) ? q.get('db') : FIREBASE_CONFIG.databaseURL,
  // Must match DEVICE_ID in the NPG firmware.
  deviceId: (q.get('device') || savedDevice || 'NPG01').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'NPG01',
  // Developer tools (keyboard finger simulation, test hooks). Off unless ?dev=1 is in the address AND you run it on localhost.
  // (only honoured on localhost, so nobody can bypass the "NPG must be online" rule on the public site)
  dev: isLocal && q.get('dev') === '1',
  isLocal,
  // Detection settings. The model file may carry its own defaults; these override them.
  pipeline: { rest_bias: 2.0, activity_floor: 1.15, cooldown: 1.0, steady: 'normal', vote: 8 },
};
