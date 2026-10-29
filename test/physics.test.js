import { describe, it, expect } from "vitest";
import { calculateHydrodynamics, resolveVehicleParameters, resolveRoadParameters } from "../src/physics.js";

describe("Hydrodynamic Pavement Calculations", () => {
  it("returns dry baseline conditions during dry weather", () => {
    const vParams = resolveVehicleParameters("sedan");
    const rParams = resolveRoadParameters("asphalt");
    const result = calculateHydrodynamics(0.0, vParams, rParams);

    expect(result.water_film_thickness_mm).toBe(0.0);
    expect(result.aquaplane_speed_kmh).toBe(160.0);
    expect(result.friction_coefficient_mu).toBe(0.85);
    expect(result.sensor_degradation_state).toBe("PERCEPTION_NOMINAL");
    expect(result.two_wheel_delay_multiplier).toBe(1.0);
  });

  it("calculates Gallaway water depth and reduces friction under heavy rain", () => {
    const vParams = resolveVehicleParameters("sedan");
    const rParams = resolveRoadParameters("asphalt");
    const result = calculateHydrodynamics(35.0, vParams, rParams);

    // At 35 mm/hr rain on standard 3-lane asphalt, WFT reaches ~1.12 mm
    expect(result.water_film_thickness_mm).toBeGreaterThan(1.0);
    expect(result.aquaplane_speed_kmh).toBeLessThan(85.0);
    expect(result.friction_coefficient_mu).toBeLessThan(0.75);
    expect(result.sensor_degradation_state).toBe("CRITICAL_PULLOVER");
    expect(result.two_wheel_delay_multiplier).toBe(2.4);
  });

  it("applies lower hydroplaning thresholds to worn motorcycle tires", () => {
    const sedan = resolveVehicleParameters("sedan");
    const bike = resolveVehicleParameters("two_wheeler", 180, 2.0); // Worn 2mm tread
    const rParams = resolveRoadParameters("asphalt");

    const resSedan = calculateHydrodynamics(20.0, sedan, rParams);
    const resBike = calculateHydrodynamics(20.0, bike, rParams);

    expect(resBike.aquaplane_speed_kmh).toBeLessThan(resSedan.aquaplane_speed_kmh);
  });
});
