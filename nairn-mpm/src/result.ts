import type { ExtractedParticle, NormalizedResult, Scenario } from './types.js';

const finiteOrNull = (value: number) => (Number.isFinite(value) ? value : null);

export const normalizeParticles = (
  scenario: Scenario,
  particles: ExtractedParticle[],
  sourcePaths: NormalizedResult['metadata']['sourcePaths'],
  solverCommand?: string[],
  warnings: string[] = []
): NormalizedResult => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxDisplacement = -Infinity;
  let maxDamage = -Infinity;

  for (const particle of particles) {
    minX = Math.min(minX, particle.x);
    maxX = Math.max(maxX, particle.x);
    minY = Math.min(minY, particle.y);
    maxY = Math.max(maxY, particle.y);

    if (particle.displacementX !== undefined || particle.displacementY !== undefined) {
      maxDisplacement = Math.max(maxDisplacement, Math.hypot(particle.displacementX ?? 0, particle.displacementY ?? 0));
    }
    if (particle.damage !== undefined) {
      maxDamage = Math.max(maxDamage, particle.damage);
    }
  }

  return {
    metadata: {
      scenarioId: scenario.id,
      outputName: scenario.outputName,
      units: scenario.units,
      generatedAt: new Date().toISOString(),
      sourcePaths,
      solverCommand
    },
    particleSummary: {
      particleCount: particles.length,
      bounds: {
        minX: particles.length === 0 ? null : finiteOrNull(minX),
        maxX: particles.length === 0 ? null : finiteOrNull(maxX),
        minY: particles.length === 0 ? null : finiteOrNull(minY),
        maxY: particles.length === 0 ? null : finiteOrNull(maxY)
      },
      maxDisplacement: maxDisplacement === -Infinity ? null : maxDisplacement,
      maxDamage: maxDamage === -Infinity ? null : maxDamage
    },
    visualization: {
      type: 'particles',
      particles
    },
    diagnostics: {
      warnings
    }
  };
};
