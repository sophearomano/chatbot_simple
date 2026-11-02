// The eclipse behind the page: a WebGL shader that ignites on load, leans toward
// the pointer and flares with activity. Once a chat starts it sinks to the top
// edge so messages stay readable. Without WebGL the CSS glow in style.css stands in.
window.orb = (function () {
  const VERTEX = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
  const FRAGMENT = `
    precision highp float;
    uniform vec2 uCenter, uPoint;
    uniform vec2 uRes;
    uniform float uTime, uRadius, uEnergy, uChat, uIgnite;

    float hash(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * 0.1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float value = 0.0, weight = 0.5;
      for (int i = 0; i < 5; i++) {
        value += weight * noise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p;
        weight *= 0.5;
      }
      return value;
    }
    vec3 fire(float heat) {
      vec3 color = mix(vec3(0.42, 0.03, 0.10), vec3(0.98, 0.27, 0.07), smoothstep(0.08, 0.55, heat));
      color = mix(color, vec3(1.0, 0.70, 0.30), smoothstep(0.55, 1.05, heat));
      return mix(color, vec3(1.0, 0.96, 0.86), smoothstep(1.05, 1.8, heat));
    }

    void main() {
      vec2 pixel = gl_FragCoord.xy;
      vec2 uv = pixel / min(uRes.x, uRes.y);
      vec2 q = (pixel - uCenter) / uRadius - uPoint * 0.05;
      float d = length(q);
      vec2 dir = q / max(d, 0.001);
      float out_ = max(d - 1.0, 0.0);

      // Flames travel outward: the noise is sampled by direction and by distance over time.
      float flow = fbm(dir * 2.1 + vec2(d * 1.1 - uTime * 0.20, uTime * 0.05));
      float wisps = fbm(dir * 5.5 + flow * 2.4 + vec2(d * 2.6 - uTime * 0.34, -uTime * 0.06));
      float reach = (0.28 + 1.5 * flow * flow + uEnergy * 0.55) * mix(1.0, 0.3, uChat);
      float corona = exp(-out_ * 2.4 / reach) * (0.30 + 1.25 * wisps * wisps + 0.25 * flow);
      float limb = exp(-out_ * 30.0) * (0.9 + 0.5 * wisps);
      float halo = exp(-out_ * 0.85) * 0.14;
      float heat = (corona * (1.15 + uEnergy * 0.9) + limb * 1.25 + halo) * uIgnite * mix(1.0, 0.8, uChat);

      vec3 color = vec3(0.016, 0.010, 0.026);
      float cloud = fbm(uv * 1.5 + vec2(uTime * 0.012, 0.0));
      color += vec3(0.11, 0.025, 0.17) * cloud * cloud * (1.0 - 0.6 * uChat);

      // Round, faint stars that thin out behind the text column.
      vec2 edge = pixel / uRes - 0.5;
      vec2 grid = uv * 240.0;
      vec2 cell = floor(grid);
      float twinkle = 0.65 + 0.35 * sin(uTime * 1.2 + hash(cell + 7.0) * 40.0);
      float star = step(0.9945, hash(cell)) * smoothstep(0.42, 0.08, length(fract(grid) - 0.5));
      float room = 0.22 + 0.78 * smoothstep(0.24, 0.44, abs(edge.x));
      color += star * vec3(0.9, 0.85, 1.0) * (0.14 + 0.5 * hash(cell + 3.0)) * twinkle * room * (1.0 - uChat * 0.7);

      color += fire(heat) * smoothstep(0.0, 0.42, heat) * min(heat * 1.7, 1.0);

      float disc = smoothstep(1.0, 0.992, d);
      vec3 inside = vec3(0.012, 0.007, 0.012) + vec3(0.30, 0.07, 0.03) * pow(d, 14.0) * uIgnite;
      color = mix(color, inside, disc);

      color *= 1.0 - dot(edge, edge) * 0.9;
      color += (hash(pixel + fract(uTime)) - 0.5) / 180.0;
      gl_FragColor = vec4(color, 1.0);
    }`;

  const canvas = document.getElementById('orb');
  const spot = document.getElementById('orb-spot');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  const silent = { excite() {}, setChatting() {} };
  if (!gl) {
    document.body.classList.add('no-webgl');
    return silent;
  }

  function shader(type, source) {
    const unit = gl.createShader(type);
    gl.shaderSource(unit, source);
    gl.compileShader(unit);
    return unit;
  }
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    document.body.classList.add('no-webgl');
    return silent;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.bindAttribLocation(program, 0, 'p');
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const uniform = Object.fromEntries(['uRes', 'uCenter', 'uPoint', 'uTime', 'uRadius', 'uEnergy', 'uChat', 'uIgnite'].map((name) => [name, gl.getUniformLocation(program, name)]));

  const ease = (from, to, rate) => from + (to - from) * rate;
  const point = { x: 0, y: 0, toX: 0, toY: 0 };
  const orbit = { y: 0, radius: 0, ready: false };
  let scale = Math.min(devicePixelRatio, 1.5);
  let width = 0;
  let height = 0;
  let energy = 0;
  let chatting = false;
  let chat = 0;
  let frames = 0;
  let last = performance.now();
  let slow = 0;
  const born = last;

  function fit() {
    const nextWidth = Math.round(innerWidth * scale);
    const nextHeight = Math.round(innerHeight * scale);
    if (nextWidth === width && nextHeight === height) return;
    width = canvas.width = nextWidth;
    height = canvas.height = nextHeight;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(uniform.uRes, width, height);
  }

  // The disc sits exactly on the placeholder in the welcome screen, wherever the layout puts it.
  function target() {
    const box = spot.getBoundingClientRect();
    if (!chatting && box.width) return { y: box.top + box.height / 2, radius: box.width / 2 };
    // In a chat only a thin arc of it shows above the messages, like a horizon.
    const size = Math.min(innerWidth, innerHeight);
    return { y: 34 - size * 0.62, radius: size * 0.62 };
  }

  function draw(now) {
    const elapsed = (now - born) / 1000;
    const goal = target();
    orbit.y = orbit.ready ? ease(orbit.y, goal.y, 0.055) : goal.y;
    orbit.radius = orbit.ready ? ease(orbit.radius, goal.radius, 0.055) : goal.radius;
    orbit.ready = true;
    energy *= 0.965;
    chat = ease(chat, chatting ? 1 : 0, 0.05);
    point.x = ease(point.x, point.toX, 0.04);
    point.y = ease(point.y, point.toY, 0.04);
    const ignite = still ? 1 : 1 - (1 - Math.min(elapsed / 2.4, 1)) ** 3;

    gl.uniform1f(uniform.uTime, still ? 12 : elapsed + 20);
    gl.uniform1f(uniform.uRadius, orbit.radius * scale);
    gl.uniform2f(uniform.uCenter, (innerWidth / 2) * scale, height - orbit.y * scale);
    gl.uniform2f(uniform.uPoint, point.x, point.y);
    gl.uniform1f(uniform.uEnergy, energy);
    gl.uniform1f(uniform.uChat, chat);
    gl.uniform1f(uniform.uIgnite, ignite);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function loop(now) {
    if (document.hidden) {
      last = now;
      requestAnimationFrame(loop);
      return;
    }
    // Slow devices trade sharpness for smoothness; the glow hides the difference.
    slow += now - last > 34 ? 1 : 0;
    last = now;
    if (++frames === 50) {
      if (slow > 25 && scale > 0.5) {
        scale *= 0.75;
        fit();
      }
      frames = 0;
      slow = 0;
    }
    draw(now);
    requestAnimationFrame(loop);
  }

  const settle = () => {
    orbit.ready = false;
    fit();
    if (still) draw(performance.now());
  };
  addEventListener('resize', settle);
  addEventListener('pointermove', (event) => {
    point.toX = event.clientX / innerWidth - 0.5;
    point.toY = 0.5 - event.clientY / innerHeight;
  });
  document.fonts?.ready.then(settle);

  fit();
  if (still) draw(performance.now());
  else requestAnimationFrame(loop);

  return {
    excite(amount = 0.35) {
      energy = Math.min(energy + amount, 1.2);
    },
    setChatting(value) {
      chatting = value;
      if (still) {
        chat = value ? 1 : 0;
        orbit.ready = false;
        draw(performance.now());
      }
    },
  };
})();
