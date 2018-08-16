import clock from 'clock';
import document from 'document';
import { HeartRateSensor } from 'heart-rate';
import { today } from 'user-activity';
import { user } from 'user-profile';
import { preferences, units } from 'user-settings';
import * as utils from '../common/utils';
import Graph from './graph';

// Constants
// TODO change to 4
const NUM_SCREENS = 2;
const SCREEN_STATS_INDEX = 0;
const SCREEN_HR_INDEX = 1;
const SCREEN_BG_INDEX = 2;
const SCREEN_SLEEP_INDEX = 3;
const NUM_STATS = 2;
const STATS_WEATHER_INDEX = 0;
const STATS_CGM_INDEX = 1;
const SENSOR_UPDATE_INTERVAL_MS = 5000;
// Max time a stale HR reading is shown before being zeroed out
const MAX_STALE_HEART_RATE_MS = 5000;
const HEART_RATE_GRAPH_PLOT_INTERVAL_MS = 60 * 1000;

// State
let screenIndex = SCREEN_STATS_INDEX;
let statsIndex = 0;
let lastHrmReadingTimestamp = null;
let lastHrmPlotTimestamp = null;

// Elements
const timeEl = document.getElementById('time');
const secondsEl = document.getElementById('seconds');
const weekdayEl = document.getElementById('weekday');
const dayOfMonthEl = document.getElementById('dayOfMonth');
const stepsEl = document.getElementById('steps');
const distanceEl = document.getElementById('distance');
const weatherEl = document.getElementById('weather');
const cgmEl = document.getElementById('cgm');
const heartRateEl = document.getElementById('heartrate');
const statsEl = document.getElementById('main-stats');
const bgStatsEl = document.getElementById('bg-stats');
const hrStatsEl = document.getElementById('heartrate-stats');
const sleepStatsEl = document.getElementById('sleep-stats');

// Widgets
// Min heart rate is resting heart rate
// Max heart rate calculated by Fitbit is (220 - age)
const hrGraph = new Graph('heartrate-graph', user.restingHeartRate, 220 - user.age);

// Setup sensors
const hrm = new HeartRateSensor();
clock.granularity = 'seconds';

// Listeners
clock.ontick = handleClockTick;
hrm.onreading = handleHeartRateReading;
hrm.onerror = handleHeartRateError;
document.getElementById('screen').onclick = handleScreenClick;
document.getElementById('toggle-stats-container').onclick = handleStatsClick;

// Setup watchface
updateSelectedScreen();
updateSelectedStats();
hrm.start();
updateSensors();
setInterval(updateSensors, SENSOR_UPDATE_INTERVAL_MS);

function updateSensors() {
  // Activity
  const { steps, distance } = today.local;
  stepsEl.text = steps.toLocaleString() || '0';
  // Distance is in meters
  const isMetric = units.distance === 'metric';
  const convertedDistance = (isMetric ? distance / 1000 : distance * 0.00062137).toFixed(1);
  const convertedDistanceWithUnits = isMetric ? `${convertedDistance} km` : `${convertedDistance} mi`;
  distanceEl.text = convertedDistanceWithUnits;

  // Heart Rate
  const timeSinceLastReading = Date.now() - lastHrmReadingTimestamp;
  if (timeSinceLastReading >= MAX_STALE_HEART_RATE_MS) {
    updateHeartRate(0);
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

function handleHeartRateReading() {
  updateHeartRate(hrm.heartRate);
}

function handleHeartRateError() {
  updateHeartRate(0);
}

function updateHeartRate(heartRate) {
  const now = Date.now();
  let heartRateFill;
  
  if (heartRate) {
    // Only use a color if heart rate is valid
    switch (user.heartRateZone(heartRate)) {
      case 'peak':
        heartRateFill = 'fb-red';
        break;
      case 'cardio':
        heartRateFill = 'fb-orange';
        break;
      case 'fat-burn':
        heartRateFill = 'fb-peach';
        break;
      case 'out-of-range':
        heartRateFill = 'fb-mint';
        break;
    }
    
    lastHrmReadingTimestamp = now;
    heartRateEl.text = heartRate
    heartRateEl.style.fill = heartRateFill;
    // TODO show arrow
  } else {
    heartRateEl.text = '--';
    heartRateEl.style.fill = '#ffffff';
    // TODO hide arrow
  }
  
  // Add HR reading to graph
  // NOTE: A point is still plotted even if heartrate is 0
  // or if a new heartrate reading hasn't been seen so that
  // old values will be cleared over time
  if (now - lastHrmPlotTimestamp >= HEART_RATE_GRAPH_PLOT_INTERVAL_MS) {
    lastHrmPlotTimestamp = now;
    
    hrGraph.addValue({
      y: heartRate || 0,
      fill: heartRateFill
    });
  }
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
