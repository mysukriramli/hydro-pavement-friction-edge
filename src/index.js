import { latLngToCell } from "h3-js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

// --- Enhancement 2: Parametric Vehicle Profiles ---
function getVehicleTireParameters(vehicleType, customKpa, customTreadMm) {
  const profiles = {
    sedan: { pressure_kpa: 220, tread_mm: 7.0 },
    two_wheeler: { pressure_kpa: 190, tread_mm: 4.5 },
    heavy_truck: { pressure_kpa: 750, tread_mm: 12.0 },
    delivery_bot: { pressure_kpa: 150, tread_mm: 3.0 }
  };
  const selected = profiles[vehicleType] || profiles.sedan;
  return {
    pressureKpa: customKpa || selected.pressure_kpa,
    treadMm: customTreadMm !== undefined ? customTreadMm : selected.tread_mm
  };
}

// --- Core Hydrodynamic Physics (Gallaway & Horne) ---
function calculateHydrodynamics(rainMmHr, vehicleParams, roadParams) {
  const { pressureKpa, treadMm } = vehicleParams;
  const { slopeGrade = 0.02, lanes = 3, surfaceType = "asphalt" } = roadParams;

  const textureDepths = { porous_asphalt: 1.2, asphalt: 0.5, concrete: 0.35, cobblestone: 1.8 };
  const T = textureDepths[surfaceType] || 0.5;
  const L = lanes * 3.65;

  if (rainMmHr <= 0.1) {
    return {
      water_film_thickness_mm: 0.0,
      aquaplane_speed_kmh: 160.0,
      friction_coefficient_mu: surfaceType === "concrete" ? 0.80 : 0.85,
      sensor_degradation_state: "PERCEPTION_NOMINAL",
      flash_flood_risk_level: "LOW"
    };
  }

  // Gallaway Equation for Water Film Thickness (WFT)
  const wft = Math.max(0.0, Number((0.00338 * ((Math.pow(L, 0.43) * Math.pow(rainMmHr, 0.59) * Math.pow(T, 0.11)) / Math.pow(slopeGrade, 0.42)) - T).toFixed(2)));

  // Horne Equation for Dynamic Hydroplaning (Adjusted for Tread Wear)
  const baseVp = 6.35 * Math.sqrt(pressureKpa);
  const treadFactor = Math.pow(Math.max(0.1, treadMm / 8.0), 0.15);
  const aquaplaneSpeed = Math.max(30.0, Number((baseVp * treadFactor * (1.0 - Math.min(0.5, wft / 6.0))).toFixed(1)));

  // Pavement Friction Coefficient (mu)
  const baseMu = surfaceType === "concrete" ? 0.78 : 0.82;
  const mu = Math.max(0.15, Number((baseMu - wft * 0.12).toFixed(2)));

  let sensorState = "PERCEPTION_NOMINAL";
  if (rainMmHr >= 25.0 || wft > 3.0) sensorState = "CRITICAL_PULLOVER";
  else if (rainMmHr >= 10.0 || wft > 1.2) sensorState = "PERCEPTION_DEGRADED";

  let floodRisk = "LOW";
  if (wft > 4.0 && rainMmHr > 30.0) floodRisk = "HIGH";
  else if (wft > 2.0) floodRisk = "MEDIUM";

  return {
    water_film_thickness_mm: wft,
    aquaplane_speed_kmh: aquaplaneSpeed,
    friction_coefficient_mu: mu,
    sensor_degradation_state: sensorState,
    flash_flood_risk_level: floodRisk
  };
}

// --- Enhancement 5: Multi-Sensor Weather Reconciliation ---
async function fetchReconciledRainfall(lat, lon) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s hard ceiling

  try {
    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation`;
    const res = await fetch(meteoUrl, { signal: controller.signal, headers: { "User-Agent": "HydroTractionWire-CF-Worker/2.0" } });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      return { rain_mm: data.current?.precipitation || 0.0, source: "OPEN_METEO_CONVECTIVE" };
    }
  } catch (e) { /* Proceed to fallback on timeout/error */ }

  try {
    const metarUrl = `https://aviationweather.gov/api/data/metar?lat=${lat}&lon=${lon}&format=json`;
    const metarRes = await fetch(metarUrl);
    if (metarRes.ok) {
      const records = await metarRes.json();
      if (records.length > 0) {
        const raw = records[0].rawOb || "";
        let rainRate = 0.0;
        if (raw.includes("+RA") || raw.includes("+TSRA")) rainRate = 35.0;
        else if (raw.includes("RA") || raw.includes("TSRA")) rainRate = 15.0;
        else if (raw.includes("-RA") || raw.includes("DZ")) rainRate = 3.0;
        return { rain_mm: rainRate, source: `NOAA_METAR_FALLBACK_${records[0].icaoId || 'UNKN'}` };
      }
    }
  } catch (err) { /* Total sensor failure */ }

  return { rain_mm: 0.0, source: "DRY_ASSUMPTION_FAILSAFE" };
}

// --- Enhancement 4: Cryptographic Proof Witness Vector ---
async function generateWitnessProof(payload) {
  const canonicalString = JSON.stringify(payload, Object.keys(payload).sort());
  const msgUint8 = new TextEncoder().encode(canonicalString);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function evaluateCoordinate(lat, lon, vehicleType) {
  const h3Index = latLngToCell(lat, lon, 7);
  const weather = await fetchReconciledRainfall(lat, lon);
  const vParams = getVehicleTireParameters(vehicleType);
  const physics = calculateHydrodynamics(weather.rain_mm, vParams, {});

  const payload = {
    request_coordinates: { latitude: lat, longitude: lon },
    h3_index_res7: h3Index,
    vehicle_profile_used: vehicleType,
    sensor_source: weather.source,
    rain_intensity_mm_hr: weather.rain_mm,
    ...physics,
    evaluated_at_utc: new Date().toISOString()
  };

  payload.proof_hash = `sha256:${await generateWitnessProof(payload)}`;
  return payload;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/llms.txt") {
      return new Response(JSON.stringify({
        wire: "hydro-pavement-friction-edge",
        status: "operational",
        endpoints: {
          single_point: "GET /v1/evaluate?lat={lat}&lon={lon}&vehicle={sedan|two_wheeler|heavy_truck}",
          route_batch: "POST /v1/evaluate-route"
        }
      }, null, 2), { headers: CORS_HEADERS });
    }

    // --- Single Point Evaluation with Enhancement 1 (Edge Caching) ---
    if (url.pathname === "/v1/evaluate" && request.method === "GET") {
      const lat = parseFloat(url.searchParams.get("lat"));
      const lon = parseFloat(url.searchParams.get("lon"));
      const vehicleType = url.searchParams.get("vehicle") || "sedan";

      if (isNaN(lat) || isNaN(lon)) {
        return new Response(JSON.stringify({ error: "Missing/invalid 'lat' or 'lon'" }), { status: 400, headers: CORS_HEADERS });
      }

      const h3Index = latLngToCell(lat, lon, 7);
      const cache = caches.default;
      const cacheKey = new Request(`https://hydro-edge.internal/cache/${h3Index}/${vehicleType}`);

      let cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const data = await cachedResponse.json();
        data.cache_hit = true;
        return new Response(JSON.stringify(data, null, 2), { status: 200, headers: { ...CORS_HEADERS, "X-Edge-Cache": "HIT" } });
      }

      const payload = await evaluateCoordinate(lat, lon, vehicleType);
      
      const responseToClient = new Response(JSON.stringify({ ...payload, cache_hit: false }, null, 2), { status: 200, headers: CORS_HEADERS });
      const responseToCache = new Response(JSON.stringify({ ...payload, cache_hit: true }), { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" } });
      
      ctx.waitUntil(cache.put(cacheKey, responseToCache));
      return responseToClient;
    }

    // --- Enhancement 3: Waypoint & Route Corridor Batch Evaluation ---
    if (url.pathname === "/v1/evaluate-route" && request.method === "POST") {
      try {
        const body = await request.json();
        const waypoints = body.waypoints || [];
        const vehicleType = body.vehicle_type || "sedan";

        if (!Array.isArray(waypoints) || waypoints.length === 0) {
          return new Response(JSON.stringify({ error: "Provide an array of [lat, lon] waypoints" }), { status: 400, headers: CORS_HEADERS });
        }

        // De-duplicate waypoints into distinct H3 cells to minimize computations & API calls
        const cellMap = new Map();
        for (const [wLat, wLon] of waypoints) {
          const cell = latLngToCell(wLat, wLon, 7);
          if (!cellMap.has(cell)) cellMap.set(cell, { lat: wLat, lon: wLon });
        }

        const results = await Promise.all(
          Array.from(cellMap.entries()).map(async ([cell, coords]) => {
            return await evaluateCoordinate(coords.lat, coords.lon, vehicleType);
          })
        );

        return new Response(JSON.stringify({
          route_cells_evaluated: results.length,
          critical_segments_count: results.filter(r => r.friction_coefficient_mu < 0.40).length,
          corridor: results
        }, null, 2), { headers: CORS_HEADERS });

      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON or batch processing failed." }), { status: 400, headers: CORS_HEADERS });
      }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS_HEADERS });
  }
};
