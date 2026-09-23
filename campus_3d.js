// =========================================================================
// G H RAISONI COLLEGE OF ENGINEERING AND MANAGEMENT, WAGHOLI, PUNE
// Exact Procedural 3D WebGL Campus Simulation (Three.js)
// Direct 1:1 Port of Architectural Geometries, Materials & Animations
// Real-world OpenStreetMap GIS footprints & Gate Camera Choreography
// =========================================================================

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

export function createCampus3D(canvas, options = {}) {
    if (!canvas) return null;

    let animId = null;
    let isRunning = true;
    let userInteracting = false;
    let flight = null;
    let t = 0.0;
    const END = 6.4;
    const DEG = Math.PI / 180;
    const FLOOR_H = 3.5;

    const clamp01 = v => Math.min(1, Math.max(0, v));
    const phase = (val, a, b) => clamp01((val - a) / (b - a));
    const ease = p => 1 - Math.pow(1 - p, 3);
    const P = (x, y, h = 0) => new THREE.Vector3(x, h, y);
    const toV2 = ([x, y]) => new THREE.Vector2(x, -y);
    const centroid = r => r.reduce((a, [x, y]) => [a[0] + x / r.length, a[1] + y / r.length], [0, 0]);
    const bearingOf = (east, south) => (Math.round(Math.atan2(east, -south) / DEG) + 360) % 360;

    // --- Renderer Setup ---
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // --- Scene & Fog ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0b0b);
    scene.fog = new THREE.Fog(0x0b0b0b, 450, 1100);

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 3000);

    // --- Lighting ---
    scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-160, 260, 120);
    scene.add(sun);

    // Blueprint grid: 10 m minor, 50 m major
    scene.add(new THREE.GridHelper(1400, 140, 0x181818, 0x181818));
    const major = new THREE.GridHelper(1400, 28, 0x262626, 0x262626);
    major.position.y = 0.05;
    scene.add(major);

    // --- Campus Geographic Data (Exact 1:1 from acm-th.vercel.app/intro) ---
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
                levels: 5,
                tagged: true,
                outer: [[-38.0, -88.7], [38.8, -63.7], [21.9, -12.6], [-54.9, -37.6]],
                inner: [[[-27.4, -70.3], [18.9, -55.6], [11.0, -30.8], [-35.4, -45.4], [-28.7, -56.1]]]
            },
            {
                name: "",
                levels: 3,
                tagged: false,
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
                name: "",
                levels: 3,
                tagged: false,
                outer: [[-82.2, -43.3], [-62.6, -105.3], [-41.9, -98.8], [-61.5, -36.8]],
                inner: []
            },
            {
                name: "G H Raisoni School",
                levels: 4,
                tagged: true,
                outer: [
                    [73.9, -171.0], [95.4, -164.1], [91.1, -143.1], [81.5, -146.7], [72.6, -117.7],
                    [81.7, -115.0], [80.8, -107.9], [76.6, -108.8], [74.9, -102.8], [54.5, -109.4],
                    [57.6, -119.1], [55.3, -120.1], [61.3, -139.8], [66.1, -140.3]
                ],
                inner: []
            },
            {
                name: "",
                levels: 3,
                tagged: false,
                outer: [[-55.5, 22.6], [-13.0, 36.8], [-19.9, 56.9], [-62.4, 42.7]],
                inner: []
            },
            {
                name: "",
                levels: 3,
                tagged: false,
                outer: [[-101.2, 8.0], [-59.3, 22.1], [-65.2, 39.2], [-107.0, 25.2]],
                inner: []
            },
            {
                name: "G H Raisoni College Boy's Hostel",
                levels: 4,
                tagged: true,
                outer: [
                    [-47.3, -145.8], [-41.5, -164.3], [-38.0, -163.2], [-35.8, -170.0],
                    [-39.3, -171.1], [-34.2, -187.3], [-17.6, -182.1], [-30.6, -140.6]
                ],
                inner: []
            },
            {
                name: "",
                levels: 1,
                tagged: false,
                outer: [[-83.9, -36.9], [-66.5, -32.1], [-78.3, 5.9], [-95.8, 0.5]],
                inner: []
            },
            {
                name: "",
                levels: 1,
                tagged: false,
                outer: [[-35.2, -107.1], [-29.5, -127.7], [-16.2, -124.0], [-21.9, -103.4]],
                inner: []
            },
            {
                name: "",
                levels: 1,
                tagged: false,
                outer: [[-99.6, -21.4], [-94.3, -39.7], [-86.9, -37.6], [-92.2, -19.4]],
                inner: []
            },
            {
                name: "",
                levels: 1,
                tagged: false,
                outer: [[-63.6, -4.9], [-54.0, -2.3], [-56.2, 5.6], [-65.8, 3.0]],
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
            ],
            main: true
        },
        { w: 7, pts: [[107.1, -177.8], [126.7, -177.5]] },
        { w: 7, pts: [[73.4, -38.6], [95.2, -38.0], [113.0, -36.6], [122.5, -35.8], [146.6, -34.8]] },
        { w: 7, pts: [[-145.9, -91.3], [-129.8, -87.5], [-118.5, -120.3]] },
        { w: 7, pts: [[-158.1, -52.3], [-146.9, -56.5], [-138.9, -63.1], [-135.5, -71.0], [-132.9, -77.4], [-129.8, -87.5]] },
        { w: 5, pts: [[63.8, -67.0], [52.5, -56.6], [39.8, -17.9], [37.7, -11.4], [36.3, -7.7], [19.3, 35.9], [13.7, 50.2], [17.9, 53.9], [20.6, 56.3]] },
        { w: 5, pts: [[85.3, -114.0], [93.8, -146.3], [100.1, -168.3], [99.6, -170.9], [96.6, -173.6], [75.9, -179.0]] },
        { w: 5, pts: [[96.1, -109.3], [93.1, -110.6], [85.3, -114.0], [70.5, -81.7], [63.8, -67.0], [-36.8, -102.1], [-51.5, -107.2]] },
        { w: 7, pts: [[-118.5, -120.3], [-115.6, -122.4], [-112.1, -122.7], [-102.0, -121.3], [-69.1, -111.7]] },
        { w: 7, pts: [[-81.0, 89.8], [-124.7, 72.1], [-130.8, 70.0], [-137.0, 69.7], [-145.9, 71.6], [-169.4, 76.5]] },
        { w: 7, pts: [[69.3, 52.5], [113.6, 54.5], [116.8, 53.8], [118.6, 51.9], [120.9, 50.2], [123.9, 49.1], [127.3, 48.6]] },
        { w: 5, pts: [[13.7, 50.2], [-34.1, 171.6]] },
        { w: 5, pts: [[-102.0, -121.3], [-84.6, -170.3], [-51.7, -158.9]] },
        { w: 5, pts: [[52.5, -56.6], [56.8, -49.2], [57.9, -44.3], [58.6, -40.5], [58.6, -34.5], [56.8, -30.3], [54.3, -27.0], [49.3, -23.2], [39.8, -17.9]] },
        { w: 5, pts: [[36.3, -7.7], [-57.4, -37.1], [-36.8, -102.1]] },
        { w: 5, pts: [[19.3, 35.9], [-105.4, 0.3]] },
        { w: 5, pts: [[-20.3, 170.1], [23.8, 186.9]] },
        { w: 5, pts: [[20.6, 56.3], [48.0, 69.1]] },
        { w: 7, pts: [[42.9, 25.5], [64.1, 35.5]] },
        { w: 7, pts: [[64.1, 35.5], [83.8, 31.8]] },
        { w: 7, pts: [[64.1, 35.5], [69.3, 52.5]] },
        { w: 7, pts: [[113.0, -36.6], [137.6, -80.9]] },
        { w: 5, pts: [[-69.1, -111.7], [-51.7, -158.9], [-43.2, -182.2]] },
        { w: 7, pts: [[-147.9, 78.8], [-149.7, 85.4], [-155.7, 106.8], [-169.7, 131.8]] },
        { w: 7, pts: [[-138.6, 166.5], [-135.2, 160.3], [-135.7, 151.9], [-137.2, 141.7], [-139.3, 135.8], [-143.4, 134.0], [-169.7, 131.8]] },
        { w: 5, pts: [[-164.5, -171.1], [-126.4, -156.3]] },
        { w: 5, pts: [[-162.8, -191.9], [-153.3, -185.6], [-140.6, -181.1], [-124.1, -175.2]] },
        { w: 7, pts: [[-25.0, 186.1], [-38.3, 197.2]] },
        { w: 7, pts: [[-145.9, 71.6], [-147.9, 78.8]] },
        { w: 7, pts: [[-149.7, 85.4], [-141.3, 83.1], [-133.0, 83.1], [-109.0, 91.6], [-105.9, 94.5], [-104.4, 97.8], [-104.5, 100.0], [-128.0, 152.2], [-135.2, 160.3]] },
        { w: 7, pts: [[-76.8, 91.8], [-67.8, 75.3], [-66.2, 72.7], [-63.4, 71.2], [-60.9, 70.9], [-41.3, 78.4], [-39.6, 80.1], [-39.1, 83.0], [-39.0, 85.7], [-39.8, 88.9], [-68.3, 153.9], [-71.0, 156.6], [-74.4, 157.3], [-76.7, 157.3], [-80.1, 156.6], [-96.0, 149.9], [-97.4, 148.4], [-98.0, 145.7], [-97.1, 142.7], [-78.4, 96.1], [-76.8, 91.8], [-77.9, 91.2], [-81.0, 89.8]] }
    ];

    // Building Style Overrides
    DATA.buildings[0].levels = 6;
    DATA.buildings[0].style = 'fins';
    DATA.buildings[0].label = 'main college building';

    const hostel = DATA.buildings.find(b => /Hostel/.test(b.name));
    hostel.levels = 6;
    hostel.style = 'hostel';
    hostel.mapLabel = 'HOSTEL';

    Object.assign(DATA.buildings.find(b => /School/.test(b.name)), { mapLabel: 'SCHOOL', levels: 5, style: 'fins' });

    const byCorner = (x, y) => DATA.buildings.find(b => b.outer[0][0] === x && b.outer[0][1] === y);
    [
        [-35.2, -107.1, { levels: 2, style: 'gym', label: 'gymnasium & swimming pool', mapLabel: 'GYM' }],
        [-55.5, 22.6, { levels: 2, style: 'metal', label: 'shop (grey-roof shed)', clutter: { tanks: 3 } }],
        [-101.2, 8.0, { levels: 4, label: "girls' hostel", mapLabel: 'GIRLS HOSTEL', roofKit: true }],
        [-83.9, -36.9, { levels: 2, style: 'workshop', label: 'Ashok Leyland workshop', mapLabel: 'WORKSHOP', clutter: { tanks: 2, stair: false } }],
        [-63.6, -4.9, { style: 'metal', label: 'small shed (grey roof)' }],
        [-82.2, -43.3, { levels: 5, label: 'white building with sloped roof', clutter: { solar: true } }],
        [-55.6, 162.9, { levels: 5, style: 'colorful', label: 'colorful stepped building' }],
    ].forEach(([x, y, props]) => {
        const found = byCorner(x, y);
        if (found) Object.assign(found, props);
    });

    // Campus boundary (dashed)
    const boundary = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(DATA.campus.map(([x, y]) => P(x, y, 0.1))),
        new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 4, gapSize: 3, transparent: true, opacity: 0 })
    );
    boundary.computeLineDistances();
    scene.add(boundary);

    // Materials
    const WHITE = new THREE.Color(0xf2f2f2), EDGE = new THREE.Color(0x4a4a4a), DETAIL = new THREE.Color(0x9a9a9a);
    const paper = new THREE.MeshStandardMaterial({
        color: 0xece8e1, roughness: .95, transparent: true, opacity: 0,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: WHITE.clone(), transparent: true, opacity: .95 });
    const detailMat = new THREE.LineBasicMaterial({ color: WHITE.clone(), transparent: true, opacity: .4 });

    function facadeTexture(tileW, draw, floors = 1) {
        const PX = 32, c = document.createElement('canvas'), tileH = FLOOR_H * floors;
        c.width = Math.round(tileW * PX);
        c.height = Math.round(tileH * PX);
        const g = c.getContext('2d');
        g.fillStyle = '#ece8e1';
        g.fillRect(0, 0, c.width, c.height);
        draw((x, y, w, h, color) => { g.fillStyle = color; g.fillRect(x * PX, c.height - (y + h) * PX, w * PX, h * PX); });
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1 / tileW, -1 / tileH);
        tex.offset.set(0, 1 / tileH);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    const wallMaterial = map => new THREE.MeshStandardMaterial({
        map, roughness: .95, transparent: true, opacity: 0,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });

    const finWalls = wallMaterial(facadeTexture(1, rect => { rect(0, .9, 1, 1.8, '#2b3038'); rect(0, 0, 1, .12, '#d4cfc6'); }));
    const plainWalls = wallMaterial(facadeTexture(3, rect => { rect(.8, 1, 1.4, 1.5, '#343a42'); rect(0, 0, 3, .12, '#d4cfc6'); }));
    const hostelWalls = wallMaterial(facadeTexture(1, rect => {
        rect(0, .1, 1, .9, '#5cbfb4'); rect(0, 1.1, 1, 1.4, '#2b3038');
        rect(0, 3.6, 1, .9, '#b9c6cf'); rect(0, 4.6, 1, 1.4, '#2b3038');
    }, 2));
    const orangeRoof = wallMaterial(null); orangeRoof.color.set(0xd9622b);
    const roofDark = wallMaterial(null); roofDark.color.set(0x222222);
    const tinted = color => { const m = wallMaterial(null); m.color.set(color); return m; };
    const greyRoof = tinted(0x8f9396), blueRoof = tinted(0x3b7fc4);
    const metalWalls = wallMaterial(facadeTexture(1, rect => { rect(0, 0, 1, FLOOR_H, '#e3d7a1'); rect(0, 2.9, 1, .15, '#c2b67f'); }));
    const blueWalls = wallMaterial(facadeTexture(1, rect => { rect(0, 2.5, 1, .6, '#3b7fc4'); }));
    const workshopWalls = wallMaterial(facadeTexture(6, rect => {
        rect(0, 0, 6, 2 * FLOOR_H, '#dfe6ee'); rect(0, 5.6, 6, 1.4, '#3b7fc4');
        rect(1.5, 0, 3, 4.2, '#3a3f45');
        for (let y = .3; y < 4.2; y += .3) rect(1.5, y, 3, .05, '#50565d');
    }, 2));
    const creamRoof = tinted(0xd8d1bf);
    const gymWalls = wallMaterial(facadeTexture(4, rect => { rect(0, 0, 4, FLOOR_H, '#e2dccb'); rect(1.2, .9, 1.6, 1.5, '#3a3f45'); rect(0, 2.9, 4, .6, '#d3ccb8'); }));

    const wallMats = [paper, finWalls, plainWalls, hostelWalls, orangeRoof, roofDark, greyRoof, blueRoof, metalWalls, blueWalls, creamRoof, gymWalls];

    const galleryTex = facadeTexture(1, rect => { rect(0, 1.1, 1, 2.1, '#5d5850'); rect(0, 1.1, 1, .12, '#d4cfc6'); });
    galleryTex.repeat.set(1, 1 / FLOOR_H); galleryTex.offset.set(0, 0);
    const galleryMat = wallMaterial(galleryTex); galleryMat.side = THREE.DoubleSide;
    const pavingMat = tinted(0x8c8577); pavingMat.side = THREE.DoubleSide;
    wallMats.push(galleryMat, pavingMat);

    const grilleTex = facadeTexture(3.5, rect => {
        rect(.95, 1, 1.6, 1.6, '#b3ad9f');
        for (let i = 0; i <= 4; i++) { rect(.95 + i * .38, 1, .06, 1.6, '#6f695e'); rect(.95, 1 + i * .38, 1.6, .06, '#6f695e'); }
    });
    grilleTex.repeat.set(1 / 3.5, 1 / FLOOR_H); grilleTex.offset.set(0, 0);
    const grilleMat = wallMaterial(grilleTex);
    wallMats.push(grilleMat, workshopWalls);

    const louverTex = facadeTexture(4, rect => {
        rect(.4, .5, 3.2, 2.5, '#7a5a3c');
        for (let y = .6; y < 3; y += .22) rect(.4, y, 3.2, .06, '#5a4230');
    });
    louverTex.repeat.set(1 / 4, 1 / FLOOR_H); louverTex.offset.set(0, 0);
    const louverMat = wallMaterial(louverTex);
    wallMats.push(louverMat);

    const PANEL_COLORS = ['#5aa9a3', '#9fc9c0', '#6f9fc8', '#a9a3cf'];
    const panelWalls = wallMaterial(facadeTexture(7, rect => {
        PANEL_COLORS.forEach((color, f) => { rect(.6, f * FLOOR_H + .5, 1.8, 2.6, color); rect(3, f * FLOOR_H + .5, 3.4, 2.6, '#dcd8cf'); });
    }, 4));

    const jogMats = ['#14a39a', '#d9d72b', '#22b8d6', '#5b8fd6', '#9d8fd0'].map(color => {
        const m = tinted(color); m.side = THREE.DoubleSide;
        m.emissive.set(color).multiplyScalar(.35);
        return m;
    });

    const brightCorridorTex = facadeTexture(1, rect => {
        rect(0, 1.1, 1, 2.1, '#c7c0ae'); rect(0, 2.6, 1, .6, '#9f9888'); rect(0, 1.1, 1, .12, '#f4f1ea');
    });
    brightCorridorTex.repeat.set(1, 1 / FLOOR_H); brightCorridorTex.offset.set(0, 0);
    const brightCorridorMat = wallMaterial(brightCorridorTex); brightCorridorMat.side = THREE.DoubleSide;
    const signBlue = tinted(0x3f6fa8);
    wallMats.push(panelWalls, ...jogMats, brightCorridorMat, signBlue);

    const STYLES = {
        fins: { walls: finWalls, fins: { bay: 1.8, w: .9, d: .6 } },
        hostel: { walls: hostelWalls, fins: { bay: 3.2, w: 1.1, d: .5 } },
        gym: { walls: gymWalls, roof: creamRoof },
        metal: { walls: metalWalls, roof: greyRoof },
        blue: { walls: blueWalls, roof: blueRoof },
        workshop: { walls: workshopWalls, roof: blueRoof },
        colorful: { walls: panelWalls },
        plain: { walls: plainWalls },
    };

    const inPolygon = ([x, y], poly) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [xi, yi] = poly[i], [xj, yj] = poly[j];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    };

    const ringEdges = r => r.map((p, i) => [p, r[(i + 1) % r.length]]);
    const edgeLength = ([[x1, y1], [x2, y2]]) => Math.hypot(x2 - x1, y2 - y1);

    function wallFrame(b, [[x1, y1], [x2, y2]]) {
        const len = Math.hypot(x2 - x1, y2 - y1), ex = (x2 - x1) / len, ey = (y2 - y1) / len;
        let nx = -ey, ny = ex;
        const probe = [(x1 + x2) / 2 + nx * .5, (y1 + y2) / 2 + ny * .5];
        if (inPolygon(probe, b.outer) && !b.inner.some(hole => inPolygon(probe, hole))) { nx = -nx; ny = -ny; }
        return { len, ex, ey, nx, ny };
    }

    function finsFor(b, h, { bay: BAY, w: FIN_W, d: FIN_D }, edges) {
        const spots = [];
        for (const edge of edges) {
            const [[x1, y1]] = edge, { len, ex, ey, nx, ny } = wallFrame(b, edge);
            for (let j = 1; j < Math.floor(len / BAY); j++) {
                spots.push([x1 + ex * j * BAY + nx * FIN_D / 2, y1 + ey * j * BAY + ny * FIN_D / 2, Math.atan2(-ey, ex)]);
            }
        }
        const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(FIN_W, h, FIN_D), paper, spots.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
        spots.forEach(([x, y, angle], i) => fins.setMatrixAt(i, m.compose(P(x, y, h / 2), q.setFromAxisAngle(up, angle), one)));
        return fins;
    }

    const footprint = [];
    const buildings = [];
    const main = DATA.buildings[0];
    const [mx, my] = centroid(main.outer);

    function roofKit(b, h, tall = true) {
        const [cx, cy] = centroid(b.outer);
        const kit = new THREE.Group();
        for (const dx of [-2.2, 0, 2.2]) {
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, 1.4, 16), roofDark);
            tank.position.copy(P(cx + dx, cy + 4, h + .7));
            kit.add(tank);
        }
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x214a72, roughness: .5, metalness: .1 });
        for (let row = 0; row < 2; row++)
            for (let col = 0; col < 3; col++) {
                const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, .16, 1.7), panelMat);
                panel.position.copy(P(cx - 3.4 + col * 3.1, cy - 4.5 - row * 2.3, h + .95));
                panel.rotation.x = -.5;
                kit.add(panel);
            }
        if (!tall) return kit;
        const frame = [], corners = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
        corners.forEach(([ax, ay], i) => {
            const [bx, by] = corners[(i + 1) % 4];
            frame.push(P(cx + ax, cy + ay, h), P(cx + ax, cy + ay, h + 7));
            for (const z of [2.5, 5, 7]) frame.push(P(cx + ax, cy + ay, h + z), P(cx + bx, cy + by, h + z));
            frame.push(P(cx + ax, cy + ay, h), P(cx + bx, cy + by, h + 2.5));
        });
        kit.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(frame), new THREE.LineBasicMaterial({ color: 0x333333 })));
        return kit;
    }

    function roofAnchor(b) {
        const c = centroid(b.outer);
        const ok = p => inPolygon(p, b.outer) && !(b.inner || []).some(r => inPolygon(p, r));
        if (ok(c)) return c;
        for (let r = 5; r <= 45; r += 5)
            for (let a = 0; a < 8; a++) {
                const p = [c[0] + r * Math.cos(a * Math.PI / 4), c[1] + r * Math.sin(a * Math.PI / 4)];
                if (ok(p)) return p;
            }
        return c;
    }

    function roofClutter(b, h, { at, solar = false, tanks = 2, stair = true } = {}) {
        const [cx, cy] = at || roofAnchor(b);
        const g = new THREE.Group();
        for (let i = 0; i < tanks; i++) {
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(.85, .7, 1.5, 14), roofDark);
            tank.position.copy(P(cx + (i - (tanks - 1) / 2) * 2.1, cy + 2.4, h + .75));
            g.add(tank);
        }
        if (stair) {
            const box = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3.4), creamRoof);
            box.position.copy(P(cx + 3, cy - 2.5, h + 1.3));
            const be = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry, 20), edgeMat);
            be.position.copy(box.position);
            g.add(box, be);
        }
        if (solar) {
            const pm = new THREE.MeshStandardMaterial({ color: 0x214a72, roughness: .5, metalness: .1 });
            for (let row = 0; row < 2; row++)
                for (let col = 0; col < 4; col++) {
                    const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, .16, 1.6), pm);
                    p.position.copy(P(cx - 4 + col * 2.6, cy - 6 - row * 2.3, h + .95));
                    p.rotation.x = -.5;
                    g.add(p);
                }
        }
        return g;
    }

    function stairTower(b) {
        const [x1, y1] = b.outer[2], [x2, y2] = b.outer[3];
        const len = Math.hypot(x2 - x1, y2 - y1), e = [(x2 - x1) / len, (y2 - y1) / len];
        const [cx, cy] = centroid(b.outer);
        let n = [-e[1], e[0]];
        if ((x1 - cx) * n[0] + (y1 - cy) * n[1] < 0) n = [-n[0], -n[1]];
        const tower = new THREE.Mesh(new THREE.BoxGeometry(5, 11, 5), creamRoof);
        tower.position.copy(P(x1 + e[0] * 2.5 + n[0], y1 + e[1] * 2.5 + n[1], 5.5));
        tower.rotation.y = Math.atan2(-e[1], e[0]);
        return tower;
    }

    function wallPlane(b, edge, h, mat) {
        const [[x1, y1], [x2, y2]] = edge, { len, ex, ey, nx, ny } = wallFrame(b, edge);
        const geo = new THREE.PlaneGeometry(len, h);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * h);
        const plane = new THREE.Mesh(geo, mat);
        plane.position.copy(P((x1 + x2) / 2 + nx * .05, (y1 + y2) / 2 + ny * .05, h / 2));
        plane.rotation.y = Math.atan2(-ey, ex);
        return plane;
    }

    function corridorWalls(b, h, edges) {
        const walls = new THREE.Group();
        for (const edge of edges) walls.add(wallPlane(b, edge, h, galleryMat));
        return walls;
    }

    function southFaceExtras(b, h) {
        const edge = [b.outer[2], b.outer[3]], [[x1, y1]] = edge, { len, ex, ey, nx, ny } = wallFrame(b, edge);
        const angle = Math.atan2(-ey, ex), extras = new THREE.Group();
        const at = (tVal, out) => [x1 + ex * len * tVal + nx * out, y1 + ey * len * tVal + ny * out];

        const column = new THREE.Mesh(new THREE.BoxGeometry(3.5, h + 1.2, 1.2), paper);
        column.position.copy(P(...at(.46, .6), (h + 1.2) / 2));
        const geo = new THREE.PlaneGeometry(3.5, h);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3.5, uv.getY(i) * h);
        const grilles = new THREE.Mesh(geo, grilleMat);
        grilles.position.copy(P(...at(.46, 1.22), h / 2));

        const roomOnRoof = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 4), paper);
        roomOnRoof.position.copy(P(...at(.62, -4), h + 1.5));

        for (const m of [column, grilles, roomOnRoof]) m.rotation.y = angle;
        extras.add(column, grilles, roomOnRoof);
        return extras;
    }

    const endWallCache = new Map();
    function endWallMaterial(len, h, levels) {
        const key = `${len.toFixed(1)}|${levels}`;
        if (endWallCache.has(key)) return endWallCache.get(key);
        const PX = 24, c = document.createElement('canvas');
        c.width = Math.round(len * PX); c.height = Math.round(h * PX);
        const g = c.getContext('2d');
        const rect = (x, y, w, hh, color) => { g.fillStyle = color; g.fillRect(x * PX, c.height - (y + hh) * PX, w * PX, hh * PX); };
        rect(0, 0, len, h, '#ece8e1'); rect(0, 0, 2, h, '#2fa9a0'); rect(.5, h * .3, 1, h * .6, '#3f6fa8');
        const colors = ['#2fa9a0', '#b8c94a', '#2fa9a0', '#9d8fd0', '#dcd8cf'];
        for (let f = 0; f < levels; f++) {
            const y = f * FLOOR_H;
            rect(2.6, y + .4, 1.8, 2.7, colors[f % colors.length]);
            rect(5, y + .4, 4.2, 2.7, '#d6d1c6');
            rect(len - 3.4, y + 1.4, .8, .8, '#2b3038');
            rect(len - 1.6, y + 1.4, .8, .8, '#2b3038');
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.repeat.set(-1 / len, 1 / h); tex.offset.set(1, 0);
        const mat = wallMaterial(tex); mat.side = THREE.DoubleSide;
        wallMats.push(mat); endWallCache.set(key, mat);
        return mat;
    }

    function steppedExtras(b, h) {
        const extras = new THREE.Group();
        let k = 0;
        for (const edge of ringEdges(b.outer)) {
            const [[x1, y1], [x2, y2]] = edge, { len, ex, ey, nx, ny } = wallFrame(b, edge);
            if (x1 === -8.1 && y1 === 51) {
                const sign = new THREE.Mesh(new THREE.BoxGeometry(11, 1.1, .2), signBlue);
                sign.position.copy(P((x1 + x2) / 2 + nx * .15, (y1 + y2) / 2 + ny * .15, h - 1.8));
                sign.rotation.y = Math.atan2(-ey, ex);
                extras.add(sign, wallPlane(b, edge, h, endWallMaterial(len, h, b.levels)));
                const mx0 = (x1 + x2) / 2 - nx * 6, my0 = (y1 + y2) / 2 - ny * 6, mast = [];
                const legs = [[-.8, -.8], [.8, -.8], [.8, .8], [-.8, .8]];
                legs.forEach(([ox, oy], i) => {
                    const [px, py] = legs[(i + 1) % 4];
                    mast.push(P(mx0 + ox, my0 + oy, h), P(mx0 + ox * .25, my0 + oy * .25, h + 12));
                    for (const z of [3, 6, 9]) {
                        const s1 = 1 - z / 16;
                        mast.push(P(mx0 + ox * s1, my0 + oy * s1, h + z), P(mx0 + px * s1, my0 + py * s1, h + z));
                    }
                });
                extras.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(mast), new THREE.LineBasicMaterial({ color: 0x555555 })));
                k = 0;
            } else if (len < 4.5) {
                extras.add(wallPlane(b, edge, h, jogMats[k++ % jogMats.length]));
            } else {
                extras.add(wallPlane(b, edge, h, brightCorridorMat));
            }
        }
        return extras;
    }

    function workshopSign(b, h) {
        const edge = ringEdges(b.outer).find(([[x, y]]) => x === -66.5 && y === -32.1);
        const [[x1, y1], [x2, y2]] = edge, { ex, ey, nx, ny } = wallFrame(b, edge);
        const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = '#1f4f96'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#ffffff'; g.font = 'bold 56px Oswald, Arial, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('ASHOK LEYLAND · SERVICE TRAINING', c.width / 2, c.height / 2 + 4);
        const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
        const mat = wallMaterial(tex); mat.side = THREE.DoubleSide; wallMats.push(mat);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), mat);
        sign.position.copy(P((x1 + x2) / 2 + nx * .12, (y1 + y2) / 2 + ny * .12, h - .9));
        sign.rotation.y = Math.atan2(-ey, ex) + (nx * -ey + ny * ex < 0 ? Math.PI : 0);
        return sign;
    }

    function textSign(text, { fg = '#2f5aa8', bg = '#ffffff', size = 82 } = {}) {
        const c = document.createElement('canvas'); c.width = 1024; c.height = 132;
        const g = c.getContext('2d');
        g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = fg; g.font = `bold ${size}px Oswald, Arial, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        let s = size;
        while (g.measureText(text).width > c.width - 40 && s > 26) { s -= 4; g.font = `bold ${s}px Oswald, Arial, sans-serif`; }
        g.fillText(text, c.width / 2, c.height / 2 + 4);
        const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
        const mat = wallMaterial(tex); mat.side = THREE.DoubleSide; wallMats.push(mat);
        return mat;
    }

    function entranceSign(b, edge, text, { fg = '#2f5aa8', canopyMat = greyRoof, signW = 11, signH = 1.4, top = 4.6, proj = 2.4 } = {}) {
        const [[x1, y1], [x2, y2]] = edge, { ex, ey, nx, ny } = wallFrame(b, edge);
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, W = signW + 1.4;
        const yaw = Math.atan2(-ey, ex);
        const faceYaw = yaw + (nx * -ey + ny * ex < 0 ? Math.PI : 0);
        const g = new THREE.Group();
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(W, .55, proj), canopyMat);
        canopy.position.copy(P(cx + nx * proj / 2, cy + ny * proj / 2, top));
        canopy.rotation.y = yaw;
        g.add(canopy);
        for (const s of [-(W / 2) + .35, W / 2 - .35]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(.5, top, .5), canopyMat);
            leg.position.copy(P(cx + ex * s + nx * (proj - .35), cy + ey * s + ny * (proj - .35), top / 2));
            leg.rotation.y = yaw;
            g.add(leg);
        }
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), textSign(text, { fg }));
        sign.position.copy(P(cx + nx * (proj + .06), cy + ny * (proj + .06), top - signH / 2 - .18));
        sign.rotation.y = faceYaw;
        g.add(sign);
        return g;
    }

    function entrancePorch(b, edge, { width = 5, up = 3.2 } = {}) {
        const [[x1, y1], [x2, y2]] = edge, { ex, ey, nx, ny } = wallFrame(b, edge);
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, yaw = Math.atan2(-ey, ex);
        const faceYaw = yaw + (nx * -ey + ny * ex < 0 ? Math.PI : 0);
        const at = (s, d, h) => P(cx + ex * s + nx * d, cy + ey * s + ny * d, h);
        const g = new THREE.Group();
        const dark = new THREE.MeshStandardMaterial({ color: 0x11151d, roughness: .92, side: THREE.DoubleSide });
        const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: .8 });
        const back = new THREE.Mesh(new THREE.PlaneGeometry(width, up), dark);
        back.position.copy(at(0, .05, up / 2 + .35)); back.rotation.y = faceYaw; g.add(back);
        for (const s of [-width / 2, width / 2]) {
            const ret = new THREE.Mesh(new THREE.BoxGeometry(.14, up, 1.1), grey);
            ret.position.copy(at(s, .6, up / 2 + .35)); ret.rotation.y = yaw; g.add(ret);
        }
        const soffit = new THREE.Mesh(new THREE.BoxGeometry(width + .3, .2, 1.1), grey);
        soffit.position.copy(at(0, .6, up + .35)); soffit.rotation.y = yaw; g.add(soffit);
        const doors = new THREE.Mesh(new THREE.PlaneGeometry(2.4, up - .7), new THREE.MeshStandardMaterial({ color: 0x35586f, roughness: .3, metalness: .2, transparent: true, opacity: .85, side: THREE.DoubleSide }));
        doors.position.copy(at(0, .1, (up - .7) / 2 + .4)); doors.rotation.y = faceYaw; g.add(doors);
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.1, up + 1, 1.1), new THREE.MeshStandardMaterial({ color: 0x4a6f8f, roughness: .3, metalness: .2, transparent: true, opacity: .5 }));
        shaft.position.copy(at(width / 2 - .9, .5, (up + 1) / 2 + .35)); shaft.rotation.y = yaw; g.add(shaft);
        for (let i = 0; i < 5; i++) {
            const st = new THREE.Mesh(new THREE.BoxGeometry(1.2, .16, .45), grey);
            st.position.copy(at(-width / 2 + .9, .35 + i * .16, .55 + i * .42)); st.rotation.y = yaw; g.add(st);
        }
        const step = new THREE.Mesh(new THREE.BoxGeometry(width + 1.4, .3, .9), grey);
        step.position.copy(at(0, .85, .15)); step.rotation.y = yaw; g.add(step);
        return g;
    }

    function schoolLouvers(b, h) {
        const louvers = new THREE.Group();
        const edge = ringEdges(b.outer).find(([[x, y]]) => x === 74.9 && y === -102.8);
        if (!edge) return louvers;
        const [[x1, y1]] = edge, { ex, ey, nx, ny } = wallFrame(b, edge);
        const at = (tVal, out) => [x1 + ex * tVal + nx * out, y1 + ey * tVal + ny * out];
        const block = new THREE.Mesh(new THREE.BoxGeometry(5, h + 2, 1.5), paper);
        block.position.copy(P(...at(3.5, .75), (h + 2) / 2));
        const geo = new THREE.PlaneGeometry(4, h);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * h);
        const face = new THREE.Mesh(geo, louverMat);
        face.position.copy(P(...at(3.5, 1.52), h / 2));
        block.rotation.y = face.rotation.y = Math.atan2(-ey, ex);
        louvers.add(block, face);
        return louvers;
    }

    function courtyardFloor(b) {
        const floor = new THREE.Group();
        for (const ring of b.inner) {
            const geo = new THREE.ShapeGeometry(new THREE.Shape(ring.map(toV2)));
            geo.rotateX(-Math.PI / 2);
            const mesh = new THREE.Mesh(geo, pavingMat);
            mesh.position.y = .08;
            floor.add(mesh);
        }
        return floor;
    }

    function buildingGroup(b) {
        const h = b.levels * FLOOR_H;
        const shape = new THREE.Shape(b.outer.map(toV2));
        b.inner.forEach(r => shape.holes.push(new THREE.Path(r.map(toV2))));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);

        const style = STYLES[b.style || 'plain'];
        const group = new THREE.Group();
        group.add(new THREE.Mesh(geo, [style.roof || paper, style.walls]));
        group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeMat));
        const outerEdges = ringEdges(b.outer), innerEdges = b.inner.flatMap(ringEdges);
        if (b === DATA.buildings[0]) {
            const corridors = innerEdges.filter(e => edgeLength(e) > 30);
            group.add(finsFor(b, h, style.fins, [...outerEdges, ...innerEdges.filter(e => edgeLength(e) <= 30)]));
            group.add(finsFor(b, h, { bay: 6.5, w: .5, d: .35 }, corridors));
            group.add(corridorWalls(b, h, corridors), courtyardFloor(b), southFaceExtras(b, h));
        } else if (style.fins) {
            group.add(finsFor(b, h, style.fins, [...outerEdges, ...innerEdges]));
        }
        if (b.style === 'hostel') group.add(roofKit(b, h));
        else if (b.roofKit) group.add(roofKit(b, h, false));
        if (b.style === 'gym') group.add(stairTower(b));
        if (b.style === 'colorful') group.add(steppedExtras(b, h));
        if (/School/.test(b.name)) { group.add(schoolLouvers(b, h)); group.add(roofClutter(b, h, { at: [85, -156], tanks: 3 })); }
        if (b.style === 'workshop') group.add(workshopSign(b, h));
        if (b.clutter) group.add(roofClutter(b, h, b.clutter));
        if (b === DATA.buildings[0]) {
            const [cx, cy] = centroid(b.outer);
            for (const [[x1, y1], [x2, y2], tVal] of [[b.outer[2], b.outer[1], .31], [b.outer[2], b.outer[1], .86], [b.outer[1], b.outer[0], .15]]) {
                let x = x1 + (x2 - x1) * tVal, y = y1 + (y2 - y1) * tVal;
                const d = Math.hypot(cx - x, cy - y);
                x += (cx - x) / d * 3.5; y += (cy - y) / d * 3.5;
                const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 6), paper);
                tower.position.copy(P(x, y, h + 2.25));
                tower.rotation.y = Math.atan2(-(y2 - y1), x2 - x1);
                group.add(tower);
            }
            group.add(roofClutter(b, h, { at: [26, -40], tanks: 3, stair: false }));
        }

        const seg = [];
        for (const r of [b.outer, ...b.inner]) {
            r.forEach(([x1, y1], i) => {
                const [x2, y2] = r[(i + 1) % r.length];
                for (let k = 1; k < b.levels; k++) seg.push(P(x1, y1, k * FLOOR_H), P(x2, y2, k * FLOOR_H));
                const n = Math.floor(Math.hypot(x2 - x1, y2 - y1) / 3);
                for (let j = 1; j < n; j++) {
                    const x = x1 + (x2 - x1) * j / n, y = y1 + (y2 - y1) * j / n;
                    seg.push(P(x, y, 0), P(x, y, h));
                }
            });
        }
        group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), detailMat));
        return group;
    }

    for (const b of DATA.buildings) {
        for (const r of [b.outer, ...b.inner]) {
            r.forEach(([x1, y1], i) => {
                const [x2, y2] = r[(i + 1) % r.length];
                footprint.push(P(x1, y1, .2), P(x2, y2, .2));
            });
        }
        const group = buildingGroup(b);
        const [cx, cy] = centroid(b.outer);
        group.visible = false;
        scene.add(group);
        buildings.push({ group, delay: Math.min(.7, Math.hypot(cx - mx, cy - my) / 300) });
    }

    const foot = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(footprint),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8 })
    );
    scene.add(foot);

    // --- Arch Gate ---
    const [ax1, ay1] = main.outer[1], [ax2, ay2] = main.outer[2];
    const faceLen = Math.hypot(ax2 - ax1, ay2 - ay1);
    const faceDir = [(ax2 - ax1) / faceLen, (ay2 - ay1) / faceLen];
    const faceMid = [(ax1 + ax2) / 2, (ay1 + ay2) / 2];
    let faceOut = [faceDir[1], -faceDir[0]];
    if ((faceMid[0] - mx) * faceOut[0] + (faceMid[1] - my) * faceOut[1] < 0) faceOut = faceOut.map(v => -v);

    const ENTRY = [ax2 + (ax1 - ax2) * 16 / faceLen, ay2 + (ay1 - ay2) * 16 / faceLen];
    const alongFace = d => [ENTRY[0] + faceOut[0] * d, ENTRY[1] + faceOut[1] * d];
    const GATE = alongFace(40);

    function archShape(W, H, w, h) {
        const s = new THREE.Shape();
        s.moveTo(-W, 0);
        s.quadraticCurveTo(0, 2 * H, W, 0);
        s.lineTo(w, 0);
        s.quadraticCurveTo(0, 2 * h, -w, 0);
        s.closePath();
        return s;
    }
    const extrude = (shape, depth) =>
        new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 40 }).translate(0, 0, -depth / 2);
    const archGeo = extrude(archShape(10.5, 9.8, 7.6, 8.2), 2.6);
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xaf221c, roughness: .9, transparent: true, opacity: 0 });

    const arch = new THREE.Group();
    arch.add(new THREE.Mesh(archGeo, paper), new THREE.LineSegments(new THREE.EdgesGeometry(archGeo, 24), edgeMat));
    arch.position.copy(P(GATE[0], GATE[1]));
    arch.rotation.y = Math.atan2(-faceDir[1], faceDir[0]);
    arch.visible = false;
    scene.add(arch);
    buildings.push({ group: arch, delay: .7 });

    // Entrance porch
    function slab(w, h, d, x, y, z, mat = paper) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y + h / 2, z);
        return m;
    }
    const porch = new THREE.Group();
    porch.add(
        slab(10, 1, 6.5, 0, 0, 3.25),
        ...[.8, .6, .4, .2].map((h, i) => slab(12, h, .7, 0, 0, 6.85 + i * .7)),
        slab(11, .9, 7, 0, 5, 3.5),
        slab(11.02, .6, .1, 0, 5.15, 7.02, bandMat),
    );
    for (const x of [-4.5, 4.5]) {
        const column = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 5, 16), paper);
        column.position.set(x, 2.5, 6.2);
        porch.add(column);
    }
    porch.position.copy(P(...ENTRY));
    porch.rotation.y = Math.atan2(faceOut[0], faceOut[1]);
    porch.visible = false;
    scene.add(porch);
    buildings.push({ group: porch, delay: .6 });

    // Named entrances
    {
        const hostelEast = ringEdges(hostel.outer).find(([[x, y]]) => x === -17.6 && y === -182.1);
        if (hostelEast) {
            const s = entranceSign(hostel, hostelEast, 'G H RAISONI BOYS HOSTEL', { signW: 12, top: 4.8 });
            s.visible = false; scene.add(s); buildings.push({ group: s, delay: .66 });
            const p = entrancePorch(hostel, hostelEast);
            p.visible = false; scene.add(p); buildings.push({ group: p, delay: .66 });
        }
        const college = byCorner(-55.6, 162.9);
        if (college) {
            const stand = [-5, 112];
            let best = null, bestD = Infinity;
            for (const edge of ringEdges(college.outer)) {
                const [[x1, y1], [x2, y2]] = edge, cmx = (x1 + x2) / 2, cmy = (y1 + y2) / 2;
                const { nx, ny, len } = wallFrame(college, edge);
                const tx = stand[0] - cmx, ty = stand[1] - cmy, d = Math.hypot(tx, ty);
                if (len < 7 || d < 5 || (tx * nx + ty * ny) / d < .35) continue;
                if (d < bestD) { bestD = d; best = edge; }
            }
            if (best) {
                const s = entranceSign(college, best, 'G H RAISONI COLLEGE OF ENGINEERING & MANAGEMENT', { signW: 11, signH: 1.6, top: 5.2, proj: 2.6 });
                s.visible = false; scene.add(s); buildings.push({ group: s, delay: .68 });
                const p = entrancePorch(college, best, { width: 5.5, up: 3.6 });
                p.visible = false; scene.add(p); buildings.push({ group: p, delay: .68 });
            }
        }
    }

    // College name on main building
    {
        const [fx, fy] = faceDir, [ox, oy] = faceOut;
        const back = new THREE.Mesh(new THREE.BoxGeometry(16.4, 2.4, .3), paper);
        back.position.copy(P(ENTRY[0] + ox * .75, ENTRY[1] + oy * .75, 7.7));
        back.rotation.y = Math.atan2(-fy, fx);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.06), textSign('G H RAISONI COLLEGE OF ENGINEERING & MANAGEMENT', { fg: '#2f5aa8' }));
        sign.position.copy(P(ENTRY[0] + ox * .95, ENTRY[1] + oy * .95, 7.7));
        sign.rotation.y = Math.atan2(-fy, fx) + (ox * -fy + oy * fx < 0 ? Math.PI : 0);
        const nameplate = new THREE.Group();
        nameplate.add(back, sign);
        nameplate.visible = false;
        scene.add(nameplate);
        buildings.push({ group: nameplate, delay: .62 });
    }

    // Palm trees
    const palmSpots = [];
    let southPalms = 0;
    {
        const [x1, y1] = main.outer[2], [x2, y2] = main.outer[3];
        const len = Math.hypot(x2 - x1, y2 - y1), u = [(x2 - x1) / len, (y2 - y1) / len];
        let n = [-u[1], u[0]];
        if (((x1 + x2) / 2 - mx) * n[0] + ((y1 + y2) / 2 - my) * n[1] < 0) n = [-n[0], -n[1]];
        for (let tVal = 4; tVal <= 34; tVal += 6) palmSpots.push([x1 + u[0] * tVal + n[0] * 4, y1 + u[1] * tVal + n[1] * 4]);
        southPalms = palmSpots.length;
        for (const d of [11, 18, 25]) for (const side of [-7, 7]) {
            palmSpots.push([ENTRY[0] + faceOut[0] * d + faceOut[1] * side, ENTRY[1] + faceOut[1] * d - faceOut[0] * side]);
        }
    }
    const PALM_H = 9;
    const trunkMat = tinted(0x8a7560), leafMat = tinted(0x3f7a3f);
    leafMat.side = THREE.DoubleSide;
    wallMats.push(trunkMat, leafMat);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.18, .28, 1, 6), trunkMat, palmSpots.length);
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 1.4, 7, 1, true), leafMat, palmSpots.length);
    {
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
        palmSpots.forEach(([x, y], i) => {
            const h = PALM_H * (.85 + .3 * ((i * 37 % 10) / 10)) * (i >= southPalms ? 1.45 : 1);
            trunks.setMatrixAt(i, m.compose(P(x, y, h / 2), q.identity(), new THREE.Vector3(1, h, 1)));
            crowns.setMatrixAt(i, m.compose(P(x, y, h - .2), q.setFromAxisAngle(up, i), new THREE.Vector3(1, 1, 1)));
        });
    }
    const porchSide = [faceOut[1], -faceOut[0]];
    const bigTreeAt = [ENTRY[0] + faceOut[0] * 6 + porchSide[0] * 11, ENTRY[1] + faceOut[1] * 6 + porchSide[1] * 11];
    const bigTrunk = new THREE.Mesh(new THREE.CylinderGeometry(.35, .5, 5, 8), trunkMat);
    bigTrunk.position.copy(P(...bigTreeAt, 2.5));
    const bigCrown = new THREE.Mesh(new THREE.SphereGeometry(4.2, 14, 10), leafMat);
    bigCrown.position.copy(P(...bigTreeAt, 7.5));
    bigCrown.scale.set(1, .85, 1);

    const palms = new THREE.Group();
    palms.add(trunks, crowns, bigTrunk, bigCrown);
    palms.visible = false;
    scene.add(palms);
    buildings.push({ group: palms, delay: .8 });

    // Football turf
    const FUTSAL = [[-29.9, -22.5], [-8.8, -16.1], [-19.8, 19.5], [-40.8, 13.1]];
    const midpoint = ([x1, y1], [x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];
    const NET_H = 6;
    const turfGeo = new THREE.ShapeGeometry(new THREE.Shape(FUTSAL.map(toV2)));
    turfGeo.rotateX(-Math.PI / 2);
    const turfMat = new THREE.MeshStandardMaterial({ color: 0x2f5a36, roughness: 1, transparent: true, opacity: 0 });
    const turf = new THREE.Mesh(turfGeo, turfMat);
    turf.position.y = .15;

    const markings = [], net = [];
    FUTSAL.forEach(([x1, y1], i) => {
        const [x2, y2] = FUTSAL[(i + 1) % 4];
        markings.push(P(x1, y1, .3), P(x2, y2, .3));
        const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 6);
        for (let j = 0; j < n; j++) {
            const x = x1 + (x2 - x1) * j / n, y = y1 + (y2 - y1) * j / n;
            net.push(P(x, y, 0), P(x, y, NET_H));
        }
        net.push(P(x1, y1, NET_H), P(x2, y2, NET_H));
    });
    markings.push(P(...midpoint(FUTSAL[1], FUTSAL[2]), .3), P(...midpoint(FUTSAL[3], FUTSAL[0]), .3));

    const futsal = new THREE.Group();
    futsal.add(
        turf,
        new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(markings), new THREE.LineBasicMaterial({ color: 0xffffff })),
        new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(net), new THREE.LineBasicMaterial({ color: 0x5fae78, transparent: true, opacity: .9 }))
    );
    futsal.visible = false;
    scene.add(futsal);
    buildings.push({ group: futsal, delay: .3 });

    // Parking & Grounds
    function ribbon(points, width, y) {
        const pos = [], index = [];
        points.forEach(([x, z], i) => {
            const [ax, az] = points[Math.max(i - 1, 0)], [bx, bz] = points[Math.min(i + 1, points.length - 1)];
            const l = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / l * width / 2, nz = (bx - ax) / l * width / 2;
            pos.push(x + nx, y, z + nz, x - nx, y, z - nz);
            if (i) index.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(index);
        geo.computeVertexNormals();
        return geo;
    }

    const pavedMat = tinted(0x9a968e), lawnMat = tinted(0x4f7a3a), flowerMat = tinted(0xc0443a), concreteMat = tinted(0xa8a49c), boothMat = tinted(0xd98a93);
    for (const m of [pavedMat, lawnMat, flowerMat]) m.side = THREE.DoubleSide;
    wallMats.push(pavedMat, lawnMat, flowerMat, concreteMat, boothMat);

    const LOOP = [[52.5, -56.6], [56.8, -49.2], [57.9, -44.3], [58.6, -40.5], [58.6, -34.5], [56.8, -30.3], [54.3, -27], [49.3, -23.2], [39.8, -17.9]];
    const loopMid = midpoint(LOOP[0], LOOP[LOOP.length - 1]);
    const slide = (ENTRY[0] - loopMid[0]) * faceDir[0] + (ENTRY[1] - loopMid[1]) * faceDir[1];
    const LAWN = LOOP.map(([x, y]) => [x + faceDir[0] * slide, y + faceDir[1] * slide]);
    ROADS.find(r => r.pts[0][0] === LOOP[0][0] && r.pts[0][1] === LOOP[0][1]).pts = LAWN;

    const grounds = new THREE.Group();
    for (const r of ROADS) grounds.add(new THREE.Mesh(ribbon(r.pts, r.w, .07), pavedMat));

    const outFromFace = ([x, y]) => (x - ENTRY[0]) * faceOut[0] + (y - ENTRY[1]) * faceOut[1];
    const roadOut = outFromFace(loopMid), apexOut = Math.max(...LAWN.map(outFromFace));
    grounds.add(
        new THREE.Mesh(ribbon([alongFace(9), alongFace(roadOut)], 9, .09), pavedMat),
        new THREE.Mesh(ribbon([alongFace(apexOut), alongFace(40)], 9, .09), pavedMat),
    );

    const lawnGeo = new THREE.ShapeGeometry(new THREE.Shape(LAWN.map(toV2)));
    lawnGeo.rotateX(-Math.PI / 2);
    const lawn = new THREE.Mesh(lawnGeo, lawnMat);
    lawn.position.y = .08;
    const flowerBed = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, .3, 24), flowerMat);
    flowerBed.position.copy(P(...alongFace((roadOut + apexOut) / 2), .15));
    grounds.add(lawn, flowerBed);

    const wallBits = [];
    const mainRoad = ROADS.find(r => r.main).pts;
    for (let i = 0; i < mainRoad.length - 1; i++) {
        const [x1, y1] = mainRoad[i], [x2, y2] = mainRoad[i + 1];
        if (Math.max(y1, y2) < -105 || Math.min(y1, y2) > 62) continue;
        const len = Math.hypot(x2 - x1, y2 - y1), ex = (x2 - x1) / len, ey = (y2 - y1) / len;
        let nx = -ey, ny = ex;
        if (nx * -x1 + ny * (-20 - y1) < 0) { nx = -nx; ny = -ny; }
        const n = Math.ceil(len / 3);
        for (let j = 0; j < n; j++) {
            const cx = x1 + (x2 - x1) * (j + .5) / n + nx * 6, cy = y1 + (y2 - y1) * (j + .5) / n + ny * 6;
            if (Math.hypot(cx - GATE[0], cy - GATE[1]) < 11) continue;
            wallBits.push([cx, cy, len / n, Math.atan2(-ey, ex)]);
        }
    }
    const compound = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 2.2, .25), concreteMat, wallBits.length);
    {
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
        wallBits.forEach(([x, y, len, angle], i) =>
            compound.setMatrixAt(i, m.compose(P(x, y, 1.1), q.setFromAxisAngle(up, angle), new THREE.Vector3(len + .05, 1, 1))));
    }
    const booth = new THREE.Mesh(new THREE.BoxGeometry(3, 2.8, 3), boothMat);
    booth.position.copy(P(23, 49, 1.4));
    grounds.add(compound, booth);
    grounds.visible = false;
    scene.add(grounds);
    buildings.push({ group: grounds, delay: 0 });

    // Center Reference
    const box = new THREE.Box3();
    buildings.forEach(b => box.expandByObject(b.group));
    DATA.buildings.forEach(b => b.outer.forEach(([x, y]) => box.expandByPoint(P(x, y))));
    const center = box.getCenter(new THREE.Vector3());

    // --- Camera Shots & Gate Coordinates ---
    const faceBearing = bearingOf(-faceOut[0], -faceOut[1]);
    function shot(x, y, h, bearing, tilt, fov) {
        const b = bearing * DEG, yaw = Math.atan2(-Math.cos(b), Math.sin(b)), p = tilt * DEG;
        const pos = P(x, y, h);
        const ahead = new THREE.Vector3(Math.cos(yaw) * Math.cos(p), Math.sin(p), Math.sin(yaw) * Math.cos(p));
        return { pos, target: pos.clone().addScaledVector(ahead, 60), fov };
    }

    // Exact gate shot: outside the arch gate on Wagholi road looking at the college entrance!
    const GATE_SHOT = shot(...alongFace(58), 1.7, faceBearing, 10, 55);

    function flyTo(to, customDur) {
        if (camera.aspect < 1) to = { ...to, fov: Math.min(to.fov * 1.4, 85) };
        const ahead = new THREE.Vector3();
        camera.getWorldDirection(ahead);
        const from = { pos: camera.position.clone(), target: camera.position.clone().addScaledVector(ahead, 60), fov: camera.fov };
        const dist = from.pos.distanceTo(to.pos), mid = (from.pos.y + to.pos.y) / 2;
        flight = {
            from, to, t: 0,
            dur: customDur ? customDur : THREE.MathUtils.clamp(dist / 70, 1.8, 3.8),
            lift: dist > 30 ? THREE.MathUtils.clamp(Math.max(dist * .3, 32 - mid), 0, 80) : 0,
        };
    }

    function placeFlightCamera(dt) {
        flight.t = Math.min(flight.dur, flight.t + dt);
        const k = flight.t / flight.dur, e = k < .5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
        const { from, to } = flight;
        camera.position.lerpVectors(from.pos, to.pos, e);
        camera.position.y += Math.sqrt(Math.sin(Math.PI * e)) * flight.lift;
        camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, e);
        camera.lookAt(new THREE.Vector3().lerpVectors(from.target, to.target, e));
        camera.updateProjectionMatrix();

        if (flight.t >= flight.dur) {
            flight = null;
        }
    }

    // Resize
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

    // User Interactive Controls
    let isDragging = false;
    let prevMouseX = 0, prevMouseY = 0;
    let targetAzimuth = -0.9, currentAzimuth = -0.9;
    let targetPolar = 0.82, currentPolar = 0.82;

    function onPointerDown(e) {
        isDragging = true;
        userInteracting = true;
        flight = null;
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
        targetPolar = Math.max(0.15, Math.min(1.4, targetPolar - dy * 0.005));
    }

    function onPointerUp() {
        isDragging = false;
        setTimeout(() => { userInteracting = false; }, 4000);
    }

    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('touchstart', onPointerDown, { passive: true });
    canvas.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp);

    // Animation Loop
    let last = performance.now();
    let total = 0;
    let gateSwoopTriggered = false;
    const hintEl = document.querySelector('.campus-3d-hint');

    function animate(now) {
        if (!isRunning) return;
        animId = requestAnimationFrame(animate);

        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        total += dt;

        if (t < END) t = Math.min(END, t + dt);

        // A: site plan lines
        const a = ease(phase(t, .2, 2.0));
        foot.geometry.setDrawRange(0, Math.floor(a * footprint.length / 2) * 2);
        boundary.material.opacity = .35 * phase(t, .2, 1.2);

        // B: wireframe model rises
        for (const b of buildings) {
            const p = ease(phase(t, 1.8 + b.delay, 3.4 + b.delay));
            b.group.visible = p > 0;
            b.group.scale.y = Math.max(p, .001);
        }

        // C: paper fills in
        const c = phase(t, 3.4, 4.6);
        for (const m of wallMats) {
            m.opacity = c;
            m.transparent = c < 1;
            m.depthWrite = c > .5;
        }
        bandMat.opacity = turfMat.opacity = c;
        edgeMat.color.lerpColors(WHITE, EDGE, c);
        detailMat.color.lerpColors(WHITE, DETAIL, c);
        detailMat.opacity = THREE.MathUtils.lerp(.4, 0, c);
        foot.material.opacity = THREE.MathUtils.lerp(.8, .25, c);

        // D: Camera Choreography: Aerial Rise -> Swoop to Main Gate
        if (userInteracting) {
            // Manual Drag Control
            currentAzimuth += (targetAzimuth - currentAzimuth) * 0.08;
            currentPolar += (targetPolar - currentPolar) * 0.08;
            const radius = 460;
            camera.position.set(
                center.x + radius * Math.sin(currentPolar) * Math.cos(currentAzimuth),
                radius * Math.cos(currentPolar) + 20,
                center.z + radius * Math.sin(currentPolar) * Math.sin(currentAzimuth)
            );
            camera.lookAt(center.x, 10, center.z);
        } else if (flight) {
            placeFlightCamera(dt);
        } else if (t < 4.8) {
            // Camera during structure rise
            if (hintEl) hintEl.innerHTML = '<span>🏗️</span> Drawing Site Plan &amp; Building Model...';
            const p = ease(phase(t, 1.2, 4.6));
            const polar = THREE.MathUtils.lerp(.18, 0.95, p);
            let radius = THREE.MathUtils.lerp(540, 480, p);
            if (camera.aspect < 1) radius *= 1.5;
            const az = -.9 + total * 0.04;
            camera.position.set(
                center.x + radius * Math.sin(polar) * Math.cos(az),
                radius * Math.cos(polar),
                center.z + radius * Math.sin(polar) * Math.sin(az)
            );
            camera.lookAt(center.x, 8, center.z);
        } else if (!gateSwoopTriggered) {
            // Trigger Swoop straight to Main Entrance Gate
            gateSwoopTriggered = true;
            if (hintEl) hintEl.innerHTML = '<span>🏛️</span> Gliding to GHRCEM Main Entrance Arch...';
            flyTo(GATE_SHOT, 3.4);
        } else if (t >= END) {
            // Settled at Main Gate: gentle ambient sway framing the college arch
            if (hintEl) hintEl.innerHTML = '<span>🏛️</span> GHRCEM Main Gate &middot; Drag to explore campus';
            const sway = Math.sin(total * 0.3) * 1.5;
            camera.position.x = GATE_SHOT.pos.x + sway;
            camera.lookAt(GATE_SHOT.target);
        }

        renderer.render(scene, camera);
    }

    requestAnimationFrame(now => {
        last = now;
        animate(now);
    });

    return {
        replayIntro() {
            t = 0.0;
            gateSwoopTriggered = false;
            flight = null;
            userInteracting = false;
        },
        pause() { isRunning = false; if (animId) cancelAnimationFrame(animId); },
        resume() { if (!isRunning) { isRunning = true; last = performance.now(); animate(last); } },
        resize,
        destroy() {
            isRunning = false;
            if (animId) cancelAnimationFrame(animId);
            window.removeEventListener('resize', resize);
            renderer.dispose();
        }
    };
}
