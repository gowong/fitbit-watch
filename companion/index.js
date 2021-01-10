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
const HERE_API_KEY = 'YmB0qORP5prqGBDfYJqEAptnLBOf7z9iDmJr0baqlTs';
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
  }).then((position) => {
    const requestURL = `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${position.coords.latitude},${position.coords.longitude}&lang=en-US&apiKey=${HERE_API_KEY}`;

    return fetch(requestURL)
      .then((response) => {
        return response.json()
          .then((body) => {
            const data = body && body.items && body.items[0];
            if (!data) {
              throw new Error('Invalid location response');
            }

            return {
              name: data.address ? (data.address.city || data.address.county || data.address.district || data.address.state || data.address.countryName) : null,
              lat: position.coords.latitude,
              long: position.coords.longitude
            };
          });
      });
  });
}

function getWeather(location) {
  const useMetric = getTemperatureUnitsSetting() === 'f' ? false : true;
  const requestURL = `https://weather.ls.hereapi.com/weather/1.0/report.json?product=observation&oneobservation=true&latitude=${location.lat}&longitude=${location.long}&metric=${useMetric}&apiKey=${HERE_API_KEY}`;

  return fetch(requestURL)
    .then((response) => {
      return response.json()
        .then((body) => {
          const data = body && body.observations && body.observations.location && body.observations.location[0] && body.observations.location[0].observation && body.observations.location[0].observation[0];
          if (!data) {
            throw new Error('Invalid weather response');
          }

          return {
            airQuality: null,
            cloudCover: null,
            description: data.precipitationDesc || data.skyDescription || data.temperatureDesc || null,
            humidity: data.humidity,
            location: location.name,
            precip: data.precipitationProbability,
            sunriseTimeStr: null,
            sunsetTimeStr: null,
            temp: (data.comfort !== '*' && data.comfort) || data.temperature,
            timestamp: Date.parse(data.utcTime) || Date.now(),
            uv: data.uvIndex,
            windDirection: data.windDescShort,
            windSpeed: data.windSpeed
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
