import settings from '../common/settings';

registerSettingsPage(() =>
  <Page>
    <Section
      title={<Text bold>Theme Settings</Text>}
    >
      <ColorSelect
        settingsKey={ settings.THEME_ACCENT_COLOR_KEY }
        colors={[
          // fb-light-gray
          { color: "#A0A0A0" },
          // fb-lavender
          { color: "#BCD8F8" },
          // fb-violet
          { color: "#D828B8" },
          // fb-purple
          { color: "#BD4EFC" },
          // fb-cerulean
          { color: "#8080FF" },
          // fb-blue
          { color: "#3182DE" },
          // fb-cyan
          { color: "#14D3F5" },
          // fb-aqua
          { color: "#3BF7DE" },
          // fb-mint
          { color: "#5BE37D" },
          // fb-yellow
          { color: "#E4FA3C" },
          // fb-orange
          { color: "#FC6B3A" },
          // fb-pink
          { color: "#F83478" },
        ]}
      />
    </Section>
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