/**
 * Sonic Runner - Modern JavaScript Platformer
 * Logic and Engine
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startScreen = document.getElementById('start-screen');
const deathScreen = document.getElementById('death-screen');
const ringsDisplay = document.getElementById('rings-count');
const scoreDisplay = document.getElementById('score-count');

// Game Config
const CONFIG = {
    gravity: 0.8,
    jumpForce: -16,
    acceleration: 0.6,
    maxSpeed: 12,
    friction: 0.95,
    tileSize: 64,
    cameraLerp: 0.1,
    sonicColor: '#242490',
    skinColor: '#fcb490',
    ringColor: '#ffff00',
    goalDistance: 2000 // Restored for normal ring/enemy spawning
};

const particles = [];
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.radius = Math.random() * 5;
        this.alpha = 1;
        this.color = color;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.alpha -= 0.02;
    }
    draw() {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function spawnExplosion(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color));
}

// --- Audio System (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(freq, type = 'square', duration = 0.1, volume = 0.1) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 2, audioCtx.currentTime + duration);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

const SFX = {
    jump: () => playSound(440, 'triangle', 0.2, 0.15),
    ring: () => playSound(880, 'sine', 0.1, 0.1),
    stomp: () => playSound(220, 'square', 0.1, 0.2),
    hurt: () => playSound(110, 'sawtooth', 0.3, 0.2),
    bossHit: () => playSound(330, 'square', 0.1, 0.2),
    bossDefeat: () => {
        for (let i = 0; i < 5; i++) setTimeout(() => playSound(110 + i * 100, 'sawtooth', 0.1, 0.1), i * 100);
    }
};

// State
let gameState = 'START'; // START, PLAYING, GAMEOVER, WON, SPECIAL, MARBLE
let currentLevel = 'GREEN_HILL'; // GREEN_HILL, MARBLE, CHEMICAL_PLANT
let score = 0;
let rings = 0;
let distance = 0;
let time = 0; 
let goalReached = false;
let signRotation = 0;
let showGiantRing = false;
let specialStageRotation = 0;
let boss = null;
let hasEmerald = false;
let emeraldScale = 1;
let transitionTimeout = null;
let nextLevelCallback = null;
let selectedChar = 'SONIC'; // SONIC, TAILS, KNUCKLES, AMY, SONIC_TAILS
const charSelectionScreen = document.getElementById('char-selection');
const followerPositionHistory = []; // For Sonic & Tails mode

// Player
const player = {
    x: 100,
    y: 0,
    vx: 0,
    vy: 0,
    width: 48,
    height: 48,
    grounded: false,
    hasShield: false,
    invincible: 0,
    jumps: 0,
    maxJumps: 2,
    facing: 1, // 1: right, -1: left
    rotation: 0,
    animFrame: 0,
    animSpeed: 0,

    reset() {
        this.x = 100;
        this.y = 100;
        this.vx = 0;
        this.vy = 0;
        this.grounded = false;
        this.hasShield = false;
        this.invincible = 0;
        this.jumps = 0;
        this.rotation = 0;

        // Set character-specific stats
        if (selectedChar === 'SONIC') {
            this.color = '#242490';
            this.maxSpeed = 12;
            this.jumpForce = -16;
            this.maxJumps = 2;
        } else if (selectedChar === 'TAILS') {
            this.color = '#ffd100';
            this.maxSpeed = 10;
            this.jumpForce = -17;
            this.maxJumps = 3; // Extra jump for "flying"
        } else if (selectedChar === 'KNUCKLES') {
            this.color = '#e63946';
            this.maxSpeed = 14; // Faster runner
            this.jumpForce = -14; // Lower jump
            this.maxJumps = 2;
        } else if (selectedChar === 'AMY') {
            this.color = '#ff92c3'; // Pink
            this.maxSpeed = 11;
            this.jumpForce = -15;
            this.maxJumps = 2;
        } else if (selectedChar === 'SONIC_TAILS') {
            this.color = '#242490';
            this.maxSpeed = 12;
            this.jumpForce = -16;
            this.maxJumps = 2;
            followerPositionHistory.length = 0;
        }
    },

    update() {
        // Horizontal Movement
        if (keys.ArrowRight || keys.d) {
            this.vx += CONFIG.acceleration;
            this.facing = 1;
        } else if (keys.ArrowLeft || keys.a) {
            this.vx -= CONFIG.acceleration;
            this.facing = -1;
        } else {
            this.vx *= CONFIG.friction;
        }

        // Limit speed
        this.vx = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, this.vx));
        
        // Gravity
        this.vy += CONFIG.gravity;

        // Apply velocities
        this.x += this.vx;
        this.y += this.vy;

        // Level Collision (Floor, Holes, Platforms)
        const groundY = canvas.height - 128 - this.height;
        let isLanding = false;
        let onHole = false;

        // Check Chunks for Holes and Platforms
        chunks.forEach(chunk => {
            if (this.x + this.width > chunk.x && this.x < chunk.x + chunk.width) {
                // Holes/Lava
                chunk.holes.forEach(hole => {
                    const px = this.x + this.width/2;
                    if (px > hole.x && px < hole.x + hole.w) {
                        if (hole.lava && this.y >= groundY - 10) {
                            this.takeDamage();
                        } else {
                            onHole = true;
                        }
                    }
                });

                // Platforms (One-way)
                chunk.platforms.forEach(plat => {
                    if (this.x + this.width > plat.x && this.x < plat.x + plat.w) {
                        const platTop = plat.y - this.height;
                        const prevY = this.y - this.vy;
                        // If falling and was above top before movement, and now is at/below top
                        if (this.vy >= 0 && prevY <= platTop && this.y >= platTop) {
                            this.y = platTop;
                            this.vy = 0;
                            isLanding = true;
                        }
                    }
                });
            }
        });

        // Floor Collision
        if (!isLanding && this.y >= groundY) {
            if (!onHole) {
                this.y = groundY;
                this.vy = 0;
                isLanding = true;
            }
        }

        if (isLanding) {
            this.grounded = true;
            this.jumps = 0;
        } else {
            this.grounded = false;
        }

        // Record position for follower
        if (selectedChar === 'SONIC_TAILS' && gameState === 'PLAYING') {
            followerPositionHistory.push({ x: this.x, y: this.y, facing: this.facing, rot: this.rotation });
            if (followerPositionHistory.length > 20) followerPositionHistory.shift();
        }

        // Check if dead (falling out of world)
        if (this.y > canvas.height) endGame();
    },

    takeDamage() {
        if (this.invincible > 0) return;
        if (this.hasShield) {
            this.hasShield = false;
            this.invincible = 60; // Short grace period
            return;
        }
        if (rings > 0) {
            rings = 0;
            ringsDisplay.textContent = '0';
            this.invincible = 120; // 2 seconds at 60fps
            player.vy = -10; // Bounce on hit
            SFX.hurt();
            
            // Simple visual feedback: flash red (briefly)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillRect(0, 0, canvas.width, canvas.height); 
        } else {
            endGame();
        }
    },

    draw() {
        // Invincibility Flash
        if (this.invincible > 0) {
            this.invincible--;
            if (Math.floor(Date.now() / 100) % 2 === 0) return;
        }

        // Speed Trail
        if (Math.abs(this.vx) > 8) {
            ctx.fillStyle = this.color + '44'; // Add transparency
            ctx.beginPath();
            ctx.arc(this.x + this.width/2 - this.vx * 2, this.y + this.height/2, 24, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(this.x + this.width/2 - this.vx * 4, this.y + this.height/2, 20, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
        ctx.rotate(this.rotation);

        // Core Body
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.fill();

        // Character Features (Quills/Tails/Dreads)
        ctx.beginPath();
        if (selectedChar === 'SONIC') {
            ctx.moveTo(-10, -20);
            ctx.lineTo(-30, -15);
            ctx.lineTo(-20, 0);
            ctx.lineTo(-30, 10);
            ctx.lineTo(-10, 5);
        } else if (selectedChar === 'TAILS') {
            // Two Tails
            ctx.moveTo(-10, 0);
            ctx.quadraticCurveTo(-40, -20, -30, 20);
            ctx.moveTo(-5, 5);
            ctx.quadraticCurveTo(-35, 30, -20, 40);
        } else if (selectedChar === 'KNUCKLES') {
            // Dreadlocks
            ctx.moveTo(-5, -15);
            ctx.lineTo(-25, 0);
            ctx.lineTo(-25, 30);
            ctx.lineTo(-10, 25);
        } else if (selectedChar === 'AMY' || (selectedChar === 'SONIC_TAILS' && false)) {
            // Amy's Hair/Headband
            ctx.moveTo(-10, -15);
            ctx.quadraticCurveTo(-30, 0, -10, 25);
            ctx.strokeStyle = '#e63946'; // Red headband
            ctx.lineWidth = 4;
            ctx.stroke();
        }
        ctx.closePath();
        ctx.fill();

        // Belly (Tan)
        ctx.fillStyle = selectedChar === 'AMY' ? '#ffccd5' : CONFIG.skinColor;
        ctx.beginPath();
        ctx.ellipse(5, 5, 12, 16, 0.1, 0, Math.PI * 2);
        ctx.fill();

        // Facial Area (Tan)
        ctx.beginPath();
        ctx.arc(10 * this.facing, -5, 12, 0, Math.PI * 2);
        ctx.fill();
        
        // Eyes
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(12 * this.facing, -8, 8, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(14 * this.facing, -8, 3, 0, Math.PI * 2);
        ctx.fill();

        // Ears
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.moveTo(-5, -20);
        ctx.lineTo(-15, -35);
        ctx.lineTo(5, -25);
        ctx.fill();

        // Tan Arms
        ctx.strokeStyle = CONFIG.skinColor;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, 5);
        ctx.lineTo(-15, 15);
        ctx.stroke();

        // Red Shoes with White Strap
        ctx.fillStyle = '#e63946';
        ctx.fillRect(-15, 15, 30, 10);
        ctx.fillStyle = 'white';
        ctx.fillRect(-15, 20, 30, 4); // Strap
        
        ctx.restore();

        // Draw Follower (Tails)
        if (selectedChar === 'SONIC_TAILS' && followerPositionHistory.length > 15) {
            const data = followerPositionHistory[0];
            drawCharacter(data.x, data.y, '#ffd100', data.facing, data.rot, 'TAILS');
        }

        // Draw Shield
        if (this.hasShield) {
            ctx.strokeStyle = 'rgba(76, 201, 240, 0.6)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(this.x + this.width/2, this.y + this.height/2, 35, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(76, 201, 240, 0.1)';
            ctx.fill();
        }
    }
};

function drawCharacter(x, y, color, facing, rotation, charType) {
    ctx.save();
    ctx.translate(x + 24, y + 24);
    ctx.rotate(rotation);

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();

    // Features
    ctx.beginPath();
    if (charType === 'TAILS') {
        ctx.moveTo(-10, 0);
        ctx.quadraticCurveTo(-40, -20, -30, 20);
        ctx.moveTo(-5, 5);
        ctx.quadraticCurveTo(-35, 30, -20, 40);
    }
    ctx.closePath();
    ctx.fill();

    // Belly
    ctx.fillStyle = CONFIG.skinColor;
    ctx.beginPath();
    ctx.ellipse(5, 5, 12, 16, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(10 * facing, -5, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.arc(14 * facing, -8, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// Input
const keys = {};
let lastGameOverTime = 0;

function handleKeyDown(e) {
    // Prevent scrolling for game keys only
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
        if (e.preventDefault) e.preventDefault();
    }
    keys[e.key] = true;
    
    if (e.key === ' ' || e.code === 'Space' || e.key === 'w' || e.key === 'ArrowUp') {
        if (gameState === 'SPECIAL' && (player.grounded || Math.abs(player.vy) < 1)) {
            player.vy = -6; 
            SFX.jump();
        }
        if (gameState === 'PLAYING' && player.jumps < player.maxJumps) {
            player.vy = player.jumpForce;
            player.jumps++;
            player.grounded = false;
            if (player.jumps > 1) player.rotation += Math.PI;
            SFX.jump();
        }
        
        // Prevent instant restart
        setTimeout(() => {
            document.getElementById('restart-btn').onclick = startGame;
        }, 500);
    }
    
    const now = Date.now();
    if (gameState === 'START') startGame();
    if (gameState === 'GAMEOVER' && now - lastGameOverTime > 500) startGame();
}

window.addEventListener('keydown', handleKeyDown);

// --- Mobile Touch Controls ---
const btnLeft = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');
const btnJump = document.getElementById('btn-jump');

if (btnLeft) {
    btnLeft.ontouchstart = (e) => { e.preventDefault(); keys.ArrowLeft = true; };
    btnLeft.ontouchend = (e) => { e.preventDefault(); keys.ArrowLeft = false; };
}
if (btnRight) {
    btnRight.ontouchstart = (e) => { e.preventDefault(); keys.ArrowRight = true; };
    btnRight.ontouchend = (e) => { e.preventDefault(); keys.ArrowRight = false; };
}
if (btnJump) {
    btnJump.ontouchstart = (e) => { 
        e.preventDefault(); 
        const event = { key: ' ', code: 'Space', preventDefault: () => {} };
        handleKeyDown(event);
    };
}

// Orientation Lock & Fullscreen (Horizontal)
function enterFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (el.msRequestFullscreen) el.msRequestFullscreen();
    
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {
            console.log("Aguardando interação do usuário para travar orientação.");
        });
    }
}
document.addEventListener('click', enterFullscreen, { once: true });
document.addEventListener('touchstart', enterFullscreen, { once: true });

window.addEventListener('keyup', e => keys[e.key] = false);

// Level / Environment
const clouds = [];
class Cloud {
    constructor() {
        this.reset();
        this.x = Math.random() * canvas.width;
    }
    reset() {
        this.x = canvas.width + Math.random() * 500;
        this.y = Math.random() * (canvas.height / 2);
        this.scale = 0.5 + Math.random();
        this.speed = (0.2 + Math.random() * 0.5) * -1;
    }
    update() {
        this.x += this.speed;
        if (this.x < -200) this.reset();
    }
    draw() {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.arc(this.x, this.y, 40 * this.scale, 0, Math.PI * 2);
        ctx.arc(this.x + 30 * this.scale, this.y - 10 * this.scale, 30 * this.scale, 0, Math.PI * 2);
        ctx.arc(this.x + 60 * this.scale, this.y, 40 * this.scale, 0, Math.PI * 2);
        ctx.fill();
    }
}
for (let i = 0; i < 8; i++) clouds.push(new Cloud());

const chunks = [];
class Chunk {
    constructor(x) {
        this.x = x;
        this.width = 1200; // Fixed chunk width for stability
        this.rings = [];
        this.spikes = [];
        this.enemies = [];
        this.monitors = [];
        this.holes = [];
        this.platforms = [];
        this.hasSign = false;
        this.hasGiantRing = false;
        this.generate();
    }

    generate() {
        // Don't add holes in the first chunk or very near the sign
        if (this.x > 1200 && this.x < CONFIG.goalDistance - 1000) {
            if (Math.random() > 0.6) {
                const isLava = currentLevel === 'MARBLE_ZONE' && Math.random() > 0.5;
                this.holes.push({
                    x: this.x + 400 + Math.random() * 400,
                    w: 150 + Math.random() * 100,
                    lava: isLava
                });
            }
        }

        if (this.x >= CONFIG.goalDistance && !goalReached) {
            if (!boss) { // Now both GH and Marble can have boss
                this.hasBoss = true;
                this.bossTriggerX = this.x + 400;
                
                // Add floating platforms/ledges for the boss fight (as requested)
                if (currentLevel === 'MARBLE_ZONE') {
                    // Two land masses with a lava hole in the middle
                    this.holes.push({ x: this.bossTriggerX + 300, w: 600, lava: true });
                } else {
                    this.platforms.push({ x: this.bossTriggerX + 100, y: canvas.height - 300, w: 120, h: 30 });
                    this.platforms.push({ x: this.bossTriggerX + 800, y: canvas.height - 300, w: 120, h: 30 });
                }
            } else {
                this.hasSign = true;
                this.signX = this.x + 500;
                this.signY = canvas.height - 128 - 140;
                
                this.hasGiantRing = false; // Will be set dynamically
                this.giantRingX = this.signX + 300;
                this.giantRingY = canvas.height - 250;
            }
            return;
        }

        // Add Monitors
        if (Math.random() > 0.7) {
            this.monitors.push({
                x: this.x + Math.random() * (this.width - 200) + 100,
                y: canvas.height - 128 - 60,
                w: 40,
                h: 40,
                broken: false
            });
        }
        for (let i = 0; i < 5; i++) {
            this.rings.push({
                x: this.x + Math.random() * (this.width - 100) + 50,
                y: canvas.height - 200 - Math.random() * 150,
                collected: false
            });
        }
        
        // Random obstacles
        if (Math.random() > 0.4) {
            this.spikes.push({
                x: this.x + Math.random() * (this.width - 200) + 100,
                y: canvas.height - 128 - 40,
                w: 60,
                h: 40
            });
        }

        // Add Badniks (Enemies)
        if (Math.random() > 0.5) {
            this.enemies.push({
                x: this.x + this.width / 2,
                y: canvas.height - 128 - 50,
                vx: -2,
                w: 50,
                h: 50,
                dead: false,
                patrolRange: 200,
                originX: this.x + this.width / 2
            });
        }
    }

    draw() {
        // Draw checkered ground
        const groundY = canvas.height - 128;
        const tileSize = 64;
        
        ctx.save();
        // Removed buggy ctx.clip()
        
        for (let gx = 0; gx < this.width; gx += tileSize) {
            const worldX = this.x + gx;
            let drawCheckers = true;
            this.holes.forEach(h => {
                if (worldX >= h.x && worldX < h.x + h.w) {
                    if (h.lava) {
                        ctx.fillStyle = currentLevel === 'CHEMICAL_PLANT' ? '#9b59b6' : '#ff793f'; // Purple Liquid for Chemical
                        ctx.fillRect(worldX, groundY, tileSize, tileSize);
                        ctx.fillStyle = currentLevel === 'CHEMICAL_PLANT' ? '#8e44ad' : '#ffb142';
                        ctx.fillRect(worldX, groundY, tileSize, 10);
                        drawCheckers = false;
                    } else {
                        drawCheckers = false; // It's a hole, skip checkers
                    }
                }
            });
            if (!drawCheckers) continue;

            for (let gy = groundY; gy < canvas.height; gy += tileSize) {
                const isEven = ((gx+this.x)/tileSize + gy/tileSize) % 2 === 0;
                
                if (currentLevel === 'GREEN_HILL') {
                    ctx.fillStyle = isEven ? '#6E2C00' : '#AA4300';
                } else if (currentLevel === 'MARBLE_ZONE') {
                    ctx.fillStyle = isEven ? '#2d3436' : '#636e72'; // Dark Bricks for Marble Zone
                } else if (currentLevel === 'CHEMICAL_PLANT') {
                    ctx.fillStyle = isEven ? '#2980b9' : '#3498db'; // Blue/Dark Blue for Chemical
                }
                
                ctx.fillRect(this.x + gx, gy, tileSize, tileSize);
                
                if (gy === groundY) {
                    if (currentLevel === 'GREEN_HILL') {
                        ctx.fillStyle = '#00AE00';
                        ctx.fillRect(this.x + gx, gy, tileSize, 12);
                        ctx.beginPath();
                        for (let x = 0; x <= tileSize; x += 16) {
                            ctx.moveTo(this.x + gx + x, gy + 12);
                            ctx.lineTo(this.x + gx + x + 8, gy + 24);
                            ctx.lineTo(this.x + gx + x + 16, gy + 12);
                        }
                        ctx.fill();
                    } else if (currentLevel === 'MARBLE_ZONE') {
                        ctx.fillStyle = '#e67e22'; // Lava/Dirt top for Marble
                        ctx.fillRect(this.x + gx, gy, tileSize, 8);
                    } else if (currentLevel === 'CHEMICAL_PLANT') {
                        ctx.fillStyle = '#f1c40f'; // Yellow pipe edges for Chemical
                        ctx.fillRect(this.x + gx, gy, tileSize, 8);
                    }
                }
            }
        }
        
        // Draw Platforms
        this.platforms.forEach(plat => {
            const isGH = currentLevel === 'GREEN_HILL';
            ctx.fillStyle = isGH ? '#AA4300' : '#444';
            ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
            ctx.fillStyle = isGH ? '#00AE00' : '#888';
            ctx.fillRect(plat.x, plat.y, plat.w, 8); // Top grass/metal
            
            // Platform "floating" look
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(plat.x, plat.y + plat.h, plat.w, 10);
        });

        // Draw Rings
        this.rings.forEach(ring => {
            if (!ring.collected) {
                ctx.fillStyle = CONFIG.ringColor;
                ctx.shadowBlur = 10;
                ctx.shadowColor = CONFIG.ringColor;
                ctx.beginPath();
                ctx.arc(ring.x, ring.y, 10, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        });

        // Draw Spikes
        this.spikes.forEach(spike => {
            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(spike.x + 5, spike.y + spike.h - 5, spike.w, 5);

            // Spike Body (Metallic Silver)
            ctx.fillStyle = '#ecf0f1';
            ctx.strokeStyle = '#2c3e50';
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            ctx.moveTo(spike.x, spike.y + spike.h);
            ctx.lineTo(spike.x + spike.w/2, spike.y);
            ctx.lineTo(spike.x + spike.w, spike.y + spike.h);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Shine
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.moveTo(spike.x + spike.w/2, spike.y + 5);
            ctx.lineTo(spike.x + spike.w/2 + 5, spike.y + 15);
            ctx.lineTo(spike.x + spike.w/2 - 5, spike.y + 15);
            ctx.fill();
        });

        // Draw Badniks
        this.enemies.forEach(enemy => {
            if (!enemy.dead) {
                // Update enemy AI
                enemy.x += enemy.vx;
                if (Math.abs(enemy.x - enemy.originX) > enemy.patrolRange) {
                    enemy.vx *= -1;
                }

                ctx.fillStyle = '#e63946'; // Red Beetle
                ctx.beginPath();
                ctx.arc(enemy.x, enemy.y + 25, 25, 0, Math.PI, true);
                ctx.fill();
                // Wheels
                ctx.fillStyle = '#333';
                ctx.fillRect(enemy.x - 20, enemy.y + 40, 10, 10);
                ctx.fillRect(enemy.x + 10, enemy.y + 40, 10, 10);
                // Eyes
                ctx.fillStyle = 'white';
                ctx.fillRect(enemy.x + (enemy.vx > 0 ? 15 : -25), enemy.y + 20, 10, 5);
            }
        });

        // Draw Monitors
        this.monitors.forEach(m => {
            if (!m.broken) {
                ctx.fillStyle = '#333';
                ctx.fillRect(m.x, m.y, m.w, m.h);
                ctx.fillStyle = '#4cc9f0'; // Shield Icon
                ctx.fillRect(m.x + 10, m.y + 10, m.w - 20, m.h - 20);
            }
        });

        // Draw Finish Sign
        if (this.hasSign) {
            ctx.save();
            ctx.translate(this.signX, this.signY);
            
            // Post
            ctx.fillStyle = '#6a4c24';
            ctx.fillRect(-5, 0, 10, 140);
            
            // Sign Plate (Rotating)
            ctx.translate(0, 30);
            if (goalReached) {
                if (signRotation < Math.PI * 4) signRotation += 0.2;
            }
            ctx.rotate(signRotation);
            
            ctx.fillStyle = '#ffd100'; // Yellow Board
            ctx.fillRect(-40, -40, 80, 80);
            
            // Eggman / Sonic face (simple shapes)
            ctx.fillStyle = goalReached ? CONFIG.sonicColor : '#e63946'; // Red for Eggman, Blue for Sonic
            ctx.beginPath();
            ctx.arc(0, 0, 20, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.restore();
        }

        // Draw Giant Ring
        if (this.hasGiantRing) {
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 15;
            ctx.beginPath();
            ctx.arc(this.giantRingX, this.giantRingY, 100, 0, Math.PI * 2);
            ctx.stroke();
            // Glow
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.3)';
            ctx.lineWidth = 30;
            ctx.stroke();
        }

        ctx.restore();
    }
}

// Camera
const camera = {
    x: 0,
    y: 0,
    update() {
        const targetX = player.x - canvas.width / 3;
        this.x += (targetX - this.x) * CONFIG.cameraLerp;
    },
    reset() {
        this.x = 0;
        this.y = 0;
    }
};

function startGame() {
    if (transitionTimeout) clearTimeout(transitionTimeout);
    nextLevelCallback = null;
    gameState = 'PLAYING';
    startScreen.classList.add('hidden');
    charSelectionScreen.classList.add('hidden');
    deathScreen.classList.add('hidden');
    rings = 3; 
    score = 0;
    distance = 0;
    time = 0;
    goalReached = false;
    signRotation = 0;
    boss = null;
    player.reset();
    camera.reset();
    chunks.length = 0;
    chunks.push(new Chunk(0));
    chunks.push(new Chunk(1200));
    ringsDisplay.textContent = '3';
    scoreDisplay.textContent = '0';
    document.getElementById('time-count').textContent = '0:00';
}

function endGame() {
    if (gameState === 'GAMEOVER' || gameState === 'WON') return;
    gameState = 'GAMEOVER';
    lastGameOverTime = Date.now();
    deathScreen.classList.remove('hidden');
    document.getElementById('restart-btn').classList.remove('hidden');
    
    // Reset death screen text in case it was changed to victory message
    deathScreen.querySelector('h2').textContent = "FIM DE JOGO";
    deathScreen.querySelector('p').innerHTML = `Você coletou <span id="final-rings">${rings}</span> anéis!`;
    
    document.getElementById('final-rings').textContent = rings;
}

function winGame(isFromGiantRing = false) {
    // Determine next level
    let nextLevelFn = startMarbleZone;
    let nextLevelName = "MARBLE ZONE";
    
    if (currentLevel === 'MARBLE_ZONE') {
        nextLevelFn = startChemicalPlant;
        nextLevelName = "CHEMICAL PLANT";
    } else if (currentLevel === 'CHEMICAL_PLANT') {
        nextLevelFn = () => { currentLevel = 'GREEN_HILL'; startGame(); };
        nextLevelName = "GREEN HILL";
    }

    if (isFromGiantRing || rings >= 25) {
        nextLevelCallback = nextLevelFn;
        showVictoryMessage("SONIC GOT THROUGH!", "ENTRANDO NO SPECIAL STAGE...");
        setTimeout(startSpecialStage, 2000);
    } else {
        showVictoryMessage("SONIC GOT THROUGH!", "PRÓXIMA ZONA: " + nextLevelName);
        transitionTimeout = setTimeout(nextLevelFn, 4000);
    }
}

function showVictoryMessage(title, sub) {
    deathScreen.classList.remove('hidden');
    deathScreen.querySelector('h2').textContent = title;
    deathScreen.querySelector('p').textContent = sub;
    document.getElementById('restart-btn').classList.add('hidden'); // Hide restart during transition
}

function startSpecialStage() {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    setTimeout(() => {
        gameState = 'SPECIAL';
        player.x = 200; // Start at the side
        player.y = 200;
        player.vx = 5;
        player.vy = 5;
        hasEmerald = false;
        specialStageRotation = 0;
        deathScreen.classList.add('hidden');
    }, 100);
}

function startMarbleZone() {
    currentLevel = 'MARBLE_ZONE';
    gameState = 'PLAYING';
    document.getElementById('restart-btn').classList.remove('hidden');
    startGame();
}

function startChemicalPlant() {
    currentLevel = 'CHEMICAL_PLANT';
    gameState = 'PLAYING';
    document.getElementById('restart-btn').classList.remove('hidden');
    startGame();
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = Math.min(window.innerHeight, 800); // Max height limit for stability
}

// Initial sizing
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
if (canvas.height === 0) canvas.height = 800; // Fallback
if (canvas.width === 0) canvas.width = 1200; // Fallback

window.addEventListener('resize', resize);
resize();

// UI Button Listeners
document.getElementById('start-btn').onclick = () => {
    startScreen.classList.add('hidden');
    charSelectionScreen.classList.remove('hidden');
};

document.getElementById('select-sonic').onclick = () => { selectedChar = 'SONIC'; currentLevel = 'GREEN_HILL'; startGame(); };
document.getElementById('select-sonic-tails').onclick = () => { selectedChar = 'SONIC_TAILS'; currentLevel = 'GREEN_HILL'; startGame(); };
document.getElementById('select-tails').onclick = () => { selectedChar = 'TAILS'; currentLevel = 'GREEN_HILL'; startGame(); };
document.getElementById('select-knuckles').onclick = () => { selectedChar = 'KNUCKLES'; currentLevel = 'GREEN_HILL'; startGame(); };
document.getElementById('select-amy').onclick = () => { selectedChar = 'AMY'; currentLevel = 'GREEN_HILL'; startGame(); };

document.getElementById('restart-btn').onclick = startGame; // Restart at current level

function update() {
    if (gameState === 'SPECIAL') {
        specialStageRotation += 0.005; // Gentle bg rotation only
        
        // Slow constant gravity downwards
        player.vy += 0.05; 

        // Input
        if (keys.ArrowRight || keys.d) player.vx += 0.2;
        else if (keys.ArrowLeft || keys.a) player.vx -= 0.2;
        else player.vx *= 0.95;

        player.vx = Math.max(-6, Math.min(6, player.vx));
        player.x += player.vx;
        player.y += player.vy;
        
        // Maze Collision Logic (Solid Platforms)
        player.grounded = false;
        for (let i = -7; i <= 7; i++) {
            for (let j = -7; j <= 7; j++) {
                const dist = Math.sqrt(i*i + j*j);
                const isWall = (dist > 5.5 && dist < 6.5);
                const isObstacle = (Math.abs(i) === 3 && Math.abs(j) === 3); 
                
                if (isWall || isObstacle) {
                    const bx = i * 60;
                    const by = j * 60;
                    const dx = player.x - bx;
                    const dy = player.y - by;
                    if (Math.abs(dx) < 50 && Math.abs(dy) < 50) {
                        // Simple solid collision (landing on top)
                        if (player.vy > 0 && dy < -20) {
                            player.y = by - 50;
                            player.vy = 0;
                            player.grounded = true;
                        } else if (player.vy < 0 && dy > 20) {
                            player.vy *= -0.5;
                        } else {
                            player.vx *= -0.5;
                        }
                    }
                }
            }
        }

        // Emerald Collision
        const distToEmerald = Math.sqrt(player.x*player.x + player.y*player.y);
        if (distToEmerald < 50 && !hasEmerald) {
            hasEmerald = true;
            score += 10000;
            SFX.ring();
            setTimeout(nextLevelCallback || startMarbleZone, 2000);
        }

        return;
    }

    if (boss) {
        // Boss AI
        if (boss.state === 'PATROL') {
            const time = Date.now();
            
            if (currentLevel === 'MARBLE_ZONE') {
                // Marble Zone Boss AI: Hover over the lava arena
                const arenaX = boss.arenaX;
                const cycle = (time / 3000) % 2; // Fixed 6 second cycle
                
                if (cycle < 0.35) {
                    boss.vx = 5; // Move Right
                    boss.isFiring = false;
                } else if (cycle < 0.5) {
                    boss.vx = 0; // Fire
                    boss.isFiring = true;
                    if (time % 100 < 50) spawnExplosion(boss.x, boss.y + 100, '#ff793f', 1);
                } else if (cycle < 0.85) {
                    boss.vx = -5; // Move Left
                    boss.isFiring = false;
                } else if (cycle < 1.0) {
                    boss.vx = 0; // Fire
                    boss.isFiring = true;
                    if (time % 100 < 50) spawnExplosion(boss.x, boss.y + 100, '#ff793f', 1);
                } else {
                    // Follow player or idle near arena center
                    const tx = (player.x + 100 < arenaX + 400) ? player.x + 100 : arenaX + 400;
                    boss.vx = (tx - boss.x) * 0.1;
                    boss.isFiring = false;
                }
                
                // Hard boundaries to prevent AI from escaping screen
                if (boss.x < boss.triggerX - 100) boss.vx = 5;
                if (boss.x > boss.triggerX + 1100) boss.vx = -5;
                
                boss.y += (canvas.height/2 - 200 - boss.y) * 0.1;
            } else {
                boss.vy = Math.sin(time / 300) * 3;
                boss.vx = Math.sin(time / 1200) * 5; // Sideways movement
                boss.y += (canvas.height/2 - 150 - boss.y) * 0.05;
            }
            
            boss.x += boss.vx;

            // --- Mace Physics (Calculated even if HIT so it doesn't vanish/glitch) ---
            if (currentLevel === 'GREEN_HILL') {
                const time = Date.now();
                boss.swingAngle = Math.sin(time / 800) * Math.PI / 1.8;
                boss.ballX = boss.x;
                boss.ballY = boss.y + 60;
                boss.maceX = boss.ballX + Math.sin(boss.swingAngle) * 160;
                boss.maceY = boss.ballY + Math.cos(boss.swingAngle) * 160;

                // Ball Collision (Damage Player)
                const dx = player.x + player.width/2 - boss.maceX;
                const dy = player.y + player.height/2 - boss.maceY;
                if (Math.sqrt(dx*dx + dy*dy) < 55 && player.invincible <= 0 && boss.state !== 'DEAD') {
                    player.takeDamage();
                }
            }
        } else if (boss.state === 'HIT') {
            boss.x += 10;
            boss.y -= 5;
            if (Date.now() - boss.hitTimer > 500) boss.state = 'PATROL';
        } else if (boss.state === 'DEAD') {
            boss.x += 8;
            boss.y -= 10;
            spawnExplosion(boss.x, boss.y, '#e67e22', 2);
        }
    }

    if (gameState !== 'PLAYING') return;

    time += 1000 / 60;
    const minutes = Math.floor(time / 60000);
    const seconds = Math.floor((time % 60000) / 1000);
    document.getElementById('time-count').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    player.update();
    camera.update();
    clouds.forEach(c => c.update());
    
    // Update Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].alpha <= 0) particles.splice(i, 1);
    }

    // Infinite level generation
    const lastChunk = chunks[chunks.length - 1];
    if (player.x + canvas.width > lastChunk.x + lastChunk.width && !goalReached) {
        chunks.push(new Chunk(lastChunk.x + lastChunk.width));
    }

    // Collection & Obstacles
    chunks.forEach(chunk => {
        // Collect Rings
        chunk.rings.forEach(ring => {
            if (!ring.collected) {
                const dx = player.x + player.width/2 - ring.x;
                const dy = player.y + player.height/2 - ring.y;
                if (Math.sqrt(dx*dx + dy*dy) < 30) {
                    ring.collected = true;
                    rings++;
                    ringsDisplay.textContent = rings;
                    score += 100;
                    scoreDisplay.textContent = score;
                    spawnExplosion(ring.x, ring.y, CONFIG.ringColor, 8);
                    SFX.ring();
                }
            }
        });

        // Hit Spikes
        chunk.spikes.forEach(spike => {
            if (player.x + 10 < spike.x + spike.w &&
                player.x + player.width - 10 > spike.x &&
                player.y + 10 < spike.y + spike.h &&
                player.y + player.height - 10 > spike.y) {
                player.takeDamage();
            }
        });

        // Hit Enemies
        chunk.enemies.forEach(enemy => {
            if (!enemy.dead) {
                const px = player.x + player.width/2;
                const py = player.y + player.height/2;
                const ex = enemy.x;
                const ey = enemy.y + 25;
                const dx = px - ex;
                const dy = py - ey;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < 60) { // Large area for detection
                    // Stomp? (Any move from above or falling)
                    if (player.vy > -2 && (player.y + player.height) < (enemy.y + 40)) {
                        enemy.dead = true;
                        player.vy = -12; // High bounce
                        player.jumps = 1; // Allow one more jump after stomp
                        score += 500;
                        scoreDisplay.textContent = score;
                        spawnExplosion(enemy.x, enemy.y + 25, '#e63946', 15);
                        SFX.stomp();
                    } else if (dist < 40) {
                        player.takeDamage();
                        spawnExplosion(px, py, '#ffffff', 20);
                    }
                }
            }
        });

        // Hit Monitors
        chunk.monitors.forEach(m => {
            if (!m.broken) {
                if (player.x < m.x + m.w && player.x + player.width > m.x &&
                    player.y < m.y + m.h && player.y + player.height > m.y) {
                    m.broken = true;
                    player.hasShield = true;
                    score += 1000;
                    scoreDisplay.textContent = score;
                    if (player.vy > 0) player.vy = -8; // Bounce
                    spawnExplosion(m.x + 20, m.y + 20, '#4cc9f0', 12);
                }
            }
        });

        // Check Finish Sign & Giant Ring Logic
        if (chunk.hasSign && !goalReached) {
            if (player.x > chunk.signX - 40) {
                goalReached = true;
                score += 5000;
                player.vx = 4;
                setTimeout(winGame, 2000);
            }
        }

        // Dynamically enable Giant Ring near the sign only if rings >= 25
        if (chunk.hasSign) {
            chunk.hasGiantRing = (rings >= 25);
        }

        // Spawn Boss Trigger
        if (chunk.hasBoss && !boss) {
            if (player.x > chunk.bossTriggerX) {
                boss = {
                    x: chunk.bossTriggerX + 600,
                    y: canvas.height/2 - 200,
                    health: 8,
                    state: 'PATROL',
                    hitTimer: 0,
                    w: 120,
                    h: 120,
                    swingAngle: 0,
                    maceX: 0,
                    maceY: 0,
                    ballX: 0,
                    ballY: 0,
                    triggerX: chunk.bossTriggerX,
                    arenaX: chunk.bossTriggerX + 600
                };
            }
        }

        // Check Boss Collision
        if (boss && boss.state !== 'DEAD') {
            const dx = player.x + player.width/2 - boss.x;
            const dy = player.y + player.height/2 - (boss.y + 60);
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < 80) {
                let isHit = false;
                if (currentLevel === 'MARBLE_ZONE') {
                    // Hit from BELOW (as requested)
                    if (player.vy < 0 && player.y > boss.y + 40 && boss.state !== 'HIT') {
                        isHit = true;
                    }
                } else {
                    // Hit from TOP (GH / Others)
                    if (player.vy > 0 && player.y < boss.y + 20 && boss.state !== 'HIT') {
                        isHit = true;
                    }
                }

                if (isHit) {
                    // Hit Boss
                    boss.health--;
                    boss.state = 'HIT';
                    boss.hitTimer = Date.now();
                    player.vy = currentLevel === 'MARBLE_ZONE' ? 5 : -12; // Bounce down if hit from below
                    SFX.bossHit();
                    spawnExplosion(boss.x, boss.y + 60, '#ffffff', 15);
                    if (boss.health <= 0) {
                        boss.state = 'DEAD';
                        SFX.bossDefeat();
                        setTimeout(() => {
                            chunk.hasBoss = false;
                            chunk.hasSign = true;
                            chunk.signX = player.x + 600;
                            chunk.signY = canvas.height - 128 - 140;
                        }, 2000);
                    }
                } else if (player.invincible <= 0 && boss.state !== 'HIT') {
                    player.takeDamage();
                }
            }
        }

        // Check Giant Ring Collision
        if (chunk.hasGiantRing) {
            const dx = player.x + player.width/2 - chunk.giantRingX;
            const dy = player.y + player.height/2 - chunk.giantRingY;
            if (Math.sqrt(dx*dx + dy*dy) < 100) {
                winGame(true); // Trigger Special Stage + Next Level
            }
        }
    });

    // Score based on distance
    distance = Math.max(distance, Math.floor(player.x / 10));
    scoreDisplay.textContent = score + distance;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (gameState === 'SPECIAL') {
        // --- Special Stage Background ---
        const scroll = (Date.now() / 20) % 200;
        ctx.fillStyle = '#1e272e'; // Dark base
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Birds / Fish Patterns (Scrolling)
        for (let x = -200; x < canvas.width + 200; x += 200) {
            for (let y = -200; y < canvas.height + 200; y += 200) {
                ctx.save();
                ctx.translate(x + scroll, y + scroll);
                ctx.rotate(specialStageRotation * 0.5);
                ctx.fillStyle = 'rgba(72, 126, 176, 0.3)'; // Cyan Bird
                ctx.beginPath();
                ctx.moveTo(0, 0); ctx.lineTo(-40, -10); ctx.lineTo(-20, 20); ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        }

        // --- Rotating Maze ---
        ctx.save();
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.rotate(-specialStageRotation); // Stage rotates opposite to player gravity

        // Maze Grid (Blocks)
        const gridSize = 12;
        const cellSize = 60;
        ctx.lineWidth = 4;
        for (let i = -7; i <= 7; i++) {
            for (let j = -7; j <= 7; j++) {
                const dist = Math.sqrt(i*i + j*j);
                const isWall = (dist > 5.5 && dist < 6.5);
                const isObstacle = (Math.abs(i) === 3 && Math.abs(j) === 3);

                if (isWall || isObstacle) {
                    ctx.fillStyle = (i + j) % 2 ? '#ff5e57' : '#ffc048';
                    ctx.fillRect(i * cellSize - 25, j * cellSize - 25, 50, 50);
                    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                    ctx.strokeRect(i * cellSize - 25, j * cellSize - 25, 50, 50);
                }
            }
        }

        // Chaos Emerald (Pulsating in center)
        if (!hasEmerald) {
            emeraldScale = 1 + Math.sin(Date.now() / 200) * 0.2;
            const colors = ['#00d2ff', '#3df5b8', '#ff4d4d', '#ff9f43'];
            const color = colors[Math.floor(Date.now() / 150) % colors.length];
            
            ctx.save();
            ctx.scale(emeraldScale, emeraldScale);
            ctx.fillStyle = color;
            ctx.shadowBlur = 20;
            ctx.shadowColor = color;
            ctx.beginPath();
            ctx.moveTo(0, -30);
            ctx.lineTo(-30, 0);
            ctx.lineTo(0, 30);
            ctx.lineTo(30, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        // --- Character (Ball Form) ---
        ctx.restore();
        ctx.save();
        ctx.translate(canvas.width/2 + player.x, canvas.height/2 + player.y);
        ctx.rotate(Date.now() / 50); // Fast spinning
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.fill();
        // Quills in ball
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI, false);
        ctx.stroke();
        ctx.restore();
        
        // UI
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.font = '700 32px Outfit';
        ctx.fillText(hasEmerald ? 'CHAOS EMERALD GET!' : 'SPECIAL STAGE', canvas.width/2, 100);
        ctx.font = '18px Outfit';
        ctx.fillText(hasEmerald ? 'COLETANDO ESMERALDA...' : 'Pegue a Esmeralda para avançar!', canvas.width/2, 140);

        requestAnimationFrame(gameLoop);
        return;
    }

    // Sky Background based on Level
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    if (currentLevel === 'GREEN_HILL') {
        sky.addColorStop(0, '#0083FF');
        sky.addColorStop(0.4, '#8EE2FF');
        sky.addColorStop(0.6, '#00C2FF');
        sky.addColorStop(1, '#004A7F');
    } else if (currentLevel === 'MARBLE_ZONE') {
        sky.addColorStop(0, '#2d3436'); // Dark Marble Zone Sky
        sky.addColorStop(0.7, '#d63031'); // Lava Glow
        sky.addColorStop(1, '#ff7675');
    } else if (currentLevel === 'CHEMICAL_PLANT') {
        sky.addColorStop(0, '#000000'); // Dark City Sky
        sky.addColorStop(0.4, '#2c3e50');
        sky.addColorStop(0.8, '#2980b9');
        sky.addColorStop(1, '#3498db');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (currentLevel === 'GREEN_HILL') {
        // Distant Ocean Waves
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        const waveY = canvas.height * 0.65;
        ctx.fillRect(0, waveY, canvas.width, 2);

        // Parallax Palm Trees (Fake)
        for (let i = 0; i < 5; i++) {
            const tx = (i * 800 - camera.x * 0.2) % (canvas.width + 800);
            ctx.fillStyle = 'rgba(0, 80, 0, 0.15)';
            ctx.fillRect(tx - 400, canvas.height - 300, 10, 180); // Trunk
            ctx.beginPath();
            ctx.arc(tx - 400, canvas.height - 300, 40, 0, Math.PI * 2); // Leaves
            ctx.fill();
        }
    } else if (currentLevel === 'MARBLE_ZONE') {
        // Marble Zone Background
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        for (let i = 0; i < 10; i++) {
            const tx = (i * 500 - camera.x * 0.1) % (canvas.width + 500);
            ctx.fillRect(tx - 250, canvas.height - 400, 100, 400); // Pillars
        }
    } else if (currentLevel === 'CHEMICAL_PLANT') {
        // Chemical Plant Background (Pipes and Towers)
        ctx.fillStyle = 'rgba(243, 156, 18, 0.2)'; // Yellow structures
        for (let i = 0; i < 6; i++) {
            const tx = (i * 400 - camera.x * 0.15) % (canvas.width + 400);
            ctx.fillRect(tx - 200, canvas.height - 500, 120, 500);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(tx - 150, canvas.height - 450, 20, 450); // Vertical pipes
        }
    }

    // Draw Clouds
    clouds.forEach(c => c.draw());

    // Draw Particles
    particles.forEach(p => p.draw());

    ctx.save();
    ctx.translate(-camera.x, 0);

    // Filter chunks to draw only visible ones
    chunks.forEach(chunk => {
        if (chunk.x + chunk.width > camera.x && chunk.x < camera.x + canvas.width) {
            chunk.draw();
        }
    });

    player.draw();
    // Draw Boss
    if (boss) {
        ctx.save();
        ctx.translate(boss.x, boss.y + boss.vy);
        
        // Eggmobile (Silver Pod)
        ctx.fillStyle = boss.state === 'HIT' ? 'white' : '#b2bec3';
        ctx.beginPath();
        ctx.ellipse(0, 60, 60, 40, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#636e72';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Robotnik (Eggman)
        ctx.fillStyle = '#ff7675'; // Suit
        ctx.fillRect(-25, 0, 50, 40);
        ctx.fillStyle = '#fdb490'; // Skin
        ctx.beginPath();
        ctx.arc(0, -10, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fdcb6e'; // Mustache
        ctx.fillRect(-30, -15, 60, 10);
        ctx.fillStyle = 'black'; // Goggles
        ctx.fillRect(-15, -25, 30, 8);

        // Jets / Fire
        if (boss.isFiring) {
            ctx.fillStyle = '#ff793f';
            ctx.beginPath();
            ctx.moveTo(-15, 100);
            ctx.lineTo(15, 100);
            ctx.lineTo(0, 160 + Math.random() * 20);
            ctx.fill();
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath();
            ctx.arc(0, 100, 10, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = '#fdcb6e';
            ctx.fillRect(-10, 100, 20, 10 + Math.random() * 20);
        }

        ctx.restore(); // End Machine Translate

        // --- Swinging Mace (Green Hill only) ---
        if (currentLevel === 'GREEN_HILL') {
            ctx.save();
            // Already in camera space from main draw transform
            
            // Draw Chain links
            const links = 10;
            for (let i = 0; i <= links; i++) {
                const ratio = i / links;
                const lx = (boss.ballX || boss.x) + Math.sin(boss.swingAngle) * (160 * ratio);
                const ly = ((boss.ballY || boss.y + 60)) + Math.cos(boss.swingAngle) * (160 * ratio);
                
                ctx.strokeStyle = '#95a5a6';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.arc(lx, ly, 10, 0, Math.PI * 2);
                ctx.stroke();
                // Inner link detail
                ctx.strokeStyle = '#bdc3c7';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(lx, ly, 6, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Draw Giant Ball (Mace)
            ctx.save();
            ctx.translate(boss.maceX, boss.maceY);
            ctx.rotate(boss.swingAngle * 2); 
            
            // Ball Base
            ctx.fillStyle = '#6d4c41'; // Brownish Checkered Base
            ctx.beginPath();
            ctx.arc(0, 0, 45, 0, Math.PI * 2);
            ctx.fill();
            
            // Checkered Pattern
            ctx.fillStyle = '#4e342e';
            for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(0, 0, 45, a, a + Math.PI / 8);
                ctx.fill();
            }
            
            ctx.strokeStyle = '#2c3e50';
            ctx.lineWidth = 3;
            ctx.strokeRect(-45, -45, 90, 90);
            ctx.beginPath();
            ctx.arc(0, 0, 45, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore(); // End Mace Ball Rotate/Translate
            ctx.restore(); // End Mace World Translate
        }
    }

    ctx.restore(); // End world transform (camera)

    requestAnimationFrame(gameLoop);
}

function gameLoop() {
    update();
    draw();
}

// Kickoff
player.reset(); // Initialize with default character (Sonic)
gameLoop();
