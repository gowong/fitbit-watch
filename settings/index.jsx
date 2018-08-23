import settings from '../common/settings';

registerSettingsPage(() =>
  <Page>
    <Section
      title={<Text bold>Weather Settings</Text>}
    >
      <Select
        label="Temperature Units"
        settingsKey={ settings.WEATHER_TEMP_UNITS_KEY }
        options={[
          { name: "Fahrenheit (°F)", value: "f" },
          { name: "Celsius (°C)", value: "c" }
        ]}
      />
    </Section>
  </Page>
);