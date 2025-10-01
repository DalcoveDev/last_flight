//COLORS
var Colors = {
  red: 0xe84545, // vivid crimson
  white: 0xe6f0ff, // cool white
  brown: 0x263042, // deep slate for dark parts
  brownDark: 0x1a2235, // darker slate
  pink: 0x9b59b6, // purple accent
  yellow: 0xffb86c, // peach/orange
  blue: 0x1ca7ec, // cyan/blue
};

///////////////

// GAME VARIABLES
var game;
var deltaTime = 0;
var newTime = new Date().getTime();
var oldTime = new Date().getTime();
var ennemiesPool = [];
var particlesPool = [];
var particlesInUse = [];

// Enhanced features
var ammo = 15;
var bullets = [];
var controlMode = "mouse"; // 'mouse' | 'buttons'
var virtualMousePos = { x: 0, y: 0 };
var inputState = {
  left: false,
  right: false,
  up: false,
  down: false,
  fire: false,
};
var paused = false;
var muted = false;
var audioReady = false;
var audioEngine = null;
var lastShotTime = 0;
var fireCooldown = 180; // ms
// Shield system
var shield = { charges: 2, active: false, hitsLeft: 0, expires: 0, mesh: null };

// Extended gameplay systems
var enemyBullets = [];
var pickupsHolder = null,
  dronesHolder = null,
  obstaclesHolder = null;
var boost = { active: false, expires: 0, fireBonus: false };

// Day/Night cycle config (60 seconds full cycle)
var dayNight = { duration: 60000, startTime: Date.now() };
// Precomputed colors for lerping
var fogDay = new THREE.Color(0xf7d9aa);
var fogNight = new THREE.Color(0x0a1424);
var hemiDaySky = new THREE.Color(0xaaaaaa);
var hemiNightSky = new THREE.Color(0x223447);
var hemiDayGround = new THREE.Color(0x000000);
var hemiNightGround = new THREE.Color(0x010305);
var ambientDayColor = new THREE.Color(0xdc8874);
var ambientNightColor = new THREE.Color(0x223347);
var seaDayColor = new THREE.Color(0x68c3c0);
var seaNightColor = new THREE.Color(0x0b2a3a);
// Camera and speed tuning for consistent view
var BASE_FOV = 55;
var CAMERA_Y = 110;
var CAMERA_Z = 220;
var MOBILE_FOV = 60;
var MOBILE_CAMERA_Y = 120;
var MOBILE_CAMERA_Z = 260;
var IS_MOBILE =
  typeof window !== "undefined" &&
  (window.innerWidth <= 720 || /Mobi|Android/i.test(navigator.userAgent));
var CONSTANT_PLANE_SPEED = 1.35;

function updateDayNightCycle() {
  var elapsed = (Date.now() - dayNight.startTime) % dayNight.duration;
  var t = elapsed / dayNight.duration;
  // Smooth cycle: 0 -> 1 -> 0 over a minute; f=0 at t=0 (day), f=1 at t=0.5 (night)
  var f = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  var dayMix = 1 - f; // 1 = day, 0 = night

  if (scene && scene.fog && scene.fog.color) {
    var fogCol = new THREE.Color().copy(fogNight).lerp(fogDay, dayMix);
    scene.fog.color.copy(fogCol);
  }
  if (typeof hemisphereLight !== "undefined" && hemisphereLight) {
    var skyCol = new THREE.Color().copy(hemiNightSky).lerp(hemiDaySky, dayMix);
    var groundCol = new THREE.Color()
      .copy(hemiNightGround)
      .lerp(hemiDayGround, dayMix);
    hemisphereLight.color.copy(skyCol);
    if (hemisphereLight.groundColor)
      hemisphereLight.groundColor.copy(groundCol);
    hemisphereLight.intensity = 0.5 + 0.3 * dayMix;
  }
  if (typeof ambientLight !== "undefined" && ambientLight) {
    var ambCol = new THREE.Color()
      .copy(ambientNightColor)
      .lerp(ambientDayColor, dayMix);
    ambientLight.color.copy(ambCol);
    ambientLight.intensity = 0.18 + 0.32 * dayMix; // ~0.5 at day, ~0.18 at night
  }
  if (typeof shadowLight !== "undefined" && shadowLight) {
    shadowLight.intensity = 0.2 + 0.7 * dayMix;
  }
  if (
    typeof sea !== "undefined" &&
    sea &&
    sea.mesh &&
    sea.mesh.material &&
    sea.mesh.material.color
  ) {
    var seaCol = new THREE.Color()
      .copy(seaNightColor)
      .lerp(seaDayColor, dayMix);
    sea.mesh.material.color.copy(seaCol);
  }

  // Sky dome color: day blue to night black
  if (
    typeof skyDome !== "undefined" &&
    skyDome &&
    skyDome.material &&
    skyDome.material.color
  ) {
    var skyDay = new THREE.Color(0x87ceeb); // sky blue
    var skyNight = new THREE.Color(0x000000); // black
    var skyCol = new THREE.Color().copy(skyNight).lerp(skyDay, dayMix);
    skyDome.material.color.copy(skyCol);
  }

  // Position sun and moon relative to the airplane (rise and set over horizon)
  var base =
    typeof airplane !== "undefined" && airplane && airplane.mesh
      ? airplane.mesh.position
      : new THREE.Vector3(0, 0, 0);
  var a = 2 * Math.PI * t; // cycle angle
  var radius = 800;
  var height = 450;
  var zOffset = -600; // keep behind gameplay space

  if (sunMesh) {
    var sy = Math.max(Math.sin(a) * height, -50);
    sunMesh.position.set(
      base.x + Math.cos(a) * radius,
      base.y + sy,
      base.z + zOffset
    );
    sunMesh.visible = dayMix > 0.15;
  }
  if (moonMesh) {
    var a2 = a + Math.PI;
    var my = Math.max(Math.sin(a2) * height, -50);
    moonMesh.position.set(
      base.x + Math.cos(a2) * radius,
      base.y + my,
      base.z + zOffset
    );
    moonMesh.visible = dayMix < 0.85;
  }

  // Tie directional light to sun direction
  if (typeof shadowLight !== "undefined" && shadowLight && sunMesh) {
    var dir = new THREE.Vector3()
      .subVectors(sunMesh.position, base)
      .normalize()
      .multiplyScalar(600);
    shadowLight.position.copy(dir);
    if (shadowLight.target) shadowLight.target.position.copy(base);
  }
}

function resetGame() {
  ammo = 15;
  if (typeof updateAmmoBadge === "function") updateAmmoBadge();
  shield.charges = 2;
  shield.active = false;
  shield.hitsLeft = 0;
  shield.expires = 0;
  if (shield.mesh) shield.mesh.visible = false;
  if (typeof updateShieldBadge === "function") updateShieldBadge();
  enemyBullets = [];
  boost.active = false;
  boost.expires = 0;
  boost.fireBonus = false;
  if (pickupsHolder && typeof pickupsHolder.reset === "function")
    pickupsHolder.reset();
  if (dronesHolder && typeof dronesHolder.reset === "function")
    dronesHolder.reset();
  if (obstaclesHolder && typeof obstaclesHolder.reset === "function")
    obstaclesHolder.reset();
  game = {
    speed: 0,
    initSpeed: 0.0003,
    baseSpeed: 0.0003,
    targetBaseSpeed: 0.0003,
    incrementSpeedByTime: 0.000001,
    incrementSpeedByLevel: 0.000002,
    distanceForSpeedUpdate: 100,
    speedLastUpdate: 0,

    distance: 0,
    ratioSpeedDistance: 45,
    energy: 100,
    ratioSpeedEnergy: 3,

    level: 1,
    levelLastUpdate: 0,
    distanceForLevelUpdate: 1500,

    planeDefaultHeight: 100,
    planeAmpHeight: 80,
    planeAmpWidth: 75,
    planeMoveSensivity: 0.005,
    planeRotXSensivity: 0.0008,
    planeRotZSensivity: 0.0004,
    planeFallSpeed: 0.001,
    planeMinSpeed: 1.2,
    planeMaxSpeed: 1.6,
    planeSpeed: 0,
    planeCollisionDisplacementX: 0,
    planeCollisionSpeedX: 0,

    planeCollisionDisplacementY: 0,
    planeCollisionSpeedY: 0,

    seaRadius: 600,
    seaLength: 800,
    //seaRotationSpeed:0.006,
    wavesMinAmp: 5,
    wavesMaxAmp: 20,
    wavesMinSpeed: 0.001,
    wavesMaxSpeed: 0.003,

    cameraFarPos: 500,
    cameraNearPos: 150,
    cameraSensivity: 0.002,

    coinDistanceTolerance: 15,
    coinValue: 3,
    coinsSpeed: 0.5,
    coinLastSpawn: 0,
    distanceForCoinsSpawn: 80,

    ennemyDistanceTolerance: 10,
    ennemyValue: 10,
    ennemiesSpeed: 0.5,
    ennemyLastSpawn: 0,
    distanceForEnnemiesSpawn: 120,

    status: "playing",
  };
  fieldLevel.innerHTML = Math.floor(game.level);
}

//THREEJS RELATED VARIABLES

var scene,
  camera,
  fieldOfView,
  aspectRatio,
  nearPlane,
  farPlane,
  renderer,
  container,
  controls;

//SCREEN & MOUSE VARIABLES

var HEIGHT,
  WIDTH,
  mousePos = { x: 0, y: 0 };

//INIT THREE JS, SCREEN AND MOUSE EVENTS

function createScene() {
  HEIGHT = window.innerHeight;
  WIDTH = window.innerWidth;

  scene = new THREE.Scene();
  aspectRatio = WIDTH / HEIGHT;
  fieldOfView = IS_MOBILE ? MOBILE_FOV : BASE_FOV;
  nearPlane = 0.1;
  farPlane = 10000;
  camera = new THREE.PerspectiveCamera(
    fieldOfView,
    aspectRatio,
    nearPlane,
    farPlane
  );
  scene.fog = new THREE.Fog(0xf7d9aa, 100, 950);
  camera.position.x = 0;
  camera.position.z = IS_MOBILE ? MOBILE_CAMERA_Z : CAMERA_Z;
  camera.position.y = IS_MOBILE ? MOBILE_CAMERA_Y : CAMERA_Y;
  //camera.lookAt(new THREE.Vector3(0, 400, 0));

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(WIDTH, HEIGHT);

  renderer.shadowMap.enabled = true;

  container = document.getElementById("world");
  container.appendChild(renderer.domElement);

  window.addEventListener("resize", handleWindowResize, false);

  /*
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.minPolarAngle = -Math.PI / 2;
  controls.maxPolarAngle = Math.PI ;

  //controls.noZoom = true;
  //controls.noPan = true;
  //*/
}

// MOUSE AND SCREEN EVENTS

function handleWindowResize() {
  HEIGHT = window.innerHeight;
  WIDTH = window.innerWidth;
  renderer.setSize(WIDTH, HEIGHT);
  camera.aspect = WIDTH / HEIGHT;
  camera.updateProjectionMatrix();
}

function handleMouseMove(event) {
  var tx = -1 + (event.clientX / WIDTH) * 2;
  var ty = 1 - (event.clientY / HEIGHT) * 2;
  mousePos = { x: tx, y: ty };
}

function handleTouchMove(event) {
  event.preventDefault();
  var tx = -1 + (event.touches[0].pageX / WIDTH) * 2;
  var ty = 1 - (event.touches[0].pageY / HEIGHT) * 2;
  mousePos = { x: tx, y: ty };
}

function handleMouseUp(event) {
  if (game.status == "waitingReplay") {
    resetGame();
    hideReplay();
  }
}

function handleTouchEnd(event) {
  if (game.status == "waitingReplay") {
    resetGame();
    hideReplay();
  }
}

// LIGHTS

var ambientLight, hemisphereLight, shadowLight;

function createLights() {
  hemisphereLight = new THREE.HemisphereLight(0xaaaaaa, 0x000000, 0.9);

  ambientLight = new THREE.AmbientLight(0xdc8874, 0.5);

  shadowLight = new THREE.DirectionalLight(0xffffff, 0.9);
  shadowLight.position.set(150, 350, 350);
  shadowLight.castShadow = true;
  shadowLight.shadow.camera.left = -400;
  shadowLight.shadow.camera.right = 400;
  shadowLight.shadow.camera.top = 400;
  shadowLight.shadow.camera.bottom = -400;
  shadowLight.shadow.camera.near = 1;
  shadowLight.shadow.camera.far = 1000;
  shadowLight.shadow.mapSize.width = 4096;
  shadowLight.shadow.mapSize.height = 4096;

  var ch = new THREE.CameraHelper(shadowLight.shadow.camera);

  //scene.add(ch);
  scene.add(hemisphereLight);
  scene.add(shadowLight);
  scene.add(ambientLight);
}

var Pilot = function () {
  this.mesh = new THREE.Object3D();
  this.mesh.name = "pilot";
  this.angleHairs = 0;

  var bodyGeom = new THREE.BoxGeometry(15, 15, 15);
  var bodyMat = new THREE.MeshPhongMaterial({
    color: Colors.brown,
    shading: THREE.FlatShading,
  });
  var body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.set(2, -12, 0);

  this.mesh.add(body);

  var faceGeom = new THREE.BoxGeometry(10, 10, 10);
  var faceMat = new THREE.MeshLambertMaterial({ color: Colors.pink });
  var face = new THREE.Mesh(faceGeom, faceMat);
  this.mesh.add(face);

  var hairGeom = new THREE.BoxGeometry(4, 4, 4);
  var hairMat = new THREE.MeshLambertMaterial({ color: Colors.brown });
  var hair = new THREE.Mesh(hairGeom, hairMat);
  hair.geometry.applyMatrix(new THREE.Matrix4().makeTranslation(0, 2, 0));
  var hairs = new THREE.Object3D();

  this.hairsTop = new THREE.Object3D();

  for (var i = 0; i < 12; i++) {
    var h = hair.clone();
    var col = i % 3;
    var row = Math.floor(i / 3);
    var startPosZ = -4;
    var startPosX = -4;
    h.position.set(startPosX + row * 4, 0, startPosZ + col * 4);
    h.geometry.applyMatrix(new THREE.Matrix4().makeScale(1, 1, 1));
    this.hairsTop.add(h);
  }
  hairs.add(this.hairsTop);

  var hairSideGeom = new THREE.BoxGeometry(12, 4, 2);
  hairSideGeom.applyMatrix(new THREE.Matrix4().makeTranslation(-6, 0, 0));
  var hairSideR = new THREE.Mesh(hairSideGeom, hairMat);
  var hairSideL = hairSideR.clone();
  hairSideR.position.set(8, -2, 6);
  hairSideL.position.set(8, -2, -6);
  hairs.add(hairSideR);
  hairs.add(hairSideL);

  var hairBackGeom = new THREE.BoxGeometry(2, 8, 10);
  var hairBack = new THREE.Mesh(hairBackGeom, hairMat);
  hairBack.position.set(-1, -4, 0);
  hairs.add(hairBack);
  hairs.position.set(-5, 5, 0);

  this.mesh.add(hairs);

  var glassGeom = new THREE.BoxGeometry(5, 5, 5);
  var glassMat = new THREE.MeshLambertMaterial({ color: Colors.brown });
  var glassR = new THREE.Mesh(glassGeom, glassMat);
  glassR.position.set(6, 0, 3);
  var glassL = glassR.clone();
  glassL.position.z = -glassR.position.z;

  var glassAGeom = new THREE.BoxGeometry(11, 1, 11);
  var glassA = new THREE.Mesh(glassAGeom, glassMat);
  this.mesh.add(glassR);
  this.mesh.add(glassL);
  this.mesh.add(glassA);

  var earGeom = new THREE.BoxGeometry(2, 3, 2);
  var earL = new THREE.Mesh(earGeom, faceMat);
  earL.position.set(0, 0, -6);
  var earR = earL.clone();
  earR.position.set(0, 0, 6);
  this.mesh.add(earL);
  this.mesh.add(earR);
};

Pilot.prototype.updateHairs = function () {
  //*
  var hairs = this.hairsTop.children;

  var l = hairs.length;
  for (var i = 0; i < l; i++) {
    var h = hairs[i];
    h.scale.y = 0.75 + Math.cos(this.angleHairs + i / 3) * 0.25;
  }
  this.angleHairs += game.speed * deltaTime * 40;
  //*/
};

var AirPlane = function () {
  this.mesh = new THREE.Object3D();
  this.mesh.name = "airPlane";

  // Fuselage (sleeker jet body)
  var bodyMat = new THREE.MeshPhongMaterial({
    color: Colors.white,
    shading: THREE.FlatShading,
  });
  var fusMain = new THREE.Mesh(
    new THREE.CylinderGeometry(18, 18, 110, 16),
    bodyMat
  );
  fusMain.rotation.z = Math.PI / 2;
  fusMain.position.set(10, 0, 0);
  fusMain.castShadow = true;
  fusMain.receiveShadow = true;
  this.mesh.add(fusMain);
  var fusNose = new THREE.Mesh(
    new THREE.CylinderGeometry(0, 18, 28, 16),
    bodyMat
  );
  fusNose.rotation.z = Math.PI / 2;
  fusNose.position.set(70, 0, 0);
  this.mesh.add(fusNose);
  var fusTail = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 12, 24, 16),
    bodyMat
  );
  fusTail.rotation.z = Math.PI / 2;
  fusTail.position.set(-60, 0, 0);
  this.mesh.add(fusTail);

  // Engine

  // Jet intakes (sides) and exhaust (rear)
  var intakeMat = new THREE.MeshPhongMaterial({
    color: Colors.brownDark,
    shading: THREE.FlatShading,
  });
  var intakeL = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 7, 6, 12),
    intakeMat
  );
  intakeL.rotation.z = Math.PI / 2;
  intakeL.position.set(25, 0, 16);
  this.mesh.add(intakeL);
  var intakeR = intakeL.clone();
  intakeR.position.z = -16;
  this.mesh.add(intakeR);
  var exhaust = new THREE.Mesh(
    new THREE.CylinderGeometry(10, 7, 12, 12),
    new THREE.MeshPhongMaterial({ color: 0x22262f, shading: THREE.FlatShading })
  );
  exhaust.rotation.z = Math.PI / 2;
  exhaust.position.set(-75, 0, 0);
  this.mesh.add(exhaust);
  // Turbine fan (keeps propeller animation)
  var fan = new THREE.Mesh(
    new THREE.CylinderGeometry(10, 10, 2, 16),
    new THREE.MeshPhongMaterial({ color: 0x111317, shading: THREE.FlatShading })
  );
  fan.rotation.z = Math.PI / 2;
  fan.position.set(-81, 0, 0);
  fan.castShadow = true;
  this.propeller = fan;
  this.mesh.add(fan);

  // Tail Plane

  var geomTailPlane = new THREE.BoxGeometry(15, 20, 5, 1, 1, 1);
  var matTailPlane = new THREE.MeshPhongMaterial({
    color: Colors.yellow,
    shading: THREE.FlatShading,
  });
  var tailPlane = new THREE.Mesh(geomTailPlane, matTailPlane);
  tailPlane.position.set(-40, 20, 0);
  tailPlane.castShadow = true;
  tailPlane.receiveShadow = true;
  this.mesh.add(tailPlane);

  // Wings

  var geomSideWing = new THREE.BoxGeometry(60, 4, 180, 1, 1, 1);
  var matSideWing = new THREE.MeshPhongMaterial({
    color: Colors.blue,
    shading: THREE.FlatShading,
  });
  var sideWing = new THREE.Mesh(geomSideWing, matSideWing);
  sideWing.position.set(0, 10, 0);
  sideWing.castShadow = true;
  sideWing.receiveShadow = true;
  this.mesh.add(sideWing);

  // Canopy (bubble)
  var canopyGeo = new THREE.SphereGeometry(16, 16, 12);
  var canopyMat = new THREE.MeshPhongMaterial({
    color: Colors.white,
    transparent: true,
    opacity: 0.35,
    shading: THREE.FlatShading,
  });
  var canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.scale.set(1.2, 0.7, 1.2);
  canopy.position.set(30, 18, 0);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  this.mesh.add(canopy);

  // Turbine fan already created; keep rotation logic compatibility
  // (this.propeller is the rear fan mesh)

  // (Fuselage and nose integrated above)
  var wheelProtecGeom = new THREE.BoxGeometry(30, 15, 10, 1, 1, 1);
  var wheelProtecMat = new THREE.MeshPhongMaterial({
    color: Colors.red,
    shading: THREE.FlatShading,
  });
  var wheelProtecR = new THREE.Mesh(wheelProtecGeom, wheelProtecMat);
  wheelProtecR.position.set(25, -20, 25);
  this.mesh.add(wheelProtecR);

  var wheelTireGeom = new THREE.BoxGeometry(24, 24, 4);
  var wheelTireMat = new THREE.MeshPhongMaterial({
    color: Colors.brownDark,
    shading: THREE.FlatShading,
  });
  var wheelTireR = new THREE.Mesh(wheelTireGeom, wheelTireMat);
  wheelTireR.position.set(25, -28, 25);

  var wheelAxisGeom = new THREE.BoxGeometry(10, 10, 6);
  var wheelAxisMat = new THREE.MeshPhongMaterial({
    color: Colors.brown,
    shading: THREE.FlatShading,
  });
  var wheelAxis = new THREE.Mesh(wheelAxisGeom, wheelAxisMat);
  wheelTireR.add(wheelAxis);

  this.mesh.add(wheelTireR);

  var wheelProtecL = wheelProtecR.clone();
  wheelProtecL.position.z = -wheelProtecR.position.z;
  this.mesh.add(wheelProtecL);

  var wheelTireL = wheelTireR.clone();
  wheelTireL.position.z = -wheelTireR.position.z;
  this.mesh.add(wheelTireL);

  var wheelTireB = wheelTireR.clone();
  wheelTireB.scale.set(0.5, 0.5, 0.5);
  wheelTireB.position.set(-35, -5, 0);
  this.mesh.add(wheelTireB);

  var suspensionGeom = new THREE.BoxGeometry(4, 20, 4);
  suspensionGeom.applyMatrix(new THREE.Matrix4().makeTranslation(0, 10, 0));
  var suspensionMat = new THREE.MeshPhongMaterial({
    color: Colors.red,
    shading: THREE.FlatShading,
  });
  var suspension = new THREE.Mesh(suspensionGeom, suspensionMat);
  suspension.position.set(-35, -5, 0);
  suspension.rotation.z = -0.3;
  this.mesh.add(suspension);

  this.pilot = new Pilot();
  this.pilot.mesh.position.set(-10, 27, 0);
  this.mesh.add(this.pilot.mesh);

  this.mesh.castShadow = true;
  this.mesh.receiveShadow = true;
};

Sky = function () {
  this.mesh = new THREE.Object3D();
  this.nClouds = 20;
  this.clouds = [];
  var stepAngle = (Math.PI * 2) / this.nClouds;
  for (var i = 0; i < this.nClouds; i++) {
    var c = new Cloud();
    this.clouds.push(c);
    var a = stepAngle * i;
    var h = game.seaRadius + 150 + Math.random() * 200;
    c.mesh.position.y = Math.sin(a) * h;
    c.mesh.position.x = Math.cos(a) * h;
    c.mesh.position.z = -300 - Math.random() * 500;
    c.mesh.rotation.z = a + Math.PI / 2;
    var s = 1 + Math.random() * 2;
    c.mesh.scale.set(s, s, s);
    this.mesh.add(c.mesh);
  }
};

Sky.prototype.moveClouds = function () {
  for (var i = 0; i < this.nClouds; i++) {
    var c = this.clouds[i];
    c.rotate();
  }
  this.mesh.rotation.z += game.speed * deltaTime;
};

Sea = function () {
  // Increase segments for smoother waves
  var geom = new THREE.CylinderGeometry(
    game.seaRadius,
    game.seaRadius,
    game.seaLength,
    80,
    20
  );
  geom.applyMatrix(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  geom.mergeVertices();
  var l = geom.vertices.length;

  this.waves = [];

  for (var i = 0; i < l; i++) {
    var v = geom.vertices[i];
    // Add some randomness to initial y for more natural look
    v.y += Math.random() * 2 - 1;
    this.waves.push({
      y: v.y,
      x: v.x,
      z: v.z,
      ang: Math.random() * Math.PI * 2,
      amp:
        game.wavesMinAmp +
        Math.random() * (game.wavesMaxAmp - game.wavesMinAmp),
      speed:
        game.wavesMinSpeed +
        Math.random() * (game.wavesMaxSpeed - game.wavesMinSpeed),
      phase: Math.random() * Math.PI * 2,
    });
  }

  // Use MeshStandardMaterial for better lighting and reflections
  var mat = new THREE.MeshStandardMaterial({
    color: Colors.blue,
    transparent: true,
    opacity: 0.85,
    roughness: 0.4,
    metalness: 0.6,
    flatShading: true,
    // Add a slight gradient using vertex colors
    vertexColors: false,
  });

  this.mesh = new THREE.Mesh(geom, mat);
  this.mesh.name = "waves";
  this.mesh.receiveShadow = true;

  // Add fog blending for distant water
  this.mesh.material.fog = true;
};

Sea.prototype.moveWaves = function () {
  var verts = this.mesh.geometry.vertices;
  var l = verts.length;
  for (var i = 0; i < l; i++) {
    var v = verts[i];
    var vprops = this.waves[i];
    v.x = vprops.x + Math.cos(vprops.ang) * vprops.amp;
    v.y = vprops.y + Math.sin(vprops.ang) * vprops.amp;
    vprops.ang += vprops.speed * deltaTime;
    this.mesh.geometry.verticesNeedUpdate = true;
  }
};

Cloud = function () {
  this.mesh = new THREE.Object3D();
  this.mesh.name = "cloud";
  var puffGeo = new THREE.SphereGeometry(12, 14, 10);
  var mat = new THREE.MeshLambertMaterial({
    color: Colors.white,
    transparent: true,
    opacity: 0.95,
  });

  var nPuffs = 5 + Math.floor(Math.random() * 4);
  for (var i = 0; i < nPuffs; i++) {
    var m = new THREE.Mesh(puffGeo.clone(), mat);
    m.position.x = (Math.random() * 2 - 1) * 20;
    m.position.y = (Math.random() * 2 - 1) * 8;
    m.position.z = (Math.random() * 2 - 1) * 12;
    var s = 0.6 + Math.random() * 1.4;
    m.scale.set(s * 1.2, s, s * 1.2);
    this.mesh.add(m);
    m.castShadow = false;
    m.receiveShadow = false;
  }
};

Cloud.prototype.rotate = function () {
  var l = this.mesh.children.length;
  for (var i = 0; i < l; i++) {
    var m = this.mesh.children[i];
    m.rotation.z += Math.random() * 0.005 * (i + 1);
    m.rotation.y += Math.random() * 0.002 * (i + 1);
  }
};

Ennemy = function () {
  this.mesh = new THREE.Object3D();
  // Mine core
  var coreGeo = new THREE.IcosahedronGeometry(7, 0);
  var coreMat = new THREE.MeshPhongMaterial({
    color: 0x0b0b10,
    shininess: 10,
    shading: THREE.FlatShading,
  });
  var core = new THREE.Mesh(coreGeo, coreMat);
  core.castShadow = true;
  core.receiveShadow = true;
  this.mesh.add(core);
  // Spikes (axes + diagonals)
  var dirs = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(-1, 1, 1),
    new THREE.Vector3(1, -1, 1),
    new THREE.Vector3(1, 1, -1),
    new THREE.Vector3(-1, -1, 1),
    new THREE.Vector3(1, -1, -1),
  ];
  var spikeGeo = new THREE.CylinderGeometry(0, 1.6, 8, 6);
  var spikeMat = new THREE.MeshPhongMaterial({
    color: 0x0b0b10,
    shininess: 20,
  });
  for (var i = 0; i < dirs.length; i++) {
    var dir = dirs[i].clone().normalize();
    var spike = new THREE.Mesh(spikeGeo, spikeMat);
    // Align cylinder's +Y axis to dir
    var quat = new THREE.Quaternion();
    quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    spike.quaternion.copy(quat);
    spike.position.copy(dir.clone().multiplyScalar(9));
    spike.castShadow = true;
    this.mesh.add(spike);
  }
  this.mesh.castShadow = true;
  this.angle = 0;
  this.dist = 0;
};

EnnemiesHolder = function () {
  this.mesh = new THREE.Object3D();
  this.ennemiesInUse = [];
};

EnnemiesHolder.prototype.spawnEnnemies = function () {
  var nEnnemies = game.level;

  for (var i = 0; i < nEnnemies; i++) {
    var ennemy;
    if (ennemiesPool.length) {
      ennemy = ennemiesPool.pop();
    } else {
      ennemy = new Ennemy();
    }

    ennemy.angle = -(i * 0.1);
    ennemy.distance =
      game.seaRadius +
      game.planeDefaultHeight +
      (-1 + Math.random() * 2) * (game.planeAmpHeight - 20);
    ennemy.mesh.position.y =
      -game.seaRadius + Math.sin(ennemy.angle) * ennemy.distance;
    ennemy.mesh.position.x = Math.cos(ennemy.angle) * ennemy.distance;

    this.mesh.add(ennemy.mesh);
    this.ennemiesInUse.push(ennemy);
  }
};

EnnemiesHolder.prototype.rotateEnnemies = function () {
  for (var i = 0; i < this.ennemiesInUse.length; i++) {
    var ennemy = this.ennemiesInUse[i];
    ennemy.angle += game.speed * deltaTime * game.ennemiesSpeed;

    if (ennemy.angle > Math.PI * 2) ennemy.angle -= Math.PI * 2;

    ennemy.mesh.position.y =
      -game.seaRadius + Math.sin(ennemy.angle) * ennemy.distance;
    ennemy.mesh.position.x = Math.cos(ennemy.angle) * ennemy.distance;
    ennemy.mesh.rotation.z += Math.random() * 0.1;
    ennemy.mesh.rotation.y += Math.random() * 0.1;

    //var globalEnnemyPosition =  ennemy.mesh.localToWorld(new THREE.Vector3());
    var diffPos = airplane.mesh.position
      .clone()
      .sub(ennemy.mesh.position.clone());
    var d = diffPos.length();
    if (d < game.ennemyDistanceTolerance) {
      if (shield.active && shield.hitsLeft > 0) {
        // Absorb hit
        shield.hitsLeft--;
        if (typeof updateShieldBadge === "function") updateShieldBadge();
        particlesHolder.spawnParticles(
          ennemy.mesh.position.clone(),
          12,
          Colors.blue,
          2
        );
        ennemiesPool.unshift(this.ennemiesInUse.splice(i, 1)[0]);
        this.mesh.remove(ennemy.mesh);
        ambientLight.intensity = 1.2;
        if (shield.hitsLeft <= 0) deactivateShield();
        i--;
      } else {
        particlesHolder.spawnParticles(
          ennemy.mesh.position.clone(),
          15,
          0x0b0b10,
          3
        );
        ennemiesPool.unshift(this.ennemiesInUse.splice(i, 1)[0]);
        this.mesh.remove(ennemy.mesh);
        game.planeCollisionSpeedX = (100 * diffPos.x) / d;
        game.planeCollisionSpeedY = (100 * diffPos.y) / d;
        ambientLight.intensity = 2;
        removeEnergy();
        i--;
      }
    } else if (ennemy.angle > Math.PI) {
      ennemiesPool.unshift(this.ennemiesInUse.splice(i, 1)[0]);
      this.mesh.remove(ennemy.mesh);
      i--;
    }
  }
};

Particle = function () {
  var geom = new THREE.TetrahedronGeometry(3, 0);
  var mat = new THREE.MeshPhongMaterial({
    color: 0x009999,
    shininess: 0,
    specular: 0xffffff,
    shading: THREE.FlatShading,
  });
  this.mesh = new THREE.Mesh(geom, mat);
};

Particle.prototype.explode = function (pos, color, scale) {
  var _this = this;
  var _p = this.mesh.parent;
  this.mesh.material.color = new THREE.Color(color);
  this.mesh.material.needsUpdate = true;
  this.mesh.scale.set(scale, scale, scale);
  var targetX = pos.x + (-1 + Math.random() * 2) * 50;
  var targetY = pos.y + (-1 + Math.random() * 2) * 50;
  var speed = 0.6 + Math.random() * 0.2;
  TweenMax.to(this.mesh.rotation, speed, {
    x: Math.random() * 12,
    y: Math.random() * 12,
  });
  TweenMax.to(this.mesh.scale, speed, { x: 0.1, y: 0.1, z: 0.1 });
  TweenMax.to(this.mesh.position, speed, {
    x: targetX,
    y: targetY,
    delay: Math.random() * 0.1,
    ease: Power2.easeOut,
    onComplete: function () {
      if (_p) _p.remove(_this.mesh);
      _this.mesh.scale.set(1, 1, 1);
      particlesPool.unshift(_this);
    },
  });
};

ParticlesHolder = function () {
  this.mesh = new THREE.Object3D();
  this.particlesInUse = [];
};

ParticlesHolder.prototype.spawnParticles = function (
  pos,
  density,
  color,
  scale
) {
  var nPArticles = density;
  for (var i = 0; i < nPArticles; i++) {
    var particle;
    if (particlesPool.length) {
      particle = particlesPool.pop();
    } else {
      particle = new Particle();
    }
    this.mesh.add(particle.mesh);
    particle.mesh.visible = true;
    var _this = this;
    particle.mesh.position.y = pos.y;
    particle.mesh.position.x = pos.x;
    particle.explode(pos, color, scale);
  }
};

Coin = function () {
  this.mesh = new THREE.Object3D();
  // Lightning-like energy bar
  var mat = new THREE.MeshPhongMaterial({
    color: 0x1ca7ec,
    emissive: 0x0b4b7a,
    shininess: 80,
    shading: THREE.FlatShading,
  });
  var seg1 = new THREE.BoxGeometry(2.2, 8, 2.2);
  var seg2 = new THREE.BoxGeometry(2.2, 8, 2.2);
  var tipGeo = new THREE.CylinderGeometry(0, 1.8, 4, 8);
  var s1 = new THREE.Mesh(seg1, mat);
  s1.rotation.z = -0.5;
  s1.position.set(0, 3, 0);
  var s2 = new THREE.Mesh(seg2, mat);
  s2.rotation.z = -0.5;
  s2.position.set(4, -3, 0);
  var tip = new THREE.Mesh(tipGeo, mat);
  tip.rotation.z = -0.5;
  tip.position.set(6.5, -6.8, 0);
  this.mesh.add(s1);
  this.mesh.add(s2);
  this.mesh.add(tip);
  // Subtle halo
  var haloGeo = new THREE.SphereGeometry(6.5, 10, 8);
  var haloMat = new THREE.MeshPhongMaterial({
    color: 0x1ca7ec,
    transparent: true,
    opacity: 0.25,
  });
  var halo = new THREE.Mesh(haloGeo, haloMat);
  halo.scale.set(1.1, 1.1, 1.1);
  this.mesh.add(halo);
  this.mesh.castShadow = false;
  this.mesh.receiveShadow = false;
  this.angle = 0;
  this.dist = 0;
};

CoinsHolder = function (nCoins) {
  this.mesh = new THREE.Object3D();
  this.coinsInUse = [];
  this.coinsPool = [];
  for (var i = 0; i < nCoins; i++) {
    var coin = new Coin();
    this.coinsPool.push(coin);
  }
};

CoinsHolder.prototype.spawnCoins = function () {
  var nCoins = 1 + Math.floor(Math.random() * 10);
  var d =
    game.seaRadius +
    game.planeDefaultHeight +
    (-1 + Math.random() * 2) * (game.planeAmpHeight - 20);
  var amplitude = 10 + Math.round(Math.random() * 10);
  for (var i = 0; i < nCoins; i++) {
    var coin;
    if (this.coinsPool.length) {
      coin = this.coinsPool.pop();
    } else {
      coin = new Coin();
    }
    this.mesh.add(coin.mesh);
    this.coinsInUse.push(coin);
    coin.angle = -(i * 0.02);
    coin.distance = d + Math.cos(i * 0.5) * amplitude;
    coin.mesh.position.y =
      -game.seaRadius + Math.sin(coin.angle) * coin.distance;
    coin.mesh.position.x = Math.cos(coin.angle) * coin.distance;
  }
};

CoinsHolder.prototype.rotateCoins = function () {
  for (var i = 0; i < this.coinsInUse.length; i++) {
    var coin = this.coinsInUse[i];
    if (coin.exploding) continue;
    coin.angle += game.speed * deltaTime * game.coinsSpeed;
    if (coin.angle > Math.PI * 2) coin.angle -= Math.PI * 2;
    coin.mesh.position.y =
      -game.seaRadius + Math.sin(coin.angle) * coin.distance;
    coin.mesh.position.x = Math.cos(coin.angle) * coin.distance;
    coin.mesh.rotation.z += Math.random() * 0.1;
    coin.mesh.rotation.y += Math.random() * 0.1;

    //var globalCoinPosition =  coin.mesh.localToWorld(new THREE.Vector3());
    var diffPos = airplane.mesh.position
      .clone()
      .sub(coin.mesh.position.clone());
    var d = diffPos.length();
    if (d < game.coinDistanceTolerance) {
      this.coinsPool.unshift(this.coinsInUse.splice(i, 1)[0]);
      this.mesh.remove(coin.mesh);
      particlesHolder.spawnParticles(
        coin.mesh.position.clone(),
        5,
        0x009999,
        0.8
      );
      addEnergy();
      i--;
    } else if (coin.angle > Math.PI) {
      this.coinsPool.unshift(this.coinsInUse.splice(i, 1)[0]);
      this.mesh.remove(coin.mesh);
      i--;
    }
  }
};

// ---- Additional Pickups: Ammo, Shield, Boost ----
function Pickup(kind) {
  this.kind = kind;
  this.angle = 0;
  this.distance = 0;
  this.mesh = new THREE.Object3D();
  if (kind === "ammo") {
    var mat = new THREE.MeshPhongMaterial({ color: 0x0a0a0f, shininess: 12 });
    var body = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 8, 10), mat);
    var nose = new THREE.Mesh(new THREE.CylinderGeometry(0, 1.3, 2.2, 10), mat);
    nose.position.y = 5.1;
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.1), mat);
    fin.position.y = -3.2;
    this.mesh.add(body);
    this.mesh.add(nose);
    for (var i = 0; i < 3; i++) {
      var f = fin.clone();
      f.rotation.y = (i * Math.PI * 2) / 3;
      this.mesh.add(f);
    }
  } else if (kind === "shield") {
    var tor = new THREE.Mesh(
      new THREE.TorusGeometry(5.2, 1.4, 8, 16),
      new THREE.MeshPhongMaterial({
        color: 0x4fb1ff,
        emissive: 0x163d66,
        shininess: 80,
      })
    );
    var orb = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 10, 8),
      new THREE.MeshPhongMaterial({
        color: 0x9bd1ff,
        transparent: true,
        opacity: 0.7,
      })
    );
    this.mesh.add(tor);
    this.mesh.add(orb);
  } else {
    // boost
    var star = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4, 0),
      new THREE.MeshPhongMaterial({
        color: 0xffb86c,
        emissive: 0x8a4f0f,
        shininess: 60,
      })
    );
    this.mesh.add(star);
  }
}

function PickupsHolder() {
  this.mesh = new THREE.Object3D();
  this.inUse = [];
  this.lastSpawn = 0;
  this.every = 100;
}
PickupsHolder.prototype.reset = function () {
  for (var i = this.inUse.length - 1; i >= 0; i--) {
    this.mesh.remove(this.inUse[i].mesh);
  }
  this.inUse = [];
  this.lastSpawn = 0;
};
PickupsHolder.prototype.spawn = function () {
  var kinds = ["ammo", "shield", "boost"];
  var kind = kinds[Math.floor(Math.random() * kinds.length)];
  var p = new Pickup(kind);
  p.angle = -Math.random() * 0.2 - 0.05; // ahead
  p.distance =
    game.seaRadius +
    game.planeDefaultHeight +
    (-1 + Math.random() * 2) * (game.planeAmpHeight - 20);
  p.mesh.position.y = -game.seaRadius + Math.sin(p.angle) * p.distance;
  p.mesh.position.x = Math.cos(p.angle) * p.distance;
  this.mesh.add(p.mesh);
  this.inUse.push(p);
};
PickupsHolder.prototype.update = function () {
  if (
    Math.floor(game.distance) % this.every === 0 &&
    Math.floor(game.distance) > this.lastSpawn
  ) {
    this.lastSpawn = Math.floor(game.distance);
    if (Math.random() < 0.5) this.spawn();
  }
  for (var i = this.inUse.length - 1; i >= 0; i--) {
    var p = this.inUse[i];
    p.angle += game.speed * deltaTime * 0.5;
    if (p.angle > Math.PI * 2) p.angle -= Math.PI * 2;
    p.mesh.position.y = -game.seaRadius + Math.sin(p.angle) * p.distance;
    p.mesh.position.x = Math.cos(p.angle) * p.distance;
    var d = airplane.mesh.position.distanceTo(p.mesh.position);
    if (d < 13) {
      // collect
      if (p.kind === "ammo") {
        ammo += 8;
        if (typeof updateAmmoBadge === "function") updateAmmoBadge();
      } else if (p.kind === "shield") {
        shield.charges = (shield.charges || 0) + 1;
        if (typeof updateShieldBadge === "function") updateShieldBadge();
      } else {
        boost.active = true;
        boost.fireBonus = true;
        boost.expires = Date.now() + 6000;
      }
      particlesHolder.spawnParticles(
        p.mesh.position.clone(),
        8,
        p.kind === "shield"
          ? 0x4fb1ff
          : p.kind === "boost"
          ? 0xffb86c
          : 0x0a0a0f,
        1.2
      );
      this.mesh.remove(p.mesh);
      this.inUse.splice(i, 1);
    } else if (p.angle > Math.PI) {
      this.mesh.remove(p.mesh);
      this.inUse.splice(i, 1);
    }
  }
};

// ---- Enemy Drones ----
function Drone() {
  this.mesh = new THREE.Object3D();
  this.angle = -Math.random() * 0.2 - 0.1;
  this.distance = game.seaRadius + game.planeDefaultHeight;
  this.shootCD = 1200 + Math.random() * 600;
  this.lastShot = 0;
  var body = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 4, 18, 12),
    new THREE.MeshPhongMaterial({ color: 0x2a2f3b, shading: THREE.FlatShading })
  );
  body.rotation.z = Math.PI / 2;
  var wing = new THREE.Mesh(
    new THREE.BoxGeometry(2, 18, 1),
    new THREE.MeshPhongMaterial({ color: 0x0b0b10 })
  );
  wing.position.set(0, 0, 3);
  var wing2 = wing.clone();
  wing2.position.z = -3;
  var nose = new THREE.Mesh(
    new THREE.CylinderGeometry(0, 4, 6, 12),
    new THREE.MeshPhongMaterial({ color: 0x0b0b10 })
  );
  nose.rotation.z = Math.PI / 2;
  nose.position.x = 10;
  this.mesh.add(body);
  this.mesh.add(wing);
  this.mesh.add(wing2);
  this.mesh.add(nose);
}

function DronesHolder() {
  this.mesh = new THREE.Object3D();
  this.dronesInUse = [];
  this.lastSpawn = 0;
  this.every = 320;
}
DronesHolder.prototype.reset = function () {
  for (var i = this.dronesInUse.length - 1; i >= 0; i--) {
    this.mesh.remove(this.dronesInUse[i].mesh);
  }
  this.dronesInUse = [];
  this.lastSpawn = 0;
};
DronesHolder.prototype.spawn = function () {
  var d = new Drone();
  d.mesh.position.y = -game.seaRadius + Math.sin(d.angle) * d.distance;
  d.mesh.position.x = Math.cos(d.angle) * d.distance;
  this.mesh.add(d.mesh);
  this.dronesInUse.push(d);
};
DronesHolder.prototype.removeAt = function (idx) {
  var d = this.dronesInUse.splice(idx, 1)[0];
  if (d) {
    this.mesh.remove(d.mesh);
  }
};
DronesHolder.prototype.update = function (dt) {
  if (
    Math.floor(game.distance) % this.every === 0 &&
    Math.floor(game.distance) > this.lastSpawn
  ) {
    this.lastSpawn = Math.floor(game.distance);
    if (Math.random() < 0.6) this.spawn();
  }
  var now = Date.now();
  var playerAngle = Math.atan2(
    airplane.mesh.position.y + game.seaRadius,
    airplane.mesh.position.x
  );
  for (var i = this.dronesInUse.length - 1; i >= 0; i--) {
    var d = this.dronesInUse[i];
    // steer angle slightly toward player
    var diff = playerAngle - d.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    d.angle += diff * 0.002 * dt;
    d.angle += game.speed * dt * 0.0009;
    d.mesh.position.y = -game.seaRadius + Math.sin(d.angle) * d.distance;
    d.mesh.position.x = Math.cos(d.angle) * d.distance;
    // shoot toward player
    if (now - d.lastShot > d.shootCD) {
      d.lastShot = now;
      d.shootCD = 900 + Math.random() * 900;
      var dir = new THREE.Vector3()
        .subVectors(airplane.mesh.position, d.mesh.position)
        .normalize();
      var b = new THREE.Mesh(
        new THREE.SphereGeometry(1.8, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe84545 })
      );
      b.position.copy(d.mesh.position);
      scene.add(b);
      enemyBullets.push({ mesh: b, vel: dir.multiplyScalar(0.35), life: 4000 });
    }
    // collision with player
    var dist = d.mesh.position.distanceTo(airplane.mesh.position);
    if (dist < game.ennemyDistanceTolerance) {
      if (shield.active && shield.hitsLeft > 0) {
        shield.hitsLeft--;
        if (typeof updateShieldBadge === "function") updateShieldBadge();
        particlesHolder.spawnParticles(
          d.mesh.position.clone(),
          12,
          Colors.blue,
          2
        );
        if (shield.hitsLeft <= 0) deactivateShield();
      } else {
        removeEnergy();
      }
      this.removeAt(i);
    }
    // cull when behind
    if (d.angle > Math.PI) {
      this.removeAt(i);
    }
  }
};

function updateEnemyBullets() {
  for (var i = enemyBullets.length - 1; i >= 0; i--) {
    var eb = enemyBullets[i];
    eb.life -= deltaTime;
    eb.mesh.position.addScaledVector(eb.vel, deltaTime);
    if (airplane && airplane.mesh) {
      var d = eb.mesh.position.distanceTo(airplane.mesh.position);
      if (d < 10) {
        if (shield.active && shield.hitsLeft > 0) {
          shield.hitsLeft--;
          if (typeof updateShieldBadge === "function") updateShieldBadge();
          if (shield.hitsLeft <= 0) deactivateShield();
        } else {
          removeEnergy();
        }
        scene.remove(eb.mesh);
        enemyBullets.splice(i, 1);
        continue;
      }
    }
    if (eb.life <= 0) {
      scene.remove(eb.mesh);
      enemyBullets.splice(i, 1);
    }
  }
}

// ---- Moving Obstacles ----
function RotatingMinefield() {
  this.mesh = new THREE.Object3D();
  this.angle = -0.1;
  this.distance = game.seaRadius + game.planeDefaultHeight;
  this.rot = Math.random() * Math.PI * 2;
  this.ring = 28 + Math.random() * 12;
  this.count = 10 + Math.floor(Math.random() * 8);
  for (var i = 0; i < this.count; i++) {
    var mine = new Ennemy();
    mine.mesh.scale.set(0.8, 0.8, 0.8);
    var a = (i / this.count) * Math.PI * 2;
    mine.mesh.position.set(Math.cos(a) * this.ring, Math.sin(a) * this.ring, 0);
    this.mesh.add(mine.mesh);
  }
}
RotatingMinefield.prototype.update = function (dt) {
  this.rot += dt * 0.001;
  for (var i = 0; i < this.mesh.children.length; i++) {
    var m = this.mesh.children[i];
    var a = (i / this.mesh.children.length) * Math.PI * 2 + this.rot;
    m.position.x = Math.cos(a) * this.ring;
    m.position.y = Math.sin(a) * this.ring;
  }
};

function FallingDebris() {
  this.mesh = new THREE.Object3D();
  this.angle = -0.08;
  this.distance = game.seaRadius + game.planeDefaultHeight;
  this.vy = -0.08 - Math.random() * 0.05;
  for (var i = 0; i < 6; i++) {
    var c = new THREE.Mesh(
      new THREE.BoxGeometry(6, 6, 6),
      new THREE.MeshPhongMaterial({ color: 0x2b2f3a })
    );
    c.position.set(
      (Math.random() * 2 - 1) * 30,
      60 + Math.random() * 20,
      (Math.random() * 2 - 1) * 10
    );
    this.mesh.add(c);
  }
}
FallingDebris.prototype.update = function (dt) {
  for (var i = 0; i < this.mesh.children.length; i++) {
    this.mesh.children[i].position.y += this.vy * dt;
  }
};

function LaserGrid() {
  this.mesh = new THREE.Object3D();
  this.angle = -0.12;
  this.distance = game.seaRadius + game.planeDefaultHeight;
  this.phase = 0;
  this.width = 50;
  for (var i = -2; i <= 2; i++) {
    var bar = new THREE.Mesh(
      new THREE.BoxGeometry(2, 30, 2),
      new THREE.MeshPhongMaterial({ color: 0xe84545, emissive: 0x4a1414 })
    );
    bar.position.set(i * 12, 0, 0);
    this.mesh.add(bar);
  }
}
LaserGrid.prototype.update = function (dt) {
  this.phase += dt * 0.002;
  var offset = Math.sin(this.phase) * 15;
  for (var i = 0; i < this.mesh.children.length; i++) {
    this.mesh.children[i].position.y = (i % 2 === 0 ? 1 : -1) * offset;
  }
};

function ObstaclesHolder() {
  this.mesh = new THREE.Object3D();
  this.list = [];
  this.lastSpawn = 0;
  this.every = 360;
}
ObstaclesHolder.prototype.reset = function () {
  for (var i = this.list.length - 1; i >= 0; i--) {
    this.mesh.remove(this.list[i].mesh);
  }
  this.list = [];
  this.lastSpawn = 0;
};
ObstaclesHolder.prototype.spawn = function () {
  var t = Math.random();
  var o = null;
  if (t < 0.34) o = new RotatingMinefield();
  else if (t < 0.68) o = new FallingDebris();
  else o = new LaserGrid();
  var a = -0.08 - Math.random() * 0.12;
  o.angle = a;
  o.mesh.position.y =
    -game.seaRadius +
    Math.sin(o.angle) * (game.seaRadius + game.planeDefaultHeight);
  o.mesh.position.x =
    Math.cos(o.angle) * (game.seaRadius + game.planeDefaultHeight);
  this.mesh.add(o.mesh);
  this.list.push(o);
};
ObstaclesHolder.prototype.update = function (dt) {
  var gate = Math.max(1, Math.floor(game.level / 2));
  if (
    Math.floor(game.distance) % Math.max(200, this.every - game.level * 6) ===
      0 &&
    Math.floor(game.distance) > this.lastSpawn
  ) {
    this.lastSpawn = Math.floor(game.distance);
    if (Math.random() < 0.5) this.spawn();
  }
  var playerPos = airplane.mesh.position;
  for (var i = this.list.length - 1; i >= 0; i--) {
    var o = this.list[i];
    o.angle += game.speed * dt * 0.0008;
    if (o.angle > Math.PI * 2) o.angle -= Math.PI * 2;
    o.mesh.position.y =
      -game.seaRadius +
      Math.sin(o.angle) * (game.seaRadius + game.planeDefaultHeight);
    o.mesh.position.x =
      Math.cos(o.angle) * (game.seaRadius + game.planeDefaultHeight);
    if (o.update) o.update(dt);
    // check collisions roughly against each child
    for (var c = 0; c < o.mesh.children.length; c++) {
      var child = o.mesh.children[c];
      if (child && child.getWorldPosition) {
        var w = child.getWorldPosition(new THREE.Vector3());
        var d = w.distanceTo(playerPos);
        if (d < 14) {
          if (shield.active && shield.hitsLeft > 0) {
            shield.hitsLeft--;
            if (typeof updateShieldBadge === "function") updateShieldBadge();
            if (shield.hitsLeft <= 0) deactivateShield();
          } else {
            removeEnergy();
          }
          this.mesh.remove(o.mesh);
          this.list.splice(i, 1);
          break;
        }
      }
    }
    if (o.angle > Math.PI) {
      this.mesh.remove(o.mesh);
      this.list.splice(i, 1);
    }
  }
};

// 3D Models
var sea;
var airplane;
var skyDome;
var celestials;
var sunMesh;
var moonMesh;

function createPlane() {
  airplane = new AirPlane();
  airplane.mesh.scale.set(0.25, 0.25, 0.25);
  airplane.mesh.position.y = game.planeDefaultHeight;
  scene.add(airplane.mesh);
  // Create shield visual as a child of the plane
  var sGeo = new THREE.SphereGeometry(70, 16, 12);
  var sMat = new THREE.MeshPhongMaterial({
    color: 0x4fb1ff,
    transparent: true,
    opacity: 0.18,
    shininess: 100,
  });
  var sMesh = new THREE.Mesh(sGeo, sMat);
  sMesh.visible = false;
  airplane.mesh.add(sMesh);
  shield.mesh = sMesh;
}

function createSea() {
  sea = new Sea();
  sea.mesh.position.y = -game.seaRadius;
  scene.add(sea.mesh);
}

function createSky() {
  sky = new Sky();
  sky.mesh.position.y = -game.seaRadius;
  scene.add(sky.mesh);
  createCelestials();
}

function createCelestials() {
  // Sky dome
  var domeGeo = new THREE.SphereGeometry(5000, 24, 16);
  var domeMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.BackSide,
  });
  skyDome = new THREE.Mesh(domeGeo, domeMat);
  scene.add(skyDome);

  // Celestials group follows the plane each update via positions we compute
  celestials = new THREE.Group();

  var sunGeo = new THREE.SphereGeometry(30, 16, 12);
  var sunMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  sunMesh = new THREE.Mesh(sunGeo, sunMat);
  celestials.add(sunMesh);

  var moonGeo = new THREE.SphereGeometry(22, 16, 12);
  var moonMat = new THREE.MeshBasicMaterial({ color: 0xdde2ff });
  moonMesh = new THREE.Mesh(moonGeo, moonMat);
  celestials.add(moonMesh);

  scene.add(celestials);
}

function createCoins() {
  coinsHolder = new CoinsHolder(20);
  scene.add(coinsHolder.mesh);
}

function createPickups() {
  pickupsHolder = new PickupsHolder();
  scene.add(pickupsHolder.mesh);
}
function createDrones() {
  dronesHolder = new DronesHolder();
  scene.add(dronesHolder.mesh);
}
function createObstacles() {
  obstaclesHolder = new ObstaclesHolder();
  scene.add(obstaclesHolder.mesh);
}

function createEnnemies() {
  for (var i = 0; i < 10; i++) {
    var ennemy = new Ennemy();
    ennemiesPool.push(ennemy);
  }
  ennemiesHolder = new EnnemiesHolder();
  //ennemiesHolder.mesh.position.y = -game.seaRadius;
  scene.add(ennemiesHolder.mesh);
}

function createParticles() {
  for (var i = 0; i < 10; i++) {
    var particle = new Particle();
    particlesPool.push(particle);
  }
  particlesHolder = new ParticlesHolder();
  //ennemiesHolder.mesh.position.y = -game.seaRadius;
  scene.add(particlesHolder.mesh);
}

function loop() {
  newTime = new Date().getTime();
  deltaTime = newTime - oldTime;
  oldTime = newTime;

  if (paused) {
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
    return;
  }

  if (game.status == "playing") {
    // Input mode: buttons moves a virtual cursor
    if (controlMode === "buttons") {
      var dx = (inputState.right ? 1 : 0) - (inputState.left ? 1 : 0);
      var dy = (inputState.up ? 1 : 0) - (inputState.down ? 1 : 0);
      virtualMousePos.x = Math.max(
        -1,
        Math.min(1, virtualMousePos.x + dx * 0.02)
      );
      virtualMousePos.y = Math.max(
        -1,
        Math.min(1, virtualMousePos.y + dy * 0.02)
      );
      mousePos = { x: virtualMousePos.x, y: virtualMousePos.y };
      if (inputState.fire && newTime - lastShotTime > fireCooldown)
        fireBullet();
    }
    // Add energy coins every 100m;
    if (
      Math.floor(game.distance) % game.distanceForCoinsSpawn == 0 &&
      Math.floor(game.distance) > game.coinLastSpawn
    ) {
      game.coinLastSpawn = Math.floor(game.distance);
      coinsHolder.spawnCoins();
    }

    if (
      Math.floor(game.distance) % game.distanceForSpeedUpdate == 0 &&
      Math.floor(game.distance) > game.speedLastUpdate
    ) {
      game.speedLastUpdate = Math.floor(game.distance);
      game.targetBaseSpeed += game.incrementSpeedByTime * deltaTime;
    }

    if (
      Math.floor(game.distance) % game.distanceForEnnemiesSpawn == 0 &&
      Math.floor(game.distance) > game.ennemyLastSpawn
    ) {
      game.ennemyLastSpawn = Math.floor(game.distance);
      ennemiesHolder.spawnEnnemies();
    }

    if (
      Math.floor(game.distance) % game.distanceForLevelUpdate == 0 &&
      Math.floor(game.distance) > game.levelLastUpdate
    ) {
      game.levelLastUpdate = Math.floor(game.distance);
      game.level++;
      fieldLevel.innerHTML = Math.floor(game.level);
      // Award ammo and shield charges for each level passed
      ammo = (ammo || 0) + 10;
      if (typeof updateAmmoBadge === "function") updateAmmoBadge();
      shield.charges = (shield.charges || 0) + 1;
      if (typeof updateShieldBadge === "function") updateShieldBadge();

      game.targetBaseSpeed =
        game.initSpeed + game.incrementSpeedByLevel * game.level;
    }

    updatePlane();
    updateDistance();
    updateEnergy();
    game.baseSpeed +=
      (game.targetBaseSpeed - game.baseSpeed) * deltaTime * 0.02;
    game.speed = game.baseSpeed * game.planeSpeed;
  } else if (game.status == "gameover") {
    game.speed *= 0.99;
    airplane.mesh.rotation.z +=
      (-Math.PI / 2 - airplane.mesh.rotation.z) * 0.0002 * deltaTime;
    airplane.mesh.rotation.x += 0.0003 * deltaTime;
    game.planeFallSpeed *= 1.05;
    airplane.mesh.position.y -= game.planeFallSpeed * deltaTime;

    if (airplane.mesh.position.y < -200) {
      showReplay();
      game.status = "waitingReplay";
    }
  } else if (game.status == "waitingReplay") {
  }

  airplane.propeller.rotation.x += 0.2 + game.planeSpeed * deltaTime * 0.005;
  sea.mesh.rotation.z += game.speed * deltaTime; //*game.seaRotationSpeed;

  if (sea.mesh.rotation.z > 2 * Math.PI) sea.mesh.rotation.z -= 2 * Math.PI;

  ambientLight.intensity += (0.5 - ambientLight.intensity) * deltaTime * 0.005;

  coinsHolder.rotateCoins();
  ennemiesHolder.rotateEnnemies();

  sky.moveClouds();
  sea.moveWaves();
  updateDayNightCycle();
  updateBullets();
  if (pickupsHolder) pickupsHolder.update();
  if (dronesHolder) dronesHolder.update(deltaTime);
  if (obstaclesHolder) obstaclesHolder.update(deltaTime);
  updateEnemyBullets();
  if (shield.active && Date.now() > shield.expires) deactivateShield();
  if (boost.active && Date.now() > boost.expires) {
    boost.active = false;
    boost.fireBonus = false;
  }
  if (audioReady && audioEngine) audioEngine.update();

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function updateDistance() {
  game.distance += game.speed * deltaTime * game.ratioSpeedDistance;
  fieldDistance.innerHTML = Math.floor(game.distance);
  var d =
    502 *
    (1 -
      (game.distance % game.distanceForLevelUpdate) /
        game.distanceForLevelUpdate);
  levelCircle.setAttribute("stroke-dashoffset", d);
}

var blinkEnergy = false;

function updateEnergy() {
  // Drain at a fixed rate: 10% per 20 seconds => 0.5 energy per second
  var drain = (deltaTime / 1000) * 3.5; // 3.5% per second
  game.energy -= drain;
  game.energy = Math.max(0, Math.min(game.energy, 100));

  // Update bar width directly (fill element has id="energyBar")
  if (energyBar && energyBar.style) {
    energyBar.style.width = game.energy + "%";
    energyBar.style.background =
      game.energy < 25
        ? "#E84545"
        : game.energy < 50
        ? "#FFB86C"
        : "linear-gradient(90deg, #68c3c0, #4fb1ff)";
    energyBar.style.animationName = game.energy < 30 ? "blinking" : "none";
  }

  if (game.energy <= 0) {
    game.status = "gameover";
  }
}

function addEnergy() {
  game.energy += game.coinValue;
  game.energy = Math.min(game.energy, 100);
}

function removeEnergy() {
  game.energy -= game.ennemyValue;
  game.energy = Math.max(0, game.energy);
}

function updatePlane() {
  // Keep forward speed constant across devices
  game.planeSpeed = CONSTANT_PLANE_SPEED;
  var targetY = normalize(
    mousePos.y,
    -0.75,
    0.75,
    game.planeDefaultHeight - game.planeAmpHeight,
    game.planeDefaultHeight + game.planeAmpHeight
  );
  var targetX = normalize(
    mousePos.x,
    -1,
    1,
    -game.planeAmpWidth * 0.7,
    -game.planeAmpWidth
  );

  game.planeCollisionDisplacementX += game.planeCollisionSpeedX;
  targetX += game.planeCollisionDisplacementX;

  game.planeCollisionDisplacementY += game.planeCollisionSpeedY;
  targetY += game.planeCollisionDisplacementY;

  airplane.mesh.position.y +=
    (targetY - airplane.mesh.position.y) * deltaTime * game.planeMoveSensivity;
  airplane.mesh.position.x +=
    (targetX - airplane.mesh.position.x) * deltaTime * game.planeMoveSensivity;

  airplane.mesh.rotation.z =
    (targetY - airplane.mesh.position.y) * deltaTime * game.planeRotXSensivity;
  airplane.mesh.rotation.x =
    (airplane.mesh.position.y - targetY) * deltaTime * game.planeRotZSensivity;
  var targetCameraZ = normalize(
    game.planeSpeed,
    game.planeMinSpeed,
    game.planeMaxSpeed,
    game.cameraNearPos,
    game.cameraFarPos
  );
  // Keep camera stable for a consistent, comfortable view
  camera.position.y = IS_MOBILE ? MOBILE_CAMERA_Y : CAMERA_Y;

  game.planeCollisionSpeedX +=
    (0 - game.planeCollisionSpeedX) * deltaTime * 0.03;
  game.planeCollisionDisplacementX +=
    (0 - game.planeCollisionDisplacementX) * deltaTime * 0.01;
  game.planeCollisionSpeedY +=
    (0 - game.planeCollisionSpeedY) * deltaTime * 0.03;
  game.planeCollisionDisplacementY +=
    (0 - game.planeCollisionDisplacementY) * deltaTime * 0.01;

  airplane.pilot.updateHairs();
}

function showReplay() {
  replayMessage.style.display = "block";
}

function hideReplay() {
  replayMessage.style.display = "none";
}

function normalize(v, vmin, vmax, tmin, tmax) {
  var nv = Math.max(Math.min(v, vmax), vmin);
  var dv = vmax - vmin;
  var pc = (nv - vmin) / dv;
  var dt = tmax - tmin;
  var tv = tmin + pc * dt;
  return tv;
}

// --- Injected UI, audio, and gameplay helpers ---
function injectEnhancedUI() {
  // Styles override and new UI
  if (document.getElementById("enhancedStyles")) return;
  var style = document.createElement("style");
  style.id = "enhancedStyles";
  style.textContent =
    "\n.game-holder{background:linear-gradient(180deg,#0d1422 0%,#0e2038 55%,#132a46 100%);}\n.pause-overlay{position:fixed;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);z-index:50;opacity:0;pointer-events:none;transition:opacity .2s ease;}\n.pause-overlay.show{opacity:1;pointer-events:auto;}\n.pause-overlay .panel{width:min(92vw,560px);background:rgba(18,28,45,.9);color:#e6f0ff;border:1px solid rgba(255,255,255,.08);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:18px;}\n.pause-overlay .panel h2{margin:6px 0 10px;font:600 22px/1.2 Inter,system-ui,sans-serif;}\n.pause-overlay .panel .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0;}\n.pause-overlay .panel label{font-size:13px;color:#b8c7e0;}\n.btn-ui{appearance:none;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#e6f0ff;border-radius:10px;padding:8px 12px;cursor:pointer}.btn-ui:hover{border-color:rgba(255,255,255,.25)}\n.controls-overlay{position:fixed;right:12px;bottom:12px;z-index:40;display:flex;flex-direction:column;gap:8px;align-items:center}.controls-overlay.hidden{display:none}\n.controls-overlay .row{display:flex;gap:8px}\n.ctrl-btn{width:48px;height:48px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#e6f0ff;font-size:18px;cursor:pointer}.ctrl-btn.small{width:auto;height:auto;padding:6px 10px;font-size:12px}.ctrl-btn:active{transform:scale(.98)}\n.ammo-badge{position:fixed;left:12px;bottom:12px;background:rgba(0,0,0,.35);color:#e6f0ff;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:6px 10px;font:600 13px Inter,system-ui,sans-serif;z-index:40}\n/* Mobile power overlay */\n.power-overlay{position:fixed;right:12px;left:auto;bottom:12px;z-index:41;display:none;gap:8px}\n.power-btn{width:58px;height:58px;border-radius:14px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e6f0ff;display:grid;place-items:center;box-shadow:0 8px 16px rgba(0,0,0,.25)}\n.power-btn:active{transform:scale(.98)}\n.power-btn.ammo svg{width:28px;height:28px}\n.power-btn.shield svg{width:30px;height:30px}\n@media (max-width:720px){.power-overlay{display:flex}.controls-overlay{right:12px;bottom:88px}.start-menu.mobile .hero h1{font-size:24px}.start-menu.mobile .grid{grid-template-columns:1fr}.start-menu.mobile .cta{justify-content:center}}\n";
  document.head.appendChild(style);

  // Pause overlay
  var overlay = document.createElement("div");
  overlay.id = "pauseOverlayEnhanced";
  overlay.className = "pause-overlay";
  overlay.innerHTML =
    "" +
    '<div class="panel">' +
    " <h2>Paused</h2>" +
    ' <div class="row"><label>Controls:</label>' +
    '   <label><input type="radio" name="ctrlMode" value="mouse" checked> Mouse</label>' +
    '   <label><input type="radio" name="ctrlMode" value="buttons"> On-screen buttons</label>' +
    " </div>" +
    ' <div class="row">' +
    '   <button id="resumeBtnEnhanced" class="btn-ui">Resume</button>' +
    '   <button id="restartBtnEnhanced" class="btn-ui">Restart</button>' +
    '   <button id="muteBtnEnhanced" class="btn-ui">Mute</button>' +
    " </div>" +
    ' <p style="margin:8px 0 0;color:#9fb0c9;font:500 12px Inter">F / Click to fire • P to pause</p>' +
    "</div>";
  document.body.appendChild(overlay);

  // Controls overlay
  var controls = document.createElement("div");
  controls.id = "controlsOverlay";
  controls.className = "controls-overlay hidden";
  controls.innerHTML =
    "" +
    '<button id="btnUp" class="ctrl-btn">���</button>' +
    '<div class="row">' +
    '  <button id="btnLeft" class="ctrl-btn">◀</button>' +
    '  <button id="btnFire" class="ctrl-btn">●</button>' +
    '  <button id="btnRight" class="ctrl-btn">▶</button>' +
    "</div>" +
    '<button id="btnDown" class="ctrl-btn">▼</button>' +
    '<button id="btnPause" class="ctrl-btn small">Pause</button>';
  document.body.appendChild(controls);

  // Ammo badge
  var ammoBadge = document.createElement("div");
  ammoBadge.className = "ammo-badge";
  ammoBadge.innerHTML = 'Ammo: <span id="ammoBadgeValue">' + ammo + "</span>";
  document.body.appendChild(ammoBadge);

  // Shield badge (above ammo)
  var shieldBadge = document.createElement("div");
  shieldBadge.className = "ammo-badge";
  shieldBadge.style.bottom = "58px";
  shieldBadge.innerHTML = 'Shield: <span id="shieldBadgeValue"></span>';
  document.body.appendChild(shieldBadge);

  // Mobile power overlay (bottom-left): Shield and Ammo (Fire)
  var power = document.createElement("div");
  power.id = "powerOverlay";
  power.className = "power-overlay";
  power.innerHTML =
    "" +
    '<button id="btnShieldBox" class="power-btn shield" aria-label="Shield">\n      <svg viewBox="0 0 64 64" fill="none">\n        <circle cx="32" cy="32" r="20" stroke="#4fb1ff" stroke-width="6"/>\n        <circle cx="32" cy="32" r="10" stroke="#9bd1ff" stroke-width="4" opacity="0.6"/>\n      </svg>\n    </button>';
  document.body.appendChild(power);

  // Wire overlay buttons
  document
    .getElementById("resumeBtnEnhanced")
    .addEventListener("click", function () {
      togglePause(false);
    });
  document
    .getElementById("restartBtnEnhanced")
    .addEventListener("click", function () {
      togglePause(false);
      resetGame();
    });
  document
    .getElementById("muteBtnEnhanced")
    .addEventListener("click", function () {
      muted = !muted;
      if (audioEngine) audioEngine.setMuted(muted);
      this.textContent = muted ? "Unmute" : "Mute";
    });
  var radios = overlay.querySelectorAll('input[name="ctrlMode"]');
  radios.forEach(function (r) {
    r.addEventListener("change", function () {
      setControlMode(this.value);
    });
  });

  // Controls buttons
  bindButtonHold("btnLeft", "left");
  bindButtonHold("btnRight", "right");
  bindButtonHold("btnUp", "up");
  bindButtonHold("btnDown", "down");
  bindButtonHold("btnFire", "fire");
  document.getElementById("btnPause").addEventListener("click", function () {
    togglePause(true);
  });

  // Power overlay buttons (mobile)
  var shieldBtn = document.getElementById("btnShieldBox");
  if (shieldBtn) {
    shieldBtn.addEventListener("click", function (e) {
      e.preventDefault();
      activateShield();
    });
  }

  // Mark start menu as mobile layout when on small screens and update content
  var sm = document.getElementById("startMenu");
  if (sm && IS_MOBILE) {
    sm.classList.add("mobile");
    try {
      var grid = sm.querySelector(".grid");
      if (grid) {
        // Append a Pickups section describing drops
        var col = document.createElement("div");
        col.className = "col";
        col.innerHTML =
          "<h3>Pickups</h3>" +
          '<ul class="list">' +
          "<li>Energy (blue lightning): refills energy</li>" +
          "<li>Ammo (black missile): +8 missiles</li>" +
          "<li>Shield (blue ring/orb): +1 shield charge</li>" +
          "<li>Boost (orange star): fast fire for 6s</li>" +
          "</ul>";
        grid.appendChild(col);
        // Replace controls description with touch-specific
        var heads = grid.querySelectorAll("h3");
        for (var i = 0; i < heads.length; i++) {
          if (
            (heads[i].textContent || "").toLowerCase().indexOf("controls") >= 0
          ) {
            var list = heads[i].parentNode.querySelector(".list");
            if (list) {
              list.innerHTML =
                "<li>Touch: Drag anywhere to steer</li><li>Tap anywhere to fire</li><li>Tap the Shield button to activate</li>";
            }
          }
        }
      }
      // Hide on-screen pad; touch controls are active by default
      var co = document.getElementById("controlsOverlay");
      if (co) co.style.display = "none";
    } catch (e) {}
  }
}

function updateAmmoBadge() {
  var el = document.getElementById("ammoBadgeValue");
  if (el) el.textContent = ammo;
}
function updateShieldBadge() {
  var el = document.getElementById("shieldBadgeValue");
  if (!el) return;
  if (shield && shield.active)
    el.textContent = "Active (" + shield.hitsLeft + ")";
  else el.textContent = "Charges: " + (shield ? shield.charges : 0);
}

function activateShield() {
  if (paused || !shield) return;
  if (shield.active) return;
  if ((shield.charges || 0) <= 0) return;
  shield.active = true;
  shield.hitsLeft = 5;
  shield.expires = Date.now() + 10000;
  shield.charges--;
  if (shield.mesh) {
    shield.mesh.visible = true;
    shield.mesh.scale.set(1.05, 1.05, 1.05);
  }
  updateShieldBadge();
}
function deactivateShield() {
  if (!shield || !shield.active) return;
  shield.active = false;
  shield.hitsLeft = 0;
  shield.expires = 0;
  if (shield.mesh) shield.mesh.visible = false;
  updateShieldBadge();
}

function setControlMode(mode) {
  controlMode = mode === "buttons" ? "buttons" : "mouse";
  updateControlOverlayVisibility();
}
function updateControlOverlayVisibility() {
  var el = document.getElementById("controlsOverlay");
  if (!el) return;
  if (controlMode === "buttons") el.classList.remove("hidden");
  else el.classList.add("hidden");
}

function bindButtonHold(id, key) {
  var el = document.getElementById(id);
  if (!el) return;
  var down = function (e) {
    e.preventDefault();
    inputState[key] = true;
    if (key === "fire") ensureAudio();
  };
  var up = function () {
    inputState[key] = false;
  };
  el.addEventListener("mousedown", down);
  el.addEventListener("touchstart", down);
  window.addEventListener("mouseup", up);
  window.addEventListener("touchend", up);
}

function togglePause(force) {
  var want = typeof force === "boolean" ? force : !paused;
  paused = want;
  var ov = document.getElementById("pauseOverlayEnhanced");
  if (ov) ov.classList.toggle("show", paused);
  if (audioEngine) audioEngine.setPaused(paused);
}

function handleKeyDown(e) {
  if (e.code === "KeyP") {
    togglePause();
  } else if (e.code === "KeyM") {
    muted = !muted;
    if (audioEngine) audioEngine.setMuted(muted);
  } else if (e.code === "KeyF") {
    ensureAudio();
    fireBullet();
  } else if (e.code === "KeyS") {
    activateShield();
  }
}
function handleFireClick() {
  if (controlMode === "mouse" && !paused && game.status === "playing") {
    ensureAudio();
    fireBullet();
  }
}

// Simple audio engine
function SimpleAudio() {
  var AC = window.AudioContext || window.webkitAudioContext;
  this.ctx = new AC();
  this.master = this.ctx.createGain();
  this.master.gain.value = 0.7;
  this.master.connect(this.ctx.destination);
  this.isMuted = false;
  this.engine = this.ctx.createOscillator();
  this.engine.type = "sawtooth";
  this.engine.frequency.value = 70;
  this.engGain = this.ctx.createGain();
  this.engGain.gain.value = 0.15;
  this.engine.connect(this.engGain);
  this.engGain.connect(this.master);
  this.wind = this._noise();
  this.windGain = this.ctx.createGain();
  this.windGain.gain.value = 0.12;
  this.wind.connect(this.windGain);
  this.windGain.connect(this.master);
  // Optional external loops
  this.planeLoopGain = this.ctx.createGain();
  this.planeLoopGain.gain.value = 0.0;
  this.planeLoopGain.connect(this.master);
  this.waterLoopGain = this.ctx.createGain();
  this.waterLoopGain.gain.value = 0.0;
  this.waterLoopGain.connect(this.master);
  this._tryLoadLoop("plane", [
    "airplane_background",
    "plane_background",
    "engine_loop",
  ]);
  this._tryLoadLoop("water", ["water_ambient", "ocean_ambient", "waves"]);
  this.engine.start();
}
SimpleAudio.prototype._noise = function () {
  var b = this.ctx.createBuffer(
    1,
    this.ctx.sampleRate * 1.5,
    this.ctx.sampleRate
  );
  var d = b.getChannelData(0);
  for (var i = 0; i < d.length; i++) {
    d[i] = (Math.random() * 2 - 1) * 0.4 + (d[i - 1] || 0) * 0.95;
  }
  var s = this.ctx.createBufferSource();
  s.buffer = b;
  s.loop = true;
  s.start();
  return s;
};
SimpleAudio.prototype.update = function () {
  if (!this.ctx || this.isMuted) return;
  var sp = game ? game.baseSpeed * 1200 : 100;
  try {
    this.engine.frequency.setTargetAtTime(
      60 + sp * 0.2,
      this.ctx.currentTime,
      0.05
    );
    this.engGain.gain.setTargetAtTime(
      0.08 + Math.min(sp / 600, 0.5),
      this.ctx.currentTime,
      0.1
    );
    this.windGain.gain.setTargetAtTime(
      0.08 + Math.min(sp / 800, 0.4),
      this.ctx.currentTime,
      0.1
    );
    // External loop levels
    if (this.planeLoopGain) {
      var pVol = 0.06 + Math.min(sp / 600, 0.35);
      this.planeLoopGain.gain.setTargetAtTime(pVol, this.ctx.currentTime, 0.2);
    }
    if (this.waterLoopGain) {
      var wVol = 0.03 + Math.min(sp / 1000, 0.15);
      this.waterLoopGain.gain.setTargetAtTime(wVol, this.ctx.currentTime, 0.25);
    }
  } catch (e) {}
};
SimpleAudio.prototype.setMuted = function (m) {
  this.isMuted = !!m;
  this.master.gain.value = this.isMuted ? 0 : 0.7;
  try {
    if (this.planeEl) this.planeEl.muted = this.isMuted;
  } catch (e) {}
  try {
    if (this.waterEl) this.waterEl.muted = this.isMuted;
  } catch (e) {}
};
SimpleAudio.prototype.setPaused = function (p) {
  if (!this.ctx) return;
  if (p && this.ctx.state === "running") this.ctx.suspend();
  if (!p && this.ctx.state === "suspended") this.ctx.resume();
  try {
    if (this.planeEl)
      p ? this.planeEl.pause() : this.planeEl.play().catch(function () {});
  } catch (e) {}
  try {
    if (this.waterEl)
      p ? this.waterEl.pause() : this.waterEl.play().catch(function () {});
  } catch (e) {}
};
SimpleAudio.prototype.shot = function () {
  if (!this.ctx || this.isMuted) return;
  var o = this.ctx.createOscillator(),
    g = this.ctx.createGain();
  o.type = "square";
  o.frequency.value = 400;
  g.gain.value = 0.0;
  o.connect(g);
  g.connect(this.master);
  var t = this.ctx.currentTime;
  g.gain.setValueAtTime(0.0, t);
  g.gain.linearRampToValueAtTime(0.4, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.start(t);
  o.stop(t + 0.15);
};
SimpleAudio.prototype.explosion = function () {
  if (!this.ctx || this.isMuted) return;
  var b = this.ctx.createBuffer(
      1,
      this.ctx.sampleRate * 0.4,
      this.ctx.sampleRate
    ),
    d = b.getChannelData(0);
  for (var i = 0; i < d.length; i++) {
    d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  var s = this.ctx.createBufferSource();
  s.buffer = b;
  var g = this.ctx.createGain();
  g.gain.value = 0.0;
  s.connect(g);
  g.connect(this.master);
  var t = this.ctx.currentTime;
  g.gain.setValueAtTime(0.0, t);
  g.gain.linearRampToValueAtTime(0.9, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  s.start(t);
  s.stop(t + 0.5);
};

// Try to load and start a looped audio file by candidate names and common extensions
SimpleAudio.prototype._tryLoadLoop = function (key, names) {
  var self = this;
  var exts = [".mp3", ".ogg", ".wav"];
  // If running from file://, use HTMLAudioElement fallback to avoid CORS on fetch
  if (location.protocol === "file:") {
    this._loadLoopViaElement(key, names, exts);
    return;
  }
  function tryNext(i, j) {
    if (i >= names.length) return;
    var url = "../sounds/" + names[i] + exts[j];
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw 0;
        return r.arrayBuffer();
      })
      .then(function (ab) {
        self.ctx.decodeAudioData(
          ab,
          function (buf) {
            var src = self.ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            var g = key === "plane" ? self.planeLoopGain : self.waterLoopGain;
            src.connect(g);
            try {
              src.start(0);
            } catch (e) {
              src.noteOn(0);
            }
          },
          function () {
            if (j + 1 < exts.length) tryNext(i, j + 1);
            else tryNext(i + 1, 0);
          }
        );
      })
      .catch(function () {
        if (j + 1 < exts.length) tryNext(i, j + 1);
        else tryNext(i + 1, 0);
      });
  }
  tryNext(0, 0);
};

// Fallback loader using <audio> element to avoid fetch() CORS issues on file://
SimpleAudio.prototype._loadLoopViaElement = function (key, names, exts) {
  var self = this;
  function tryNext(i, j) {
    if (i >= names.length) return;
    var url = "sounds/" + names[i] + exts[j];
    var el = document.createElement("audio");
    el.preload = "auto";
    el.loop = true;
    el.src = url;
    el.crossOrigin = "anonymous";
    el.addEventListener("canplaythrough", function onok() {
      el.removeEventListener("canplaythrough", onok);
      try {
        var node = self.ctx.createMediaElementSource(el);
        var g = key === "plane" ? self.planeLoopGain : self.waterLoopGain;
        node.connect(g);
        if (key === "plane") self.planeEl = el;
        else self.waterEl = el;
        el.muted = !!self.isMuted;
        el.play().catch(function () {});
      } catch (e) {}
    });
    el.addEventListener("error", function () {
      if (j + 1 < exts.length) tryNext(i, j + 1);
      else tryNext(i + 1, 0);
    });
    // Kick off load
    el.load();
  }
  tryNext(0, 0);
};

function ensureAudio() {
  if (!audioReady) {
    try {
      audioEngine = new SimpleAudio();
      audioReady = true;
    } catch (e) {}
  }
}

function fireBullet() {
  var now = Date.now();
  if (paused || game.status !== "playing") return;
  var cd = boost.fireBonus
    ? Math.max(60, Math.floor(fireCooldown * 0.5))
    : fireCooldown;
  if (now - lastShotTime < cd) return;
  if (ammo <= 0) return;
  lastShotTime = now;
  ammo--;
  updateAmmoBadge();
  // Create missile (black) composed of body + nose
  var missile = new THREE.Object3D();
  var bodyGeo = new THREE.CylinderGeometry(1.2, 1.2, 12, 10);
  var noseGeo = new THREE.CylinderGeometry(0, 1.2, 3, 10); // cone
  var finGeo = new THREE.BoxGeometry(0.4, 2, 0.1);
  var mat = new THREE.MeshPhongMaterial({ color: 0x0a0a0f, shininess: 10 });
  var body = new THREE.Mesh(bodyGeo, mat);
  var nose = new THREE.Mesh(noseGeo, mat);
  nose.position.y = 7.5;
  body.position.y = 1;
  missile.add(body);
  missile.add(nose);
  // Add 3 fins
  for (var i = 0; i < 3; i++) {
    var fin = new THREE.Mesh(finGeo, mat);
    fin.position.set(0, -4, 0);
    fin.rotation.y = (i * Math.PI * 2) / 3;
    missile.add(fin);
  }
  // Orient forward along +X, original world uses +X as forward for bullets
  missile.rotation.z = Math.PI / 2;
  missile.position.copy(airplane.mesh.position.clone());
  missile.position.x += 10; // in front of plane
  scene.add(missile);
  bullets.push({ mesh: missile, life: 2000 });
  if (audioEngine) audioEngine.shot();
}

function updateBullets() {
  for (var i = bullets.length - 1; i >= 0; i--) {
    var b = bullets[i];
    b.life -= deltaTime;
    b.mesh.position.x += 0.6 * deltaTime; // speed scaled by ms
    // Collide with enemies
    if (
      typeof ennemiesHolder !== "undefined" &&
      ennemiesHolder &&
      ennemiesHolder.ennemiesInUse
    ) {
      for (var j = ennemiesHolder.ennemiesInUse.length - 1; j >= 0; j--) {
        var en = ennemiesHolder.ennemiesInUse[j];
        var d = b.mesh.position.distanceTo(en.mesh.position);
        if (d < 15) {
          // Remove enemy similar to player collision removal
          ennemiesPool.unshift(ennemiesHolder.ennemiesInUse.splice(j, 1)[0]);
          ennemiesHolder.mesh.remove(en.mesh);
          if (typeof particlesHolder !== "undefined")
            particlesHolder.spawnParticles(
              en.mesh.position.clone(),
              12,
              Colors.red,
              2
            );
          game.distance += 50; // reward
          if (audioEngine) audioEngine.explosion();
          scene.remove(b.mesh);
          bullets.splice(i, 1);
          continue;
        }
      }
    }
    // Collide with drones
    if (dronesHolder && dronesHolder.dronesInUse) {
      for (var k = dronesHolder.dronesInUse.length - 1; k >= 0; k--) {
        var dr = dronesHolder.dronesInUse[k];
        var dd = b.mesh.position.distanceTo(dr.mesh.position);
        if (dd < 16) {
          dronesHolder.removeAt(k);
          if (typeof particlesHolder !== "undefined")
            particlesHolder.spawnParticles(
              dr.mesh.position.clone(),
              14,
              Colors.red,
              2.5
            );
          game.distance += 80;
          if (audioEngine) audioEngine.explosion();
          scene.remove(b.mesh);
          bullets.splice(i, 1);
          break;
        }
      }
    }
    if (i < bullets.length && b.life <= 0) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
    }
  }
}

var fieldDistance, energyBar, replayMessage, fieldLevel, levelCircle;

function init(event) {
  // UI

  fieldDistance = document.getElementById("distValue");
  energyBar = document.getElementById("energyBar");
  replayMessage = document.getElementById("replayMessage");
  fieldLevel = document.getElementById("levelValue");
  levelCircle = document.getElementById("levelCircleStroke");

  resetGame();
  createScene();

  createLights();
  createPlane();
  createSea();
  createSky();
  createCoins();
  createEnnemies();
  createParticles();
  createPickups();
  createDrones();
  createObstacles();

  document.addEventListener("mousemove", handleMouseMove, false);
  document.addEventListener("touchmove", handleTouchMove, false);
  document.addEventListener("mouseup", handleMouseUp, false);
  document.addEventListener("touchend", handleTouchEnd, false);
  document.addEventListener("keydown", handleKeyDown, false);
  injectEnhancedUI();
  updateControlOverlayVisibility();
  var worldEl = document.getElementById("world");
  if (worldEl) {
    worldEl.addEventListener("mousedown", handleFireClick, false);
    worldEl.addEventListener(
      "touchstart",
      function (e) {
        e.preventDefault();
        handleFireClick(e);
      },
      false
    );
  }
  document.addEventListener(
    "mousedown",
    function () {
      ensureAudio();
    },
    { once: true }
  );

  loop();
}

window.addEventListener("load", init, false);
