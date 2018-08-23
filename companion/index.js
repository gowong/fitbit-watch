import { me } from 'companion';
import { encode } from 'cbor';
import { outbox } from 'file-transfer';
import { geolocation } from 'geolocation';
import { localStorage } from 'local-storage';
import { settingsStorage } from 'settings';
import fileTransfer from '../common/file-transfer';
import settings from '../common/settings';

// Constants
const WAKE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const GEOLOCATION_TIMEOUT_MS = 60 * 1000; // 1 minute
const GEOLOCATION_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
// Decrease slightly so it doesn't fall exactly on N * WAKE_INTERVAL_MS
const WEATHER_UPDATE_INTERVAL_MS = (60 * 60 * 1000) - (5 * 60 * 1000); // 55 minutes

const STORAGE_KEY_WEATHER_TIMESTAMP = 'weather_timestamp';
const STORAGE_KEY_WEATHER_TEMP_UNITS = 'weather_temperature_units';

// State
let wakeTimer = null;

// Setup
// Wake interval periodically wakes the companion app
// ONLY IF the companion app is NOT currently running
me.wakeInterval = WAKE_INTERVAL_MS;
// Setup timer that will execute periodically
// ONLY IF the companion app is currently running
setupTimer();
// Listen to setting changes while companion app is running
settingsStorage.onchange = (event) => {
  switch (event.key) {
    case settings.WEATHER_TEMP_UNITS_KEY:
      updateWeather();
      break;
  }
};

// Launch reasons
if (me.launchReasons.wokenUp) {
  handleWake();
}
if (me.launchReasons.settingsChanged) {
  // Update weather if temp units setting is different from the temp units
  // used in the last weather update
  if (localStorage.getItem(STORAGE_KEY_WEATHER_TEMP_UNITS) !== getTemperatureUnitsSetting()) {
    updateWeather();
  }
}

function setupTimer() {
  clearInterval(wakeTimer);
  wakeTimer = setInterval(handleWake, WAKE_INTERVAL_MS);
}

function handleWake() {
  // Perform periodic data updates
  const now = Date.now();
  // Update weather if needed
  const lastWeatherUpdateTimestamp = parseInt(localStorage.getItem(STORAGE_KEY_WEATHER_TIMESTAMP), 10) || 0;
  if (now - lastWeatherUpdateTimestamp >= WEATHER_UPDATE_INTERVAL_MS) {
    updateWeather();
  }
}

function updateWeather() {
  getLocation()
    .then(getWeather)
    .then((weather) => {
      // Write weather data to file and transfer to watch
      return outbox.enqueue(fileTransfer.WEATHER_DATA_FILENAME, encode(weather))
        .then((ft) => {
          localStorage.setItem(STORAGE_KEY_WEATHER_TIMESTAMP, `${weather.timestamp}`);
          localStorage.setItem(STORAGE_KEY_WEATHER_TEMP_UNITS, `${getTemperatureUnitsSetting()}`);
        });
    }).catch((error) => {
      console.error('Companion update weather error: ' + error);
    });
}

function getLocation() {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition((position) => {
      resolve(position);
    }, (error) => {
      reject(error);
    }, {
      enableHighAccuracy: false,
      maximumAge: GEOLOCATION_MAX_AGE_MS,
      timeout: GEOLOCATION_TIMEOUT_MS
    });
  });
}

function getWeather(position) {
  const coordinates = `${position.coords.latitude},${position.coords.longitude}`;
  const tempUnits = getTemperatureUnitsSetting();
  const queryString = 'select item.condition,location from weather.forecast where woeid in'
    + `(SELECT woeid FROM geo.places(1) WHERE text="(${coordinates})") and u="${tempUnits}"`;
  const requestURL = `https://query.yahooapis.com/v1/public/yql?q=${queryString}&format=json`;
  return fetch(requestURL)
    .then((response) => {
       return response.json()
        .then((data) => {
          return {
            temp: data.query.results.channel.item.condition.temp,
            city: data.query.results.channel.location.city,
            timestamp: Date.now()
          };
        });
    });
}

function getTemperatureUnitsSetting() {
  try {
    const setting = JSON.parse(settingsStorage.getItem(settings.WEATHER_TEMP_UNITS_KEY));
    return setting.values[0].value || 'f';
  } catch (error) {
    console.error('Companion get temperature units setting error: ' + error);
    return 'f';
  }
}