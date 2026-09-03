/**
 * Enhanced Cosmic Starfield Animation
 * High-performance canvas-based particle system for immersive background
 */
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('galaxy-bg');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let animationId = null;
  let stars = [];
  let particles = [];
  
  // Configuration
  const config = {
    starCount: 250,
    particleCount: 80,
    maxStarSize: 2.5,
    minStarSize: 0.5,
    starOpacity: 0.8,
    particleOpacity: 0.4,
    nebulaDensity: 0.15
  };

  // Resize handler
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  window.addEventListener('resize', resize);
  resize();

  // Star class
  class Star {
    constructor() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.radius = Math.random() * config.maxStarSize + config.minStarSize;
      this.vx = (Math.random() - 0.5) * 0.1;
      this.vy = (Math.random() - 0.5) * 0.1;
      this.opacity = Math.random() * 0.5 + 0.3;
      this.twinkleSpeed = Math.random() * 0.05 + 0.02;
      this.originalOpacity = this.opacity;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      // Wrap around edges
      if (this.x < 0) this.x = canvas.width;
      if (this.x > canvas.width) this.x = 0;
      if (this.y < 0) this.y = canvas.height;
      if (this.y > canvas.height) this.y = 0;

      // Twinkling effect
      this.opacity += (Math.random() - 0.5) * this.twinkleSpeed;
      this.opacity = Math.max(0.1, Math.min(this.originalOpacity, this.opacity));
    }

    draw() {
      ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Particle class for cosmic dust
  class Particle {
    constructor() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.radius = Math.random() * 1.5 + 0.5;
      this.vx = (Math.random() - 0.5) * 0.05;
      this.vy = (Math.random() - 0.5) * 0.05;
      this.hue = Math.random() * 30 + 240; // Purple/Blue
      this.opacity = Math.random() * config.nebulaDensity;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      if (this.x < 0) this.x = canvas.width;
      if (this.x > canvas.width) this.x = 0;
      if (this.y < 0) this.y = canvas.height;
      if (this.y > canvas.height) this.y = 0;
    }

    draw() {
      ctx.fillStyle = `hsla(${this.hue}, 100%, 50%, ${this.opacity})`;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Initialize
  for (let i = 0; i < config.starCount; i++) {
    stars.push(new Star());
  }
  for (let i = 0; i < config.particleCount; i++) {
    particles.push(new Particle());
  }

  // Animation loop
  function animate() {
    // Clear with semi-transparent overlay for trail effect
    ctx.fillStyle = 'rgba(13, 6, 31, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw nebula-like glow
    const gradient = ctx.createRadialGradient(
      canvas.width * 0.3, canvas.height * 0.3, 0,
      canvas.width * 0.3, canvas.height * 0.3, canvas.width
    );
    gradient.addColorStop(0, 'rgba(138, 43, 226, 0.05)');
    gradient.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Update and draw particles (nebula dust)
    particles.forEach(p => {
      p.update();
      p.draw();
    });

    // Update and draw stars
    stars.forEach(star => {
      star.update();
      star.draw();
    });

    animationId = requestAnimationFrame(animate);
  }

  animate();

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (animationId) cancelAnimationFrame(animationId);
  });
});
