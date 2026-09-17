/**
 * Open MCT Plugin: Orion 3D Model View
 * 
 * Features:
 * - Center of the model is exactly at the center of the base (static pivot at 0, 0, 0).
 * - Normal model movement (no manual sliders):
 *   - Continuous wheel spinning along the wheel axle axis (Z) in reversed direction.
 *   - Rocker-bogie articulation along the pivot axis (Z).
 *   - Dynamic smooth 2-axis tilting on X (roll) and Z (pitch) in full range between, with strictly zero rotation left-right (yaw = 0).
 * - OrbitControls camera navigation centered on the static base point.
 * - Collision geometry rendered as wireframe boxes matching CAD assembly (Picture 2).
 * - Clean minimal HUD: Pause/Play, Wireframe toggle, Reset View.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.OrionModelPlugin = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    return function OrionModelPlugin(options) {
        options = options || {};

        const modelUrl = options.modelUrl || '/orion_VI.glb';
        const objectType = options.objectType || 'orion-model-view';
        const backgroundColor = 0x1e1e1e; // Neutral dark grey #1e1e1e

        return function install(openmct) {
            // 1. Register domain object type in Open MCT (available in "+ Create" menu)
            openmct.types.addType(objectType, {
                name: 'Orion 3D Model',
                description: 'Displays the animated 3D model of the Orion Mars Rover (orion_VI.glb).',
                creatable: true,
                cssClass: 'icon-box',
                initialize: function (domainObject) {
                    domainObject.modelUrl = modelUrl;
                },
                form: [
                    {
                        key: 'modelUrl',
                        name: 'Model URL',
                        control: 'textfield',
                        required: false,
                        cssClass: 'l-input-lg'
                    }
                ]
            });

            // 2. Register Permanent Root Object & Provider in Open MCT Tree
            openmct.objects.addRoot({
                namespace: 'orion.model',
                key: 'rover'
            });

            openmct.objects.addProvider('orion.model', {
                get: function (identifier) {
                    if (identifier.key === 'rover') {
                        return Promise.resolve({
                            identifier: identifier,
                            name: 'Orion VI Rover (3D Model)',
                            type: objectType,
                            modelUrl: modelUrl,
                            location: 'ROOT'
                        });
                    }
                    return Promise.reject(new Error(`Model object not found: ${identifier.key}`));
                }
            });

            // 3. Register Object View Provider
            openmct.objectViews.addProvider({
                key: 'orion-model-object-view',
                name: '3D Model View',
                cssClass: 'icon-box',
                priority: openmct.priority ? (openmct.priority.DEFAULT + 20) : 120,
                canView: function (domainObject) {
                    return domainObject.type === objectType;
                },
                canEdit: function () {
                    return false;
                },
                view: function (domainObject) {
                    let animationFrameId = null;
                    let resizeObserver = null;
                    let renderer = null;
                    let scene = null;
                    let camera = null;
                    let controls = null;
                    let mixer = null;
                    let pivotGroup = null;
                    let clock = null;
                    let isDestroyed = false;
                    let hudElement = null;

                    // Kinematics references
                    const wheels = [];
                    let rockerL = null;
                    let rockerR = null;
                    const collisionMeshes = [];

                    // Animation state: normal movement running automatically
                    let isMoving = true;
                    let showCollision = false; // Wireframe off by default
                    let wheelAngle = 0;
                    let elapsedTime = 0;

                    return {
                        show: function (container) {
                            isDestroyed = false;

                            const THREE = options.THREE || (typeof window !== 'undefined' ? window.THREE : null);
                            if (!THREE) {
                                renderError(container, 'Three.js is not loaded.');
                                return;
                            }

                            const GLTFLoader = options.GLTFLoader ||
                                               (THREE.GLTFLoader ? THREE.GLTFLoader : (typeof window !== 'undefined' ? window.GLTFLoader : null));
                            if (!GLTFLoader) {
                                renderError(container, 'GLTFLoader is not available.');
                                return;
                            }

                            const OrbitControls = options.OrbitControls ||
                                                 (THREE.OrbitControls ? THREE.OrbitControls : (typeof window !== 'undefined' ? window.OrbitControls : null));

                            // Container styling
                            container.style.position = 'relative';
                            container.style.width = '100%';
                            container.style.height = '100%';
                            container.style.overflow = 'hidden';
                            container.style.backgroundColor = '#' + backgroundColor.toString(16).padStart(6, '0');

                            const viewWrapper = document.createElement('div');
                            viewWrapper.style.width = '100%';
                            viewWrapper.style.height = '100%';
                            viewWrapper.style.position = 'absolute';
                            viewWrapper.style.top = '0';
                            viewWrapper.style.left = '0';
                            container.appendChild(viewWrapper);

                            // Loading Overlay
                            const loadingOverlay = document.createElement('div');
                            loadingOverlay.style.position = 'absolute';
                            loadingOverlay.style.top = '50%';
                            loadingOverlay.style.left = '50%';
                            loadingOverlay.style.transform = 'translate(-50%, -50%)';
                            loadingOverlay.style.textAlign = 'center';
                            loadingOverlay.style.color = '#fff';
                            loadingOverlay.style.fontFamily = 'Helvetica, Arial, sans-serif';
                            loadingOverlay.style.pointerEvents = 'none';
                            loadingOverlay.style.zIndex = '10';
                            loadingOverlay.innerHTML = `
                                <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px;">Loading Orion VI Rover...</div>
                                <div style="width: 220px; height: 6px; background: rgba(255,255,255,0.15); border-radius: 3px; overflow: hidden; margin: 0 auto 6px auto;">
                                    <div id="orion-progress-bar" style="width: 0%; height: 100%; background: #38ef7d; transition: width 0.15s ease;"></div>
                                </div>
                                <div id="orion-progress-text" style="font-size: 11px; color: #94a3b8;">Reading .glb model...</div>
                            `;
                            viewWrapper.appendChild(loadingOverlay);

                            const progressBar = loadingOverlay.querySelector('#orion-progress-bar');
                            const progressText = loadingOverlay.querySelector('#orion-progress-text');

                            const width = container.clientWidth || 600;
                            const height = container.clientHeight || 400;

                            // 1. Scene & Static Pivot Group
                            scene = new THREE.Scene();
                            scene.background = new THREE.Color(backgroundColor);

                            // Pivot Group: Fixed at (0, 0, 0) static center point of base
                            pivotGroup = new THREE.Group();
                            pivotGroup.position.set(0, 0, 0);
                            scene.add(pivotGroup);

                            // 2. Camera: Looking directly at static base center (0, 0, 0)
                            camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
                            camera.position.set(2.4, 1.2, 2.4);

                            // 3. Renderer
                            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
                            renderer.setSize(width, height);
                            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                            if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
                                renderer.outputColorSpace = THREE.SRGBColorSpace;
                            }
                            viewWrapper.appendChild(renderer.domElement);

                            // 4. OrbitControls: Target centered on static base center (0, 0, 0)
                            if (OrbitControls) {
                                controls = new OrbitControls(camera, renderer.domElement);
                                controls.enableDamping = true;
                                controls.dampingFactor = 0.08;
                                controls.minDistance = 0.5;
                                controls.maxDistance = 25.0;
                                controls.target.set(0, 0, 0);
                            }

                            // 5. Lighting: Clean multi-point lighting matching Blender CAD (Picture 2)
                            const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444d56, 1.6);
                            scene.add(hemiLight);

                            const sun1 = new THREE.DirectionalLight(0xffffff, 2.0);
                            sun1.position.set(6, 12, 8);
                            scene.add(sun1);

                            const sun2 = new THREE.DirectionalLight(0x90b0d0, 1.2);
                            sun2.position.set(-6, 4, -6);
                            scene.add(sun2);

                            const sun3 = new THREE.DirectionalLight(0xffffff, 0.8);
                            sun3.position.set(0, 8, -8);
                            scene.add(sun3);

                            // 6. Ground Grid: Positioned flush under wheels at level y = -0.7464
                            const grid = new THREE.GridHelper(10, 20, 0x555555, 0x3e3e42);
                            grid.position.y = -0.7464;
                            scene.add(grid);

                            clock = new THREE.Clock();

                            // 7. Load orion_VI.glb directly
                            const activeModelUrl = domainObject.modelUrl || modelUrl;
                            const loader = new GLTFLoader();

                            loader.load(
                                activeModelUrl,
                                function (gltf) {
                                    if (isDestroyed) {
                                        disposeHierarchy(gltf.scene);
                                        return;
                                    }

                                    const gltfScene = gltf.scene;

                                    // Find robot assembly root (realsense)
                                    const robotRoot = gltfScene.getObjectByName('realsense');
                                    if (robotRoot) {
                                        // Hide unparented stray duplicate objects sitting at origin
                                        gltfScene.children.forEach(function (child) {
                                            if (child !== robotRoot) {
                                                child.visible = false;
                                            }
                                        });
                                    }

                                    // Locate Kinematic Parts:
                                    // A. Rockers (rocker_L_joint and rocker_R_joint pivot along lateral Z axis)
                                    rockerL = gltfScene.getObjectByName('rocker_L_joint') || gltfScene.getObjectByName('rocker_L');
                                    rockerR = gltfScene.getObjectByName('rocker_R_joint') || gltfScene.getObjectByName('rocker_R');

                                    // B. Wheels (4 wheels: FL, FR, RL, RR)
                                    ['wheel_F_L', 'wheel_F_R', 'wheel_R_L', 'wheel_R_R'].forEach(function (wName) {
                                        const wObj = gltfScene.getObjectByName(wName);
                                        if (wObj) wheels.push(wObj);
                                    });

                                    // C. Configure Collision Meshes as wireframe boxes (matching Picture 2)
                                    gltfScene.traverse(function (child) {
                                        if (child.isMesh) {
                                            if (child.name.toLowerCase().includes('collision')) {
                                                collisionMeshes.push(child);
                                                child.material = new THREE.MeshBasicMaterial({
                                                    color: 0x111827,
                                                    wireframe: true,
                                                    transparent: true,
                                                    opacity: 0.5
                                                });
                                                child.visible = showCollision;
                                            } else {
                                                if (child.material) {
                                                    child.material.side = THREE.DoubleSide;
                                                }
                                            }
                                        }
                                    });

                                    // Calculate center of the base chassis
                                    const baseBox = new THREE.Box3();
                                    ['base_link_visual', 'module_F_visual', 'module_R_visual', 'base_link'].forEach(function (name) {
                                        const obj = gltfScene.getObjectByName(name);
                                        if (obj) baseBox.expandByObject(obj);
                                    });
                                    const baseCenter = baseBox.getCenter(new THREE.Vector3());

                                    // Shift gltfScene so that the center of the base is at (0, 0, 0) relative to pivotGroup
                                    gltfScene.position.set(-baseCenter.x, -baseCenter.y, -baseCenter.z);
                                    pivotGroup.add(gltfScene);
                                    pivotGroup.updateMatrixWorld(true);

                                    // Dynamically lower the model so the bottom of the wheels rests squarely on the ground grid
                                    let lowestWheelY = Infinity;
                                    if (wheels.length > 0) {
                                        wheels.forEach(function (wheel) {
                                            const box = new THREE.Box3().setFromObject(wheel);
                                            if (box.min.y < lowestWheelY) {
                                                lowestWheelY = box.min.y;
                                            }
                                        });
                                    } else {
                                        const sceneBox = new THREE.Box3().setFromObject(gltfScene);
                                        lowestWheelY = sceneBox.min.y;
                                    }

                                    if (lowestWheelY !== Infinity) {
                                        const gap = lowestWheelY - grid.position.y;
                                        pivotGroup.position.y = -gap;
                                        pivotGroup.updateMatrixWorld(true);
                                    }

                                    // Camera & OrbitControls target match static base center at its lowered position
                                    camera.position.set(2.4, 1.2 + pivotGroup.position.y, 2.4);
                                    if (controls) {
                                        controls.target.set(0, pivotGroup.position.y, 0);
                                        controls.update();
                                    }

                                    // Play genuine animations if defined in GLTF
                                    if (gltf.animations && gltf.animations.length > 0) {
                                        mixer = new THREE.AnimationMixer(gltfScene);
                                        gltf.animations.forEach(function (clip) {
                                            mixer.clipAction(clip).play();
                                        });
                                    }

                                    // Remove loading overlay
                                    if (loadingOverlay.parentNode) {
                                        loadingOverlay.parentNode.removeChild(loadingOverlay);
                                    }

                                    // Create Clean Minimal HUD (No sliders - normal movement)
                                    hudElement = createMinimalHUD(container, {
                                        initialWireframe: showCollision,
                                        onToggleMovement: function (active) {
                                            isMoving = active;
                                        },
                                        onToggleWireframe: function (visible) {
                                            showCollision = visible;
                                            collisionMeshes.forEach(function (m) {
                                                m.visible = showCollision;
                                            });
                                        },
                                        onReset: function () {
                                            elapsedTime = 0;
                                            if (pivotGroup) {
                                                pivotGroup.rotation.set(0, 0, 0);
                                            }
                                            if (rockerL && rockerR) {
                                                rockerL.rotation.z = 0;
                                                rockerR.rotation.z = 0;
                                            }
                                            if (camera && controls) {
                                                const baseY = pivotGroup ? pivotGroup.position.y : 0;
                                                camera.position.set(2.4, 1.2 + baseY, 2.4);
                                                controls.target.set(0, baseY, 0);
                                                controls.update();
                                            }
                                        }
                                    });
                                },
                                function (xhr) {
                                    if (xhr.lengthComputable && xhr.total > 0) {
                                        const percent = Math.round((xhr.loaded / xhr.total) * 100);
                                        if (progressBar) progressBar.style.width = percent + '%';
                                        if (progressText) {
                                            const mbLoaded = (xhr.loaded / (1024 * 1024)).toFixed(1);
                                            const mbTotal = (xhr.total / (1024 * 1024)).toFixed(1);
                                            progressText.innerText = `${mbLoaded} / ${mbTotal} MB (${percent}%)`;
                                        }
                                    } else {
                                        const mb = (xhr.loaded / (1024 * 1024)).toFixed(1);
                                        if (progressText) progressText.innerText = `Loaded: ${mb} MB`;
                                    }
                                },
                                function (error) {
                                    console.error('Error loading orion_VI.glb:', error);
                                    if (loadingOverlay.parentNode) {
                                        loadingOverlay.innerHTML = `
                                            <div style="background: rgba(20,24,32,0.92); padding: 16px 20px; border-radius: 8px; border: 1px solid #ef4444; max-width: 340px;">
                                                <div style="color: #ef4444; font-weight: bold; margin-bottom: 6px;">Model Load Error</div>
                                                <div style="color: #cbd5e1; font-size: 12px; line-height: 1.4;">
                                                    Failed to load <code>${activeModelUrl}</code>.<br>
                                                    Ensure <b>orion_VI.glb</b> is in <code>openmct-tutorial/</code>.
                                                </div>
                                            </div>
                                        `;
                                    }
                                }
                            );

                            // 8. Main Render Loop with Normal Movement
                            function renderLoop() {
                                if (isDestroyed) return;
                                animationFrameId = requestAnimationFrame(renderLoop);

                                const delta = clock ? clock.getDelta() : 0.016;

                                if (mixer) {
                                    mixer.update(delta);
                                }

                                if (isMoving) {
                                    elapsedTime += delta;

                                    // 1. Wheel spin along axle axis (Z) - REVERSED direction
                                    wheelAngle -= delta * 3.5;
                                    wheels.forEach(function (wheel) {
                                        wheel.rotation.z = wheelAngle;
                                    });

                                    // 2. Rocker articulation along its pivot axis (Z)
                                    if (rockerL && rockerR) {
                                        const autoRock = Math.sin(elapsedTime * 1.8) * 0.12; // ±7° suspension movement
                                        rockerL.rotation.z = autoRock;
                                        rockerR.rotation.z = -autoRock;
                                    }

                                    // 3. Dynamic tilt of entire model around static base center:
                                    // Strictly NO rotation left-right (yaw / rotation around vertical Y is 0).
                                    // Full-range continuous compound tilting on X (roll) and Z (pitch) spanning 360° of directions between the two axes.
                                    if (pivotGroup) {
                                        const tiltSpeed = 0.8; // Smooth natural precession rate
                                        const tiltAngle = elapsedTime * tiltSpeed;
                                        const ramp = Math.min(1.0, elapsedTime * 0.8); // Smooth ramp-up from level start/reset

                                        // Full range tilts (±7.5° pitch, ±6.5° roll)
                                        const maxPitch = 0.13;
                                        const maxRoll = 0.11;

                                        // 2-DOF tilt covering the entire range between X and Y axes
                                        const pitch = Math.sin(tiltAngle) * maxPitch * ramp;
                                        const roll = Math.cos(tiltAngle) * maxRoll * ramp;

                                        pivotGroup.rotation.order = 'XYZ';
                                        pivotGroup.rotation.x = roll;   // Longitudinal tilt (bank left/right)
                                        pivotGroup.rotation.y = 0;      // Zero rotation left-right (strictly no yaw/steering)
                                        pivotGroup.rotation.z = pitch;  // Lateral tilt (pitch up/down)
                                    }
                                }

                                if (controls) {
                                    controls.update();
                                }

                                renderer.render(scene, camera);
                            }
                            renderLoop();

                            // 9. Resize Handling
                            function updateSize() {
                                if (isDestroyed || !container || !renderer || !camera) return;
                                const w = container.clientWidth || 300;
                                const h = container.clientHeight || 200;

                                camera.aspect = w / h;
                                camera.updateProjectionMatrix();
                                renderer.setSize(w, h);
                            }

                            if (typeof window.ResizeObserver !== 'undefined') {
                                resizeObserver = new ResizeObserver(updateSize);
                                resizeObserver.observe(container);
                            } else {
                                window.addEventListener('resize', updateSize);
                            }
                        },

                        // 10. Open MCT destroy hook
                        destroy: function () {
                            isDestroyed = true;

                            if (animationFrameId !== null) {
                                cancelAnimationFrame(animationFrameId);
                                animationFrameId = null;
                            }

                            if (resizeObserver) {
                                resizeObserver.disconnect();
                                resizeObserver = null;
                            } else {
                                window.removeEventListener('resize', updateSize);
                            }

                            if (controls) {
                                controls.dispose();
                                controls = null;
                            }

                            if (hudElement && hudElement.parentNode) {
                                hudElement.parentNode.removeChild(hudElement);
                                hudElement = null;
                            }

                            if (mixer) {
                                mixer.stopAllAction();
                                mixer = null;
                            }

                            if (scene) {
                                disposeHierarchy(scene);
                                scene = null;
                            }

                            if (renderer) {
                                renderer.dispose();
                                if (renderer.forceContextLoss) renderer.forceContextLoss();
                                if (renderer.domElement && renderer.domElement.parentNode) {
                                    renderer.domElement.parentNode.removeChild(renderer.domElement);
                                }
                                renderer = null;
                            }

                            pivotGroup = null;
                            camera = null;
                            clock = null;
                            wheels.length = 0;
                            rockerL = null;
                            rockerR = null;
                            collisionMeshes.length = 0;
                        }
                    };
                }
            });
        };
    };

    /**
     * Clean Minimal HUD (No sliders - movement is automatic)
     */
    function createMinimalHUD(container, handlers) {
        const hud = document.createElement('div');
        hud.style.position = 'absolute';
        hud.style.bottom = '12px';
        hud.style.right = '12px';
        hud.style.background = 'rgba(37, 37, 38, 0.9)';
        hud.style.backdropFilter = 'blur(8px)';
        hud.style.border = '1px solid #3e3e42';
        hud.style.borderRadius = '8px';
        hud.style.padding = '6px 10px';
        hud.style.display = 'flex';
        hud.style.alignItems = 'center';
        hud.style.gap = '8px';
        hud.style.zIndex = '5';
        hud.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)';
        hud.style.color = '#e2e8f0';
        hud.style.fontFamily = 'Helvetica, Arial, sans-serif';
        hud.style.fontSize = '11px';

        let wireframeOn = handlers.initialWireframe === true;
        hud.innerHTML = `
            <button id="btn-play-pause" style="background: #10b981; color: #fff; border: 1px solid rgba(255,255,255,0.15); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; transition: all 0.2s;">
                Pause
            </button>
            <button id="btn-wireframe" style="background: ${wireframeOn ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'}; color: ${wireframeOn ? '#cbd5e1' : '#64748b'}; border: 1px solid rgba(255,255,255,0.15); padding: 4px 9px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: all 0.2s;" title="Toggle Collision Wireframe Boxes">
                ${wireframeOn ? 'Wireframe: ON' : 'Wireframe: OFF'}
            </button>
            <button id="btn-reset" style="background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.15); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;" title="Reset Camera and Movement">
                Reset View
            </button>
        `;

        let isRunning = true;
        const btnPlayPause = hud.querySelector('#btn-play-pause');
        btnPlayPause.addEventListener('click', function () {
            isRunning = !isRunning;
            btnPlayPause.innerText = isRunning ? 'Pause' : 'Play';
            btnPlayPause.style.background = isRunning ? '#10b981' : 'rgba(255,255,255,0.08)';
            handlers.onToggleMovement(isRunning);
        });

        const btnWireframe = hud.querySelector('#btn-wireframe');
        btnWireframe.addEventListener('click', function () {
            wireframeOn = !wireframeOn;
            btnWireframe.innerText = wireframeOn ? 'Wireframe: ON' : 'Wireframe: OFF';
            btnWireframe.style.background = wireframeOn ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
            btnWireframe.style.color = wireframeOn ? '#cbd5e1' : '#64748b';
            handlers.onToggleWireframe(wireframeOn);
        });

        const btnReset = hud.querySelector('#btn-reset');
        btnReset.addEventListener('click', function () {
            handlers.onReset();
        });

        container.appendChild(hud);
        return hud;
    }

    function disposeHierarchy(rootObject) {
        if (!rootObject) return;
        rootObject.traverse(function (child) {
            if (child.geometry && typeof child.geometry.dispose === 'function') {
                child.geometry.dispose();
            }
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(function (mat) {
                    if (!mat) return;
                    const textureKeys = [
                        'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap',
                        'emissiveMap', 'envMap', 'lightMap', 'metalnessMap',
                        'normalMap', 'roughnessMap'
                    ];
                    textureKeys.forEach(function (key) {
                        if (mat[key] && typeof mat[key].dispose === 'function') {
                            mat[key].dispose();
                        }
                    });
                    if (typeof mat.dispose === 'function') {
                        mat.dispose();
                    }
                });
            }
        });
    }

    function renderError(container, message) {
        const errorDiv = document.createElement('div');
        errorDiv.style.color = '#ff6b6b';
        errorDiv.style.padding = '20px';
        errorDiv.style.fontFamily = 'monospace';
        errorDiv.innerText = message;
        container.appendChild(errorDiv);
    }
}));
