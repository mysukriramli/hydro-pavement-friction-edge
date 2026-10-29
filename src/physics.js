export const VEHICLE_PROFILES = {
  sedan: { pressure_kpa: 220, tread_mm: 7.0, description: "Standard passenger car / robotaxi" },
  two_wheeler: { pressure_kpa: 190, tread_mm: 4.5, description: "Motorcycle / scooter delivery" },
  heavy_truck: { pressure_kpa: 750, tread_mm: 12.0, description: "Commercial Class 8 freight truck" },
  delivery_bot: { pressure_kpa: 150, tread_mm: 3.0, description: "Low-speed sidewalk / road cargo bot" }
};

export const SURFACE_TEXTURE_DEPTHS = {
  asphalt: 0.50,
  porous_asphalt: 1.20,
  concrete: 0.35,
  sett_paving: 1.80
};

export function resolveVehicleParameters(vehicleType, customKpa, customTreadMm) {
  const profile = VEHICLE_PROFILES[vehicleType] || VEHICLE_PROFILES.sedan;
  const pressureKpa = customKpa ? parseFloat(customKpa) : profile.pressure_kpa;
  const treadMm = customTreadMm !== undefined ? parseFloat(customTreadMm) : profile.tread_mm;
  return { pressureKpa, treadMm };
}

export function resolveRoadParameters(surfaceType, customSlope, customLanes) {
  const surface = SURFACE_TEXTURE_DEPTHS[surfaceType] ? surfaceType : "asphalt";
  const T = SURFACE_TEXTURE_DEPTHS[surface];
  const slopeGrade = customSlope ? Math.max(0.005, parseFloat(customSlope)) : 0.02; // Default 2% cross-slope
  const lanes = customLanes ? Math.max(1, parseInt(customLanes, 10)) : 3;
  const L = lanes * 3.65; // Lane drainage path in meters
  return { surface, T, slopeGrade, lanes, L };
}

export function calculateHydrodynamics(rainMmHr, vehicleParams, roadParams) {
  const { pressureKpa, treadMm } = vehicleParams;
  const { surface, T, slopeGrade, L } = roadParams;

  if (rainMmHr <= 0.1) {
    return {
      water_film_thickness_mm: 0.0,
      aquaplane_speed_kmh: 160.0,
      friction_coefficient_mu: surface === "concrete" ? 0.80 : 0.85,
      sensor_degradation_state: "PERCEPTION_NOMINAL",
      two_wheel_delay_multiplier: 1.0,
      flash_flood_risk_level: "LOW"
    };
  }

  // Gallaway Water Film Thickness (WFT) empirical formulation in SI metric units:
  // WFT = 0.01485 * [ (L^0.43 * I^0.59 * T^0.11) / (S^0.42) ] - T
  const wftRaw = 0.01485 * ((Math.pow(L, 0.43) * Math.pow(rainMmHr, 0.59) * Math.pow(T, 0.11)) / Math.pow(slopeGrade, 0.42)) - T;
  const wft = Math.max(0.0, Number(wftRaw.toFixed(2)));

  // Horne Dynamic Hydroplaning Velocity (NASA / FAA) adjusted for residual tire tread depth
  const baseVp = 6.35 * Math.sqrt(pressureKpa);
  const treadFactor = Math.pow(Math.max(0.1, treadMm / 8.0), 0.15);
  const aquaplaneSpeed = Math.max(
    30.0,
    Number((baseVp * treadFactor * (1.0 - Math.min(0.5, wft / 6.0))).toFixed(1))
  );

  // Dynamic Pavement Friction Coefficient (mu)
  const baseMu = surface === "concrete" ? 0.78 : 0.82;
  const mu = Math.max(0.15, Number((baseMu - (wft * 0.11)).toFixed(2)));

  // Autonomous Perception Degradation (LiDAR backscatter & optical occlusion)
  let sensorState = "PERCEPTION_NOMINAL";
  if (rainMmHr >= 25.0 || wft > 3.0) {
    sensorState = "CRITICAL_PULLOVER";
  } else if (rainMmHr >= 10.0 || wft > 1.2) {
    sensorState = "PERCEPTION_DEGRADED";
  }

  // Two-Wheel Delivery Delay Multiplier (Grab / Uber Eats rider sheltering behavior)
  let delayMult = 1.0;
  if (rainMmHr >= 30.0) delayMult = 2.4;
  else if (rainMmHr >= 12.0) delayMult = 1.6;
  else if (rainMmHr >= 3.0) delayMult = 1.2;

  // Localized Ponding / Flash Inundation Risk
  let floodRisk = "LOW";
  if (wft > 3.5 && rainMmHr > 25.0) floodRisk = "HIGH";
  else if (wft > 1.8) floodRisk = "MEDIUM";

  return {
    water_film_thickness_mm: wft,
    aquaplane_speed_kmh: aquaplaneSpeed,
    friction_coefficient_mu: mu,
    sensor_degradation_state: sensorState,
    two_wheel_delay_multiplier: delayMult,
    flash_flood_risk_level: floodRisk
  };
}
