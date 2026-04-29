import type { KnifeGeometry, Scenario, ScrewdriverGeometry } from './types.js';

const xmlEscape = (value: string) => (
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
);

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot serialize non-finite number ${value}`);
  }
  return Number.isInteger(value) ? `${value}` : `${Number(value.toPrecision(12))}`;
};

const indent = (text: string, spaces: number) => {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map(line => `${pad}${line}`).join('\n');
};

const toolVelocity = (scenario: Scenario) => {
  const radians = scenario.tool.directionDeg * Math.PI / 180;
  return {
    vx: Math.cos(radians) * scenario.tool.speedMmPerSec,
    vy: Math.sin(radians) * scenario.tool.speedMmPerSec
  };
};

const toolShapeXml = (scenario: Scenario) => {
  const { startXmm, startYmm } = scenario.tool;
  if (scenario.tool.type === 'screwdriver') {
    const geometry = scenario.tool.geometry as ScrewdriverGeometry;
    const halfLength = geometry.activeLengthMm / 2;
    const halfWidth = geometry.bladeWidthMm / 2;
    return `<Rect xmin="${formatNumber(startXmm - halfLength)}" xmax="${formatNumber(startXmm + halfLength)}" ymin="${formatNumber(startYmm - halfWidth)}" ymax="${formatNumber(startYmm + halfWidth)}"/>`;
  }

  if (scenario.tool.type === 'knife') {
    const geometry = scenario.tool.geometry as KnifeGeometry;
    const halfLength = geometry.bladeLengthMm / 2;
    const halfThickness = geometry.bladeThicknessMm / 2;
    return [
      `<Rect xmin="${formatNumber(startXmm - halfLength)}" xmax="${formatNumber(startXmm + halfLength)}" ymin="${formatNumber(startYmm - halfThickness)}" ymax="${formatNumber(startYmm + halfThickness)}"/>`,
      `<!-- knife edgeRadiusMm=${formatNumber(geometry.edgeRadiusMm)} bevelHalfAngleDeg=${formatNumber(geometry.bevelHalfAngleDeg)} are tracked in scenario metadata; first XML prototype uses a rigid contact strip. -->`
    ].join('\n');
  }

  throw new Error(`Cannot generate NairnMPM XML for unsupported tool "${scenario.tool.type}"`);
};

export const generateNairnXml = (scenario: Scenario) => {
  const { simulation, solver, target } = scenario;
  const xMin = simulation.originXmm;
  const xMax = simulation.originXmm + simulation.widthMm;
  const yMin = simulation.originYmm;
  const yMax = simulation.originYmm + simulation.heightMm;
  const { vx, vy } = toolVelocity(scenario);

  const archiveRoot = `runs/${xmlEscape(scenario.id)}/archive/${xmlEscape(scenario.outputName)}.`;
  const archiveOrder = solver.archiveFields.join(',');

  return [
    "<?xml version='1.0'?>",
    '<!DOCTYPE JANFEAInput SYSTEM "NairnMPM.dtd">',
    "<JANFEAInput version='3'>",
    '',
    '  <Header>',
    '    <Description>',
    indent([
      `Forensic tool mark sidecar scenario ${scenario.id}.`,
      `Tool=${scenario.tool.type}; target=${target.material}; forceN=${formatNumber(scenario.tool.forceN)}; attackAngleDeg=${formatNumber(scenario.tool.angleDeg)}; chatter=${formatNumber(scenario.tool.chatter)}; wear=${formatNumber(scenario.tool.wear)}.`
    ].join('\n'), 6),
    '    </Description>',
    '    <Analysis>10</Analysis>',
    '  </Header>',
    '',
    '  <MPMHeader>',
    `    <Processors>${formatNumber(solver.processors)}</Processors>`,
    `    <MPMMethod>${xmlEscape(solver.mpmMethod)}</MPMMethod>`,
    `    <MatlPtsPerElement>${formatNumber(simulation.particlesPerElement)}</MatlPtsPerElement>`,
    `    <TimeStep units="sec">${formatNumber(simulation.timeStepSeconds)}</TimeStep>`,
    `    <MaxTime units="sec">${formatNumber(simulation.maxTimeSeconds)}</MaxTime>`,
    `    <ArchiveTime units="sec">${formatNumber(simulation.archiveTimeSeconds)}</ArchiveTime>`,
    `    <ArchiveRoot>${archiveRoot}</ArchiveRoot>`,
    `    <MPMArchiveOrder>${xmlEscape(archiveOrder)}</MPMArchiveOrder>`,
    '    <GIMP/>',
    '    <MultiMaterialMode Vmin="1"/>',
    '  </MPMHeader>',
    '',
    '  <Mesh output="file">',
    `    <Grid xmin="${formatNumber(xMin)}" xmax="${formatNumber(xMax)}" ymin="${formatNumber(yMin)}" ymax="${formatNumber(yMax)}" thickness="${formatNumber(simulation.thicknessMm)}">`,
    `      <Horiz cellsize="${formatNumber(simulation.cellSizeMm)}"/>`,
    `      <Vert cellsize="${formatNumber(simulation.cellSizeMm)}"/>`,
    '    </Grid>',
    '  </Mesh>',
    '',
    '  <MaterialPoints>',
    `    <Body matname="Target" angle="0" thick="${formatNumber(target.thicknessMm)}" vx="0" vy="0">`,
    `      <Rect xmin="${formatNumber(xMin)}" xmax="${formatNumber(xMax)}" ymin="${formatNumber(yMin)}" ymax="${formatNumber(yMax)}"/>`,
    '    </Body>',
    `    <Body matname="Tool" angle="${formatNumber(scenario.tool.directionDeg)}" thick="${formatNumber(target.thicknessMm)}" vx="${formatNumber(vx)}" vy="${formatNumber(vy)}">`,
    indent(toolShapeXml(scenario), 6),
    '    </Body>',
    '  </MaterialPoints>',
    '',
    '  <Material Type="9" Name="Target">',
    `    <rho>${formatNumber(target.properties.densityMgPerMm3)}</rho>`,
    `    <E>${formatNumber(target.properties.youngModulusMPa)}</E>`,
    `    <nu>${formatNumber(target.properties.poissonRatio)}</nu>`,
    '    <Hardening>Linear</Hardening>',
    `    <yield>${formatNumber(target.properties.yieldStrengthMPa)}</yield>`,
    `    <Ep>${formatNumber(target.properties.hardeningModulusMPa)}</Ep>`,
    `    <ContactPosition>${formatNumber(target.properties.frictionCoefficient)}</ContactPosition>`,
    '  </Material>',
    '',
    '  <Material Type="35" Name="Tool">',
    '    <rho>7.85</rho>',
    `    <SetDirection x="${formatNumber(vx)}" y="${formatNumber(vy)}"/>`,
    '  </Material>',
    '',
    '</JANFEAInput>',
    ''
  ].join('\n');
};

export const validateGeneratedXmlStructure = (xml: string) => {
  const required = [
    "<?xml version='1.0'?>",
    '<!DOCTYPE JANFEAInput SYSTEM "NairnMPM.dtd">',
    "<JANFEAInput version='3'>",
    '<Header>',
    '<MPMHeader>',
    '<Mesh output="file">',
    '<MaterialPoints>',
    '<Material Type="9" Name="Target">',
    '<Material Type="35" Name="Tool">',
    '</JANFEAInput>'
  ];

  for (const token of required) {
    if (!xml.includes(token)) {
      throw new Error(`Generated XML is missing required token: ${token}`);
    }
  }

  const order = ['<Header>', '<MPMHeader>', '<Mesh output="file">', '<MaterialPoints>', '<Material Type="9" Name="Target">'];
  let previousIndex = -1;
  for (const token of order) {
    const index = xml.indexOf(token);
    if (index <= previousIndex) {
      throw new Error(`Generated XML token order is invalid near ${token}`);
    }
    previousIndex = index;
  }
};
