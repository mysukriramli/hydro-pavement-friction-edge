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
## 🤖 LLM Agent Integration & Function Calling

Autonomous agents can invoke this service directly using the tool specification in [`schemas/tool-definition.json`](./schemas/tool-definition.json) or by reading the machine-readable manifest at `/llms.txt`.

### OpenAI / LangChain Tool Integration (Python)

```python
import json
import requests

# Load definition into your LLM tools array
with open("schemas/tool-definition.json") as f:
    hydro_tool_spec = json.load(f)

def run_hydro_tool(lat: float, lon: float, vehicle_type: str = "sedan", **kwargs):
    endpoint = "[https://hydro-pavement-friction-edge.mysukriramli.workers.dev/v1/evaluate](https://hydro-pavement-friction-edge.mysukriramli.workers.dev/v1/evaluate)"
    params = {"lat": lat, "lon": lon, "vehicle_type": vehicle_type, **kwargs}
    res = requests.get(endpoint, params=params, timeout=5)
    return res.json()
