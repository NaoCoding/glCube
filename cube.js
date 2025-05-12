// import glMatrix from './glMatrix.js';
// gl-matrix an global vars
import "./gl-matrix-min.js";

const { mat2, mat2d, mat4, mat3, quat, quat2, vec2, vec3, vec4 } = glMatrix;
console.log(mat4, vec3, quat); // Check if glMatrix is loaded correctly

let gl;
let shaderProgram;
let rubiksCube;
let orbitCamera;
let firstPersonCamera;
let cameraMode = 'orbit'; // 'orbit' or 'firstPerson'
let currentCamera;

// --- NEW: Background/Skybox variables ---
let backgroundMode = 'color'; // 'color' or 'cubemap'
let skyboxTexture = null;
let skyboxProgramInfo = null;
let skyboxBuffers = null;
let isSkyboxReady = false;
const CUBEMAP_BASE_PATH = './cubemap/'; // <--- IMPORTANT: Set path to your cubemap images
const CUBEMAP_FACES = [
    CUBEMAP_BASE_PATH + 'posx.jpg', // Right
    CUBEMAP_BASE_PATH + 'negx.jpg', // Left
    CUBEMAP_BASE_PATH + 'posy.jpg', // Top
    CUBEMAP_BASE_PATH + 'negy.jpg', // Bottom
    CUBEMAP_BASE_PATH + 'posz.jpg', // Front
    CUBEMAP_BASE_PATH + 'negz.jpg', // Back
];
const SOLID_BG_COLOR = [0.1, 0.1, 0.15, 1.0]; // Store the solid color

// Animation variables
let isAnimating = false;
let animationQueue = [];
const ANIMATION_SPEED = 0.035; // Radians per frame, adjust for speed (slightly faster)
let currentAnimation = null;

// Cubie dimensions and spacing
const CUBIE_SIZE = 0.95; // Size of a single cubie
const CUBIE_SPACING = 0.05; // Space between cubies
const CUBE_UNIT_SIZE = CUBIE_SIZE + CUBIE_SPACING;

// Standard Rubik's Cube Colors (RGB, A=1.0)
const COLORS = {
    WHITE:  [1.0, 1.0, 1.0, 1.0],
    YELLOW: [1.0, 1.0, 0.0, 1.0],
    RED:    [1.0, 0.0, 0.0, 1.0],
    ORANGE: [1.0, 0.5, 0.0, 1.0],
    BLUE:   [0.0, 0.0, 1.0, 1.0],
    GREEN:  [0.0, 0.8, 0.0, 1.0], // Darker green for better contrast
    BLACK:  [0.15, 0.15, 0.15, 1.0], // Inner cubie color
    GRAY:   [0.5, 0.5, 0.5, 1.0]    // Default sticker color if undefined
};

// Face name to color mapping (standard Western color scheme)
// F, B, U, D, L, R
const FACE_COLOR_NAMES = ['GREEN', 'BLUE', 'WHITE', 'YELLOW', 'ORANGE', 'RED'];
const FACE_INDICES = { F: 0, B: 1, U: 2, D: 3, L: 4, R: 5 };


// --- Shader Definitions (Rubik's Cube - Improved Lighting) ---
// --- Shader Definitions (Rubik's Cube - Improved Lighting + Reflection) ---
const vsSource = `
    attribute vec4 aVertexPosition;
    attribute vec3 aVertexNormal;
    attribute vec4 aVertexColor;

    uniform mat4 uModelMatrix;
    uniform mat4 uViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat3 uNormalMatrix; // For transforming normals

    varying highp vec3 vFragPos_World; // Fragment position in world space
    varying highp vec3 vNormal_World;  // Transformed normal in world space
    varying lowp vec4 vColor;          // Base color from vertex attribute

    void main(void) {
        // Calculate world position of the vertex
        vec4 worldPos = uModelMatrix * aVertexPosition;
        vFragPos_World = worldPos.xyz / worldPos.w; // Use w for perspective correction if needed, usually fine without for position

        // Transform normal to world space using the normal matrix
        vNormal_World = normalize(uNormalMatrix * aVertexNormal);

        // Standard position calculation for rendering
        gl_Position = uProjectionMatrix * uViewMatrix * worldPos;

        // Pass color through
        vColor = aVertexColor;
    }
`;

const fsSource = `
    precision highp float; // Use highp for vectors used in calculations

    varying highp vec3 vFragPos_World;
    varying highp vec3 vNormal_World;
    varying lowp vec4 vColor; // Base color of the fragment (sticker/plastic)

    // Existing uniforms
    uniform vec3 uEyePosition_World;   // Camera position in world space
    uniform vec3 uLightPosition_World; // Position of the light source
    uniform vec3 uLightColor;
    uniform vec3 uAmbientLightColor;
    uniform float uShininess;

    // --- NEW: Reflection Uniforms ---
    uniform samplerCube uEnvironmentSampler; // The cubemap texture
    uniform bool uEnableReflection;          // Toggle reflection on/off
    uniform float uReflectivity;             // How much reflection (0.0 to 1.0)

    void main(void) {
        // --- Standard Lighting Calculation (Phong) ---
        vec3 norm = normalize(vNormal_World);
        vec3 lightDir = normalize(uLightPosition_World - vFragPos_World);
        vec3 viewDir = normalize(uEyePosition_World - vFragPos_World);

        // Ambient
        vec3 ambient = uAmbientLightColor * vColor.rgb;

        // Diffuse
        float diff = max(dot(norm, lightDir), 0.0);
        vec3 diffuse = uLightColor * diff * vColor.rgb;

        // Specular
        vec3 reflectDirLight = reflect(-lightDir, norm); // Reflection of light source
        float spec = pow(max(dot(viewDir, reflectDirLight), 0.0), uShininess);
        vec3 specular = uLightColor * spec * vec3(0.8, 0.8, 0.8); // Specular highlight color

        // Combine basic lighting components
        vec3 lightingColor = ambient + diffuse + specular;

        // --- NEW: Reflection Calculation ---
        vec3 reflectionColor = vec3(0.0); // Initialize reflection color
        if (uEnableReflection) {
            // Calculate reflection vector for the *environment*
            // reflect() expects incident vector (from eye to surface), so negate viewDir
            vec3 reflectDirEnv = reflect(-viewDir, norm);

            // Sample the environment cubemap
            // Use .rgb to discard alpha if the cubemap has it
            reflectionColor = textureCube(uEnvironmentSampler, reflectDirEnv).rgb;

             // Optional: Modulate reflection by base color (tints reflection)
             // reflectionColor *= vColor.rgb;
        }

        // --- Combine Lighting and Reflection ---
        // Mix the base lighting color with the reflection color using reflectivity
        // If reflection is disabled, reflectivity effectively has no impact if reflectionColor is black.
        // Or more explicitly:
        vec3 finalColor;
        if (uEnableReflection) {
             finalColor = mix(lightingColor, reflectionColor, uReflectivity);
        } else {
             finalColor = lightingColor;
        }


        // Ensure output color is within valid range (optional but good practice)
        // finalColor = clamp(finalColor, 0.0, 1.0);

        gl_FragColor = vec4(finalColor, vColor.a); // Use alpha from original vertex color
    }
`;

// --- NEW: Shader Definitions (Skybox) ---
const skyboxVsSource = `
    attribute vec4 aVertexPosition;

    uniform mat4 uViewMatrix;
    uniform mat4 uProjectionMatrix;

    varying highp vec3 vTextureCoord;

    void main() {
        vTextureCoord = aVertexPosition.xyz; // Use position as direction vector for cubemap lookup

        // Remove translation from view matrix to make skybox appear infinitely far
        mat4 viewRotationMatrix = mat4(mat3(uViewMatrix)); // Extract 3x3 rotation part

        vec4 pos = uProjectionMatrix * viewRotationMatrix * aVertexPosition;

        // Ensure skybox is drawn behind everything (at the far plane)
        gl_Position = pos.xyww;
    }
`;

const skyboxFsSource = `
    precision mediump float;

    varying highp vec3 vTextureCoord;

    uniform samplerCube uSkyboxSampler;

    void main() {
        // Sample the cubemap texture using the direction vector
        gl_FragColor = textureCube(uSkyboxSampler, normalize(vTextureCoord));
    }
`;


// --- WebGL Initialization ---
function initWebGL(canvas) {
    gl = canvas.getContext('webgl');
    if (!gl) {
        gl = canvas.getContext('experimental-webgl');
    }
    if (!gl) {
        showMessage("無法初始化 WebGL。您的瀏覽器可能不支援。");
        return null;
    }
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    // Initial clear color, might be overwritten by skybox
    gl.clearColor(SOLID_BG_COLOR[0], SOLID_BG_COLOR[1], SOLID_BG_COLOR[2], SOLID_BG_COLOR[3]);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL); // Use LEQUAL for depth test (skybox uses z=w)
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    return gl;
}

// --- Shader Loading/Linking (no changes needed) ---
function loadShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        showMessage('著色器編譯錯誤: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function initShaderProgram(vsSource, fsSource) {
    const vertexShader = loadShader(gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl.FRAGMENT_SHADER, fsSource);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        showMessage('著色器程式連結錯誤: ' + gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}

// --- NEW: Cube Map Texture Loading ---
function loadCubeMap(faceUrls) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);

    const faceInfos = [
        { target: gl.TEXTURE_CUBE_MAP_POSITIVE_X, url: faceUrls[0] },
        { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_X, url: faceUrls[1] },
        { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Y, url: faceUrls[2] },
        { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, url: faceUrls[3] },
        { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Z, url: faceUrls[4] },
        { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, url: faceUrls[5] },
    ];

    let facesLoaded = 0;
    faceInfos.forEach((faceInfo) => {
        const { target, url } = faceInfo;
        // Setup a placeholder texture so we can render immediately
        const level = 0;
        const internalFormat = gl.RGBA;
        const width = 2048; // Placeholder size
        const height = 2048;
        const border = 0;
        const format = gl.RGBA;
        const type = gl.UNSIGNED_BYTE;
        const data = new Uint8Array([10, 10, 20, 255]); // Placeholder pixel color (dark blue)
        gl.texImage2D(target, level, internalFormat, width, height, border, format, type, null);

        // Asynchronously load the image
        const image = new Image();
        image.onload = function () {
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
            gl.texImage2D(target, level, internalFormat, format, type, image);
            gl.generateMipmap(gl.TEXTURE_CUBE_MAP); // Generate mipmaps after loading
            facesLoaded++;
            if (facesLoaded === 6) {
                isSkyboxReady = true;
                console.log("Cube map loaded successfully.");
                 showMessage("天空盒背景已載入 (按 B 切換)", 2000);
            }
        };
         image.onerror = function() {
             console.error(`Error loading cubemap face: ${url}`);
             facesLoaded++; // Still count it as "processed" to avoid hanging
             if (facesLoaded === 6 && !isSkyboxReady) { // Check if any succeeded
                 console.error("Failed to load all cubemap faces.");
             }
         }
        image.src = url;
    });

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // TEXTURE_WRAP_R is needed for cube maps in WebGL 2, but optional in WebGL 1
     if (gl.TEXTURE_WRAP_R) { // Check if constant exists
         gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
     }


    return texture;
}

// --- NEW: Skybox Buffers ---
function initSkyboxBuffers() {
    const positions = [
        // Position
        -1.0,  1.0, -1.0,
        -1.0, -1.0, -1.0,
         1.0, -1.0, -1.0,
         1.0, -1.0, -1.0,
         1.0,  1.0, -1.0,
        -1.0,  1.0, -1.0,

        -1.0, -1.0,  1.0,
        -1.0, -1.0, -1.0,
        -1.0,  1.0, -1.0,
        -1.0,  1.0, -1.0,
        -1.0,  1.0,  1.0,
        -1.0, -1.0,  1.0,

         1.0, -1.0, -1.0,
         1.0, -1.0,  1.0,
         1.0,  1.0,  1.0,
         1.0,  1.0,  1.0,
         1.0,  1.0, -1.0,
         1.0, -1.0, -1.0,

        -1.0, -1.0,  1.0,
        -1.0,  1.0,  1.0,
         1.0,  1.0,  1.0,
         1.0,  1.0,  1.0,
         1.0, -1.0,  1.0,
        -1.0, -1.0,  1.0,

        -1.0,  1.0, -1.0,
         1.0,  1.0, -1.0,
         1.0,  1.0,  1.0,
         1.0,  1.0,  1.0,
        -1.0,  1.0,  1.0,
        -1.0,  1.0, -1.0,

        -1.0, -1.0, -1.0,
        -1.0, -1.0,  1.0,
         1.0, -1.0, -1.0, // Note: corrected index here vs typical tutorials for CCW
         1.0, -1.0, -1.0, // Duplicate last two vertices to make 36
        -1.0, -1.0,  1.0,
         1.0, -1.0,  1.0,
    ];
     // Scale the skybox to be large
     for (let i = 0; i < positions.length; i++) {
         positions[i] *= 50; // Make skybox large
     }


    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    return {
        position: positionBuffer,
        vertexCount: 36, // 6 faces * 2 triangles/face * 3 vertices/triangle
    };
}

// --- Cubie Class (no changes needed inside the class itself) ---
class Cubie {
    constructor(id, initialLogicPos) {
        this.id = id;
        this.initialLogicPos = vec3.clone(initialLogicPos);
        this.currentLogicPos = vec3.clone(initialLogicPos);

        this.faceColors = Array(6).fill('BLACK');
        this.initFaceColors();

        this.modelMatrix = mat4.create();
        this.updateModelMatrixBasedOnPosition(); // Initialize based on logic pos

        this.buffers = this.initBuffers();
    }

    initFaceColors() {
        if (this.initialLogicPos[2] === 1) this.faceColors[FACE_INDICES.F] = FACE_COLOR_NAMES[FACE_INDICES.F];
        if (this.initialLogicPos[2] === -1) this.faceColors[FACE_INDICES.B] = FACE_COLOR_NAMES[FACE_INDICES.B];
        if (this.initialLogicPos[1] === 1) this.faceColors[FACE_INDICES.U] = FACE_COLOR_NAMES[FACE_INDICES.U];
        if (this.initialLogicPos[1] === -1) this.faceColors[FACE_INDICES.D] = FACE_COLOR_NAMES[FACE_INDICES.D];
        if (this.initialLogicPos[0] === -1) this.faceColors[FACE_INDICES.L] = FACE_COLOR_NAMES[FACE_INDICES.L];
        if (this.initialLogicPos[0] === 1) this.faceColors[FACE_INDICES.R] = FACE_COLOR_NAMES[FACE_INDICES.R];
    }

    // Updates the model matrix based ONLY on its logical position
    updateModelMatrixBasedOnPosition() {
        mat4.identity(this.modelMatrix);
        const translation = vec3.create();
        vec3.scale(translation, this.currentLogicPos, CUBE_UNIT_SIZE);
        mat4.translate(this.modelMatrix, this.modelMatrix, translation);
    }

    // Applies a temporary rotation (for animation) on top of the position-based matrix
    applyTemporaryRotation(rotationQuat) {
       this.updateModelMatrixBasedOnPosition(); // Start with base position
       if (rotationQuat) {
            const rotationMatrix = mat4.create();
            mat4.fromQuat(rotationMatrix, rotationQuat);
            // IMPORTANT: Multiply the rotation *after* the translation in the final matrix,
            // but here we modify the cubie's matrix *before* the parent matrix is applied.
            // We want to rotate the cubie around the CUBE's origin during animation.
            // So, calculate the rotated position relative to the origin first.
            let rotatedPosition = vec3.create();
            let currentPosition = vec3.create();
             vec3.scale(currentPosition, this.currentLogicPos, CUBE_UNIT_SIZE);

            vec3.transformQuat(rotatedPosition, currentPosition, rotationQuat);

            mat4.identity(this.modelMatrix);
            mat4.translate(this.modelMatrix, this.modelMatrix, rotatedPosition); // Move to rotated position

            // Also rotate the cubie's orientation itself
             mat4.multiply(this.modelMatrix, this.modelMatrix, rotationMatrix);
       }
    }


    initBuffers() {
        const s = CUBIE_SIZE / 2;
        // F, B, U, D, R, L order for vertices and normals
        const positions = [
            // Front face (Z+)
            -s, -s,  s,   s, -s,  s,   s,  s,  s,  -s,  s,  s,
            // Back face (Z-)
            -s, -s, -s,  -s,  s, -s,   s,  s, -s,   s, -s, -s,
            // Top face (Y+)
            -s,  s, -s,  -s,  s,  s,   s,  s,  s,   s,  s, -s,
            // Bottom face (Y-)
            -s, -s, -s,   s, -s, -s,   s, -s,  s,  -s, -s,  s,
            // Right face (X+)
             s, -s, -s,   s,  s, -s,   s,  s,  s,   s, -s,  s,
            // Left face (X-)
            -s, -s, -s,  -s, -s,  s,  -s,  s,  s,  -s,  s, -s,
        ];
        const faceNormals = [
             [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]
        ];
        const normals = [];
        faceNormals.forEach(normal => { for (let i = 0; i < 4; ++i) normals.push(...normal); });

        // Match geometry order F, B, U, D, R, L
        const geometryFaceOrder = [
            FACE_INDICES.F, FACE_INDICES.B, FACE_INDICES.U, FACE_INDICES.D, FACE_INDICES.R, FACE_INDICES.L
        ];
        const colors = [];
        geometryFaceOrder.forEach(faceIndex => {
            const colorName = this.faceColors[faceIndex];
            const colorVec = COLORS[colorName] || COLORS.GRAY;
            for (let i = 0; i < 4; ++i) colors.push(...colorVec);
        });

        const indices = [
             0,  1,  2,    0,  2,  3,  // Front
             4,  5,  6,    4,  6,  7,  // Back
             8,  9, 10,    8, 10, 11, // Top
            12, 13, 14,   12, 14, 15, // Bottom
            16, 17, 18,   16, 18, 19, // Right
            20, 21, 22,   20, 22, 23, // Left
        ];

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        const normalBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

        const colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW); // Dynamic for color updates

        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

        return {
            position: positionBuffer, normal: normalBuffer, color: colorBuffer,
            indices: indexBuffer, vertexCount: indices.length,
        };
    }

    updateColorBuffer() {
         // Match geometry order F, B, U, D, R, L
        const geometryFaceOrder = [
            FACE_INDICES.F, FACE_INDICES.B, FACE_INDICES.U, FACE_INDICES.D, FACE_INDICES.R, FACE_INDICES.L
        ];
        const newColorsData = [];
        geometryFaceOrder.forEach(faceIndex => {
            const colorName = this.faceColors[faceIndex];
            const colorVec = COLORS[colorName] || COLORS.GRAY;
            for (let i = 0; i < 4; ++i) newColorsData.push(...colorVec);
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        // Use bufferSubData for potentially better performance if structure doesn't change
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(newColorsData));
        // gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(newColorsData), gl.DYNAMIC_DRAW); // Also works
    }

    draw(programInfo, viewMatrix, projectionMatrix, parentModelMatrix = mat4.create()) {
        // --- Setup Cube Attributes ---
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.normal);
        gl.vertexAttribPointer(programInfo.attribLocations.vertexNormal, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(programInfo.attribLocations.vertexNormal);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.vertexAttribPointer(programInfo.attribLocations.vertexColor, 4, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(programInfo.attribLocations.vertexColor);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.indices);

        // --- Calculate Matrices ---
        const finalModelMatrix = mat4.create();
        // Apply the parent matrix (world rotation in FP mode, identity otherwise)
        // THEN apply the cubie's own model matrix (includes animation rotation or just position)
        mat4.multiply(finalModelMatrix, parentModelMatrix, this.modelMatrix);

        gl.uniformMatrix4fv(programInfo.uniformLocations.modelMatrix, false, finalModelMatrix);
        // Note: View and Projection matrices are set once per frame, not per cubie

        // Calculate and set the Normal Matrix (Inverse Transpose of Model-View)
        const normalMatrix = mat3.create();
        mat3.normalFromMat4(normalMatrix, finalModelMatrix); // Use the final model matrix
        gl.uniformMatrix3fv(programInfo.uniformLocations.normalMatrix, false, normalMatrix);

        // --- Draw Call ---
        gl.drawElements(gl.TRIANGLES, this.buffers.vertexCount, gl.UNSIGNED_SHORT, 0);
    }
}


// --- Rubik's Cube Class (no changes needed inside)---
class RubiksCube {
    constructor() {
        this.cubies = [];
        // this.mainModelMatrix = mat4.create(); // Now unused
        this.initCubies();
        this.initialCubieStates = this.cubies.map(c => ({
            logicPos: vec3.clone(c.currentLogicPos),
            faceColors: [...c.faceColors],
        }));
    }

    initCubies() {
        this.cubies = [];
        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                for (let z = -1; z <= 1; z++) {
                     if (x === 0 && y === 0 && z === 0) { continue; } // Skip center cubie
                    const logicPos = vec3.fromValues(x, y, z);
                    const cubie = new Cubie(`cubie_${x}_${y}_${z}`, logicPos);
                    this.cubies.push(cubie);
                }
            }
        }
    }

    reset() {
        this.cubies.forEach((cubie, index) => {
            const initialState = this.initialCubieStates[index];
            cubie.currentLogicPos = vec3.clone(initialState.logicPos);
            cubie.faceColors = [...initialState.faceColors];
            cubie.updateModelMatrixBasedOnPosition();
            cubie.updateColorBuffer();
        });
        isAnimating = false;
        animationQueue = [];
        currentAnimation = null;
    }

    getAffectedCubies(axisIndex, layerValue) {
        // Use Math.round to handle potential floating point inaccuracies after rotation
        return this.cubies.filter(cubie => Math.round(cubie.currentLogicPos[axisIndex]) === layerValue);
    }

    rotateFace(face, clockwise) {
        if (isAnimating && animationQueue.length > 3) return; // Limit queue

        animationQueue.push({ face, clockwise });
        if (!isAnimating) {
            this.processAnimationQueue();
        }
    }

    processAnimationQueue() {
        if (animationQueue.length === 0) {
            isAnimating = false;
            currentAnimation = null;
            return;
        }
        isAnimating = true;
        currentAnimation = animationQueue.shift();

        const { face, clockwise } = currentAnimation;
        let axis = vec3.create(); // Axis of rotation in world space
        let layer = 0; // The coordinate value defining the layer
        let axisIndex = 0; // 0 for X, 1 for Y, 2 for Z

         // Determine axis, layer, and axis index based on face
        switch (face) {
            case 'F': axis = [0, 0,  1]; layer =  1; axisIndex = 2; break;
            case 'B': axis = [0, 0, -1]; layer = -1; axisIndex = 2; break;
            case 'U': axis = [0,  1,  0]; layer =  1; axisIndex = 1; break;
            case 'D': axis = [0, -1,  0]; layer = -1; axisIndex = 1; break;
            case 'L': axis = [-1, 0,  0]; layer = -1; axisIndex = 0; break;
            case 'R': axis = [ 1, 0,  0]; layer =  1; axisIndex = 0; break;
        }

        // Calculate target angle: Positive angle = CCW, Negative angle = CW
        let targetAngle = clockwise ? -Math.PI / 2 : Math.PI / 2;

        // For B, D, L faces, invert angle for negative axes view consistency
        if (face === 'B' || face === 'D' || face === 'L') {
             targetAngle *= -1;
        }

        currentAnimation.axis = axis; // Use the correct world axis for rotation math
        currentAnimation.angle = 0;
        currentAnimation.targetAngle = targetAngle;
        currentAnimation.affectedCubies = this.getAffectedCubies(axisIndex, layer);
        currentAnimation.originalPositions = new Map();
        currentAnimation.affectedCubies.forEach(cubie => {
            currentAnimation.originalPositions.set(cubie.id, vec3.clone(cubie.currentLogicPos));
        });
    }

    updateAnimation() {
        if (!currentAnimation) return;

        const { affectedCubies, axis, targetAngle } = currentAnimation;
        let deltaAngle = ANIMATION_SPEED * Math.sign(targetAngle - currentAnimation.angle);

        // Clamp deltaAngle if it would overshoot the target
        if (Math.abs(currentAnimation.angle + deltaAngle) >= Math.abs(targetAngle)) {
            deltaAngle = targetAngle - currentAnimation.angle;
            currentAnimation.angle = targetAngle;
        } else {
            currentAnimation.angle += deltaAngle;
        }

        const rotationQuat = quat.create();
        quat.setAxisAngle(rotationQuat, axis, currentAnimation.angle); // Total rotation from start

        affectedCubies.forEach(cubie => {
             // Method 1: Use applyTemporaryRotation (simpler if it works)
             // cubie.applyTemporaryRotation(rotationQuat); // Needs debugging if used

             // Method 2: Manual calculation (current implementation)
            const originalPos = currentAnimation.originalPositions.get(cubie.id);
            let rotatedLogicPos = vec3.create();
            vec3.transformQuat(rotatedLogicPos, originalPos, rotationQuat);
            const translation = vec3.create();
            vec3.scale(translation, rotatedLogicPos, CUBE_UNIT_SIZE);

            mat4.identity(cubie.modelMatrix);
            mat4.translate(cubie.modelMatrix, cubie.modelMatrix, translation);
            const orientationRotationMatrix = mat4.create();
            mat4.fromQuat(orientationRotationMatrix, rotationQuat);
            mat4.multiply(cubie.modelMatrix, cubie.modelMatrix, orientationRotationMatrix);
        });

        if (currentAnimation.angle === targetAngle) {
            this.finalizeRotation(currentAnimation);
            this.processAnimationQueue();
        }
    }

     finalizeRotation(animationDetails) {
        const { face, clockwise, affectedCubies, targetAngle, axis } = animationDetails;

        // Rotation matrix for updating logical positions and colors
        const rotationMatrixLogic = mat4.create();
        mat4.fromRotation(rotationMatrixLogic, targetAngle, axis); // Use axis/angle from animation

        affectedCubies.forEach(cubie => {
            // Update logical position
            vec3.transformMat4(cubie.currentLogicPos, cubie.currentLogicPos, rotationMatrixLogic);
            cubie.currentLogicPos[0] = Math.round(cubie.currentLogicPos[0]);
            cubie.currentLogicPos[1] = Math.round(cubie.currentLogicPos[1]);
            cubie.currentLogicPos[2] = Math.round(cubie.currentLogicPos[2]);

            // --- Update Face Colors ---
            const oldColors = [...cubie.faceColors];
             // F=0, B=1, U=2, D=3, L=4, R=5
              const F = FACE_INDICES.F, B = FACE_INDICES.B, U = FACE_INDICES.U,
                    D = FACE_INDICES.D, L = FACE_INDICES.L, R = FACE_INDICES.R;

            // Determine the direction of color shuffling based on the *actual* rotation angle
            const isPositiveRotation = targetAngle > 0; // Positive angle = CCW around axis

            if (face === 'F' || face === 'B') { // Z-axis rotation
                const isActualCW = (face === 'F' && !isPositiveRotation) || (face === 'B' && isPositiveRotation);
                if (isActualCW) { // Actual Clockwise rotation around positive Z axis
                    cubie.faceColors[U] = oldColors[L]; cubie.faceColors[R] = oldColors[U];
                    cubie.faceColors[D] = oldColors[R]; cubie.faceColors[L] = oldColors[D];
                } else { // Actual Counter-Clockwise
                    cubie.faceColors[U] = oldColors[R]; cubie.faceColors[L] = oldColors[U];
                    cubie.faceColors[D] = oldColors[L]; cubie.faceColors[R] = oldColors[D];
                }
            } else if (face === 'U' || face === 'D') { // Y-axis rotation
                const isActualCW = (face === 'U' && !isPositiveRotation) || (face === 'D' && isPositiveRotation);
                if (isActualCW) { // Actual Clockwise rotation around positive Y axis
                    cubie.faceColors[F] = oldColors[R]; cubie.faceColors[L] = oldColors[F];
                    cubie.faceColors[B] = oldColors[L]; cubie.faceColors[R] = oldColors[B];
                } else { // Actual Counter-Clockwise
                    cubie.faceColors[F] = oldColors[L]; cubie.faceColors[R] = oldColors[F];
                    cubie.faceColors[B] = oldColors[R]; cubie.faceColors[L] = oldColors[B];
                }
            } else if (face === 'L' || face === 'R') { // X-axis rotation
                const isActualCW = (face === 'R' && !isPositiveRotation) || (face === 'L' && isPositiveRotation);
                 if (isActualCW) { // Actual Clockwise rotation around positive X axis
                    cubie.faceColors[F] = oldColors[D]; cubie.faceColors[U] = oldColors[F];
                    cubie.faceColors[B] = oldColors[U]; cubie.faceColors[D] = oldColors[B];
                 } else { // Actual Counter-Clockwise
                    cubie.faceColors[F] = oldColors[U]; cubie.faceColors[D] = oldColors[F];
                    cubie.faceColors[B] = oldColors[D]; cubie.faceColors[U] = oldColors[B];
                 }
            }

            cubie.updateColorBuffer();
            // Reset the model matrix to reflect the final logical position
            cubie.updateModelMatrixBasedOnPosition();
        });
    }


    draw(programInfo, viewMatrix, projectionMatrix) {
         // Set view and projection matrices once (shared by all cubies)
         gl.uniformMatrix4fv(programInfo.uniformLocations.viewMatrix, false, viewMatrix);
         gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);

        const identityMatrix = mat4.create();
        this.cubies.forEach(cubie => {
            cubie.draw(programInfo, viewMatrix, projectionMatrix, identityMatrix);
        });
    }
}

// --- Camera Classes (no changes needed inside classes) ---
class OrbitCamera {
    constructor(canvas) {
        this.canvas = canvas;
        this.radius = 8.0;
        this.minRadius = CUBE_UNIT_SIZE * 1.8; // Ensure cube is not clipped
        this.maxRadius = 25.0;
        this.theta = Math.PI / 4; // Horizontal angle
        this.phi = Math.PI / 4;   // Vertical angle
        this.target = vec3.fromValues(0, 0, 0);
        this.up = vec3.fromValues(0, 1, 0);
        this.eye = vec3.create(); // Camera position calculated from radius/angles

        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        this.viewMatrix = mat4.create();
        this.projectionMatrix = mat4.create();

        this.initEventListeners();
        this.updateProjectionMatrix();
        this.updateViewMatrix(); // Calculate initial eye position and view matrix
    }

    reset() {
        this.radius = 8.0;
        this.theta = Math.PI / 4;
        this.phi = Math.PI / 4;
        this.updateViewMatrix();
    }

    initEventListeners() {
        // Mouse Listeners
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        document.addEventListener('mousemove', this.onMouseMove.bind(this)); // Use document for dragging outside canvas
        document.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.onMouseWheel.bind(this), { passive: false }); // Prevent page scroll

        // Touch Listeners
        this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        document.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        document.addEventListener('touchend', this.onTouchEnd.bind(this));

        // Resize Listener
        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    _getTouchCoords(event) { return event.touches.length > 0 ? event.touches[0] : event.changedTouches[0]; }

    onTouchStart(event) {
        if (cameraMode !== 'orbit') return;
        event.preventDefault();
        if (event.touches.length === 1) {
            this.isDragging = true;
            const touch = this._getTouchCoords(event);
            this.lastMouseX = touch.clientX;
            this.lastMouseY = touch.clientY;
        }
    }
    onTouchMove(event) {
        if (cameraMode !== 'orbit' || !this.isDragging || event.touches.length !== 1) return;
        event.preventDefault();
        const touch = this._getTouchCoords(event);
        const deltaX = touch.clientX - this.lastMouseX;
        const deltaY = touch.clientY - this.lastMouseY;
        this.theta -= deltaX * 0.005; // Adjust sensitivity as needed
        this.phi -= deltaY * 0.005;
        // Clamp phi to avoid flipping upside down
        this.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.phi));
        this.lastMouseX = touch.clientX; this.lastMouseY = touch.clientY;
        this.updateViewMatrix();
    }
    onTouchEnd(event) { if (cameraMode === 'orbit' && event.touches.length === 0) this.isDragging = false; }


    onMouseDown(event) {
        if (cameraMode !== 'orbit' || event.button !== 0) return; // Only left button
        this.isDragging = true;
        this.lastMouseX = event.clientX; this.lastMouseY = event.clientY;
         this.canvas.style.cursor = 'grabbing'; // Indicate dragging
    }
    onMouseMove(event) {
        if (cameraMode !== 'orbit' || !this.isDragging) return;
        const deltaX = event.clientX - this.lastMouseX;
        const deltaY = event.clientY - this.lastMouseY;
        this.theta -= deltaX * 0.005; // Adjust sensitivity
        this.phi -= deltaY * 0.005;
        this.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.phi)); // Clamp phi
        this.lastMouseX = event.clientX; this.lastMouseY = event.clientY;
        this.updateViewMatrix();
    }
    onMouseUp(event) {
        if (cameraMode === 'orbit' && event.button === 0) {
            this.isDragging = false;
             this.canvas.style.cursor = 'grab'; // Back to grabbable cursor
        }
    }
    onMouseWheel(event) {
        if (cameraMode !== 'orbit') return;
        event.preventDefault(); // Prevent page scrolling
        this.radius += event.deltaY * 0.01; // Adjust zoom sensitivity
        this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius)); // Clamp radius
        this.updateViewMatrix();
    }

    onWindowResize() {
        // Update canvas size and viewport
        gl.canvas.width = window.innerWidth;
        gl.canvas.height = window.innerHeight;
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        // Update projection matrices for both cameras and skybox
        this.updateProjectionMatrix();
        if (firstPersonCamera) {
            firstPersonCamera.updateProjectionMatrix();
        }
        // Skybox uses the same projection matrix, so no extra update needed here
    }

    updateViewMatrix() {
        // Calculate eye position based on spherical coordinates (radius, theta, phi)
        this.eye[0] = this.target[0] + this.radius * Math.sin(this.phi) * Math.sin(this.theta);
        this.eye[1] = this.target[1] + this.radius * Math.cos(this.phi);
        this.eye[2] = this.target[2] + this.radius * Math.sin(this.phi) * Math.cos(this.theta);
        // Update the view matrix
        mat4.lookAt(this.viewMatrix, this.eye, this.target, this.up);
    }

    updateProjectionMatrix() {
        const fieldOfView = 45 * Math.PI / 180; // Field of view in radians
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        const zNear = 0.1;
        const zFar = 200.0; // Increase zFar to ensure skybox fits
        mat4.perspective(this.projectionMatrix, fieldOfView, aspect, zNear, zFar);
    }
}

class FirstPersonCamera {
    constructor(canvas) {
        this.canvas = canvas;
        // Camera Attributes
        this.position = vec3.fromValues(0, CUBE_UNIT_SIZE * 0.5, CUBE_UNIT_SIZE * 8); // Initial position slightly in front and up
        this.front = vec3.fromValues(0, 0, -1); // Initial facing direction (-Z)
        this.up = vec3.fromValues(0, 1, 0);     // World up direction
        this.right = vec3.create();             // Calculated based on front and up
        this.worldUp = vec3.clone(this.up);   // Store world up for calculations

        // Euler Angles (for view direction)
        this.yaw = -90.0; // Degrees. -90 points towards -Z
        this.pitch = 0.0; // Degrees. 0 is level

        // Mouse/Touch Interaction
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.sensitivity = 0.1; // Mouse sensitivity factor

        // Zoom (adjusting Field of View or position - let's adjust position)
        this.minZoomDistance = CUBE_UNIT_SIZE * 1.8;
        this.maxZoomDistance = CUBE_UNIT_SIZE * 15; // Allow zooming further out/in

        // Matrices
        this.viewMatrix = mat4.create();
        this.projectionMatrix = mat4.create();

        this.initEventListeners();
        this.updateCameraVectors(); // Calculate initial front, right, up
        this.updateProjectionMatrix();
        this.updateViewMatrix();
    }

    initEventListeners() {
        // Mouse
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        document.addEventListener('mousemove', this.onMouseMove.bind(this));
        document.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.onMouseWheel.bind(this), { passive: false });
        // Touch
        this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        document.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        document.addEventListener('touchend', this.onTouchEnd.bind(this));
        // Note: Resize is handled by OrbitCamera's listener
    }

    _getTouchCoords(event) { return event.touches.length > 0 ? event.touches[0] : event.changedTouches[0]; }

     onTouchStart(event) {
        if (cameraMode !== 'firstPerson') return;
        event.preventDefault();
        if (event.touches.length === 1) {
            this.isDragging = true;
            const touch = this._getTouchCoords(event);
            this.lastMouseX = touch.clientX;
            this.lastMouseY = touch.clientY;
        }
    }
    onTouchMove(event) {
        if (cameraMode !== 'firstPerson' || !this.isDragging || event.touches.length !== 1) return;
        event.preventDefault();
        const touch = this._getTouchCoords(event);
        const deltaX = touch.clientX - this.lastMouseX;
        const deltaY = touch.clientY - this.lastMouseY; // Inverted Y for touch usually not needed
        this.lastMouseX = touch.clientX;
        this.lastMouseY = touch.clientY;
        this.processMouseMovement(deltaX, deltaY);
    }
    onTouchEnd(event) { if (cameraMode === 'firstPerson' && event.touches.length === 0) this.isDragging = false; }


    onMouseDown(event) {
        if (cameraMode !== 'firstPerson' || event.button !== 0) return;
        this.isDragging = true;
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
         this.canvas.style.cursor = 'grabbing';
    }
    onMouseMove(event) {
        if (cameraMode !== 'firstPerson' || !this.isDragging) return;
        const deltaX = event.clientX - this.lastMouseX;
        const deltaY = this.lastMouseY - event.clientY; // Y is reversed: higher screen Y is lower pitch
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;
        this.processMouseMovement(deltaX, deltaY);
    }
    onMouseUp(event) {
        if (cameraMode === 'firstPerson' && event.button === 0) {
             this.isDragging = false;
             this.canvas.style.cursor = 'crosshair'; // Or default
        }
    }

    // NEW: Process mouse/touch movement to update yaw and pitch
    processMouseMovement(xoffset, yoffset) {
        xoffset *= this.sensitivity;
        yoffset *= this.sensitivity;

        this.yaw += xoffset;
        this.pitch += yoffset;

        // Clamp pitch to prevent looking straight up or down and flipping
        if (this.pitch > 89.0) this.pitch = 89.0;
        if (this.pitch < -89.0) this.pitch = -89.0;

        // Update Front, Right and Up Vectors based on new Euler angles
        this.updateCameraVectors();
        this.updateViewMatrix(); // Update view matrix after changing orientation
    }

    // NEW: Update camera direction vectors based on yaw and pitch
    updateCameraVectors() {
        // Calculate the new Front vector
        const front = vec3.create();
        front[0] = Math.cos(glMatrix.glMatrix.toRadian(this.yaw)) * Math.cos(glMatrix.glMatrix.toRadian(this.pitch));
        front[1] = Math.sin(glMatrix.glMatrix.toRadian(this.pitch));
        front[2] = Math.sin(glMatrix.glMatrix.toRadian(this.yaw)) * Math.cos(glMatrix.glMatrix.toRadian(this.pitch));
        vec3.normalize(this.front, front);

        // Recalculate the Right vector
        vec3.cross(this.right, this.front, this.worldUp);
        vec3.normalize(this.right, this.right);

        // Recalculate the Up vector (relative to camera orientation)
        vec3.cross(this.up, this.right, this.front);
        vec3.normalize(this.up, this.up);
    }


    onMouseWheel(event) {
        if (cameraMode !== 'firstPerson') return;
        event.preventDefault();
        // Zoom by moving the camera position along the 'front' vector
        const zoomAmount = event.deltaY * -0.01; // Adjust sensitivity, negative deltaY means scroll up/zoom in
        const moveVector = vec3.create();
        vec3.scale(moveVector, this.front, zoomAmount);

        // Calculate potential new position
        const newPos = vec3.add(vec3.create(), this.position, moveVector);

        // Check distance to origin (target) and clamp
        const distToOrigin = vec3.length(newPos); // Assuming target is origin (0,0,0)

        if (distToOrigin >= this.minZoomDistance && distToOrigin <= this.maxZoomDistance) {
             vec3.add(this.position, this.position, moveVector); // Apply movement
             this.updateViewMatrix(); // Update view matrix after changing position
        }
    }

    updateViewMatrix() {
        // Calculate the target point the camera is looking at
        const lookAtTarget = vec3.create();
        vec3.add(lookAtTarget, this.position, this.front);
        // Create the view matrix using the camera's position, target, and up vector
        mat4.lookAt(this.viewMatrix, this.position, lookAtTarget, this.up);
    }

    updateProjectionMatrix() {
        const fieldOfView = 50 * Math.PI / 180; // Keep FOV consistent
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        const zNear = 0.1;
        const zFar = 200.0; // Increase zFar to ensure skybox fits
        mat4.perspective(this.projectionMatrix, fieldOfView, aspect, zNear, zFar);
    }

    reset() {
        // Reset position and orientation
        this.position = vec3.fromValues(0, CUBE_UNIT_SIZE * 0.5, CUBE_UNIT_SIZE * 3.2);
        this.yaw = -90.0;
        this.pitch = 0.0;
        this.updateCameraVectors(); // Recalculate vectors based on reset angles
        this.updateViewMatrix();     // Update the view matrix
    }

    // Getter for eye position needed by shader (consistent naming with OrbitCamera)
    get eye() {
        return this.position;
    }
}

// --- NEW: Function to draw the skybox ---
function drawSkybox(viewMatrix, projectionMatrix) {
    if (!isSkyboxReady || !skyboxProgramInfo || !skyboxBuffers || !skyboxTexture) {
        // Fallback to clearing color if skybox isn't ready yet
        gl.clearColor(SOLID_BG_COLOR[0], SOLID_BG_COLOR[1], SOLID_BG_COLOR[2], SOLID_BG_COLOR[3]);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        return;
    }

    // --- Setup Skybox Rendering ---
    // NOTE: Changed depthFunc setting order slightly for clarity
    // The important part is setting it *before* drawing the skybox
    // and potentially resetting it after if needed (though LEQUAL is often fine for both).
    gl.depthFunc(gl.LEQUAL); // Draw skybox behind everything else (or at the same depth)

    gl.useProgram(skyboxProgramInfo.program);

    // --- CORRECTED VIEW MATRIX HANDLING ---
    // Remove translation from the *actual* incoming view matrix.
    // We want the skybox to rotate with the camera, but not move with it.
    const viewRotationMatrix = mat4.clone(viewMatrix); // 1. Clone the camera's view matrix
    viewRotationMatrix[12] = 0; // 2. Zero out the x translation component
    viewRotationMatrix[13] = 0; // 3. Zero out the y translation component
    viewRotationMatrix[14] = 0; // 4. Zero out the z translation component
    // Now viewRotationMatrix contains only the rotation/orientation part of the camera's view.

    // --- Set uniforms ---
    // Pass the modified view matrix (rotation only) to the skybox shader
    gl.uniformMatrix4fv(skyboxProgramInfo.uniformLocations.viewMatrix, false, viewRotationMatrix);
    // Projection matrix remains the same
    gl.uniformMatrix4fv(skyboxProgramInfo.uniformLocations.projectionMatrix, false, projectionMatrix);

    // Bind texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
    gl.uniform1i(skyboxProgramInfo.uniformLocations.skyboxSampler, 0); // Texture unit 0

    // Set attribute pointers
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffers.position);
    gl.vertexAttribPointer(skyboxProgramInfo.attribLocations.vertexPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(skyboxProgramInfo.attribLocations.vertexPosition);

    // --- Draw the skybox ---
    gl.drawArrays(gl.TRIANGLES, 0, skyboxBuffers.vertexCount);

    // --- Restore depth function if necessary (LEQUAL often works for both) ---
    // gl.depthFunc(gl.LESS); // If your main scene uses LESS, uncomment this. LEQUAL is generally safe.
}

let enableReflection = false; // Start with reflection off
let reflectionStrength = 0.4; // Default reflectivity (adjust as needed)

// --- Main Application Logic ---
function main() {
    const canvas = document.getElementById('rubiksCubeCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;

     // Set initial cursor styles
    canvas.style.cursor = 'grab'; // Default for orbit

    gl = initWebGL(canvas);
    if (!gl) return;

    // --- Initialize Rubik's Cube Shader Program ---
    shaderProgram = initShaderProgram(vsSource, fsSource);
    if (!shaderProgram) return;

    const programInfo = {
        program: shaderProgram,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
            vertexNormal: gl.getAttribLocation(shaderProgram, 'aVertexNormal'),
            vertexColor: gl.getAttribLocation(shaderProgram, 'aVertexColor'),
        },
        uniformLocations: {
            projectionMatrix: gl.getUniformLocation(shaderProgram, 'uProjectionMatrix'),
            viewMatrix: gl.getUniformLocation(shaderProgram, 'uViewMatrix'),
            modelMatrix: gl.getUniformLocation(shaderProgram, 'uModelMatrix'),
            normalMatrix: gl.getUniformLocation(shaderProgram, 'uNormalMatrix'),
            // Lighting uniforms
            eyePosition_World: gl.getUniformLocation(shaderProgram, 'uEyePosition_World'),
            lightPosition_World: gl.getUniformLocation(shaderProgram, 'uLightPosition_World'),
            lightColor: gl.getUniformLocation(shaderProgram, 'uLightColor'),
            ambientLightColor: gl.getUniformLocation(shaderProgram, 'uAmbientLightColor'),
            shininess: gl.getUniformLocation(shaderProgram, 'uShininess'),
            // --- NEW: Reflection Uniform Locations ---
            environmentSampler: gl.getUniformLocation(shaderProgram, 'uEnvironmentSampler'),
            enableReflection: gl.getUniformLocation(shaderProgram, 'uEnableReflection'),
            reflectivity: gl.getUniformLocation(shaderProgram, 'uReflectivity'),
        },
    };

    // --- Initialize Skybox Shader Program ---
    const skyboxProgram = initShaderProgram(skyboxVsSource, skyboxFsSource);
     if (skyboxProgram) {
        skyboxProgramInfo = {
            program: skyboxProgram,
            attribLocations: {
                vertexPosition: gl.getAttribLocation(skyboxProgram, 'aVertexPosition'),
            },
            uniformLocations: {
                projectionMatrix: gl.getUniformLocation(skyboxProgram, 'uProjectionMatrix'),
                viewMatrix: gl.getUniformLocation(skyboxProgram, 'uViewMatrix'),
                skyboxSampler: gl.getUniformLocation(skyboxProgram, 'uSkyboxSampler'),
            },
        };
        skyboxBuffers = initSkyboxBuffers();
        skyboxTexture = loadCubeMap(CUBEMAP_FACES); // Start loading the cubemap
    } else {
         console.error("Failed to initialize skybox shader program.");
         // Continue without skybox functionality
    }


    // --- Initialize Scene Objects ---
    rubiksCube = new RubiksCube();
    orbitCamera = new OrbitCamera(canvas);
    firstPersonCamera = new FirstPersonCamera(canvas);
    currentCamera = orbitCamera; // Start with orbit camera

    // --- Event Listeners ---
    document.addEventListener('keydown', (event) => {
        // Allow camera/background toggle even during animation
        if (event.key.toUpperCase() === 'C') {
            event.preventDefault();
            toggleCameraMode();
            return;
        }
        // --- NEW: Background Toggle ---
        if (event.key.toUpperCase() === 'B') {
            event.preventDefault();
            toggleBackground();
            return;
        }

        if (event.key.toUpperCase() === 'M') {
            event.preventDefault();
            toggleReflection();
            return;
       }

        // Limit new moves if animating heavily
        if (isAnimating && animationQueue.length > 2) return;

        const key = event.key.toUpperCase();
        const clockwise = !event.shiftKey; // Shift key reverses direction (makes it CCW)

        let face = null;
        if (['F', 'B', 'U', 'D', 'L', 'R'].includes(key)) face = key;

        if (face) {
            event.preventDefault(); // Prevent browser default actions for F, R etc.
            rubiksCube.rotateFace(face, clockwise);
        }
    });

    // --- Render Loop ---
    function render(now) {
        // --- 1. Handle Background ---
        if (backgroundMode === 'color') {
            gl.clearColor(SOLID_BG_COLOR[0], SOLID_BG_COLOR[1], SOLID_BG_COLOR[2], SOLID_BG_COLOR[3]);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        } else if (backgroundMode === 'cubemap' && isSkyboxReady) { // Check if skybox is ready
            // Clear only depth buffer before drawing skybox
            gl.clear(gl.DEPTH_BUFFER_BIT);
            // NOTE: drawSkybox internally uses texture unit 0
            drawSkybox(currentCamera.viewMatrix, currentCamera.projectionMatrix);
        } else {
             // Fallback if cubemap background selected but not ready
             gl.clearColor(SOLID_BG_COLOR[0], SOLID_BG_COLOR[1], SOLID_BG_COLOR[2], SOLID_BG_COLOR[3]);
             gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }

        // --- 2. Setup Rubik's Cube Rendering ---
        gl.useProgram(programInfo.program);

        // Set common uniforms for the Rubik's cube shader
        gl.uniform3fv(programInfo.uniformLocations.eyePosition_World, currentCamera.eye);

        // Lighting settings (can remain the same)
        gl.uniform3fv(programInfo.uniformLocations.ambientLightColor, [0.4, 0.4, 0.45]);
        gl.uniform3fv(programInfo.uniformLocations.lightColor, [1.0, 1.0, 1.0]);
        const lightPos = currentCamera.eye; // Light source follows the camera
        gl.uniform3fv(programInfo.uniformLocations.lightPosition_World, lightPos);
        gl.uniform1f(programInfo.uniformLocations.shininess, 32.0);

        if (isSkyboxReady && skyboxTexture) { // Only bind if cubemap is loaded
            gl.activeTexture(gl.TEXTURE1); // Use texture unit 1 for environment map
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
            gl.uniform1i(programInfo.uniformLocations.environmentSampler, 1); // Tell shader sampler to use texture unit 1
    
            // Set reflection toggle and strength (pass boolean as 0 or 1)
            gl.uniform1i(programInfo.uniformLocations.enableReflection, enableReflection ? 1 : 0);
            gl.uniform1f(programInfo.uniformLocations.reflectivity, reflectionStrength);
        } else {
             // If cubemap not ready, ensure reflection is disabled in shader
             gl.uniform1i(programInfo.uniformLocations.enableReflection, 0);
        }

        // --- 3. Update and Draw Rubik's Cube ---
        if (isAnimating) {
            rubiksCube.updateAnimation();
        }
        // Pass the *cube's* programInfo and current camera matrices
        rubiksCube.draw(programInfo, currentCamera.viewMatrix, currentCamera.projectionMatrix);

        // --- 4. Request Next Frame ---
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render); // Start the render loop
}

// --- UI Interaction Functions ---
window.rotateFace = (face, clockwise) => { rubiksCube.rotateFace(face, clockwise); };

window.resetCube = () => {
    rubiksCube.reset();
    showMessage("魔術方塊已重置。");
};

window.resetCamera = () => {
    currentCamera.reset();
    showMessage("相機視角已重置。");
};

window.toggleCameraMode = () => {
    const canvas = document.getElementById('rubiksCubeCanvas');
    if (cameraMode === 'orbit') {
        cameraMode = 'firstPerson';
        currentCamera = firstPersonCamera;
        orbitCamera.isDragging = false; // Ensure orbit dragging stops
        canvas.style.cursor = 'crosshair'; // Or default cursor for FP
        showMessage("切換到第一人稱視角 (按 C 切換, 按 B 切換背景)");
    } else {
        cameraMode = 'orbit';
        currentCamera = orbitCamera;
        firstPersonCamera.isDragging = false; // Ensure FP dragging stops
        canvas.style.cursor = 'grab'; // Set grab cursor for orbit
        showMessage("切換到第三人稱軌道視角 (按 C 切換, 按 B 切換背景)");
    }
    currentCamera.updateViewMatrix(); // Update view matrix immediately
};

// --- NEW: Background Toggle Function ---
window.toggleBackground = () => {
    if (backgroundMode === 'color') {
        if (isSkyboxReady) {
            backgroundMode = 'cubemap';
            showMessage("背景切換為環境Cube Map (按 B 切換)");
        } else {
            showMessage("環境Cube Map尚未載入完成。", 2000);
        }
    } else {
        backgroundMode = 'color';
        showMessage("背景切換為純色 (按 B 切換)");
    }
};

window.toggleReflection = () => {
    // Only allow enabling if the skybox texture is actually ready
    if (!enableReflection && !isSkyboxReady) {
         showMessage("天空盒紋理尚未載入，無法啟用反射。", 2000);
         return;
    }

    enableReflection = !enableReflection; // Toggle the state
    if (enableReflection) {
        showMessage(`啟用環境反射 (強度: ${reflectionStrength.toFixed(2)}) (按 M 切換)`, 2500);
    } else {
        showMessage("禁用環境反射 (按 M 切換)", 2500);
    }
    // No need to explicitly call render, the next frame will pick up the new 'enableReflection' value
};

window.scrambleCube = () => {
    if (isAnimating && animationQueue.length > 0) {
        showMessage("請等待目前動畫完成。");
        return;
    }
    const moves = ['F', 'B', 'U', 'D', 'L', 'R'];
    const numScrambleMoves = 20 + Math.floor(Math.random() * 10);
    let scrambleSequence = [];
    let lastMoveFace = '';

    for (let i = 0; i < numScrambleMoves; i++) {
         let randomFace;
         do {
             randomFace = moves[Math.floor(Math.random() * moves.length)];
         } while (randomFace === lastMoveFace);

        const randomClockwise = Math.random() < 0.5;
        scrambleSequence.push({ face: randomFace, clockwise: randomClockwise });
        lastMoveFace = randomFace;
    }
    animationQueue = [...animationQueue, ...scrambleSequence];
    if (!isAnimating) {
        rubiksCube.processAnimationQueue();
    }
    showMessage(`開始 ${numScrambleMoves} 步隨機打亂...`);
};

let messageTimeout;
function showMessage(message, duration = 3000) {
    const messageBox = document.getElementById('message-box');
    if (!messageBox) { console.log("Message: ", message); return; } // Fallback to console
    messageBox.textContent = message;
    messageBox.style.display = 'block';
    clearTimeout(messageTimeout);
    messageTimeout = setTimeout(() => { messageBox.style.display = 'none'; }, duration);
}

// --- Global Error Handler ---
window.onerror = function (message, source, lineno, colno, error) {
  console.error("JavaScript Error:", message, "at", source, ":", lineno, ":", colno);
  showMessage(`發生錯誤: ${message}`, 5000); // Display error to user
  return true; // Prevent default browser error handling
};

window.onload = main;