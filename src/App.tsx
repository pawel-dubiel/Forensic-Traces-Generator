import { useState } from 'react';
import ForensicLab from './components/ForensicLab';
import Controls from './components/Controls';
import { Box, CssBaseline, ThemeProvider, createTheme, Typography, AppBar, Toolbar, LinearProgress } from '@mui/material';

// Define the simulation state interface
export interface SimulationState {
  toolType: 'screwdriver' | 'knife' | 'crowbar' | 'hammer_face' | 'hammer_claw' | 'spoon';
  toolHardness: number; // 0-10 Mohs
  angle: number; // degrees
  force: number; // Newtons
  direction: number; // degrees (0-360)
  speed: number; // mm/s (affects chatter)
  chatter: number; // 0-1 range (vibration intensity)
  toolWear: number; // 0-1 range (micro-chipping/dullness)
  material: 'aluminum' | 'steel' | 'brass' | 'wood' | 'gold';
  viewMode: 'standard' | 'heatmap' | 'normal';
  rakingLightAngle: number; // 0-90 degrees
  showScales: boolean;
  showTool: boolean;
  loopGhost: boolean;
  randomSeed: number;
  progress: number; // 0-100
  isSimulating: boolean;
  isResetting: boolean;
}

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
    toolHardness: 8,
    angle: 45,
    force: 50,
    direction: 0,
    speed: 10,
    chatter: 0.2,
    toolWear: 0.1,
    material: 'aluminum',
    viewMode: 'standard',
    rakingLightAngle: 10,
    showScales: true,
    showTool: true,
    loopGhost: false,
    randomSeed: 1337,
    progress: 0,
    isSimulating: false,
    isResetting: false,
  });

  const handleExecute = () => {
    setSimState(prev => ({ ...prev, isSimulating: true, progress: 0 }));
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
            <ForensicLab simState={simState} setSimState={setSimState} />
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
