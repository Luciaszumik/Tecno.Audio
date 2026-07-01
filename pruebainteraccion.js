// CONFIGURACION DE AUDIO — AMPLITUD GENERAL
// ====================================================
let AMP_MIN       = 0.030;  // por debajo de esto se considera silencio
let AMP_MAX       = 0.200;  // amplitud máxima esperada del micrófono
let AMORTIGUACION = 0.85;   // suavizado del gestor de amplitud general


// CONFIGURACIÓN DE AUDIO — GRAVES  (pinta bordo)
// ====================================================
let GRAVES_MIN             = 20;   // silencio
let GRAVES_MAX             = 180;  // amplitud máxima esperada (voz grave, golpe de mesa)
let GRAVES_F               = 0.75; // suavizado del filtro de graves
let GRAVES_UMBRAL_PINTURA  = 0.80; // IR AJUSTANDO: filtrado debe superar para pintar bordo


// CONFIGURACIÓN DE AUDIO — AGUDOS (pinta crema)
// ====================================================
let AGUDOS_MIN             = 10;   // Menos es silencio
let AGUDOS_MAX             = 120;  // amplitud máxima esperada 
let AGUDOS_F               = 0.65; // suavizado del filtro de agudos 
let AGUDOS_UMBRAL_PINTURA  = 0.35; // IR AJUTANDO: filtrado debe superar para pintar crema


// VARIABLES DE AUDIO
// ====================================================
let mic;
let fft;

let amp       = 0;   // amplitud general filtrada
let ampGraves = 0;   //  graves filtrada, normalizada 0-1
let ampAgudos = 0;   //  agudos filtradp

let vozLejana      = false;
let antesVozLejana = false;

let gestorAmp;
let gestorGraves;
let gestorAgudos;


// ====================================================
// CONFIGURACIÓN — CHASQUIDO DE LENGUA  (intercambia opacidades)
// ====================================================
// Transiente muy breve: pico de amplitud cruda que sube de golpe desde silencio.
let CHASQUIDO_UMBRAL   = 0.06; // ---cuanto más bajo es más sensible--!!
let CHASQUIDO_COOLDOWN = 10;   // frames de espera cuando se detecta un chasquidp 

let ampCruda          = 0;
let ampCrudaAnterior  = 0;
let chasquidoCooldown = 0;


// CONFIGURACIÓN — SHHH  (reinicia el programa)
// ====================================================

// El umbral debe ser mayor que AGUDOS_UMBRAL_PINTURA para no confundirlo con pintura
let SHHH_UMBRAL       = 0.65; // ←ammplitud del agudo necesario
let SHHH_DURACION_MIN = 15;   //  frames sostenidos para confirmar el shhh
let SHHH_COOLDOWN     = 90;   // frames de espera

let shhhFrames   = 0; // frames consecutivos con agudos sobre el umbral
let shhhCooldown = 0; // contador regresivo de cooldown


// CALIBRADOR — TECLA C
// =====================================
let mostrarCalibrador = true;



// VARIABLES ORIGINALES
// ====================================================
let manchas         = [];
let puntosDibujados = [];
let totalManchas    = 13;

let fondoGuardado = null;
let capaManchitas = null;
let capaPintura   = null;

let lloviendo       = false;
let velocidadLluvia = 15;

// Teclas manuales (override, siguen funcionando)
let teclaA = false;
let teclaS = false;

// ---- Posición y dirección de la franja de pintura BORDO (graves y Tecla A)
let iniciaPinturaGraves;    // posY actual de la franja bordo
let sentidoGraves    = 1;   // 1 = bajando, -1 = subiendo
let cantElipsesGraves = 0;  // contador interno para mover la franja

// ---- Posición y dirección de la franja de pintura CREMA (agudo y Tecla S)
let iniciaPinturaAgudos;    // posY actual de la franja crema
let sentidoAgudos    = -1;
let cantElipsesAgudos = 0;

let elipsesMax = 40; // cada cuántas elipses se desplaza la franja

// Para detectar el borde "dejé de pintar"
let antePintando = false;

// ====================================================
// VARIABLES DE TRANSICIÓN (FADE A BLANCO)
// ====================================================
let estadoFade = 0; // 0: inactivo, 1: yendo a blanco, 2: volviendo de blanco
let fadeAlfa = 0;   // Transparencia actual del fundido
let velocidadFade = 4; //  mayor número = fade más rápido


// ====================================================
// PRELOAD
// ====================================================
function preload() {
  for (let i = 0; i < totalManchas; i++) {
    manchas.push(loadImage(`assets/mancha${i}.png`));
  }
}


// ====================================================
// SETUP
// ====================================================
function setup() {
  createCanvas(700, 900);
  noStroke();

  capaManchitas = createGraphics(700, 900);
  capaManchitas.noStroke();

  capaPintura = createGraphics(700, 900);
  capaPintura.noStroke();

  // Posiciones iniciales de cada franja
  iniciaPinturaGraves = height * 0.40;
  iniciaPinturaAgudos = height * 0.70;

  // dibuja el fondo una sola vez
  fondo();
  capaBordo();
  capaRosa();
  capaCrema();
  textura();

  fondoGuardado = get();
  dibujarManchas();

  // ---- MICRÓFONO ----
  mic = new p5.AudioIn();
  mic.start();

  // ---- FFT ----
  fft = new p5.FFT(0.8, 512);
  fft.setInput(mic);

  // ---- GESTORES ----
  gestorAmp    = new GestorSenial(AMP_MIN, AMP_MAX);
  gestorAmp.f  = AMORTIGUACION;

  gestorGraves   = new GestorSenial(GRAVES_MIN, GRAVES_MAX);
  gestorGraves.f = GRAVES_F;

  gestorAgudos   = new GestorSenial(AGUDOS_MIN, AGUDOS_MAX);
  gestorAgudos.f = AGUDOS_F;

  userStartAudio();
}


// ====================================================
// DRAW
// ====================================================
function draw() {

  // ---- ANÁLISIS DE AUDIO ----
  fft.analyze();
  ampCruda = mic.getLevel();
  gestorAmp.actualizar(ampCruda);
  gestorGraves.actualizar(fft.getEnergy("bass"));
  gestorAgudos.actualizar(fft.getEnergy("treble"));

  amp       = gestorAmp.filtrada;
  ampGraves = gestorGraves.filtrada;
  ampAgudos = gestorAgudos.filtrada;



// CHASQUIDO DE LENGUA intercambia opacidades 
// ====================================================
  // Pico brusco (amplitud cruda supera umbral viniendo de silencio) + cooldown terminado.
  if (chasquidoCooldown > 0) chasquidoCooldown--;
  let esChasquido = (ampCruda > CHASQUIDO_UMBRAL) &&
                    (ampCrudaAnterior < CHASQUIDO_UMBRAL * 0.5) &&
                    (chasquidoCooldown === 0);
  if (esChasquido) {
    for (let p of puntosDibujados) p.alfa = random(25, 130);
    redibujarManchitas();
    chasquidoCooldown = CHASQUIDO_COOLDOWN;
  }
  ampCrudaAnterior = ampCruda;

  // ---- SHHH  reinicia el programa ----
  // ====================================================
  // Se confirma cuando los agudos filtrados se mantienen sobre SHHH_UMBRAL
  // durante SHHH_DURACION_MIN frames consecutivos.
  if (shhhCooldown > 0) shhhCooldown--;
  if (shhhCooldown === 0) {
    if (ampAgudos > SHHH_UMBRAL) {
      shhhFrames++;
      if (shhhFrames >= SHHH_DURACION_MIN) {
        shhhFrames   = 0;
        shhhCooldown = SHHH_COOLDOWN;
        iniciarFadeReset(); 
      }
    } else {
      shhhFrames = 0; // si baja del umbral, reinicia el conteo
    }
  }

  // ---- DETECCIÓN DE VOZ ----
  vozLejana = amp < AMP_MIN;
  let seAlejoLaVoz  = !vozLejana && antesVozLejana;
  let seAcercoLaVoz =  vozLejana && !antesVozLejana;
  antesVozLejana = vozLejana;

  // ---- DECISIÓN DE PINTURA ----
  // Sonido activa pintura o teclas A y S 
  let pintandoGraves = (ampGraves > GRAVES_UMBRAL_PINTURA) || teclaA;
  let pintandoAgudos = (ampAgudos > AGUDOS_UMBRAL_PINTURA) || teclaS;
  let pintando       = pintandoGraves || pintandoAgudos;

  // ---- LÓGICA DE LLUVIA ----

  if (seAlejoLaVoz)  lloviendo = true;
  if (seAcercoLaVoz) lloviendo = false;

  // La pintura pausa la lluvia si se activa
  if (pintando) lloviendo = false;

  // Al dejar de pintar retomar segun el estado actual de la voz:   !vozLejana = voz cercana = condición para que llueva
  if (!pintando && antePintando) lloviendo = !vozLejana;
  antePintando = pintando;


  // ---- LLUVIA ----
  if (lloviendo) {
    image(fondoGuardado, 0, 0);
    image(capaPintura, 0, 0);

    
    // CONTROL DINÁMICO DE VELOCIDAD GLOBAL (ONDAS)
    // =========================================================================
    // Usamos sin() para crear un ciclo suave de lento rápido  lento
    let velocidadDelCiclo = 0.05; 
    let oscilacion = (sin(frameCount * velocidadDelCiclo) + 1) / 2; 
    
    let minVelocidad = 5;   
    let maxVelocidad = 35;  

    let velocidadBloqueActual = map(oscilacion, 0, 1, minVelocidad, maxVelocidad);
    
    
    // =========================================================================

    for (let p of puntosDibujados) {
      p.y += velocidadBloqueActual; 
      
  
      if (p.y > height) {
        p.y = p.y - height - p.h; 
      }

      tint(255, p.alfa);
      push();
      translate(p.x, p.y);
      image(p.img, 0, 0, p.w, p.h);
      pop();
    }
    noTint();

    if (mostrarCalibrador) dibujarCalibradorFFT();
    return;
  }

  // ---- PINTURA BORDO —
  if (pintandoGraves) {
    for (let i = 0; i < 10; i++) {  
      let x     = random(-100, width + 100);
      let y     = random(iniciaPinturaGraves, iniciaPinturaGraves + 40); 
      let alpha = random(2, 10);
      capaPintura.fill(random(92, 128), random(10, 30), random(18, 48), alpha);
      capaPintura.ellipse(x, y, random(40, 180), random(20, 80));
    }
    actualizarPinturaGraves();
  }

  // ---- PINTURA CREMA — 
  if (pintandoAgudos) {
    for (let i = 0; i < 10; i++) {
      let x = random(-100, width + 100);
      let y = random(iniciaPinturaAgudos, iniciaPinturaAgudos + 10);
      capaPintura.fill(250, 237, 235, random(4, 10));
      capaPintura.ellipse(x, y, random(40, 180), random(20, 80));
    }
    for (let i = 0; i < 20; i++) {
      let x = random(-100, width + 100);
      let y = random(iniciaPinturaAgudos, iniciaPinturaAgudos + 10);
      capaPintura.fill(238, 225, 210, random(2, 10));
      capaPintura.ellipse(x, y, random(40, 180), random(20, 80));
    }
    actualizarPinturaAgudos();
  }

  // Redibujar solo si algo se pintó
  if (pintando) redibujarManchitas();

  // ---- CALIBRADOR ----
  if (mostrarCalibrador) dibujarCalibradorFFT();




  // EFECTO BARRIDO FUNDIDO EN BLANCO 
  // ====================================================
  if (estadoFade > 0) {
    if (!lloviendo && !pintando) {
      image(fondoGuardado, 0, 0);
      image(capaPintura, 0, 0);
      image(capaManchitas, 0, 0);
    }

    push();
    noStroke();
    fill(255, fadeAlfa);
    rect(0, 0, width, height);
    pop();

    if (estadoFade === 1) {
      fadeAlfa += velocidadFade;
      if (fadeAlfa >= 255) {
        fadeAlfa = 255;
        resetear();      
        estadoFade = 2;
      }
    } else if (estadoFade === 2) {
      fadeAlfa -= velocidadFade;
      if (fadeAlfa <= 0) {
        fadeAlfa = 0;
        estadoFade = 0;
        redibujarManchitas(); 
      }
    }
  }
}



// ACTUALIZAR FRANJA DE PINTURA — GRAVES
// ====================================================
function actualizarPinturaGraves() {
  cantElipsesGraves += 20;
  if (cantElipsesGraves >= elipsesMax) {
    cantElipsesGraves = 0;
    iniciaPinturaGraves += 10 * sentidoGraves;
    if (iniciaPinturaGraves >= height) sentidoGraves = -1;
    if (iniciaPinturaGraves <= 0)      sentidoGraves =  1;
  }
}


// ACTUALIZAR FRANJA DE PINTURA — AGUDOS
// ====================================================
function actualizarPinturaAgudos() {
  cantElipsesAgudos += 20;
  if (cantElipsesAgudos >= elipsesMax) {
    cantElipsesAgudos = 0;
    iniciaPinturaAgudos += 10 * sentidoAgudos;
    if (iniciaPinturaAgudos >= height) sentidoAgudos = -1;
    if (iniciaPinturaAgudos <= 0)      sentidoAgudos =  1;
  }
}


// ====================================================
// CALIBRADOR FFT
// ====================================================
function dibujarCalibradorFFT() {

  let crudo      = mic.getLevel();
  let graveCrudo = fft.getEnergy("bass");
  let agudoCrudo = fft.getEnergy("treble");

  // Booleanos de pintura activa
  let activoGraves = ampGraves > GRAVES_UMBRAL_PINTURA;
  let activoAgudos = ampAgudos > AGUDOS_UMBRAL_PINTURA;

  push();
  noStroke();

  // ---- Fondo del panel ----
  fill(0, 0, 0, 190);
  rect(8, 8, 340, 310, 8); 

  textFont("monospace");

  // ---- Título ----
  textSize(12);
  fill(255);
  text("── CALIBRADOR FFT  [C] ocultar ──", 18, 30);

  // =========================================
  // AMPLITUD GENERAL
  // =========================================
  textSize(11);
  fill(160);
  text("AMP GENERAL (Controla Lluvia)", 18, 55);

  fill(180);  text("crudo:   ", 18, 70);
  fill(crudo > AMP_MIN ? color(80,220,120) : color(220,80,80));
  text(nf(crudo, 1, 5), 100, 70);

  fill(180);  text("filtrado:", 18, 84);
  fill(180, 200, 255);
  text(nf(amp, 1, 5), 100, 84);

  // Barra amp general
  fill(40);
  rect(18, 89, 280, 7, 3);
  fill(crudo > AMP_MIN ? color(80,220,120) : color(220,80,80));
  rect(18, 89, map(amp, 0, AMP_MAX, 0, 280), 7, 3);
  
  // Marcador AMP_MIN
  stroke(255, 220, 0);  strokeWeight(1.5);
  let xMin = map(AMP_MIN, 0, AMP_MAX, 18, 298);
  xMin = constrain(xMin, 18, 298); 
  line(xMin, 87, xMin, 98);
  noStroke();
  fill(255, 220, 0);  textSize(9);
  text("MIN", xMin - 6, 86);
  
  // Instrucciones teclado
  fill(255, 220, 0); textSize(10);
  text("Ajustar MIN: [1] bajar | [2] subir", 18, 110);

  // =========================================
  // GRAVES
  // =========================================
  textSize(11);
  fill(160);
  text("GRAVES 20-140 Hz (Pintura Bordo)", 18, 135);

  fill(180);  text("filtrado 0-1:", 18, 150);
  fill(activoGraves ? color(80,220,120) : color(130,200,255));
  text(nf(ampGraves, 1, 4), 100, 150);

  // Barra graves
  fill(30, 30, 50);
  rect(18, 155, 280, 7, 3);
  fill(activoGraves ? color(80,220,120) : color(100,160,255));
  rect(18, 155, map(ampGraves, 0, 1, 0, 280), 7, 3);
  
  // Marcador de umbral
  stroke(255, 80, 80);  strokeWeight(1.5);
  let xUmbralG = map(GRAVES_UMBRAL_PINTURA, 0, 1, 18, 298);
  xUmbralG = constrain(xUmbralG, 18, 298);
  line(xUmbralG, 153, xUmbralG, 164);
  noStroke();
  fill(255, 80, 80);  textSize(9);
  text("UMBRAL", xUmbralG - 14, 152);

  // Instrucciones teclado
  fill(255, 80, 80); textSize(10);
  text("Ajustar UMBRAL: [3] bajar | [4] subir", 18, 176);

  // =========================================
  // AGUDOS
  // =========================================
  textSize(11);
  fill(160);
  text("AGUDOS 5200-14000 Hz (Pintura Crema)", 18, 201);

  fill(180);  text("filtrado 0-1:", 18, 216);
  fill(activoAgudos ? color(80,220,120) : color(255,225,120));
  text(nf(ampAgudos, 1, 4), 100, 216);

  // Barra agudos
  fill(50, 40, 15);
  rect(18, 221, 280, 7, 3);
  fill(activoAgudos ? color(80,220,120) : color(255,200,60));
  rect(18, 221, map(ampAgudos, 0, 1, 0, 280), 7, 3);
  
  // Marcador de umbral
  stroke(255, 80, 80);  strokeWeight(1.5);
  let xUmbralA = map(AGUDOS_UMBRAL_PINTURA, 0, 1, 18, 298);
  xUmbralA = constrain(xUmbralA, 18, 298);
  line(xUmbralA, 219, xUmbralA, 230);
  noStroke();
  fill(255, 80, 80);  textSize(9);
  text("UMBRAL", xUmbralA - 14, 218);

  // Instrucciones teclado
  fill(255, 80, 80); textSize(10);
  text("Ajustar UMBRAL: [5] bajar | [6] subir", 18, 242);

  // =========================================
  // ESTADO GENERAL
  // =========================================
  fill(120); 
  rect(18, 260, 280, 1); 

  textSize(12);
  fill(180);  
  text("ESTADOS:", 18, 285);
  
  fill(lloviendo ? color(100,180,255) : color(120));
  text("Lluvia: " + (lloviendo ? "SI" : "NO"), 90, 285);
  
  fill(activoGraves ? color(80,220,120) : color(120));
  text("Bordo: " + (activoGraves ? "SI" : "NO"), 180, 285);
  
  fill(activoAgudos ? color(80,220,120) : color(120));
  text("Crema: " + (activoAgudos ? "SI" : "NO"), 260, 285);

  pop();
}



// MANCHAS
// ====================================================
function dibujarManchas() {
  puntosDibujados = [];

  for (let i = 0; i < 300000; i++) {
    let x    = random(width);
    let y    = random(height);
    let tamW = 14 + random(-1, 1);
    let tamH = tamW * 1.8;
    let rw   = (tamW / 2) + 0.1;
    let rh   = (tamH / 2) + 0.1;

    if (esPosicionValida(x, y, rw, rh)) {
      puntosDibujados.push({
        x: x, y: y, rw: rw, rh: rh,
        w: tamW, h: tamH,
        alfa: random(40, 130),
        img: random(manchas)
      });
    }
  }
  redibujarManchitas();
}

function redibujarManchitas() {
  capaManchitas.clear();
  for (let p of puntosDibujados) {
    capaManchitas.tint(255, p.alfa);
    capaManchitas.push();
    capaManchitas.translate(p.x, p.y);
    capaManchitas.image(p.img, 0, 0, p.w, p.h);
    capaManchitas.pop();
  }
  capaManchitas.noTint();

  image(fondoGuardado, 0, 0);
  image(capaPintura, 0, 0);
  image(capaManchitas, 0, 0);
}

function esPosicionValida(nx, ny, nrw, nrh) {
  for (let p of puntosDibujados) {
    if (abs(nx - p.x) < (nrw + p.rw) && abs(ny - p.y) < (nrh + p.rh)) {
      return false;
    }
  }
  return true;
}


// ====================================================
// CAPAS DE FONDO
// ====================================================
function fondo() {
  background(238, 225, 210);
}
 // bloque sólido tope — llega hasta el 60%
function capaBordo() {
  for (let i = 0; i < 6000; i++) {
    let x = random(width);
    let y = random(-30, height * 0.60);
    fill(random(92,128), random(10,30), random(18,48), map(y,-30,height*0.60,62,8));
    ellipse(x, y, random(20,90), random(12,45));
  }
    // bordó más difuso, refuerza el tope hasta el 42%
  for (let i = 0; i < 4000; i++) {
    let x = random(width);
    let y = random(0, height * 0.42);
    fill(random(105,150), random(18,45), random(30,68), map(y,0,height*0.42,38,2));
    ellipse(x, y, random(35,160), random(18,70));
  }
    // bordó oscuro para generar la transición hacia la zona baja
  for (let i = 0; i < 1800; i++) {
    let x = random(width);
    let y = random(height*0.38, height*0.82);
    fill(random(130,155), random(30,55), random(45,75), map(y,height*0.38,height*0.82,9,1));
    ellipse(x, y, random(45,190), random(22,85));
  }
}
//zona media, resultado del bordó + crema
function capaRosa() {
  for (let i = 0; i < 1200; i++) {
    let x = random(width);
    let y = random(height*0.52, height*0.92);
    fill(183, 96, 90, map(y, height*0.52, height*0.92, 16, 3));
    ellipse(x, y, random(55,220), random(28,100));

     // arranca en 0.52, donde el bordó ya se disolvió y queda un color crema teñida por el bordó
  }
}
//zona iinferior
function capaCrema() {
  for (let i = 0; i < 2000; i++) {
    let x = random(width);
    let y = random(height*0.62, height);
    fill(random(235,248), random(220,235), random(208,225), map(y,height*0.62,height,3,18));
    ellipse(x, y, random(70,270), random(35,125));
  }
  for (let i = 0; i < 500; i++) {
    let x = random(width);
    let y = random(height*0.60, height);
    fill(205, 148, 158, map(y, height*0.60, height, 12, 2));
    ellipse(x, y, random(50,190), random(6,20));
  }
}

function textura() {
  noStroke();
  for (let i = 0; i < 20000; i++) {
    fill(255, random(2, 8));
    rect(random(width), random(height), 1, 1);
    fill(0, random(1, 4));
    rect(random(width), random(height), 1, 1);
  }
}


// ====================================================
// INTERACCIONES
// ====================================================
function mousePressed() {
  dibujarManchas();
}

function keyPressed() {
  
  // C: muestra o no el calibrador
  if (key === 'c' || key === 'C') {
    mostrarCalibrador = !mostrarCalibrador;
  }

  // R: resetea
  else if (key === 'r' || key === 'R') {
    iniciarFadeReset();
  }

  // G: lluvia manual
  else if (key === 'g' || key === 'G') {
    lloviendo = !lloviendo;
  }
   // T: transparencia de manchas
  else if (key === 't' || key === 'T') {
    for (let p of puntosDibujados) {
      p.alfa = random(25, 130);
    }
    redibujarManchitas();
  }

  // A: bordo manual )
  else if (key === 'a' || key === 'A') {
    teclaA    = true;
    lloviendo = false;
  }

  // S: ecrema manual
  else if (key === 's' || key === 'S') {
    teclaS    = true;
    lloviendo = false;
  }


  // CONTROLES EN VIVO DEL CALIBRADOR (solo funciona si esta)
  // =========================================================
  if (mostrarCalibrador) {
    if (key === '1') AMP_MIN = max(0.005, AMP_MIN - 0.005);
    if (key === '2') AMP_MIN = min(1.0, AMP_MIN + 0.005);

    if (key === '3') GRAVES_UMBRAL_PINTURA = max(0.05, GRAVES_UMBRAL_PINTURA - 0.05);
    if (key === '4') GRAVES_UMBRAL_PINTURA = min(1.0, GRAVES_UMBRAL_PINTURA + 0.05);

    if (key === '5') AGUDOS_UMBRAL_PINTURA = max(0.05, AGUDOS_UMBRAL_PINTURA - 0.05);
    if (key === '6') AGUDOS_UMBRAL_PINTURA = min(1.0, AGUDOS_UMBRAL_PINTURA + 0.05);
  }
}

// ====================================================
// RESET — llamado por tecla R y por un shhh sostenido
// ====================================================
function resetear() {
  iniciaPinturaGraves = height * 0.40;
  iniciaPinturaAgudos = height * 0.70;
  sentidoGraves     = 1;
  sentidoAgudos     = -1;
  cantElipsesGraves = 0;
  cantElipsesAgudos = 0;
  lloviendo         = false;
  antePintando      = false;
  capaPintura.clear();
  fondo();
  capaBordo();
  capaRosa();
  capaCrema();
  textura();
  fondoGuardado = get();
  dibujarManchas();
}


// INICIAR TRANSICIÓN DE RESET
// ====================================================
function iniciarFadeReset() {
  // Solo inicia si no estamos en medio de un fade
  if (estadoFade === 0) {
    estadoFade = 1;
    fadeAlfa = 0;
    lloviendo = false; //detiene la lluvia al instante para permitir el fade
  }
}

function keyReleased() {
  if (key === 'a' || key === 'A') {
    teclaA = false;
    if (vozLejana && !teclaS && ampGraves <= GRAVES_UMBRAL_PINTURA) {
      lloviendo = true;
    }
  }
  if (key === 's' || key === 'S') {
    teclaS = false;
    if (vozLejana && !teclaA && ampAgudos <= AGUDOS_UMBRAL_PINTURA) {
      lloviendo = true;
    }
  }
}
