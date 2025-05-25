# glCube

`glCube` is a WebGL-based 3D Rubik's Cube simulator that offers rich interactive features and visual effects. This project supports multiple material modes, camera controls, animations, and a skybox background.

![Screenshot](./page.png)

---

## Features

### 1. Rubik's Cube Features
- **Rotation and Animation**: Supports face rotation animations and provides a random scramble feature.
- **Material Modes**:
  - Solid Color Mode
  - Texture Mode
  - Normal Map Mode
  - Reflection Mode
- **Auto-Rotation**: Enables automatic random rotation.

### 2. Camera Controls
- **First-Person Camera**:
  - Supports mouse drag for adjusting the view.
  - Supports zooming with the scroll wheel.
- **Orbit Camera**:
  - Supports mouse drag for rotation.
  - Supports zooming with the scroll wheel.
  - Supports resetting the view.

### 3. Visual Effects
- **Skybox Background**: Supports cube map textures as the background.
- **Platform Rendering**: Renders a platform below the Rubik's Cube.
- **Mini Cube Orbiting**: Enables orbiting mini cubes effect.

---

## Shortcuts

| Shortcut | Function                          |
|----------|-----------------------------------|
| `C`      | Switch camera mode (First-Person/Orbit) |
| `B`      | Switch background mode (Solid Color/Skybox) |
| `M`      | Toggle reflection effect          |
| `E`      | Enable/Disable auto-rotation      |
| `T`      | Switch material mode              |
| `O`      | Enable/Disable mini cube orbiting |

## Getting Started

### 1. Requirements
- Modern browser (supports WebGL)

### 2. Start the Project
1. Clone this repository:
   ```bash
   git clone https://github.com/your-repo/glCube.git
   ```