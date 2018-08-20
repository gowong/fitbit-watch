import { me } from 'appbit';
import clock from 'clock';
import document from 'document';
import { display } from 'display';
import { inbox } from 'file-transfer';
import * as fs from "fs";
import { HeartRateSensor } from 'heart-rate';
import { today } from 'user-activity';
import { user } from 'user-profile';
import { preferences, units } from 'user-settings';
import * as utils from '../common/utils';
import fileTransfer from '../common/file-transfer';
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

const ACTIVITY_UPDATE_INTERVAL_MS = 3000;
// Max time an HR reading is shown before being zeroed out
const MAX_AGE_HR_READING_MS = 5000;
// How often HR readings are plotted on the graph
const HR_GRAPH_PLOT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const STATE_FILENAME = 'prev_state.cbor';
const STATE_FILETYPE = 'cbor';
const STATE_KEY_SCREEN_INDEX = 'screen_index';
const STATE_KEY_STATS_INDEX = 'stats_index';
const STATE_KEY_HR_GRAPH_VALUES = 'hr_graph_values';
const STATE_KEY_HR_GRAPH_VALUES_TIMESTAMP = 'hr_graph_values_timestamp';
// Max age of usable HR graph values loaded from previous state
const STATE_MAX_AGE_HR_GRAPH_VALUES_MS = HR_GRAPH_PLOT_INTERVAL_MS;

// State
// Load previous state so it can be used in the rest of initialization
const prevState = loadPreviousState();
let screenIndex = prevState[STATE_KEY_SCREEN_INDEX] || SCREEN_STATS_INDEX;
let statsIndex = prevState[STATE_KEY_STATS_INDEX] || STATS_WEATHER_INDEX;
let lastHrmReadingTimestamp = null;
let lastHrmPlotTimestamp = null;
let weatherUpdatedTimestamp = null;
let updateActivityTimer = null;

// Elements
const timeEl = document.getElementById('time');
const secondsEl = document.getElementById('seconds');
const weekdayEl = document.getElementById('weekday');
const dayOfMonthEl = document.getElementById('dayOfMonth');
const stepsEl = document.getElementById('steps');
const distanceEl = document.getElementById('distance');
const weatherEl = document.getElementById('weather');
const weatherTempEl = document.getElementById('weather-temperature');
const weatherLocationEl = document.getElementById('weather-location');
const weatherUpdatedEl = document.getElementById('weather-updated');
const cgmEl = document.getElementById('cgm');
const heartRateEl = document.getElementById('heartrate');
const statsEl = document.getElementById('main-stats');
const bgStatsEl = document.getElementById('bg-stats');
const hrStatsEl = document.getElementById('heartrate-stats');

// Widgets
let hrGraph;
initializeGraphs();

// Setup sensors
const hrm = new HeartRateSensor();
clock.granularity = 'seconds';

// Listeners
me.onunload = handleAppUnload;
display.onchange = handleDisplayChange;
clock.ontick = handleClockTick;
hrm.onreading = handleHeartRateReading;
hrm.onerror = handleHeartRateError;
inbox.onnewfile = handleNewFiles;
document.getElementById('screen').onclick = handleScreenClick;
document.getElementById('toggle-stats-container').onclick = handleStatsClick;

// Setup watchface
updateSelectedScreen();
updateSelectedStats();
hrm.start();
updateActivity();
updateWeather();
handleNewFiles();
setupTimers();

function loadPreviousState() {
  try {
    const prevState = fs.readFileSync(STATE_FILENAME, STATE_FILETYPE);
    if (Date.now() - prevState[STATE_KEY_HR_GRAPH_VALUES_TIMESTAMP] > STATE_MAX_AGE_HR_GRAPH_VALUES_MS) {
      delete prevState[STATE_KEY_HR_GRAPH_VALUES];
    }
    return prevState;
  } catch (e) {
    console.error('Device load previous state error: ' + error);
    // State file might not exist
    return {};
  }
}

function handleAppUnload() {
  prevState[STATE_KEY_HR_GRAPH_VALUES] = hrGraph.getValues();
  prevState[STATE_KEY_HR_GRAPH_VALUES_TIMESTAMP] = Date.now();
  prevState[STATE_KEY_SCREEN_INDEX] = screenIndex;
  prevState[STATE_KEY_STATS_INDEX] = statsIndex;
  fs.writeFileSync(STATE_FILENAME, prevState, STATE_FILETYPE);
}

function handleNewFiles() {
  let fileName; while (fileName = inbox.nextFile()) {
    switch (fileName) {
      case fileTransfer.WEATHER_DATA_FILENAME:
        updateWeather();
        break;
    }
  }
}

function handleDisplayChange() {
  const isDisplayOn = this.on;
  if (isDisplayOn) {
    setupTimers();
    // Execute immediately in case display wasn't on for long enough for timers to execute
    updateActivity();
    // Only update weather time when display wakes up since the timestamp isn't
    // very important and it only needs to be updated every minute anyways
    updateWeatherTime();
  } else {
    clearTimers();
  }
}

function setupTimers() {
  clearTimers();
  updateActivityTimer = setInterval(updateActivity, ACTIVITY_UPDATE_INTERVAL_MS);
}

function clearTimers() {
  clearInterval(updateActivityTimer);
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

function updateActivity() {
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

function initializeGraphs() {
  // Min heart rate is resting heart rate
  // Max heart rate calculated by Fitbit is (220 - age)
  hrGraph = new Graph('heartrate-graph', user.restingHeartRate, 220 - user.age);
  hrGraph.setValues(prevState[STATE_KEY_HR_GRAPH_VALUES]);
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
  try {
    const weather = fs.readFileSync(fileTransfer.WEATHER_DATA_FILENAME, fileTransfer.WEATHER_DATA_FILETYPE);
    weatherTempEl.text = `${weather.temp}°`;
    weatherLocationEl.text = weather.city.toUpperCase();
    weatherUpdatedTimestamp = weather.timestamp;
    updateWeatherTime();
  } catch (error) {
    // Weather file might not exist (if weather hasn't been loaded before)
    console.error('Device update weather error: ' + error);
  }
}

function updateWeatherTime() {
  if (!weatherUpdatedTimestamp) {
    return;
  }
  const timeDiff = Date.now() - (new Date(weatherUpdatedTimestamp)).getTime();
  const minutes = Math.round(timeDiff / 60 / 1000);
  if (minutes <= 1) {
    weatherUpdatedEl.text = "NOW";
  } else if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    weatherUpdatedEl.text = `${hours} HR AGO`;
  } else {
    weatherUpdatedEl.text = `${minutes} MIN AGO`;
  }
}

function updateCGM() {
  // TODO change color based on BG
  // TODO read data from file
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

function show(element) {
  element.style.display = 'inline';
}

function hide(element) {
  element.style.display = 'none';
}
