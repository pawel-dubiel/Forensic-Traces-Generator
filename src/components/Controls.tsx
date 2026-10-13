import React, { useState } from 'react';
import { Box, Typography, Slider, MenuItem, Select, FormControl, InputLabel, Button, Divider, FormControlLabel, Checkbox, TextField } from '@mui/material';
import type { SimulationState } from '../App';
import { PlayCircle, Trash2 } from 'lucide-react';

interface ControlsProps {
  simState: SimulationState;
  setSimState: React.Dispatch<React.SetStateAction<SimulationState>>;
  onExecute: () => void;
  onReset: () => void;
}

// The seed rebuilds the whole plate, so it is committed on blur or Enter rather than on every keystroke.
const SeedField: React.FC<{ seed: number; disabled: boolean; onCommit: (seed: number) => void }> = ({ seed, disabled, onCommit }) => {
  const [draft, setDraft] = useState(String(seed));
  const parsed = draft.trim() === '' ? NaN : Number(draft);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffffff;

  const commit = () => {
    if (valid && parsed !== seed) {
      onCommit(parsed);
    }
  };

  return (
    <TextField
      label="Random Seed"
      type="number"
      size="small"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
        }
      }}
      inputProps={{ min: 0, step: 1 }}
      error={!valid}
      helperText={valid ? 'Same seed and settings reproduce the same mark. Changing it clears the surface.' : 'Seed must be a whole number from 0 to 4294967295'}
      fullWidth
    />
  );
};

const Controls: React.FC<ControlsProps> = ({ simState, setSimState, onExecute, onReset }) => {
  
  type NumericSimulationKey = {
    [K in keyof SimulationState]: SimulationState[K] extends number ? K : never
  }[keyof SimulationState];

  const readSliderNumber = (value: number | number[]) => {
    if (Array.isArray(value)) {
      throw new Error('Range slider values are not supported');
    }
    return value;
  };

  const handleChange = <K extends keyof SimulationState>(key: K, value: SimulationState[K]) => {
    setSimState(prev => ({ ...prev, [key]: value }));
  };

  // A hammer face is struck, everything else is dragged. The action can still be changed afterwards.
  const handleToolChange = (toolType: SimulationState['toolType']) => {
    setSimState(prev => ({ ...prev, toolType, action: toolType === 'hammer_face' ? 'strike' : 'drag' }));
  };

  const handleNumberChange = (key: NumericSimulationKey, value: number | number[]) => {
    setSimState(prev => ({ ...prev, [key]: readSliderNumber(value) }));
  };

  const timeStepValid = Number.isFinite(simState.timeStep) && simState.timeStep > 0;
  const materialThicknessValid = Number.isFinite(simState.materialThicknessMm) && simState.materialThicknessMm > 0;
  const stepsPerSecond = timeStepValid ? 1 / simState.timeStep : 0;
  // Settings are locked while a pass is running: the pass uses the values it started with.
  const locked = simState.isSimulating;
  const striking = simState.action === 'strike';
  // The time step only applies to a drag.
  const canExecute = (striking || timeStepValid) && materialThicknessValid && !locked;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
        Tool Configuration
      </Typography>
      
      <FormControl fullWidth size="small" sx={{ mt: 2, mb: 3 }} disabled={locked}>
        <InputLabel>Tool Profile</InputLabel>
        <Select
          value={simState.toolType}
          label="Tool Profile"
          onChange={(e) => handleToolChange(e.target.value as SimulationState['toolType'])}
        >
          <MenuItem value="screwdriver">Flathead Screwdriver</MenuItem>
          <MenuItem value="knife">Knife Edge</MenuItem>
          <MenuItem value="crowbar">Crowbar Tip</MenuItem>
          <Divider />
          <MenuItem value="hammer_face">Hammer (Face)</MenuItem>
          <MenuItem value="hammer_claw">Hammer (Claw)</MenuItem>
          <MenuItem value="spoon">Spoon (Bowl)</MenuItem>
        </Select>
      </FormControl>

      <FormControl fullWidth size="small" sx={{ mb: 3 }} disabled={locked}>
        <InputLabel>Action</InputLabel>
        <Select
          value={simState.action}
          label="Action"
          onChange={(e) => handleChange('action', e.target.value as SimulationState['action'])}
        >
          <MenuItem value="drag">Drag (scrape 40 mm)</MenuItem>
          <MenuItem value="strike">Strike (single blow)</MenuItem>
        </Select>
      </FormControl>

      <Typography gutterBottom variant="body2">Tool Hardness (Mohs)</Typography>
      <Slider
        value={simState.toolHardness}
        onChange={(_, val) => handleNumberChange('toolHardness', val)}
        min={1} max={10} step={0.5}
        valueLabelDisplay="auto"
        disabled={locked}
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
            onChange={(_, val) => handleNumberChange('angle', val)}
            min={1} max={90}
            valueLabelDisplay="auto"
            disabled={locked}
          />
        </Box>

        {striking ? (
          <Box>
            <Typography gutterBottom variant="body2">Blow Energy ({simState.impactEnergy.toFixed(1)} J)</Typography>
            <Slider
              value={simState.impactEnergy}
              onChange={(_, val) => handleNumberChange('impactEnergy', val)}
              min={0} max={30} step={0.5}
              valueLabelDisplay="auto"
              disabled={locked}
              color="secondary"
            />
            <Typography variant="caption" color="text.secondary">
              A 450 g hammer swung at 5 m/s delivers about 5.6 J. At 90° the tool lands square on; below that it lands on its edge.
            </Typography>
          </Box>
        ) : (
          <Box>
            <Typography gutterBottom variant="body2">Applied Force (N)</Typography>
            <Slider
              value={simState.force}
              onChange={(_, val) => handleNumberChange('force', val)}
              min={0} max={500}
              valueLabelDisplay="auto"
              disabled={locked}
              color="secondary"
            />
          </Box>
        )}
        
        <Box>
           <Typography gutterBottom variant="body2">{striking ? 'Tool Heading (°)' : 'Drag Direction (°)'}</Typography>
           <Slider
            value={simState.direction}
            onChange={(_, val) => handleNumberChange('direction', val)}
            min={0} max={360}
            valueLabelDisplay="auto"
            disabled={locked}
          />
        </Box>

        {!striking && (
          <>
            <Box>
               <Typography gutterBottom variant="body2">Tool Speed (mm/s)</Typography>
               <Slider
                value={simState.speed}
                onChange={(_, val) => handleNumberChange('speed', val)}
                min={1} max={100}
                valueLabelDisplay="auto"
                disabled={locked}
              />
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <TextField
                label="Time Step (s)"
                type="number"
                value={Number.isFinite(simState.timeStep) ? simState.timeStep : ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  handleChange('timeStep', raw === '' ? NaN : Number(raw));
                }}
                inputProps={{ min: 0, step: 'any' }}
                disabled={locked}
                error={!timeStepValid}
                helperText={timeStepValid ? ' ' : 'Time step must be a positive number'}
                fullWidth
              />
              <TextField
                label="Steps per second"
                value={timeStepValid ? stepsPerSecond.toFixed(2) : ''}
                InputProps={{ readOnly: true }}
                fullWidth
              />
            </Box>

            <Box>
               <Typography gutterBottom variant="body2">Chatter/Vibration</Typography>
               <Slider
                value={simState.chatter}
                onChange={(_, val) => handleNumberChange('chatter', val)}
                min={0} max={1} step={0.05}
                valueLabelDisplay="auto"
                disabled={locked}
              />
            </Box>
          </>
        )}

        <Box>
           <Typography gutterBottom variant="body2">Micro-Wear (Edge Condition)</Typography>
           <Slider
            value={simState.toolWear}
            onChange={(_, val) => handleNumberChange('toolWear', val)}
            min={0} max={1} step={0.05}
            valueLabelDisplay="auto"
            disabled={locked}
          />
        </Box>
      </Box>

      <Divider sx={{ my: 3 }} />

      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
        Target Material
      </Typography>
      
      <FormControl fullWidth size="small" sx={{ mt: 2, mb: 3 }} disabled={locked}>
        <InputLabel>Surface Material</InputLabel>
        <Select
          value={simState.material}
          label="Surface Material"
          onChange={(e) => handleChange('material', e.target.value as SimulationState['material'])}
        >
          <MenuItem value="aluminum">Aluminum (Soft)</MenuItem>
          <MenuItem value="brass">Brass (Medium)</MenuItem>
          <MenuItem value="steel">Steel (Hard)</MenuItem>
          <MenuItem value="wood">Wood (Very Soft)</MenuItem>
          <MenuItem value="gold">Gold (Soft Precious)</MenuItem>
        </Select>
      </FormControl>

      <Box sx={{ mb: 3 }}>
        <Typography gutterBottom variant="body2">
          Material Thickness ({Number.isFinite(simState.materialThicknessMm) ? simState.materialThicknessMm.toFixed(2) : 'invalid'} mm)
        </Typography>
        <Slider
          value={Number.isFinite(simState.materialThicknessMm) ? simState.materialThicknessMm : 1}
          onChange={(_, val) => handleNumberChange('materialThicknessMm', val)}
          min={0.1} max={5} step={0.05}
          valueLabelDisplay="auto"
          disabled={locked}
          color="secondary"
        />
        {!materialThicknessValid && (
          <Typography variant="caption" color="error">
            Material thickness must be a positive number
          </Typography>
        )}
      </Box>

      <SeedField
        seed={simState.randomSeed}
        disabled={locked}
        onCommit={(seed) => handleChange('randomSeed', seed)}
      />

      <Divider sx={{ my: 3 }} />

      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
        Forensic Visualization
      </Typography>

      <Box sx={{ mt: 2, mb: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <FormControl fullWidth size="small" disabled={locked}>
          <InputLabel>Resolution (pts/mm)</InputLabel>
          <Select
            value={simState.resolution}
            label="Resolution (pts/mm)"
            onChange={(e) => handleChange('resolution', Number(e.target.value))}
          >
            <MenuItem value={15}>15</MenuItem>
            <MenuItem value={30}>30</MenuItem>
            <MenuItem value={40}>40</MenuItem>
          </Select>
        </FormControl>

        <FormControl fullWidth size="small" disabled={locked}>
          <InputLabel>View Mode</InputLabel>
          <Select
            value={simState.viewMode}
            label="View Mode"
            onChange={(e) => handleChange('viewMode', e.target.value as SimulationState['viewMode'])}
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
            onChange={(_, val) => handleNumberChange('rakingLightAngle', val)}
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

        <FormControlLabel
          control={
            <Checkbox
              checked={simState.showTool}
              onChange={(e) => handleChange('showTool', e.target.checked)}
            />
          }
          label="Show 3D Tool"
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={simState.showDetail}
              onChange={(e) => handleChange('showDetail', e.target.checked)}
            />
          }
          label="Show Striation Detail Overlay"
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={simState.loopGhost}
              onChange={(e) => handleChange('loopGhost', e.target.checked)}
            />
          }
          label="Loop Ghost Playback"
        />
      </Box>

      <Button 
        variant="contained" 
        fullWidth 
        size="large" 
        startIcon={<PlayCircle />}
        onClick={onExecute}
        disabled={!canExecute}
        sx={{ 
          height: 50,
          background: 'linear-gradient(45deg, #00e5ff 30%, #2979ff 90%)',
          boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
          mb: 2
        }}
      >
        EXECUTE SIMULATION
      </Button>

      <Button 
        variant="outlined" 
        fullWidth 
        color="error"
        startIcon={<Trash2 />}
        onClick={onReset}
        disabled={locked}
      >
        CLEAR SURFACE
      </Button>

    </Box>
  );
};

export default Controls;
