import { lazy, Suspense, useState } from 'react';
import Controls from './components/Controls';
import { Alert, Box, CssBaseline, ThemeProvider, createTheme, Typography, AppBar, Toolbar, LinearProgress } from '@mui/material';
import type { CutSummary } from './utils/SimulationEngine';

// The 3D lab pulls in three.js, by far the largest part of the app, so it loads after the page shell.
const ForensicLab = lazy(() => import('./components/ForensicLab'));

// Define the simulation state interface
export interface SimulationState {
  toolType: 'screwdriver' | 'knife' | 'crowbar' | 'hammer_face' | 'hammer_claw' | 'spoon';
  action: 'drag' | 'strike'; // dragged along the surface, or driven into it in a single blow
  toolHardness: number; // 1-10 Mohs
  angle: number; // degrees
  force: number; // Newtons (drag)
  impactEnergy: number; // Joules (strike)
  direction: number; // degrees (0-360)
  speed: number; // mm/s (affects chatter)
  chatter: number; // 0-1 range (vibration intensity)
  timeStep: number; // seconds
  toolWear: number; // 0-1 range (micro-chipping/dullness)
  materialThicknessMm: number; // mm
  material: 'aluminum' | 'steel' | 'brass' | 'wood' | 'gold';
  viewMode: 'standard' | 'heatmap' | 'normal';
  rakingLightAngle: number; // 0-90 degrees
  showScales: boolean;
  showTool: boolean;
  showDetail: boolean;
  loopGhost: boolean;
  randomSeed: number;
  resolution: number;
  progress: number; // 0-100
  isSimulating: boolean;
  isResetting: boolean;
  lastRun: CutSummary | null; // outcome of the most recent pass
  error: string | null;
}

const formatLength = (valueMm: number) => (
  valueMm < 1 ? `${Math.round(valueMm * 1000)} µm` : `${valueMm.toFixed(2)} mm`
);

// The plate's own finish is rougher than this, so a shallower mark cannot be told apart from it.
const VISIBLE_MARK_DEPTH_MM = 0.01;

const leavesVisibleMark = (run: CutSummary) => run.detachedCells > 0 || run.maxCutDepthMm >= VISIBLE_MARK_DEPTH_MM;

const describeRun = (run: CutSummary, action: SimulationState['action']) => {
  if (!leavesVisibleMark(run)) {
    const remedy = action === 'strike' ? 'Raise the blow energy or tilt the tool.' : 'Raise the force or pick a sharper tool.';
    const outcome = run.carvedVolumeMm3 === 0
      ? 'NO MARK: the contact left the surface unchanged.'
      : 'NO VISIBLE MARK: the contact only burnished the surface finish.';
    return `${outcome} ${remedy}`;
  }
  const parts = [
    `DEPTH ${formatLength(run.maxCutDepthMm)}`,
    `PILE-UP ${formatLength(run.maxPileUpMm)}`,
    `CARVED ${run.carvedVolumeMm3.toFixed(run.carvedVolumeMm3 < 1 ? 3 : 1)} mm³`,
  ];
  if (run.detachedCells > 0) {
    parts.push(`TORN OUT ${run.detachedCells} cells`);
  }
  return parts.join('  ·  ');
};

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00e5ff',
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
  },
  typography: {
    fontFamily: '"Roboto Mono", monospace',
  },
});

function App() {
  const [simState, setSimState] = useState<SimulationState>({
    toolType: 'screwdriver',
    action: 'drag',
    toolHardness: 8,
    angle: 45,
    force: 150,
    impactEnergy: 5,
    direction: 0,
    speed: 10,
    chatter: 0.2,
    timeStep: 0.0005,
    toolWear: 0.1,
    materialThicknessMm: 1.0,
    material: 'aluminum',
    viewMode: 'standard',
    rakingLightAngle: 10,
    showScales: true,
    showTool: true,
    showDetail: true,
    loopGhost: false,
    randomSeed: 1337,
    resolution: 30,
    progress: 0,
    isSimulating: false,
    isResetting: false,
    lastRun: null,
    error: null,
  });

  const handleExecute = () => {
    setSimState(prev => ({ ...prev, isSimulating: true, progress: 0, error: null }));
  };

  const handleReset = () => {
    setSimState(prev => ({ ...prev, isResetting: true }));
    setTimeout(() => setSimState(prev => ({ ...prev, isResetting: false })), 100);
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: '1px solid #333' }}>
          <Toolbar variant="dense">
            <Typography variant="h6" component="div" sx={{ flexGrow: 1, color: 'primary.main', fontWeight: 'bold' }}>
              FORENSIC MARK SIMULATOR v1.0
            </Typography>
          </Toolbar>
        </AppBar>
        
        <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
          {/* Main 3D Viewport */}
          <Box sx={{ flexGrow: 1, position: 'relative' }}>
            {simState.isSimulating && (
                <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
                    <LinearProgress variant="determinate" value={simState.progress} color="secondary" sx={{ height: 4 }} />
                    <Typography 
                        variant="caption" 
                        sx={{ 
                            position: 'absolute', 
                            top: 10, 
                            right: 10, 
                            color: 'secondary.main', 
                            fontWeight: 'bold',
                            textShadow: '0 0 5px black'
                        }}
                    >
                        CALCULATING PHYSICS... {Math.round(simState.progress)}%
                    </Typography>
                </Box>
            )}
            <Suspense
                fallback={
                    <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', top: '50%', left: 0, right: 0, textAlign: 'center' }}>
                        LOADING 3D LAB...
                    </Typography>
                }
            >
                <ForensicLab simState={simState} setSimState={setSimState} />
            </Suspense>
            {simState.error && (
                <Alert
                    severity="error"
                    onClose={() => setSimState(prev => ({ ...prev, error: null }))}
                    sx={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 10 }}
                >
                    Simulation failed: {simState.error}
                </Alert>
            )}
            {simState.lastRun && !simState.isSimulating && (
                <Typography
                    variant="caption"
                    sx={{
                        position: 'absolute',
                        top: 10,
                        left: 16,
                        color: leavesVisibleMark(simState.lastRun) ? 'primary.main' : 'warning.main',
                        fontWeight: 'bold',
                        textShadow: '0 0 5px black',
                        pointerEvents: 'none'
                    }}
                >
                    {describeRun(simState.lastRun, simState.action)}
                </Typography>
            )}
          </Box>
          
          {/* Side Control Panel */}
          <Box sx={{ width: 350, borderLeft: '1px solid #333', overflowY: 'auto', bgcolor: 'background.paper' }}>
            <Controls simState={simState} setSimState={setSimState} onExecute={handleExecute} onReset={handleReset} />
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
