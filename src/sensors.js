export async function fetchReconciledRainfall(lat, lon) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1600); // 1.6s timeout ceiling

  // 1. Primary Open-Meteo High-Resolution Surface Forecast API
  try {
    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation`;
    const res = await fetch(meteoUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "HydroTractionEdge/1.1 (Autonomous AV Safety)" }
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const rain = parseFloat(data.current?.precipitation || 0.0);
      return {
        rain_mm: Math.max(0.0, rain),
        source: "OPEN_METEO_SURFACE"
      };
    }
  } catch (err) {
    // Upstream network failure or timeout: advance to METAR fallback
  }

  // 2. Fallback: NOAA Aviation Weather Center Optical METAR Sensor
  try {
    const metarUrl = `https://aviationweather.gov/api/data/metar?lat=${lat}&lon=${lon}&format=json`;
    const metarRes = await fetch(metarUrl, {
      headers: { "User-Agent": "HydroTractionEdge/1.1 (Autonomous AV Safety)" }
    });
    if (metarRes.ok) {
      const records = await metarRes.json();
      if (Array.isArray(records) && records.length > 0) {
        const raw = records[0].rawOb || "";
        let metarRain = 0.0;
        if (raw.includes("+RA") || raw.includes("+TSRA")) metarRain = 35.0;
        else if (raw.includes("RA") || raw.includes("TSRA")) metarRain = 15.0;
        else if (raw.includes("-RA") || raw.includes("DZ")) metarRain = 3.5;

        return {
          rain_mm: metarRain,
          source: `NOAA_METAR_FALLBACK_${records[0].icaoId || "STATION"}`
        };
      }
    }
  } catch (err) {
    // Both zero-auth sources unavailable
  }

  return {
    rain_mm: 0.0,
    source: "FAILSAFE_NOMINAL_CLEAR"
  };
}
