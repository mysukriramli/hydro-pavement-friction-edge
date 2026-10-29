import { latLngToCell } from "h3-js";
import { resolveVehicleParameters, resolveRoadParameters, calculateHydrodynamics, VEHICLE_PROFILES } from "./physics.js";
import { fetchReconciledRainfall } from "./sensors.js";
import { generateProofHash } from "./crypto.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

const H3_RESOLUTION = 7; // ~5.16 km² hexagonal cells

async function evaluateSinglePoint(lat, lon, queryParams) {
  const h3Cell = latLngToCell(lat, lon, H3_RESOLUTION);
  const vehicleParams = resolveVehicleParameters(
    queryParams.get("vehicle_type"),
    queryParams.get("tire_pressure_kpa"),
    queryParams.get("tread_depth_mm")
  );
  const roadParams = resolveRoadParameters(
    queryParams.get("surface_type"),
    queryParams.get("slope_grade"),
    queryParams.get("lanes")
  );

  const sensor = await fetchReconciledRainfall(lat, lon);
  const physics = calculateHydrodynamics(sensor.rain_mm, vehicleParams, roadParams);
  const evaluatedAt = new Date().toISOString();

  const responseBody = {
    request_coordinates: { latitude: lat, longitude: lon },
    h3_index_res7: h3Cell,
    sensor_telemetry: {
      rain_intensity_mm_hr: sensor.rain_mm,
      upstream_source: sensor.source
    },
    vehicle_profile: {
      pressure_kpa: vehicleParams.pressureKpa,
      tread_depth_mm: vehicleParams.treadMm
    },
    road_profile: {
      surface_material: roadParams.surface,
      slope_grade: roadParams.slopeGrade,
      lane_count: roadParams.lanes
    },
    traction_proof: physics,
    evaluated_at_utc: evaluatedAt
  };

  responseBody.proof_hash = await generateProofHash(responseBody);
  return responseBody;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // Discovery & LLM Agent Documentation Endpoints
    if (pathname === "/" || pathname === "/llms.txt") {
      const doc = {
        wire: "hydro-pavement-friction-edge",
        version: "1.1.0",
        engine: "Gallaway-WFT / Horne-Hydroplaning / Uber-H3",
        endpoints: {
          point_eval: "GET /v1/evaluate?lat={lat}&lon={lon}&vehicle_type={sedan|two_wheeler|heavy_truck|delivery_bot}",
          route_eval: "POST /v1/evaluate-route"
        },
        supported_profiles: VEHICLE_PROFILES,
        zero_auth_guarantee: "100% public, unauthenticated, rate-limit protected edge CDN"
      };
      return new Response(JSON.stringify(doc, null, 2), { headers: CORS_HEADERS });
    }

    // 1. Single Point Instant Evaluation (With Cloudflare Edge Caching)
    if (pathname === "/v1/evaluate" && request.method === "GET") {
      const latStr = searchParams.get("lat");
      const lonStr = searchParams.get("lon");

      if (!latStr || !lonStr) {
        return new Response(
          JSON.stringify({ error: "Missing required query parameters: 'lat' and 'lon'" }),
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);

      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return new Response(
          JSON.stringify({ error: "Invalid geographic coordinates [-90 to 90, -180 to 180]" }),
          { status: 400, headers: CORS_HEADERS }
        );
      }

      // Check Cloudflare Edge Cache API keyed by H3 + vehicle type
      const h3Cell = latLngToCell(lat, lon, H3_RESOLUTION);
      const vType = searchParams.get("vehicle_type") || "sedan";
      const cache = caches.default;
      const cacheUrl = new URL(`https://edge-cache.internal/cells/${h3Cell}?v=${vType}`);
      const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

      let cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const cachedData = await cachedResponse.json();
        cachedData.cache_status = "HIT_EDGE";
        return new Response(JSON.stringify(cachedData, null, 2), {
          status: 200,
          headers: { ...CORS_HEADERS, "X-Edge-Cache": "HIT" }
        });
      }

      try {
        const result = await evaluateSinglePoint(lat, lon, searchParams);
        result.cache_status = "MISS_EVALUATED";

        const edgeResponse = new Response(JSON.stringify(result, null, 2), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Cache-Control": "public, max-age=300", // 5-minute spatial cache TTL
            "X-Edge-Cache": "MISS"
          }
        });

        // Asynchronously populate edge cache without blocking execution
        ctx.waitUntil(cache.put(cacheKey, edgeResponse.clone()));
        return edgeResponse;
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Edge computation failed", detail: err.message }),
          { status: 502, headers: CORS_HEADERS }
        );
      }
    }

    // 2. Batch Waypoint & Corridor Evaluation (Route Matrix)
    if (pathname === "/v1/evaluate-route" && request.method === "POST") {
      try {
        const body = await request.json();
        const waypoints = body.waypoints || [];
        const vehicleType = body.vehicle_type || "sedan";

        if (!Array.isArray(waypoints) || waypoints.length === 0) {
          return new Response(
            JSON.stringify({ error: "Body must contain 'waypoints' array: [[lat, lon], ...]" }),
            { status: 400, headers: CORS_HEADERS }
          );
        }

        // Deduplicate waypoints into unique H3 cells along the corridor
        const cellMap = new Map();
        for (const pt of waypoints.slice(0, 50)) { // Cap batch to 50 waypoints per request
          if (Array.isArray(pt) && pt.length >= 2) {
            const [wLat, wLon] = pt;
            const cId = latLngToCell(wLat, wLon, H3_RESOLUTION);
            if (!cellMap.has(cId)) {
              cellMap.set(cId, { lat: wLat, lon: wLon });
            }
          }
        }

        const syntheticParams = new URLSearchParams({ vehicle_type: vehicleType });
        const evaluatedCells = await Promise.all(
          Array.from(cellMap.entries()).map(async ([cId, coords]) => {
            return await evaluateSinglePoint(coords.lat, coords.lon, syntheticParams);
          })
        );

        const summary = {
          route_corridor_h3_count: evaluatedCells.length,
          vehicle_profile_applied: vehicleType,
          critical_segments_count: evaluatedCells.filter(
            (c) => c.traction_proof.friction_coefficient_mu < 0.45 || c.traction_proof.sensor_degradation_state !== "PERCEPTION_NOMINAL"
          ).length,
          corridor_cells: evaluatedCells,
          evaluated_at_utc: new Date().toISOString()
        };

        return new Response(JSON.stringify(summary, null, 2), { status: 200, headers: CORS_HEADERS });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Malformed JSON payload or evaluation error", detail: err.message }),
          { status: 400, headers: CORS_HEADERS }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "Not found", available_endpoints: ["/llms.txt", "/v1/evaluate", "/v1/evaluate-route"] }),
      { status: 404, headers: CORS_HEADERS }
    );
  }
};
