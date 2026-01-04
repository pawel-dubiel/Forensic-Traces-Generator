const assertPositiveFinite = (value, label, material) => {
    if (!Number.isFinite(value) || value <= 0) {
        const prefix = material ? `${material} ` : '';
        throw new Error(`${prefix}${label} must be a positive finite number`);
    }
};
export const validateElasticPlasticMaterial = (material, name) => {
    assertPositiveFinite(material.youngModulusGPa, 'youngModulusGPa', name);
    assertPositiveFinite(material.yieldStrengthMPa, 'yieldStrengthMPa', name);
    assertPositiveFinite(material.hardeningModulusMPa, 'hardeningModulusMPa', name);
};
// Sources:
// - Aluminum, Brass: https://www.engineeringtoolbox.com/young-modulus-d_417.html
// - Steel (A36): https://en.wikipedia.org/wiki/A36_steel
// - Wood (Pine, along grain): https://www.engineeringtoolbox.com/timber-mechanical-properties-d_1789.html
// - Gold E + hardness: https://en.wikipedia.org/wiki/Gold (yield estimated from hardness)
// Note: hardeningModulusMPa values are heuristic and should be calibrated per alloy.
export const ELASTIC_PLASTIC_MATERIALS = {
    aluminum: { youngModulusGPa: 69, yieldStrengthMPa: 95, hardeningModulusMPa: 1500 },
    brass: { youngModulusGPa: 110, yieldStrengthMPa: 250, hardeningModulusMPa: 2000 },
    steel: { youngModulusGPa: 200, yieldStrengthMPa: 250, hardeningModulusMPa: 4000 },
    wood: { youngModulusGPa: 11, yieldStrengthMPa: 80, hardeningModulusMPa: 200 },
    gold: { youngModulusGPa: 79, yieldStrengthMPa: 70, hardeningModulusMPa: 1200 },
};
export const getElasticPlasticMaterial = (material) => {
    const props = ELASTIC_PLASTIC_MATERIALS[material];
    if (!props) {
        throw new Error(`Missing elastic-plastic material properties for "${material}"`);
    }
    validateElasticPlasticMaterial(props, material);
    return props;
};
export class ElasticPlasticModel {
    youngModulusMPa;
    yieldStrengthMPa;
    hardeningModulusMPa;
    constructor(material) {
        validateElasticPlasticMaterial(material);
        this.youngModulusMPa = material.youngModulusGPa * 1000;
        this.yieldStrengthMPa = material.yieldStrengthMPa;
        this.hardeningModulusMPa = material.hardeningModulusMPa;
    }
    computePermanentDepth(penetration, characteristicLength, plasticStrain) {
        if (!Number.isFinite(penetration) || penetration < 0) {
            throw new Error('penetration must be a non-negative finite number');
        }
        if (!Number.isFinite(characteristicLength) || characteristicLength <= 0) {
            throw new Error('characteristicLength must be a positive finite number');
        }
        if (!Number.isFinite(plasticStrain) || plasticStrain < 0) {
            throw new Error('plasticStrain must be a non-negative finite number');
        }
        if (penetration === 0) {
            return { permanentDepth: 0, plasticStrainIncrement: 0, elasticStrain: 0, totalStrain: 0 };
        }
        const totalStrain = penetration / characteristicLength;
        if (totalStrain <= 0) {
            return { permanentDepth: 0, plasticStrainIncrement: 0, elasticStrain: 0, totalStrain };
        }
        const effectiveYield = this.yieldStrengthMPa + (this.hardeningModulusMPa * plasticStrain);
        const elasticStrainLimit = effectiveYield / this.youngModulusMPa;
        const elasticStrain = Math.min(totalStrain, elasticStrainLimit);
        const plasticStrainIncrement = Math.max(0, totalStrain - elasticStrain);
        const permanentFraction = plasticStrainIncrement / totalStrain;
        const permanentDepth = penetration * permanentFraction;
        return { permanentDepth, plasticStrainIncrement, elasticStrain, totalStrain };
    }
}
