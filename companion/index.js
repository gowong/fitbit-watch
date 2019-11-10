import { me } from 'companion';
import { encode } from 'cbor';
import { outbox } from 'file-transfer';
import { geolocation } from 'geolocation';
import { localStorage } from 'local-storage';
import * as messaging from 'messaging';
import { settingsStorage } from 'settings';
import fileTransfer from '../common/file-transfer';
import settings from '../common/settings';

// Constants
const WEATHERBIT_API_KEY = '0002be6b19d04f518ca1b5f262a134cd';
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
    case settings.THEME_ACCENT_COLOR_KEY:
      sendSettingToDevice(event.key);
      break;
    case settings.WEATHER_TEMP_UNITS_KEY:
      updateWeather();
      break;
  }
};
// Treat any launch of the companion app as a "wake"
// This is so that the weather gets updated immediately
// when the watchface is first installed and also
// periodically whenever the app is woken up by the wake timer
handleWake();

// Launch reasons
if (me.launchReasons.settingsChanged) {
  // Update weather if temp units setting is different from the temp units
  // used in the last weather update
  if (localStorage.getItem(STORAGE_KEY_WEATHER_TEMP_UNITS) !== getTemperatureUnitsSetting()) {
    updateWeather();
  }
  // No good way to detect that these settings changed so just send them every time
  // It's fine because updating the UI using these settings is inexpensive
  sendSettingToDevice(settings.THEME_ACCENT_COLOR_KEY);
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
  const coordinates = `lat=${position.coords.latitude}&lon=${position.coords.longitude}`;
  const tempUnits = getTemperatureUnitsSetting() === 'f' ? 'I' : 'M';
  const requestURL = `https://api.weatherbit.io/v2.0/current?${coordinates}&units=${tempUnits}&key=${WEATHERBIT_API_KEY}`;
  return fetch(requestURL)
    .then((response) => {
       return response.json()
        .then((body) => {
          if (!body.data || !body.data.length || body.data[0].temp == null) {
            throw new Error('Weather response missing current temperature');
          }
          const data = body.data[0];

          return {
            airQuality: data.aqi,
            city: data.city_name,
            cloudCover: data.clouds,
            description: data.weather ? data.weather.description : '',
            humidity: data.rh,
            isMetricUnits: tempUnits === 'M',
            precip: data.precip,
            sunriseTimeStr: data.sunrise,
            sunsetTimeStr: data.sunset,
            timestamp: Date.now(),
            temp: Math.round(data.temp),
            uv: data.uv,
            windDirection: data.wind_cdir,
            windSpeed: data.wind_spd
          };
        });
    });
}

function sendSettingToDevice(settingKey) {
  if (messaging.peerSocket.readyState === messaging.peerSocket.OPEN) {
    // This only works for string values (ie. values that don't need to be JSON parsed)
    let value = settingsStorage.getItem(settingKey) || '';
    // Strip quotes from values. Some settings like the ColorSelect stores values as strings with quotes
    value = value.replace(/\"/g, '');
    // Send setting
    messaging.peerSocket.send({
      settingKey: settingKey,
      value: value
    });
  } else {
    console.error('Companion send setting to device error: No peerSocket connection');
  }
}

/* Returns either 'f' or 'c' */
function getTemperatureUnitsSetting() {
  try {
    const setting = JSON.parse(settingsStorage.getItem(settings.WEATHER_TEMP_UNITS_KEY));
    return setting.values[0].value || 'f';
  } catch (error) {
    console.error('Companion get temperature units setting error: ' + error);
    return 'f';
  }
}
