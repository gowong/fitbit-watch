import { me } from 'appbit';
import clock from 'clock';
import document from 'document';
import * as fs from "fs";
import { HeartRateSensor } from 'heart-rate';
import { today } from 'user-activity';
import { user } from 'user-profile';
import { preferences, units } from 'user-settings';
import * as utils from '../common/utils';
import Graph from './graph';

// Constants
// TODO change to 3
const NUM_SCREENS = 2;
const SCREEN_STATS_INDEX = 0;
const SCREEN_HR_INDEX = 1;
const SCREEN_BG_INDEX = 2;
const NUM_STATS = 2;
const STATS_WEATHER_INDEX = 0;
const STATS_CGM_INDEX = 1;

const SENSOR_UPDATE_INTERVAL_MS = 5000;
// Max time an HR reading is shown before being zeroed out
const MAX_AGE_HR_READING_MS = 5000;
// How often HR readings are plotted on the graph
const HR_GRAPH_PLOT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const SETTINGS_FILENAME = 'settings.cbor';
const SETTINGS_FILETYPE = 'cbor';
const SETTINGS_KEY_HR_GRAPH_VALUES = 'hr_graph_values';
const SETTINGS_KEY_HR_GRAPH_VALUES_TIMESTAMP = 'hr_graph_values_timestamp';
// Max age of usable HR graph values loaded from settings
const SETTINGS_MAX_AGE_HR_GRAPH_VALUES_MS = HR_GRAPH_PLOT_INTERVAL_MS;

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

// Load settings so it can be used in the rest of initialization
const settings = loadSettings();

// Widgets
let hrGraph;
initializeGraphs();

// Setup sensors
const hrm = new HeartRateSensor();
clock.granularity = 'seconds';

// Listeners
me.onunload = handleAppUnload;
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

function initializeGraphs() {
  // Min heart rate is resting heart rate
  // Max heart rate calculated by Fitbit is (220 - age)
  hrGraph = new Graph('heartrate-graph', user.restingHeartRate, 220 - user.age);
  hrGraph.setValues(settings[SETTINGS_KEY_HR_GRAPH_VALUES]);
}

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
  if (timeSinceLastReading >= MAX_AGE_HR_READING_MS) {
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
  if (now - lastHrmPlotTimestamp >= HR_GRAPH_PLOT_INTERVAL_MS) {
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

function handleAppUnload() {
  settings[SETTINGS_KEY_HR_GRAPH_VALUES] = hrGraph.getValues();
  settings[SETTINGS_KEY_HR_GRAPH_VALUES_TIMESTAMP] = Date.now();
  fs.writeFileSync(SETTINGS_FILENAME, settings, SETTINGS_FILETYPE);
}

function loadSettings() {
  try {
    const settings = fs.readFileSync(SETTINGS_FILENAME, SETTINGS_FILETYPE);
    if (Date.now() - settings[SETTINGS_KEY_HR_GRAPH_VALUES_TIMESTAMP] > SETTINGS_MAX_AGE_HR_GRAPH_VALUES_MS) {
      delete settings[SETTINGS_KEY_HR_GRAPH_VALUES];
    }
    return settings;
  } catch (e) {
    // Settings file might not exist
    return {};
  }
}

function show(element) {
  element.style.display = 'inline';
}

function hide(element) {
  element.style.display = 'none';
}
