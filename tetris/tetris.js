/* ===========================================================
   Mini Tetris — game logic
   - Score + persisted high score (localStorage)
   - Level / lines progression
   - AMOLED-friendly rendering (true-black cells)
   - Google Analytics: game events pushed to window.dataLayer
   =========================================================== */

(function () {
  'use strict';

  // ---- Config ----
  var COLS = 10;
  var ROWS = 20;
  var CELL = 24;                 // px, matches canvas 240x480
  var HS_KEY = 'miniTetrisHighScore';

  // Tetromino definitions (SRS-ish) with AMOLED-tuned neon colors.
  var SHAPES = {
    I: { color: '#00e5ff', cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    O: { color: '#ffd500', cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
    T: { color: '#c774ff', cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    S: { color: '#5dff8f', cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    Z: { color: '#ff5d5d', cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    J: { color: '#4d7bff', cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { color: '#ff9f2e', cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }
  };
  var TYPES = Object.keys(SHAPES);

  // Points per line-clear count (index = lines cleared).
  var LINE_SCORES = [0, 100, 300, 500, 800];

  // ---- DOM ----
  var boardCanvas = document.getElementById('board');
  var ctx = boardCanvas.getContext('2d');
  var nextCanvas = document.getElementById('next');
  var nextCtx = nextCanvas.getContext('2d');

  var scoreEl = document.getElementById('score');
  var highScoreEl = document.getElementById('high-score');
  var levelEl = document.getElementById('level');
  var linesEl = document.getElementById('lines');

  var overlay = document.getElementById('overlay');
  var overlayTitle = document.getElementById('overlay-title');
  var overlaySub = document.getElementById('overlay-sub');
  var startBtn = document.getElementById('start-btn');

  // ---- Analytics helper ----
  // Pushes a structured event onto the GA/GTM dataLayer. Safe no-op if GA
  // isn't configured — the events simply queue on the array.
  function track(event, params) {
    window.dataLayer = window.dataLayer || [];
    var payload = { event: event };
    if (params) {
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k)) payload[k] = params[k];
      }
    }
    window.dataLayer.push(payload);
  }

  // ---- State ----
  var grid, current, next, score, high, level, lines, dropInterval, dropTimer;
  var running = false;
  var paused = false;
  var rafId = null;
  var lastTime = 0;

  function emptyGrid() {
    var g = [];
    for (var r = 0; r < ROWS; r++) {
      g.push(new Array(COLS).fill(null));
    }
    return g;
  }

  function randomPiece() {
    var type = TYPES[(Math.random() * TYPES.length) | 0];
    var def = SHAPES[type];
    return {
      type: type,
      color: def.color,
      cells: def.cells.map(function (c) { return [c[0], c[1]]; }),
      x: 3,
      y: 0
    };
  }

  function loadHighScore() {
    var v = 0;
    try { v = parseInt(localStorage.getItem(HS_KEY), 10) || 0; } catch (e) { v = 0; }
    return v;
  }

  function saveHighScore(v) {
    try { localStorage.setItem(HS_KEY, String(v)); } catch (e) { /* ignore */ }
  }

  // ---- Collision ----
  function collides(piece, offX, offY, cells) {
    cells = cells || piece.cells;
    for (var i = 0; i < cells.length; i++) {
      var nx = piece.x + cells[i][0] + offX;
      var ny = piece.y + cells[i][1] + offY;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && grid[ny][nx]) return true;
    }
    return false;
  }

  // Rotate cells clockwise around a 4x4-ish origin.
  function rotate(cells) {
    return cells.map(function (c) { return [-c[1], c[0]]; });
  }

  function normalize(cells) {
    var minX = Math.min.apply(null, cells.map(function (c) { return c[0]; }));
    var minY = Math.min.apply(null, cells.map(function (c) { return c[1]; }));
    return cells.map(function (c) { return [c[0] - minX, c[1] - minY]; });
  }

  function tryRotate() {
    if (current.type === 'O') return;
    var rotated = normalize(rotate(current.cells));
    // Wall-kick attempts.
    var kicks = [0, -1, 1, -2, 2];
    for (var i = 0; i < kicks.length; i++) {
      if (!collides(current, kicks[i], 0, rotated)) {
        current.cells = rotated;
        current.x += kicks[i];
        return;
      }
    }
  }

  // ---- Piece placement ----
  function lockPiece() {
    for (var i = 0; i < current.cells.length; i++) {
      var x = current.x + current.cells[i][0];
      var y = current.y + current.cells[i][1];
      if (y >= 0) grid[y][x] = current.color;
    }
    clearLines();
    spawnNext();
  }

  function clearLines() {
    var cleared = 0;
    for (var r = ROWS - 1; r >= 0; r--) {
      var full = grid[r].every(function (c) { return c !== null; });
      if (full) {
        grid.splice(r, 1);
        grid.unshift(new Array(COLS).fill(null));
        cleared++;
        r++; // re-check the same row index after shift
      }
    }
    if (cleared > 0) {
      score += LINE_SCORES[cleared] * level;
      lines += cleared;
      var newLevel = Math.floor(lines / 10) + 1;
      if (newLevel !== level) {
        level = newLevel;
        dropInterval = Math.max(80, 800 - (level - 1) * 70);
        track('tetris_level_up', { level: level });
      }
      track('tetris_line_clear', { lines_cleared: cleared, score: score, level: level });
      updateHud();
    }
  }

  function spawnNext() {
    current = next;
    next = randomPiece();
    drawNext();
    if (collides(current, 0, 0)) {
      gameOver();
    }
  }

  // ---- Movement ----
  function move(dx) {
    if (!collides(current, dx, 0)) current.x += dx;
  }

  function softDrop() {
    if (!collides(current, 0, 1)) {
      current.y += 1;
      score += 1;
      updateHud();
    } else {
      lockPiece();
    }
  }

  function hardDrop() {
    var dist = 0;
    while (!collides(current, 0, 1)) {
      current.y += 1;
      dist++;
    }
    score += dist * 2;
    updateHud();
    lockPiece();
  }

  // ---- Rendering ----
  function drawCell(context, x, y, color, size) {
    size = size || CELL;
    context.fillStyle = color;
    context.fillRect(x * size, y * size, size, size);
    // subtle inner bevel for readability on true black
    context.fillStyle = 'rgba(255,255,255,0.14)';
    context.fillRect(x * size, y * size, size, 2);
    context.fillStyle = 'rgba(0,0,0,0.28)';
    context.fillRect(x * size, y * size + size - 2, size, 2);
  }

  function draw() {
    // Clear to true black (AMOLED).
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

    // Faint grid lines.
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1;
    for (var c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL + 0.5, 0);
      ctx.lineTo(c * CELL + 0.5, ROWS * CELL);
      ctx.stroke();
    }
    for (var r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL + 0.5);
      ctx.lineTo(COLS * CELL, r * CELL + 0.5);
      ctx.stroke();
    }

    // Settled blocks.
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (grid[y][x]) drawCell(ctx, x, y, grid[y][x]);
      }
    }

    // Ghost piece.
    if (current) {
      var ghostY = 0;
      while (!collides(current, 0, ghostY + 1)) ghostY++;
      ctx.globalAlpha = 0.22;
      for (var i = 0; i < current.cells.length; i++) {
        drawCell(ctx, current.x + current.cells[i][0], current.y + current.cells[i][1] + ghostY, current.color);
      }
      ctx.globalAlpha = 1;

      // Active piece.
      for (var j = 0; j < current.cells.length; j++) {
        var px = current.x + current.cells[j][0];
        var py = current.y + current.cells[j][1];
        if (py >= 0) drawCell(ctx, px, py, current.color);
      }
    }
  }

  function drawNext() {
    nextCtx.fillStyle = '#000';
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!next) return;
    var size = 20;
    var norm = normalize(next.cells);
    var maxX = Math.max.apply(null, norm.map(function (c) { return c[0]; })) + 1;
    var maxY = Math.max.apply(null, norm.map(function (c) { return c[1]; })) + 1;
    var offX = (nextCanvas.width / size - maxX) / 2;
    var offY = (nextCanvas.height / size - maxY) / 2;
    for (var i = 0; i < norm.length; i++) {
      drawCell(nextCtx, norm[i][0] + offX, norm[i][1] + offY, next.color, size);
    }
  }

  function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    linesEl.textContent = lines;
    if (score > high) {
      high = score;
      highScoreEl.textContent = high;
    }
  }

  // ---- Game loop ----
  function loop(time) {
    if (!running || paused) return;
    var delta = time - lastTime;
    dropTimer += delta;
    lastTime = time;
    if (dropTimer >= dropInterval) {
      dropTimer = 0;
      if (!collides(current, 0, 1)) {
        current.y += 1;
      } else {
        lockPiece();
      }
    }
    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ---- Game lifecycle ----
  function startGame() {
    grid = emptyGrid();
    score = 0;
    lines = 0;
    level = 1;
    dropInterval = 800;
    dropTimer = 0;
    high = loadHighScore();
    highScoreEl.textContent = high;
    next = randomPiece();
    current = randomPiece();
    drawNext();
    updateHud();
    running = true;
    paused = false;
    overlay.classList.add('hidden');
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
    track('tetris_game_start', { high_score: high });
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(rafId);
    var isHigh = false;
    if (score > loadHighScore()) {
      saveHighScore(score);
      high = score;
      highScoreEl.textContent = high;
      isHigh = true;
    }
    overlayTitle.textContent = 'GAME OVER';
    overlaySub.textContent = (isHigh ? 'New high score! ' : '') + 'Score ' + score;
    startBtn.textContent = 'PLAY AGAIN';
    overlay.classList.remove('hidden');
    track('tetris_game_over', {
      score: score,
      level: level,
      lines: lines,
      new_high_score: isHigh
    });
  }

  function togglePause() {
    if (!running) return;
    paused = !paused;
    if (paused) {
      overlayTitle.textContent = 'PAUSED';
      overlaySub.textContent = 'Press P to resume';
      startBtn.textContent = 'RESUME';
      overlay.classList.remove('hidden');
      track('tetris_pause');
    } else {
      overlay.classList.add('hidden');
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
      track('tetris_resume');
    }
  }

  // ---- Input ----
  function onKey(e) {
    if (e.key === 'p' || e.key === 'P') { togglePause(); return; }
    if (!running || paused) return;
    switch (e.key) {
      case 'ArrowLeft': move(-1); break;
      case 'ArrowRight': move(1); break;
      case 'ArrowDown': softDrop(); break;
      case 'ArrowUp': tryRotate(); break;
      case ' ': e.preventDefault(); hardDrop(); break;
      default: return;
    }
    draw();
  }

  function doAction(action) {
    if (!running || paused) return;
    if (action === 'left') move(-1);
    else if (action === 'right') move(1);
    else if (action === 'down') softDrop();
    else if (action === 'rotate') tryRotate();
    else if (action === 'drop') hardDrop();
    draw();
  }

  // ---- Wire up ----
  document.addEventListener('keydown', onKey);

  startBtn.addEventListener('click', function () {
    if (paused) { togglePause(); return; }
    startGame();
  });

  var touchBtns = document.querySelectorAll('.tbtn');
  for (var i = 0; i < touchBtns.length; i++) {
    touchBtns[i].addEventListener('click', function (e) {
      doAction(e.currentTarget.getAttribute('data-action'));
    });
  }

  // Initial paint.
  high = loadHighScore();
  highScoreEl.textContent = high;
  grid = emptyGrid();
  draw();
})();
