import clock from 'clock';
import document from 'document';
import { HeartRateSensor } from "heart-rate";
import { preferences } from 'user-settings';
import * as utils from '../common/utils';

// Constants
const NUM_SCREENS = 4;
const SCREEN_STATS_INDEX = 0;
const SCREEN_BG_INDEX = 1;
const SCREEN_HR_INDEX = 2;
const SCREEN_SLEEP_INDEX = 3;
const NUM_STATS = 2;
const STATS_WEATHER_INDEX = 0;
const STATS_CGM_INDEX = 1;
const UPDATE_INTERVAL_MS = 10000;
// Max time a stale HR reading is shown before being zeroed out
const MAX_STALE_HEART_RATE_MS = 5000;

// State
let screenIndex = 0;
let statsIndex = 0;
let lastHrmReadingTimestamp = null;

// Elements
const timeEl = document.getElementById('time');
const secondsEl = document.getElementById('seconds');
const weekdayEl = document.getElementById('weekday');
const dayOfMonthEl = document.getElementById('dayOfMonth');
const weatherEl = document.getElementById('weather');
const cgmEl = document.getElementById('cgm');
const heartRateEl = document.getElementById('heartrate');
const statsEl = document.getElementById('main-stats');
const bgStatsEl = document.getElementById('bg-stats');
const hrStatsEl = document.getElementById('heartrate-stats');
const sleepStatsEl = document.getElementById('sleep-stats');

// Setup sensors
const hrm = new HeartRateSensor();
clock.granularity = 'seconds';

// Listeners
clock.ontick = handleClockTick;
hrm.onreading = handleHeartRateReading;
hrm.onerror = handleHeartRateError;
document.getElementById('screen').onclick = handleScreenClick;
document.getElementById('toggle-stats-container').onclick = handleStatsClick;

// Setup watch
updateSelectedScreen();
updateSelectedStats();
hrm.start();
setInterval(periodicUpdate, UPDATE_INTERVAL_MS);

function periodicUpdate() {
  // Heart Rate
  const timeSinceLastReading = Date.now() - lastHrmReadingTimestamp;
  if (timeSinceLastReading >= MAX_STALE_HEART_RATE_MS) {
    zeroOutHeartRate();
  }
}

function handleClockTick(event) {
  const date = event.date;
  let hours = date.getHours();
  if (preferences.clockDisplay === '12h') {
    // 12h format
    hours = hours % 12 || 12;
  } else {
    // 24h format
    hours = utils.zeroPad(hours);
  }
  const minutes = utils.zeroPad(date.getMinutes());
  const seconds = utils.zeroPad(date.getSeconds());
  // Update time
  timeEl.text = `${hours}:${minutes}`;
  secondsEl.text = seconds;

  // Update date
  const dayOfMonth = date.getDate();
  const weekday = date.toLocaleString().split(' ')[0];
  weekdayEl.text = `${weekday}`.toUpperCase();
  dayOfMonthEl.text = dayOfMonth;
}

function handleScreenClick(event) {
  screenIndex = ++screenIndex % NUM_SCREENS;
  updateSelectedScreen();
}

function updateSelectedScreen() {
  // Hide all screens
  hide(statsEl);
  hide(bgStatsEl);
  hide(hrStatsEl);
  hide(sleepStatsEl);

  // Show correct one
  switch (screenIndex) {
    case SCREEN_STATS_INDEX:
      show(statsEl);
      break;
    case SCREEN_BG_INDEX:
      show(bgStatsEl);
      break;
    case SCREEN_HR_INDEX:
      show(hrStatsEl);
      break;
    case SCREEN_SLEEP_INDEX:
      show(sleepStatsEl);
      break;
  }
}

function handleStatsClick(event) {
  statsIndex = ++statsIndex % NUM_STATS;
  updateSelectedStats();
}

function updateSelectedStats() {
  // Hide all stats
  hide(weatherEl);
  hide(cgmEl);

  // Show correct one
  switch (statsIndex) {
    case STATS_WEATHER_INDEX:
      show(weatherEl);
      break;
    case STATS_CGM_INDEX:
      show(cgmEl);
      break;
  }
}

function updateActivity() {
  // TODO
}

function handleHeartRateReading() {
  if (hrm.heartRate) {
    lastHrmReadingTimestamp = Date.now();
    heartRateEl.text = hrm.heartRate
    // TODO show arrow
  } else {
    zeroOutHeartRate();
  }
}

function handleHeartRateError() {
  zeroOutHeartRate();
}

function zeroOutHeartRate() {
  heartRateEl.text = '--';
  // TODO hide arrow
}

function updateWeather() {
  // TODO
}

function updateCGM() {
  // TODO change color based on BG
}

function updateSleep() {
  // TODO
}

function show(element) {
  element.style.display = 'inline';
}

function hide(element) {
  element.style.display = 'none';
}
