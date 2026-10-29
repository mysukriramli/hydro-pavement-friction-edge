# 🌊 Hydro Pavement Friction Edge Wire

A zero-authentication, edge-native micro-service deployed on Cloudflare Workers. It ingests open meteorological sensors on-demand and computes deterministic road hydrodynamics, aquaplaning thresholds, friction coefficients, and LiDAR degradation states for autonomous vehicles (AVs), delivery robots, and on-demand dispatch swarms.

## Architecture Highlights
- **Sub-Millisecond Edge Caching**: Caches spatial evaluations across Uber H3 Resolution-7 cells via `caches.default`.
- **Closed-Form Physical Formulations**: Implements Gallaway Water Film Thickness (WFT) and Horne NASA Dynamic Hydroplaning velocity equations.
- **Parametric Vehicle Profiles**: Tailored physics for sedans, delivery motorcycles/e-bikes, commercial trucks, and sidewalk robots.
- **Failover Sensor Ingestion**: Primary Open-Meteo surface precipitation API with zero-auth fallback to NOAA Aviation Weather METAR optical runway sensors.
- **Cryptographic Audit Trail**: Each response includes a deterministic SHA-256 witness hash for insurance underwriting and dispatch audit logs.

## API Specification

### 1. Instant Point Evaluation
```bash
curl -X GET "https://hydro-pavement-friction-edge.<subdomain>.workers.dev/v1/evaluate?lat=3.1390&lon=101.6869&vehicle_type=two_wheeler"
