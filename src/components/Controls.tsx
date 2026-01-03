import React from 'react';
import { Box, Typography, Slider, MenuItem, Select, FormControl, InputLabel, Button, Divider, FormControlLabel, Checkbox } from '@mui/material';
import type { SimulationState } from '../App';
import { PlayCircle, Trash2 } from 'lucide-react';

interface ControlsProps {
  simState: SimulationState;
  setSimState: React.Dispatch<React.SetStateAction<SimulationState>>;
  onExecute: () => void;
  onReset: () => void;
}

const Controls: React.FC<ControlsProps> = ({ simState, setSimState, onExecute, onReset }) => {
  
  const handleChange = (key: keyof SimulationState, value: any) => {
    setSimState(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
        Tool Configuration
      </Typography>
      
      <FormControl fullWidth size="small" sx={{ mt: 2, mb: 3 }}>
        <InputLabel>Tool Profile</InputLabel>
        <Select
          value={simState.toolType}
          label="Tool Profile"
          onChange={(e) => handleChange('toolType', e.target.value)}
        >
          <MenuItem value="screwdriver">Flathead Screwdriver</MenuItem>
          <MenuItem value="knife">Knife Edge</MenuItem>
          <MenuItem value="crowbar">Crowbar Tip</MenuItem>
          <Divider />
          <MenuItem value="hammer_face">Hammer (Face)</MenuItem>
          <MenuItem value="hammer_claw">Hammer (Claw)</MenuItem>
        </Select>
      </FormControl>

      <Typography gutterBottom variant="body2">Tool Hardness (Mohs)</Typography>
      <Slider
        value={simState.toolHardness}
        onChange={(_, val) => handleChange('toolHardness', val)}
        min={1} max={10} step={0.5}
        valueLabelDisplay="auto"
        sx={{ mb: 3 }}
      />

      <Divider sx={{ my: 3 }} />

      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
        Physics Parameters
      </Typography>

      <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography gutterBottom variant="body2">Angle of Attack (°)</Typography>
          <Slider
            value={simState.angle}
            onChange={(_, val) => handleChange('angle', val)}
            min={0} max={90}
            valueLabelDisplay="auto"
          />
        </Box>

        <Box>
          <Typography gutterBottom variant="body2">Applied Force (N)</Typography>
          <Slider
            value={simState.force}
            onChange={(_, val) => handleChange('force', val)}
            min={0} max={500}
            valueLabelDisplay="auto"
            color="secondary"
          />
        </Box>
        
        <Box>
           <Typography gutterBottom variant="body2">Drag Direction (°)</Typography>
           <Slider
            value={simState.direction}
            onChange={(_, val) => handleChange('direction', val)}
            min={0} max={360}
            valueLabelDisplay="auto"
          />
        </Box>

        <Box>
           <Typography gutterBottom variant="body2">Tool Speed (mm/s)</Typography>
           <Slider
            value={simState.speed}
            onChange={(_, val) => handleChange('speed', val)}
            min={1} max={100}
            valueLabelDisplay="auto"
          />
        </Box>

        <Box>
           <Typography gutterBottom variant="body2">Chatter/Vibration</Typography>
           <Slider
            value={simState.chatter}
            onChange={(_, val) => handleChange('chatter', val)}
            min={0} max={1} step={0.05}
            valueLabelDisplay="auto"
          />
        </Box>

        <Box>
           <Typography gutterBottom variant="body2">Micro-Wear (Edge Condition)</Typography>
           <Slider
            value={simState.toolWear}
            onChange={(_, val) => handleChange('toolWear', val)}
            min={0} max={1} step={0.05}
            valueLabelDisplay="auto"
          />
        </Box>
      </Box>

      <Divider sx={{ my: 3 }} />

      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
        Target Material
      </Typography>
      
      <FormControl fullWidth size="small" sx={{ mt: 2, mb: 4 }}>
        <InputLabel>Surface Material</InputLabel>
        <Select
          value={simState.material}
          label="Surface Material"
          onChange={(e) => handleChange('material', e.target.value)}
        >
          <MenuItem value="aluminum">Aluminum (Soft)</MenuItem>
          <MenuItem value="brass">Brass (Medium)</MenuItem>
          <MenuItem value="steel">Steel (Hard)</MenuItem>
          <MenuItem value="wood">Wood (Very Soft)</MenuItem>
          <MenuItem value="gold">Gold (Soft Precious)</MenuItem>
        </Select>
      </FormControl>

      <Divider sx={{ my: 3 }} />

      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
        Forensic Visualization
      </Typography>

      <Box sx={{ mt: 2, mb: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <FormControl fullWidth size="small">
          <InputLabel>View Mode</InputLabel>
          <Select
            value={simState.viewMode}
            label="View Mode"
            onChange={(e) => handleChange('viewMode', e.target.value)}
          >
            <MenuItem value="standard">Standard (Material)</MenuItem>
            <MenuItem value="heatmap">Depth Heatmap (False Color)</MenuItem>
            <MenuItem value="normal">Normal Map (Slope)</MenuItem>
          </Select>
        </FormControl>

        <Box>
           <Typography gutterBottom variant="body2">Raking Light Angle ({simState.rakingLightAngle}°)</Typography>
           <Slider
            value={simState.rakingLightAngle}
            onChange={(_, val) => handleChange('rakingLightAngle', val)}
            min={0} max={90}
            valueLabelDisplay="auto"
          />
        </Box>

        <FormControlLabel
          control={
            <Checkbox
              checked={simState.showScales}
              onChange={(e) => handleChange('showScales', e.target.checked)}
            />
          }
          label="Show Scale Bars"
        />
      </Box>

      <Button 
        variant="contained" 
        fullWidth 
        size="large" 
        startIcon={<PlayCircle />}
        onClick={onExecute}
        sx={{ 
          height: 50,
          background: 'linear-gradient(45deg, #00e5ff 30%, #2979ff 90%)',
          boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
        }}
      >
        EXECUTE SIMULATION
      </Button>

    </Box>
  );
};

export default Controls;
