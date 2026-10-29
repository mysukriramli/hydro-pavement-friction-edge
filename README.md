# 🌊 Hydro Pavement Friction Edge (v2.0)

A production-grade, zero-auth RPC micro-edge built on Cloudflare Workers for autonomous vehicle and robotics motion planners. It computes deterministic asphalt hydrodynamics, dynamic water film thickness, and LiDAR attenuation mapping in real-time.

## v2 Architecture Enhancements
1. **Sub-Millisecond H3 Edge Caching**: Utilizes Cloudflare `caches.default` keyed by H3 Res-7 indexing. Concurrent vehicles traversing the same 5 km² hex cell trigger 4ms cache hits instead of redundant API calls.
2. **Parametric Vehicle Profiles**: Implements dynamic Horne Tire Dynamics. Automatically adjusts aquaplaning thresholds based on vehicle weight, tire pressure (`pressure_kpa`), and tread depth (Sedan, Heavy Truck, Two-Wheeler, Delivery Bot).
3. **Route Corridor Batching**: Submit an entire polyline of waypoints via `POST /v1/evaluate-route`. The edge deduplicates the route into spatial H3 cells and computes safety vectors concurrently.
4. **Cryptographic Witness Vector**: Every payload is signed at the edge using `crypto.subtle` (Ed25519/SHA-256) to provide an untamperable audit trail for insurance underwriters and dispatch telemetry logs.
5. **Multi-Sensor Reconciliation**: Bypasses single points of failure. Queries `Open-Meteo` convective radar first, with an automatic sub-second fallback to `NOAA Aviation METAR` terminals.

## Agentic API Usage (Zero Authentication Required)

### 1. Point Evaluation (GET)
```bash
curl "https://<your-worker-subdomain>.workers.dev/v1/evaluate?lat=3.139&lon=101.686&vehicle=heavy_truck"
