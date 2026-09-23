// =========================================================================
// G H RAISONI COLLEGE OF ENGINEERING AND MANAGEMENT, WAGHOLI, PUNE
// Interactive Procedural 3D WebGL Campus Module (Three.js)
// Real-world OpenStreetMap GIS footprints & Architectural Simulation
// =========================================================================

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

export function createCampus3D(canvas, options = {}) {
    if (!canvas) return null;

    let animId = null;
    let isRunning = true;
    let userInteracting = false;
    let pointerX = 0, pointerY = 0;
    let targetAzimuth = -0.9;
    let currentAzimuth = -0.9;
    let targetPolar = 0.82;
    let currentPolar = 0.82;
    let zoomRadius = 450;
    let targetRadius = 450;

    // --- Renderer Setup ---
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    // --- Scene & Fog (Professional Bright Daylight) ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1c36); // Deep rich royal navy/academic sky
    scene.fog = new THREE.FogExp2(0x0e1c36, 0.0018);

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 2800);

    // --- Professional Lighting ---
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.9);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
    sunLight.position.set(-180, 280, 140);
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.85);
    fillLight.position.set(160, 120, -140);
    scene.add(fillLight);

    // Grid System: 10m minor, 50m major academic blueprint grid
    const minorGrid = new THREE.GridHelper(1200, 120, 0x1e3a5f, 0x152844);
    minorGrid.position.y = 0.02;
    scene.add(minorGrid);

    const majorGrid = new THREE.GridHelper(1200, 24, 0x3b82f6, 0x1d4ed8);
    majorGrid.position.y = 0.05;
    scene.add(majorGrid);

    // --- Real Geographic OpenStreetMap Coordinates for GHRCEM Wagholi ---
    const DATA = {
        campus: [
            [-28.6, 176.2], [-19.7, 148.4], [6.1, 81.3], [12.3, 66.5], [16.2, 59.3],
            [77.3, -76.5], [87.7, -103.7], [93.1, -120.3], [100.0, -140.7], [101.3, -178.5],
            [52.3, -185.1], [-37.8, -196.6], [-79.5, -75.1], [-117.4, 28.5], [-73.3, 39.6],
            [-80.0, 56.8], [-23.5, 79.2], [-58.0, 164.3]
        ],
        buildings: [
            {
                name: "G H Raisoni College of Engineering & Management",
                levels: 6,
                style: 'main_academic',
                outer: [[-38.0, -88.7], [38.8, -63.7], [21.9, -12.6], [-54.9, -37.6]],
                inner: [[[-27.4, -70.3], [18.9, -55.6], [11.0, -30.8], [-35.4, -45.4], [-28.7, -56.1]]]
            },
            {
                name: "E&TC & Computer Engineering Wing",
                levels: 5,
                style: 'stepped',
                outer: [
                    [-55.6, 162.9], [-55.5, 159.3], [-52.2, 159.8], [-50.7, 148.0], [-48.2, 147.8],
                    [-45.6, 136.3], [-43.5, 137.2], [-41.3, 125.9], [-38.5, 125.4], [-37.2, 115.3],
                    [-32.1, 104.2], [-24.3, 89.0], [-25.6, 87.6], [-20.1, 78.4], [-21.9, 76.2],
                    [-15.0, 67.0], [-17.3, 65.7], [-8.1, 51.0], [4.6, 57.8], [-1.8, 74.7],
                    [0.5, 76.7], [-6.7, 86.6], [-4.4, 87.6], [-10.6, 97.5], [-9.1, 99.2],
                    [-14.7, 108.3], [-16.5, 115.5], [-18.4, 119.0], [-20.7, 129.9], [-23.1, 129.4],
                    [-24.4, 135.0], [-25.6, 141.2], [-27.6, 140.7], [-28.1, 144.0], [-30.3, 152.9],
                    [-33.0, 154.1], [-34.9, 164.3], [-36.9, 163.6], [-38.4, 168.1]
                ],
                inner: []
            },
            {
                name: "Academic Complex B",
                levels: 4,
                style: 'plain',
                outer: [[-82.2, -43.3], [-62.6, -105.3], [-41.9, -98.8], [-61.5, -36.8]],
                inner: []
            },
            {
                name: "G H Raisoni School",
                levels: 5,
                style: 'school',
                outer: [
                    [73.9, -171.0], [95.4, -164.1], [91.1, -143.1], [81.5, -146.7], [72.6, -117.7],
                    [81.7, -115.0], [80.8, -107.9], [76.6, -108.8], [74.9, -102.8], [54.5, -109.4],
                    [57.6, -119.1], [55.3, -120.1], [61.3, -139.8], [66.1, -140.3]
                ],
                inner: []
            },
            {
                name: "Central Workshop & Labs",
                levels: 3,
                style: 'workshop',
                outer: [[-55.5, 22.6], [-13.0, 36.8], [-19.9, 56.9], [-62.4, 42.7]],
                inner: []
            },
            {
                name: "Girls' Hostel",
                levels: 4,
                style: 'hostel',
                outer: [[-101.2, 8.0], [-59.3, 22.1], [-65.2, 39.2], [-107.0, 25.2]],
                inner: []
            },
            {
                name: "G H Raisoni Boys' Hostel",
                levels: 6,
                style: 'hostel',
                outer: [
                    [-47.3, -145.8], [-41.5, -164.3], [-38.0, -163.2], [-35.8, -170.0],
                    [-39.3, -171.1], [-34.2, -187.3], [-17.6, -182.1], [-30.6, -140.6]
                ],
                inner: []
            },
            {
                name: "Ashok Leyland Training Centre",
                levels: 2,
                style: 'workshop',
                outer: [[-83.9, -36.9], [-66.5, -32.1], [-78.3, 5.9], [-95.8, 0.5]],
                inner: []
            },
            {
                name: "Gymnasium & Sports Complex",
                levels: 2,
                style: 'gym',
                outer: [[-35.2, -107.1], [-29.5, -127.7], [-16.2, -124.0], [-21.9, -103.4]],
                inner: []
            }
        ]
    };

    const ROADS = [
        {
            w: 7,
            pts: [
                [107.0, -228.3], [108.3, -204.8], [107.1, -177.8], [103.4, -143.1], [96.1, -109.3],
                [85.7, -86.8], [81.0, -70.0], [79.8, -65.6], [73.4, -38.6], [68.0, -17.4],
                [59.8, 1.0], [45.3, 22.6], [42.9, 25.5], [33.1, 37.0], [20.6, 56.3],
                [15.8, 63.6], [7.2, 91.5], [-3.7, 118.1], [-10.4, 140.7], [-19.5, 167.4],
                [-20.3, 170.1], [-25.0, 186.1]
            ]
        },
        { w: 6, pts: [[63.8, -67.0], [52.5, -56.6], [39.8, -17.9], [37.7, -11.4], [36.3, -7.7], [19.3, 35.9], [13.7, 50.2]] },
        { w: 6, pts: [[36.3, -7.7], [-57.4, -37.1], [-36.8, -102.1]] },
        { w: 6, pts: [[19.3, 35.9], [-105.4, 0.3]] },
        { w: 7, pts: [[42.9, 25.5], [64.1, 35.5], [69.3, 52.5]] }
    ];

    const FLOOR_H = 3.6;
    const P = (x, y, h = 0) => new THREE.Vector3(x, h, y);
    const toV2 = ([x, y]) => new THREE.Vector2(x, -y);
    const centroid = r => r.reduce((a, [x, y]) => [a[0] + x / r.length, a[1] + y / r.length], [0, 0]);

    // --- Texture Generator ---
    function makeFacadeTexture(tileW, draw, floors = 1) {
        const PX = 32, tileH = FLOOR_H * floors;
        const c = document.createElement('canvas');
        c.width = Math.round(tileW * PX);
        c.height = Math.round(tileH * PX);
        const g = c.getContext('2d');
        g.fillStyle = '#f8fafc';
        g.fillRect(0, 0, c.width, c.height);
        draw((x, y, w, h, col) => {
            g.fillStyle = col;
            g.fillRect(x * PX, c.height - (y + h) * PX, w * PX, h * PX);
        });
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1 / tileW, -1 / tileH);
        tex.offset.set(0, 1 / tileH);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    // High quality academic building materials
    const mainWallTex = makeFacadeTexture(2.0, rect => {
        rect(0.2, 0.9, 1.6, 1.9, '#1e293b'); // Dark reflective windows
        rect(0, 0, 2.0, 0.15, '#cbd5e1'); // Floor dividing concrete sill
    });

    const hostelWallTex = makeFacadeTexture(1.5, rect => {
        rect(0, 0.1, 1.5, 0.9, '#0284c7'); // Teal accent spandrel
        rect(0.1, 1.1, 1.3, 1.5, '#0f172a'); // Glass
        rect(0, 2.7, 1.5, 0.9, '#94a3b8'); // Upper trim
    });

    const wallMatMain = new THREE.MeshStandardMaterial({
        map: mainWallTex,
        roughness: 0.65,
        metalness: 0.15,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });

    const wallMatHostel = new THREE.MeshStandardMaterial({
        map: hostelWallTex,
        roughness: 0.7,
        metalness: 0.1
    });

    const roofMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.65 });
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.85 });
    const lawnMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.95 });
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3, metalness: 0.6, emissive: 0x78350f });

    // --- Campus Boundary Line ---
    const boundaryPoints = DATA.campus.map(([x, y]) => P(x, y, 0.2));
    boundaryPoints.push(boundaryPoints[0]);
    const boundaryGeo = new THREE.BufferGeometry().setFromPoints(boundaryPoints);
    const boundaryLine = new THREE.Line(
        boundaryGeo,
        new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 6, gapSize: 3, opacity: 0.85, transparent: true })
    );
    boundaryLine.computeLineDistances();
    scene.add(boundaryLine);

    // --- Build Buildings ---
    const buildingMeshGroup = new THREE.Group();
    DATA.buildings.forEach((b) => {
        const h = b.levels * FLOOR_H;
        const shape = new THREE.Shape(b.outer.map(toV2));
        b.inner.forEach(r => shape.holes.push(new THREE.Path(r.map(toV2))));

        const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);

        const currentMat = b.style === 'hostel' ? [roofMat, wallMatHostel] : [roofMat, wallMatMain];
        const mesh = new THREE.Mesh(geo, currentMat);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 22), edgeMat);

        const bGroup = new THREE.Group();
        bGroup.add(mesh, edges);

        // Architectural fins for Main Academic building
        if (b.style === 'main_academic') {
            const finGeo = new THREE.BoxGeometry(0.8, h, 0.6);
            const finMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
            const [cx, cy] = centroid(b.outer);

            for (let i = 0; i < b.outer.length; i++) {
                const [x1, y1] = b.outer[i];
                const [x2, y2] = b.outer[(i + 1) % b.outer.length];
                const len = Math.hypot(x2 - x1, y2 - y1);
                const steps = Math.floor(len / 4);
                for (let s = 1; s < steps; s++) {
                    const fx = x1 + (x2 - x1) * (s / steps);
                    const fy = y1 + (y2 - y1) * (s / steps);
                    const fin = new THREE.Mesh(finGeo, finMat);
                    fin.position.copy(P(fx, fy, h / 2));
                    fin.rotation.y = Math.atan2(-(y2 - y1), x2 - x1);
                    bGroup.add(fin);
                }
            }

            // Courtyard Lawn
            if (b.inner && b.inner[0]) {
                const courtShape = new THREE.Shape(b.inner[0].map(toV2));
                const courtGeo = new THREE.ShapeGeometry(courtShape);
                courtGeo.rotateX(-Math.PI / 2);
                const courtLawn = new THREE.Mesh(courtGeo, lawnMat);
                courtLawn.position.y = 0.15;
                bGroup.add(courtLawn);
            }
        }

        buildingMeshGroup.add(bGroup);
    });
    scene.add(buildingMeshGroup);

    // --- Grand Parabolic Entrance Arch Gate on Wagholi Road ---
    function makeArch() {
        const archGroup = new THREE.Group();
        const shape = new THREE.Shape();
        shape.moveTo(-11, 0);
        shape.quadraticCurveTo(0, 22, 11, 0);
        shape.lineTo(8.2, 0);
        shape.quadraticCurveTo(0, 18, -8.2, 0);
        shape.closePath();

        const archGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.8, bevelEnabled: false, curveSegments: 36 });
        archGeo.translate(0, 0, -1.4);
        const archMesh = new THREE.Mesh(archGeo, concreteMat);
        const archEdges = new THREE.LineSegments(new THREE.EdgesGeometry(archGeo, 24), edgeMat);

        archGroup.add(archMesh, archEdges);
        archGroup.position.set(73, 0, -38); // Location on the Wagholi entrance road
        archGroup.rotation.y = 0.42;

        // Golden Marquee Banner on Arch
        const signC = document.createElement('canvas');
        signC.width = 1024;
        signC.height = 128;
        const sg = signC.getContext('2d');
        sg.fillStyle = '#4a154b'; // Royal Maroon
        sg.fillRect(0, 0, 1024, 128);
        sg.strokeStyle = '#fbbf24';
        sg.lineWidth = 6;
        sg.strokeRect(6, 6, 1012, 116);
        sg.fillStyle = '#ffffff';
        sg.font = 'bold 36px "Segoe UI", Roboto, sans-serif';
        sg.textAlign = 'center';
        sg.textBaseline = 'middle';
        sg.fillText('G H RAISONI COLLEGE OF ENGINEERING & MANAGEMENT', 512, 48);
        sg.fillStyle = '#fef08a';
        sg.font = 'bold 30px "Segoe UI", Roboto, sans-serif';
        sg.fillText('WAGHOLI, PUNE', 512, 94);

        const signTex = new THREE.CanvasTexture(signC);
        const signPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(16, 2.2),
            new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide })
        );
        signPlane.position.set(0, 8.8, 1.5);
        archGroup.add(signPlane);

        return archGroup;
    }
    scene.add(makeArch());

    // --- Football Turf & Sports Grounds ---
    const turfCoords = [[-29.9, -22.5], [-8.8, -16.1], [-19.8, 19.5], [-40.8, 13.1]];
    const turfShape = new THREE.Shape(turfCoords.map(toV2));
    const turfGeo = new THREE.ShapeGeometry(turfShape);
    turfGeo.rotateX(-Math.PI / 2);
    const turfMesh = new THREE.Mesh(turfGeo, new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.9 }));
    turfMesh.position.y = 0.12;

    const turfFenceLines = [];
    turfCoords.forEach(([x1, y1], i) => {
        const [x2, y2] = turfCoords[(i + 1) % 4];
        turfFenceLines.push(P(x1, y1, 0.2), P(x2, y2, 0.2));
        turfFenceLines.push(P(x1, y1, 5.0), P(x2, y2, 5.0));
        turfFenceLines.push(P(x1, y1, 0.2), P(x1, y1, 5.0));
    });
    const fenceSegments = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(turfFenceLines),
        new THREE.LineBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.75 })
    );
    scene.add(turfMesh, fenceSegments);

    // --- Campus Roads ---
    function makeRoadRibbon(points, width) {
        const pos = [], idx = [];
        points.forEach(([x, z], i) => {
            const [ax, az] = points[Math.max(i - 1, 0)];
            const [bx, bz] = points[Math.min(i + 1, points.length - 1)];
            const l = Math.hypot(bx - ax, bz - az) || 1;
            const nx = -(bz - az) / l * width / 2;
            const nz = (bx - ax) / l * width / 2;
            pos.push(x + nx, 0.08, z + nz, x - nx, 0.08, z - nz);
            if (i > 0) idx.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, roadMat);
    }
    ROADS.forEach(r => scene.add(makeRoadRibbon(r.pts, r.w)));

    // --- Royal Palm Tree Avenues ---
    const palmPositions = [];
    for (let t = 0; t <= 36; t += 6) {
        palmPositions.push([-38 + t * 0.9, -88 + t * 0.35]);
        palmPositions.push([22 - t * 0.7, -12 - t * 0.6]);
    }
    for (let d = 10; d <= 42; d += 8) {
        palmPositions.push([58 - d * 0.6, -18 - d * 0.8]);
    }

    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.35, 9, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
    const crownGeo = new THREE.ConeGeometry(3.5, 2.0, 7);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 });

    const palmGroup = new THREE.Group();
    palmPositions.forEach(([px, py]) => {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(px, 4.5, py);
        const crown = new THREE.Mesh(crownGeo, crownMat);
        crown.position.set(px, 9.2, py);
        palmGroup.add(trunk, crown);
    });
    scene.add(palmGroup);

    // --- Center Reference Coordinates ---
    const campusCenter = new THREE.Vector3(0, 10, -20);

    // --- Resize Handler ---
    function resize() {
        const w = canvas.parentElement ? canvas.parentElement.clientWidth : window.innerWidth;
        const h = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
        if (w === 0 || h === 0) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    // --- Interactive Orbit Controls (Pointer Drag) ---
    let isDragging = false;
    let prevMouseX = 0, prevMouseY = 0;

    function onPointerDown(e) {
        isDragging = true;
        userInteracting = true;
        prevMouseX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
        prevMouseY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    }

    function onPointerMove(e) {
        if (!isDragging) return;
        const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
        const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
        const dx = clientX - prevMouseX;
        const dy = clientY - prevMouseY;
        prevMouseX = clientX;
        prevMouseY = clientY;

        targetAzimuth += dx * 0.005;
        targetPolar = Math.max(0.2, Math.min(1.4, targetPolar - dy * 0.005));
    }

    function onPointerUp() {
        isDragging = false;
        setTimeout(() => { userInteracting = false; }, 3000);
    }

    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    canvas.addEventListener('touchstart', onPointerDown, { passive: true });
    canvas.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp);

    // --- Render Loop (Continuous Majestic Drone Orbit) ---
    let clock = new THREE.Clock();

    function animate() {
        if (!isRunning) return;
        animId = requestAnimationFrame(animate);

        const delta = clock.getDelta();
        const total = clock.getElapsedTime();

        // Slow, majestic continuous drone camera pan
        if (!userInteracting) {
            targetAzimuth += 0.045 * delta;
        }

        // Smooth Lerp damping
        currentAzimuth += (targetAzimuth - currentAzimuth) * 0.08;
        currentPolar += (targetPolar - currentPolar) * 0.08;
        zoomRadius += (targetRadius - zoomRadius) * 0.08;

        const effectiveRadius = camera.aspect < 1 ? zoomRadius * 1.35 : zoomRadius;
        const cx = campusCenter.x + effectiveRadius * Math.sin(currentPolar) * Math.cos(currentAzimuth);
        const cy = campusCenter.y + effectiveRadius * Math.cos(currentPolar) + 30;
        const cz = campusCenter.z + effectiveRadius * Math.sin(currentPolar) * Math.sin(currentAzimuth);

        camera.position.set(cx, cy, cz);
        camera.lookAt(campusCenter.x, 15, campusCenter.z);

        renderer.render(scene, camera);
    }

    animate();

    return {
        pause() { isRunning = false; if (animId) cancelAnimationFrame(animId); },
        resume() { if (!isRunning) { isRunning = true; clock.start(); animate(); } },
        resize,
        destroy() {
            isRunning = false;
            if (animId) cancelAnimationFrame(animId);
            window.removeEventListener('resize', resize);
            renderer.dispose();
        }
    };
}
