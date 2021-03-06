import { me } from 'appbit';
import clock from 'clock';
import document from 'document';
import { display } from 'display';
import { inbox } from 'file-transfer';
import * as fs from "fs";
import { HeartRateSensor } from 'heart-rate';
import * as messaging from 'messaging';
import { today } from 'user-activity';
import { user } from 'user-profile';
import { preferences, units } from 'user-settings';
import * as utils from '../common/utils';
import fileTransfer from '../common/file-transfer';
import settings from '../common/settings';
import Graph from './graph';

// Constants
// TODO change to 4 when CGM is supported
const NUM_SCREENS = 2;
const SCREEN_STATS_INDEX = 0;
const SCREEN_HR_INDEX = 1;
const SCREEN_WEATHER_INDEX = 2;
const SCREEN_BG_INDEX = 3;
// TODO change to 2 when CGM is supported
const NUM_STATS = 1;
const STATS_WEATHER_INDEX = 0;
const STATS_CGM_INDEX = 1;

const ACTIVITY_UPDATE_INTERVAL_MS = 3000;
// Max time an HR reading is shown before being zeroed out
const MAX_AGE_HR_READING_MS = 8000;
// How often HR readings are plotted on the graph
const HR_GRAPH_PLOT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
// Max age of the most recent HR reading that should be displayed on the graph
const MAX_AGE_HR_GRAPH_VALUES_MS = 20 * 60 * 1000; // 20 minutes

const STATE_FILENAME = 'prev_state.cbor';
const STATE_FILETYPE = 'cbor';
const STATE_KEY_SCREEN_INDEX = 'screen_index';
const STATE_KEY_STATS_INDEX = 'stats_index';
const STATE_KEY_THEME_ACCENT_COLOR = 'theme_accent_color';
const STATE_KEY_HR_GRAPH_VALUES = 'hr_graph_values';
const STATE_KEY_HR_GRAPH_VALUES_TIMESTAMP = 'hr_graph_values_timestamp';

// State
// Load previous state so it can be used in the rest of initialization
const prevState = loadPreviousState();
let screenIndex = prevState[STATE_KEY_SCREEN_INDEX] || SCREEN_STATS_INDEX;
let statsIndex = prevState[STATE_KEY_STATS_INDEX] || STATS_WEATHER_INDEX;
let lastHrmReadingTimestamp = prevState[STATE_KEY_HR_GRAPH_VALUES_TIMESTAMP] || null;
let lastHrmPlotTimestamp = null;
let weatherUpdatedTimestamp = null;
let updateActivityTimer = null;
let themeAccentColor = prevState[STATE_KEY_THEME_ACCENT_COLOR] || 'fb-orange';

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
const weatherDescriptionEl = document.getElementById('weather-description');
const weatherUpdatedEl = document.getElementById('weather-updated');
const cgmEl = document.getElementById('cgm');
const heartRateEl = document.getElementById('heartrate');
const statsEl = document.getElementById('main-stats');
const bgStatsEl = document.getElementById('bg-stats');
const hrStatsEl = document.getElementById('heartrate-stats');
const heartRateSmallEl = document.getElementById('heartrate-small');
const weatherStatsEl = document.getElementById('weather-stats');
const weatherDescriptionTitleEl = document.getElementById('weather-description-title');
const weatherWindEl = document.getElementById('weather-wind');
const weatherHumidityEl = document.getElementById('weather-humidity');
const weatherCloudEl = document.getElementById('weather-cloud');
const weatherPrecipEl = document.getElementById('weather-precip');
const weatherAirQualityEl = document.getElementById('weather-aqi');
const weatherUvEl = document.getElementById('weather-uv');
const weatherSunEl = document.getElementById('weather-sun');
const weatherSunsetEl = document.getElementById('weather-sunset');

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
messaging.peerSocket.onmessage = handleNewMessage;
document.getElementById('screen').onclick = handleScreenClick;
document.getElementById('toggle-stats-container').onclick = handleStatsClick;

// Setup watchface
updateTheme();
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
    if (Date.now() - prevState[STATE_KEY_HR_GRAPH_VALUES_TIMESTAMP] > MAX_AGE_HR_GRAPH_VALUES_MS) {
      delete prevState[STATE_KEY_HR_GRAPH_VALUES];
    }
    return prevState;
  } catch (error) {
    console.error('Device load previous state error: ' + error);
    // State file might not exist
    return {};
  }
}

function handleAppUnload() {
  prevState[STATE_KEY_HR_GRAPH_VALUES] = hrGraph.getValues() || [];
  prevState[STATE_KEY_HR_GRAPH_VALUES_TIMESTAMP] = lastHrmReadingTimestamp || Date.now();
  prevState[STATE_KEY_SCREEN_INDEX] = screenIndex;
  prevState[STATE_KEY_STATS_INDEX] = statsIndex;
  prevState[STATE_KEY_THEME_ACCENT_COLOR] = themeAccentColor;
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

function handleNewMessage(event) {
  if (!!event.data.settingKey) {
    handleSettingChange(event);
    return;
  }
}

function handleSettingChange(event) {
  switch (event.data.settingKey) {
    case settings.THEME_ACCENT_COLOR_KEY:
      themeAccentColor = event.data.value;
      updateTheme();
      break;
  }
}

function updateTheme() {
  document.getElementsByClassName('accent').forEach((element) => {
    element.style.fill = themeAccentColor;
  });
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

  if (heartRate) {
    let heartRateFill;
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

    heartRateEl.text = heartRate
    heartRateEl.style.fill = heartRateFill;
    heartRateSmallEl.text = heartRate
    heartRateSmallEl.style.fill = heartRateFill;

    // Clear graph if the last reading was really old
    if (now - lastHrmReadingTimestamp >= MAX_AGE_HR_GRAPH_VALUES_MS) {
      hrGraph.clearValues();
    }

    // Add HR reading to graph (ignore 0 values)
    if (now - lastHrmPlotTimestamp >= HR_GRAPH_PLOT_INTERVAL_MS) {
      lastHrmPlotTimestamp = now;

      hrGraph.addValue({
        y: heartRate,
        fill: heartRateFill
      });
    }

    lastHrmReadingTimestamp = now;

  } else {
    heartRateEl.text = '--';
    heartRateEl.style.fill = '#ffffff';
    heartRateSmallEl.text = '';
    heartRateSmallEl.style.fill = '#ffffff';
  }
}

function updateWeather() {
  try {
    const weather = fs.readFileSync(fileTransfer.WEATHER_DATA_FILENAME, fileTransfer.WEATHER_DATA_FILETYPE);
    const {
      airQuality,
      location,
      cloudCover,
      description,
      humidity,
      precip,
      sunriseTimeStr,
      sunsetTimeStr,
      timestamp,
      temp,
      uv,
      windDirection,
      windSpeed
    } = weather;

    weatherTempEl.text = `${Math.round(temp)}°`;
    weatherLocationEl.text = location ? location.toUpperCase() : '*';
    weatherUpdatedTimestamp = timestamp;
    weatherDescriptionEl.text = description ? description.toUpperCase() : '';
    weatherDescriptionTitleEl.text = description ? description.toUpperCase() : '';
    weatherWindEl.text = `WIND: ${Math.round(windSpeed)} ${windDirection}`;
    weatherHumidityEl.text = `HUM: ${humidity ? Math.round(humidity) + '%' : '*'}`;
    weatherCloudEl.text = `CLOUD: ${cloudCover ? Math.round(cloudCover) + '%' : '*'}`
    weatherPrecipEl.text = `RAIN: ${precip ? Math.round(precip) + '%' : '*'}`
    weatherAirQualityEl.text = `AIR: ${airQuality || '*'}`;
    weatherUvEl.text = `UV: ${Math.round(uv) || '*'}`;
    weatherSunEl.text = `SUN: ${sunriseTimeStr || '*'} - ${sunsetTimeStr || '*'}`;

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

  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    weatherUpdatedEl.text = `${hours} HR AGO`;
  } else if (minutes >= 45) {
    weatherUpdatedEl.text = `${minutes} MIN AGO`;
  } else {
    weatherUpdatedEl.text = '';
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
  hide(weatherStatsEl);

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
    case SCREEN_WEATHER_INDEX:
      show(weatherStatsEl);
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
